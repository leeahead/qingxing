// 记忆架构：L0 原文 → L1 原子事实 → L2 场景 → L3 画像。
//
// v6.0 的洞察流只读 L3 + 最近几个 L2，不读 L0 原文。
// 这件事分成两半实现：
//   L1/L2 完全在本地算（分词、用词倾向、按共享词聚类）——不花 token，记录一进来就更新；
//   L3 由模型每 7 天压缩一次（首次读过去 30 天，之后读增量），保留最多 12 个版本。
//
// 之所以不把 L2 也交给模型：每次记一条就调一次接口，既慢又贵，
// 而「哪些话在一起来自同一件事」用共享词就能分得足够好。

import type { Entry, Scene, UserProfile } from './types';
import { addDays, dayOf, today, uid } from './utils';
import { termsFor } from './topics';

/* ─────────────────────────── L1：原子事实（本地） ─────────────────────────── */

/**
 * 用词倾向。不是情绪识别，只是「这批话里出现了哪类词」。
 * 场景卡上的情绪基调由它来，模型只负责读，不负责猜。
 */
const MOOD_WORDS = {
  heavy: ['烦', '累', '焦虑', '担心', '压力', '失望', '生气', '委屈', '烦躁', '卡住', '拖', '矛盾', '吵', '冷淡', '无力', '迷茫', '抗拒', '尴尬', '崩', '熬夜', '失眠', '后悔', '烦人', '不舒服'],
  light: ['开心', '舒服', '顺', '满意', '期待', '感谢', '轻松', '痛快', '成了', '定了', '喜欢', '有劲', '放松', '值得'],
  think: ['想', '考虑', '为什么', '值不值', '选择', '决定', '计划', '复盘', '排查', '要不要', '如果', '意味着'],
};

function hitCount(texts: string[], list: string[]): number {
  const joined = texts.join(' ');
  return list.reduce((sum, word) => sum + (joined.includes(word) ? 1 : 0), 0);
}

/** 一批文字的情绪基调，给 L2 场景用。 */
export function moodOf(texts: string[]): string {
  const heavy = hitCount(texts, MOOD_WORDS.heavy);
  const light = hitCount(texts, MOOD_WORDS.light);
  const think = hitCount(texts, MOOD_WORDS.think);
  if (!heavy && !light && !think) return '语调平';
  const top = Math.max(heavy, light, think);
  if (top === think) return '在反复想这件事';
  if (heavy && light) return '有起伏';
  return top === heavy ? '偏沉重' : '偏轻快';
}

/* ─────────────────────────── L2：场景层（本地，实时更新） ─────────────────────────── */

/** 场景窗口：只聚合最近 45 天的记录；更早的交给画像层。 */
const SCENE_WINDOW_DAYS = 45;
/** 无活动多久之后归档（不再进入洞察的上下文）。 */
const SCENE_ARCHIVE_DAYS = 14;

const jaccard = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const hit = a.filter(item => setB.has(item)).length;
  const setA = new Set(a);
  return hit / (setA.size + b.length - hit);
};

/** 两个场景是不是同一件事：名字互相包含，或关键词高度重叠。 */
const sameScene = (a: Scene, theme: string, keywords: string[]) =>
  a.theme.includes(theme) || theme.includes(a.theme) || jaccard(a.keywords, keywords) >= 0.5;

/**
 * 把最近的记录聚成场景块。
 * 已有场景优先续用（保持 id 与 createdAt 不变），新记录找不到归属才开新场景。
 * 14 天没有新记录的自动归档，不删除——它还会作为画像的原料。
 */
export function buildScenes(entries: Entry[], existing: Scene[] = [], limit = 8): Scene[] {
  const cutoff = addDays(today(), -SCENE_WINDOW_DAYS);
  const recent = entries
    .filter(entry => dayOf(entry.createdAt) >= cutoff)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!recent.length) return existing.map(scene => ({ ...scene, archived: dayOf(scene.lastActiveAt) < addDays(today(), -SCENE_ARCHIVE_DAYS) || scene.archived }));

  const byId = new Map(recent.map(entry => [entry.id, entry]));
  const termIndex = new Map<string, string[]>();
  for (const entry of recent) {
    for (const term of termsFor(entry.content)) {
      const list = termIndex.get(term) || [];
      list.push(entry.id);
      termIndex.set(term, list);
    }
  }
  // 种子词：跨 2 个记录日以上、至少 2 条记录，且不是覆盖一切的大词。
  const seeds = [...termIndex.entries()]
    .map(([term, ids]) => {
      const unique = [...new Set(ids)];
      return { term, ids: unique, days: new Set(unique.map(id => dayOf(byId.get(id)?.createdAt || ''))).size };
    })
    .filter(item => item.ids.length >= 2 && item.days >= 2 && item.ids.length <= Math.max(8, recent.length * 0.7))
    .sort((a, b) => b.days - a.days || b.ids.length - a.ids.length)
    .slice(0, limit);

  const scenes: Scene[] = [];
  for (const seed of seeds) {
    const keywords = [...new Set(seed.ids.map(id => termsFor(byId.get(id)?.content || '')).flat())].slice(0, 8);
    const matched = existing.find(scene => sameScene(scene, seed.term, keywords));
    const texts = seed.ids.map(id => byId.get(id)?.content || '').filter(Boolean);
    const lastActiveAt = byId.get(seed.ids[seed.ids.length - 1])?.createdAt || new Date().toISOString();
    if (matched) {
      scenes.push({ ...matched, keywords: [...new Set([...matched.keywords, ...keywords])].slice(0, 8), entryIds: [...new Set([...matched.entryIds, ...seed.ids])], lastActiveAt, archived: false });
      continue;
    }
    scenes.push({ id: uid(), theme: seed.term, mood: moodOf(texts), keywords, entryIds: seed.ids, lastActiveAt, createdAt: byId.get(seed.ids[0])?.createdAt || lastActiveAt, archived: false });
  }
  // 老场景这一轮没有新记录：先留 14 天，超时就归档；归档后不再进洞察上下文，但画像还能读到。
  for (const scene of existing) {
    if (scenes.some(item => item.id === scene.id)) continue;
    const archived = dayOf(scene.lastActiveAt) < addDays(today(), -SCENE_ARCHIVE_DAYS);
    scenes.push({ ...scene, archived });
  }
  return scenes
    .filter(scene => scene.entryIds.some(id => byId.has(id) || scene.archived))
    .sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)) || b.lastActiveAt.localeCompare(a.lastActiveAt));
}

