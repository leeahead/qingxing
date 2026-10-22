// 纯函数工具：日期、id、本地存储键与界面用到的固定文案。
// 这些函数不依赖 React，也不读写状态，方便单独复用和测试。

import type { ObservationType } from './types';

export const VERSION = '5.1.1 · 记忆会自己长出来';

export const keys = {
  entries: 'qingxing.entries.v1',
  tasks: 'qingxing.tasks.v1',
  judgments: 'qingxing.judgments.v1',
  memoryFeedback: 'qingxing.memory-feedback.v1',
  summaries: 'qingxing.summaries.v1',
  digests: 'qingxing.digests.v1',
  profile: 'qingxing.profile.v1',
  threadNotes: 'qingxing.thread-notes.v1',
};

/** 备份文件的 schema 版本；新增数据结构时要一起升级并兼容旧备份。 */
export const SCHEMA_VERSION = 9;

export const dayOf = (value: string | Date) => new Date(value).toLocaleDateString('sv-SE');
export const today = () => dayOf(new Date());
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const timeOf = (date: string) => new Date(date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
export const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
export const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
export const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** 所在自然周的周一（以 sv-SE 的 yyyy-mm-dd 表示）。 */
export const weekStart = (value: string) => { const d = new Date(`${dayOf(value)}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d); };
export const addDays = (value: string, days: number) => { const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate() + days); return dayOf(d); };
/** 距今天数（0 = 今天）。 */
export const daysAgo = (value: string) => Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));

/**
 * 连续有记录的天数。今天还没记时从昨天起算——
 * 白天打开应用不应该看到自己的连续天数已经断了。
 */
export function streakOf(counts: Map<string, number>): number {
  let cursor = today();
  if (!counts.get(cursor)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (counts.get(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}

export const navItems: { id: 'now' | 'review' | 'ask'; label: string; icon: string }[] = [
  { id: 'now', label: '记录', icon: 'edit' },
  { id: 'review', label: '回看', icon: 'spark' },
  { id: 'ask', label: '提问', icon: 'chat' },
];

export const confidenceLabels = { weak: '证据较弱', medium: '证据中等', strong: '证据较强' } as const;
export const insightKindLabels = { repeat: '反复出现', change: '变化', tension: '矛盾', connection: '与过去相连', detail: '一个细节' } as const;
export const threadTrendLabels = { up: '最近更频繁', down: '最近变少', flat: '一直没断' } as const;
export const observationTypeLabels: Record<ObservationType, string> = { pattern: '模式', change: '变化', tension: '矛盾', question: '问题', hypothesis: '假设' };
export const profileKindLabels = { identity: '我是谁', value: '我在意的事', person: '重要的人', focus: '眼下的焦点' } as const;
export const judgmentStatusLabels = { candidate: '待核对', confirmed: '已确认', uncertain: '暂不确定', withdrawn: '已撤回' } as const;
export const correctionReasons = ['不准确', '只发生过一次', '忽略了另一条记录', '当时情境不同', '已经变化了', '以后不再使用'];
