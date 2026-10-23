// 纯函数工具：日期、id、本地存储键与界面用到的固定文案。
// 这些函数不依赖 React，也不读写状态，方便单独复用和测试。

import type { Settings } from './types';

export const VERSION = '6.0.1 · 洞察流';

export const keys = {
  entries: 'qingxing.entries.v1',
  tasks: 'qingxing.tasks.v1',
  judgments: 'qingxing.judgments.v1',
  memoryFeedback: 'qingxing.memory-feedback.v1',
  summaries: 'qingxing.summaries.v1',
  digests: 'qingxing.digests.v1',
  profile: 'qingxing.profile.v1',
  threadNotes: 'qingxing.thread-notes.v1',
  insights: 'qingxing.insights.v1',
  userProfile: 'qingxing.user-profile.v1',
  profileVersions: 'qingxing.profile-versions.v1',
  scenes: 'qingxing.scenes.v1',
  runs: 'qingxing.insight-runs.v1',
};

/** 备份文件的 schema 版本；新增数据结构时要一起升级并兼容旧备份。v10 = 洞察流（画像层 + 洞察 + 场景）。 */
export const SCHEMA_VERSION = 10;

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

export const navItems: { id: 'insight' | 'memory' | 'settings'; label: string; icon: string }[] = [
  { id: 'insight', label: '洞察流', icon: 'spark' },
  { id: 'memory', label: '记忆', icon: 'calendar' },
  { id: 'settings', label: '偏好与数据', icon: 'settings' },
];

const SETTING_TEXT_FIELDS = ['baseUrl', 'apiKey', 'model', 'embedModel', 'lastAutoObservationAt', 'lastAutoProfileAt', 'lastAutoDigestAt', 'lastInsightAt', 'lastProfileBuildAt', 'rawReadMonth'] as const;
const SETTING_NUMBER_FIELDS = ['insightTemperature', 'insightDailyTarget', 'rawReadCount'] as const;

/**
 * 合并几处模型设置，按传入顺序取优先级：先出现的非空值胜出，后面只补空缺。
 * 老设备的模型地址与密钥可能只写在其中一处（IndexedDB 主存或 localStorage 镜像），
 * 直接整体覆盖会让已经配好的模型“凭空消失”，这就是空的那一边不能压过有值的那一边。
 */
export function mergeSettings(...sources: (Partial<Settings> | undefined | null)[]): Settings {
  const merged: Settings = { baseUrl: '', apiKey: '', model: '' };
  for (const source of sources) {
    if (!source) continue;
    for (const key of SETTING_TEXT_FIELDS) {
      const value = source[key];
      if (typeof value === 'string' && value.trim() && !merged[key]) merged[key] = value;
    }
    for (const key of SETTING_NUMBER_FIELDS) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value) && merged[key] === undefined) merged[key] = value;
    }
    if (typeof source.autoPilot === 'boolean' && merged.autoPilot === undefined) merged.autoPilot = source.autoPilot;
    if (source.harnessLevel && !merged.harnessLevel) merged.harnessLevel = source.harnessLevel;
  }
  return merged;
}

export const insightKindLabels = { repeat: '反复出现', change: '变化', tension: '矛盾', connection: '与过去相连', detail: '一个细节' } as const;
export const threadTrendLabels = { up: '最近更频繁', down: '最近变少', flat: '一直没断' } as const;
export const profileKindLabels = { identity: '我是谁', value: '我在意的事', person: '重要的人', focus: '眼下的焦点' } as const;
export const judgmentStatusLabels = { candidate: '待核对', confirmed: '已确认', uncertain: '暂不确定', withdrawn: '已撤回' } as const;
/** 洞察卡片上的置信度标签：只有这两种，不展示证据数量与原文。 */
export const insightConfidenceLabels = { grounded: '🟢 有依据', speculative: '🟡 有待验证' } as const;
/** Harness 丢弃原因。只留代号与一句人话，被丢弃的内容本身不进设备存储、也不给用户看。 */
export const harnessReasonLabels: Record<string, string> = {
  bad_format: '没按格式回答',
  empty: '内容是空的',
  too_short: '短到说明不了任何事',
  too_long: '超过一句话',
  has_evidence: '带了引用或证据',
  self_explaining: '在解释自己怎么想的',
  parroting: '重复你刚说过的话',
  report_tone: '语气像在汇报',
  overclaim: '猜测却用了肯定句',
  labeling: '在贴标签或下诊断',
  cliche: '换成谁都成立的话',
  duplicate: '和之前说过的重了',
  avoided_direction: '撞到你否定过的方向',
  daily_limit: '今天先到这里',
};
