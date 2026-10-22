// 本地记忆脉络：不调用 AI，把反复出现的话题聚成「线索」。
//
// 线索不是结论，只是把散落的记录按同一个词放回同一条时间线上。
// 它让记录页在写下第一条之后就有东西可看，也让回看页有一条条能点进去的线。

import type { Entry } from './types';
import { addDays, dayOf, today } from './utils';
import { termsFor } from './topics';

export type EntryThread = {
  id: string;
  topic: string;
  terms: string[];
  entryIds: string[];
  days: string[];
  start: string;
  end: string;
  count: number;
  /** 最近 14 天 / 前 14 天，用来判断这条线是在升温还是变淡 */
  recentCount: number;
  previousCount: number;
  trend: 'up' | 'flat' | 'down';
};

export type DayMemory = { entry: Entry; label: string };

const TERM_CACHE = new Map<string, string[]>();

/**
 * 分词器会把「定下来」「说清楚」切成通用的补语和轻动词。
 * 它们在不同话题里都会出现，做线索只会占满屏幕，不能说明任何事。
 */
const THREAD_STOP = new Set([
  '下来', '起来', '出来', '回来', '过去', '上来', '下去', '进去',
  '清楚', '明白', '知道', '觉得', '感觉', '希望', '应该', '需要',
  '可以', '没有', '不是', '还是', '已经', '可能', '一直', '有点',
  '非常', '真的', '其实', '然后', '但是', '因为', '所以', '如果',
  '就是', '不会', '不能', '不要', '只是', '还有', '一起', '自己',
  '我们', '你们', '他们', '她们', '大家', '别人', '这么', '那么',
  '什么', '怎么', '为什么', '时候', '时间', '一次', '一件', '一样',
  '一点', '很多', '比较', '确实', '当然', '终于', '于是', '甚至',
  '完全', '基本', '特别', '总是', '开始', '结束', '认为', '发现',
  '看到', '做到', '说到', '想到', '记得', '今天', '昨天', '明天',
]);


/** 分词结果按「记录 id + 更新时间」缓存，避免每次渲染把所有历史重新分词。 */
function cachedTerms(entry: Entry): string[] {
  const key = `${entry.id}:${entry.updatedAt}`;
  const hit = TERM_CACHE.get(key);
  if (hit) return hit;
  const terms = termsFor(entry.content);
  if (TERM_CACHE.size > 6000) TERM_CACHE.clear();
  TERM_CACHE.set(key, terms);
  return terms;
}

const overlapRatio = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  const hit = a.filter(id => set.has(id)).length;
  return hit / Math.min(a.length, b.length);
};

/** 两条线索覆盖的记录有多接近；用并集做分母，避免小话题被大话题整个吞掉。 */
const similarity = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const hit = a.filter(id => setB.has(id)).length;
  return hit / (a.length + b.length - hit);
};

/**
 * 从记录里找出反复出现的线索。
 * 门槛：至少跨 3 个记录日、至少 3 条记录；过于普遍（覆盖六成以上记录）的词不算线索。
 */
export function buildThreads(entries: Entry[], limit = 8): EntryThread[] {
  if (entries.length < 3) return [];
  const now = today();
  const cutoff = addDays(now, -240);
  const recentStart = addDays(now, -13);
  const previousStart = addDays(now, -27);

  const buckets = new Map<string, { entries: Entry[]; days: Set<string> }>();
  for (const entry of entries) {
    const day = dayOf(entry.createdAt);
    if (day < cutoff) continue;
    for (const term of cachedTerms(entry)) {
      const bucket = buckets.get(term) || { entries: [], days: new Set<string>() };
      if (!bucket.entries.some(item => item.id === entry.id)) bucket.entries.push(entry);
      bucket.days.add(day);
      buckets.set(term, bucket);
    }
  }

  const candidates = [...buckets.entries()]
    .filter(([topic]) => !THREAD_STOP.has(topic))
    .filter(([, bucket]) => bucket.days.size >= 3 && bucket.entries.length >= 3)
    .filter(([, bucket]) => bucket.entries.length <= Math.max(6, entries.length * 0.6))
    .map(([topic, bucket]) => {
      const sorted = [...bucket.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const days = [...bucket.days].sort();
      const recentCount = sorted.filter(entry => dayOf(entry.createdAt) >= recentStart).length;
      const previousCount = sorted.filter(entry => { const day = dayOf(entry.createdAt); return day >= previousStart && day < recentStart; }).length;
      const trend: EntryThread['trend'] = recentCount >= 2 && recentCount >= previousCount * 1.5 ? 'up' : previousCount >= 2 && previousCount >= recentCount * 1.5 ? 'down' : 'flat';
      return {
        id: topic, topic, terms: [topic], entryIds: sorted.map(entry => entry.id), days,
        start: days[0], end: days[days.length - 1], count: sorted.length,
        recentCount, previousCount, trend,
      };
    })
    .sort((a, b) => (b.days.length * 3 + b.recentCount * 2 + b.count * 0.5) - (a.days.length * 3 + a.recentCount * 2 + a.count * 0.5));

  // 同一批记录常会被切成几个近义词（项目 / 排期、产品 / 报告）。
  // 记录集合几乎一致时只保留得分更高的那条，避免同一件事占满整屏。
  const kept: EntryThread[] = [];
  for (const candidate of candidates) {
    const duplicated = kept.some(item => {
      const overlap = similarity(item.entryIds, candidate.entryIds);
      const contains = item.topic.includes(candidate.topic) || candidate.topic.includes(item.topic);
      return overlap >= 0.75 || (contains && overlapRatio(item.entryIds, candidate.entryIds) >= 0.65);
    });
    if (!duplicated) kept.push(candidate);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** 这条记录属于哪条线索（用来在记录下面显示「接上了某条线」）。 */
export function threadForEntry(entry: Entry, threads: EntryThread[]): EntryThread | null {
  return threads.find(thread => thread.entryIds.includes(entry.id)) || null;
}

/**
 * 往年今天 / 一个月前 / 三个月前 / 上周今天。
 * 优先同月同日，其次固定间隔；没有就返回空。
 */
export function memoriesOnThisDay(entries: Entry[], day: string): DayMemory[] {
  const [, month, date] = day.split('-');
  const sameDate = entries.filter(entry => {
    const value = dayOf(entry.createdAt);
    const [year, m, d] = value.split('-');
    return m === month && d === date && year !== day.split('-')[0];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sameDate.length) {
    return sameDate.slice(0, 2).map(entry => ({
      entry,
      label: `${Number(day.split('-')[0]) - Number(dayOf(entry.createdAt).split('-')[0])} 年前的今天`,
    }));
  }
  const rounds: [number, string][] = [[30, '一个月前'], [90, '三个月前'], [7, '上周今天']];
  for (const [days, label] of rounds) {
    const target = addDays(day, -days);
    const list = entries.filter(entry => dayOf(entry.createdAt) === target).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (list.length) return list.slice(0, 2).map(entry => ({ entry, label }));
  }
  return [];
}