/** 洞察生成时只读最近的活跃场景。 */
export const activeScenes = (scenes: Scene[], count = 3): Scene[] =>
  scenes.filter(scene => !scene.archived).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)).slice(0, count);

/** 注入提示词的 L2 块：每个场景约 50 字，只给主题、基调与常提到的词。 */
export function sceneBlock(scenes: Scene[]): string {
  if (!scenes.length) return '（最近还没有成形的场景）';
  return scenes.map(scene => {
    const count = scene.entryIds.length;
    return `- 「${scene.theme}」：${scene.mood}，常提到${scene.keywords.slice(0, 5).map(word => `「${word}」`).join('、') || '（没有明显关键词）'}；${count} 条，最近一次 ${dayOf(scene.lastActiveAt)}`;
  }).join('\n');
}

/* ─────────────────────────── L3：画像层（模型，每 7 天） ─────────────────────────── */

/** 画像多久更新一次；洞察生成节奏比它高得多，画像必须稳。 */
export const PROFILE_INTERVAL_DAYS = 7;
/** 画像历史最多留几版（约 3 个月）。 */
export const PROFILE_HISTORY_LIMIT = 12;
/** 首次生成读多久以前的原文；已经有画像时只读增量。 */
const FIRST_WINDOW_DAYS = 30;

/** 该不该更新画像：从没生成过，或者距上次已满 7 天。 */
export function profileDue(lastBuildAt: string | undefined, now = Date.now()): boolean {
  if (!lastBuildAt) return true;
  const at = Date.parse(lastBuildAt);
  if (!Number.isFinite(at)) return true;
  return now - at >= PROFILE_INTERVAL_DAYS * 86400000;
}

/** 这一轮画像要读哪些原文：首次读 30 天，之后只读上次更新以后的增量（最少 12 条）。 */
export function profileSourceEntries(entries: Entry[], lastBuildAt?: string): { list: Entry[]; window: string } {
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!lastBuildAt) {
    const cutoff = addDays(today(), -FIRST_WINDOW_DAYS);
    const list = sorted.filter(entry => dayOf(entry.createdAt) >= cutoff);
    return { list: list.length ? list : sorted.slice(-Math.min(30, sorted.length)), window: `首次生成：最近 ${FIRST_WINDOW_DAYS} 天` };
  }
  const fresh = sorted.filter(entry => entry.createdAt > lastBuildAt);
  if (fresh.length < 12) {
    // 增量太少时往前多拿一点，避免画像被几条碎语带偏。
    const pad = sorted.slice(-Math.min(24, sorted.length));
    return { list: [...new Map([...pad, ...fresh].map(entry => [entry.id, entry])).values()], window: `增量 ${fresh.length} 条 + 之前的 ${pad.length} 条` };
  }
  return { list: fresh.slice(-80), window: `自上次画像以来的 ${fresh.length} 条` };
}

/**
 * 画像里注入洞察提示词的那一块。正文（narrative）优先，四个骨架数组补在后面。
 * 提示词与解析在 lib/ai.ts：这里只管「读哪段、留几版、怎么拼成上下文」。
 */
export function profileBlock(profile: UserProfile | null): string {
  if (!profile) return '';
  const lines = [
    'L3 画像（这是你自己读这个人的方式，不是对他的结论，也不要照着念给他听）：',
    profile.narrative,
  ];
  if (profile.patterns.length) lines.push(`常见模式：${profile.patterns.join('；')}`);
  if (profile.values.length) lines.push(`在意的事：${profile.values.join('；')}`);
  if (profile.tensions.length) lines.push(`长期拉扯：${profile.tensions.join('；')}`);
  if (profile.currentThemes.length) lines.push(`眼下主题：${profile.currentThemes.join('；')}`);
  return lines.join('\n');
}

/** 画像的历史，用于设置页显示「它看我的方式是怎么变的」。 */
export const keepProfileVersions = (list: UserProfile[]): UserProfile[] =>
  [...list].sort((a, b) => b.version - a.version).slice(0, PROFILE_HISTORY_LIMIT).sort((a, b) => a.version - b.version);

/* ─────────────────────────── 记录变化后的增量 ─────────────────────────── */

/** 上次画像之后新增了多少条——决定要不要现在就更新。 */
export function freshEntryCount(entries: Entry[], since?: string): number {
  if (!since) return entries.length;
  return entries.filter(entry => entry.createdAt > since).length;
}

/** 洞察至少要有多少条记录才不纯属瞎猜（本地门槛，不调接口）。 */
export const MIN_ENTRIES_FOR_INSIGHT = 12;

/** 距离「可以开始出洞察」还差多少条，给首页的等待状态用。 */
export function entriesNeeded(entries: Entry[]): number {
  return Math.max(0, MIN_ENTRIES_FOR_INSIGHT - entries.length);
}
