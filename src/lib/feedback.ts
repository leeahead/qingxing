// 用户反馈闭环：👍 / 👎 怎么变成它下一次的取向。
//
// 这一层不追求「算得准」，只追求两件事：
//   1) 用户否定过的方向，短期内硬性不再推（Harness 里有一条规则专门拦它）；
//   2) 用户点头过的方向，在下一次生成与画像更新时说明「这类联想他认」。
// 偏好报告不进界面，只作为提示词的一段内部上下文——用户不需要看到它。

import type { Insight, InsightRun } from './types';
import { addDays, today } from './utils';

export type FeedbackValue = 'positive' | 'negative';

/** 打上反馈；重复点同一个方向就当取消（用户可以改主意）。 */
export function applyFeedback(insights: Insight[], id: string, value: FeedbackValue): Insight[] {
  return insights.map(item => item.id !== id ? item : { ...item, feedback: item.feedback === value ? null : value });
}

const withinDays = (value: string, days: number) => value >= addDays(today(), -days);

const norm = (value?: string) => (value || '').trim().toLowerCase().slice(0, 12);

export function directionsWithFeedback(insights: Insight[], value: FeedbackValue, days = 7): string[] {
  const since = addDays(today(), -days);
  return [...new Set(insights.filter(item => item.feedback === value && item.createdAt >= since && item.direction).map(item => norm(item.direction)))].filter(Boolean);
}

/** 近 7 天被点过「不对」的方向：Harness 直接拦，模型也被明确要求避开。 */
export const avoidedDirections = (insights: Insight[], days = 7): string[] => directionsWithFeedback(insights, 'negative', days);

export const preferredDirections = (insights: Insight[], days = 7): string[] => directionsWithFeedback(insights, 'positive', days);

/** 这条洞察属于哪个方向；没有标签时按内容里的词兜一个，保证反馈闭环不会空转。 */
/**
 * 注入提示词的偏好块。
 * 只说方向与数量，不复制洞察原文——模型不需要再看见一次自己说过的话。
 */
export function buildPreferenceBlock(insights: Insight[]): string {
  if (!insights.length) return '';
  const liked = preferredDirections(insights);
  const disliked = avoidedDirections(insights);
  if (!liked.length && !disliked.length) return '';
  const lines = ['用户对这些方向的反应（只有他点过👍/👎的才算数）：'];
  if (liked.length) lines.push(`- 认过的方向：${liked.join('、')}。同类联想更容易命中，可以往这里靠，但不要重复他说过的原话。`);
  if (disliked.length) lines.push(`- 否掉过的方向：${disliked.join('、')}。换角度，别绕回去；不用道歉，也不用解释为什么之前那么猜。`);
  lines.push('这份反馈是调参用的，不要转述给用户，也不要问他「上次那条对不对」。');
  return lines.join('\n');
}

/* ─────────────────────────── 产出节奏 ─────────────────────────── */

/** 默认每天想留下几条；设置页可以调成 3 / 5 / 8。 */
export const DEFAULT_DAILY_TARGET = 5;
export const DAILY_TARGET_CHOICES = [3, 5, 8];
/** 一次运行最多尝试几条（Harness 通过率大约 1/3，留出重试空间） */
export const RUN_ATTEMPT_LIMIT = 8;
/** 一天的尝试预算：按目标条数放大，最多 48 次，避免无限烧 token。 */
export const attemptBudget = (preferred = DEFAULT_DAILY_TARGET) => Math.min(48, Math.max(12, preferred * 6));

/** 一天的目标条数：以用户选的档为基准，同一天内稳定，偶尔多一条。 */
export function dailyTarget(day: string, carry = 0, preferred = DEFAULT_DAILY_TARGET): number {
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return Math.max(1, Math.min(preferred + 3, preferred + (hash % 2) + Math.max(0, carry)));
}

export const acceptedOn = (insights: Insight[], day: string): number =>
  insights.filter(item => item.createdAt.slice(0, 10) === day).length;

export const runOf = (runs: InsightRun[], day: string): InsightRun | undefined =>
  runs.find(run => run.day === day);

export const attemptsToday = (runs: InsightRun[], day: string): number => runOf(runs, day)?.attempts ?? 0;

/** 今天还剩多少次尝试预算。 */
export const attemptsLeft = (runs: InsightRun[], day: string = today(), preferred = DEFAULT_DAILY_TARGET): number =>
  Math.max(0, attemptBudget(preferred) - attemptsToday(runs, day));

/**
 * 昨天没发够，今天补。
 * 只看「昨天有尝试过但没收够」的情况——一整天没打开应用不算欠。
 */
export function carryOver(insights: Insight[], runs: InsightRun[], preferred = DEFAULT_DAILY_TARGET): number {
  const yesterday = addDays(today(), -1);
  const run = runOf(runs, yesterday);
  if (!run || !run.attempts) return 0;
  const target = dailyTarget(yesterday, 0, preferred);
  return Math.max(0, Math.min(3, target - acceptedOn(insights, yesterday)));
}

/** 今天还该生成几条（已经够了、或者预算用完就返回 0）。 */
export function remainingQuota(insights: Insight[], runs: InsightRun[], preferred = DEFAULT_DAILY_TARGET, day = today()): number {
  if (attemptsLeft(runs, day, preferred) <= 0) return 0;
  const need = dailyTarget(day, carryOver(insights, runs, preferred), preferred) - acceptedOn(insights, day);
  return Math.max(0, need);
}

/** 首次进入：24 小时内至少 3 条、至多 5 条（不低于用户选的档）。 */
export function firstRunQuota(insights: Insight[], preferred = DEFAULT_DAILY_TARGET): number {
  if (insights.length) return 0;
  return Math.min(8, Math.max(3, preferred));
}

/* ─────────────────────────── 自检通过率 ─────────────────────────── */

/** 把一次运行的丢弃原因累加到当天的账本上。 */
export function mergeRun(runs: InsightRun[], day: string, addedAttempts: number, addedAccepted: number, reasons: string[]): InsightRun[] {
  const current = runOf(runs, day);
  const merged: InsightRun = {
    day,
    attempts: (current?.attempts ?? 0) + addedAttempts,
    accepted: (current?.accepted ?? 0) + addedAccepted,
    rejected: [...(current?.rejected ?? []), ...reasons].slice(-40),
  };
  return [...runs.filter(run => run.day !== day), merged].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);
}

/** 近 7 天的通过率与被丢弃原因的次数，设置页用它决定要不要放宽自检。 */
export function qualityStats(insights: Insight[], runs: InsightRun[]) {
  const since = addDays(today(), -7);
  const window = runs.filter(run => run.day >= since);
  const attempts = window.reduce((sum, run) => sum + run.attempts, 0);
  const accepted = window.reduce((sum, run) => sum + run.accepted, 0);
  const counts = new Map<string, number>();
  for (const run of window) for (const reason of run.rejected) counts.set(reason, (counts.get(reason) || 0) + 1);
  const rejected = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const judged = insights.filter(item => item.feedback === 'positive' || item.feedback === 'negative');
  return {
    attempts,
    accepted,
    /** 每几条候选留下 1 条；0 表示还没数据 */
    ratio: accepted ? Math.round((attempts / accepted) * 10) / 10 : 0,
    topReasons: rejected.slice(0, 4).map(([reason, count]) => ({ reason, count })),
    positive: insights.filter(item => item.feedback === 'positive').length,
    negative: insights.filter(item => item.feedback === 'negative').length,
    judged: judged.length,
  };
}

export type QualityStats = ReturnType<typeof qualityStats>;
