// 备份的导出、校验与合并。
// 备份文件包含记录、事项、洞察、画像、场景、每日回望与旧版数据，不包含访问密钥。
// 校验集中在这里，界面只负责给出人话提示。

import type { DailySummary, Entry, Insight, InsightRun, Judgment, MemoryDigest, MemoryEvidence, ObservationCorrection, ObservationVersion, ProfileItem, Scene, Store, SummaryInsight, Task, Theme, ThreadNote, UserProfile } from './types';
import { SCHEMA_VERSION, today, validDate } from './utils';

/** 导出成备份文本。 */
export function buildBackupText(data: Store, theme: Theme): string {
  return JSON.stringify({ app: 'qingxing', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...data, theme }, null, 2);
}

/** 洞察流的置信度只有两种；备份里出现别的值就按「有待验证」处理。 */
const confidenceOf = (value: unknown): Insight['confidence'] => (value === 'grounded' ? 'grounded' : 'speculative');

/**
 * 解析并校验备份文本。
 * 只接受清醒的备份格式；缺字段、类型不对的条目直接丢掉，不让脏数据进来。
 * 返回通过校验的数据，以及被丢弃的条目数量。
 *
 * v10 是洞察流：新增 insights / userProfile / profileVersions / scenes / runs。
 * 旧备份（v6~v9）没有这些字段，按空处理；它们的观察与周沉淀读进来后只进「旧数据存档」，
 * 界面不再展示，也不会凭空丢掉用户已经攒下的东西。
 */
export function parseBackupText(text: string): { store: Store; skipped: number } {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || !Array.isArray(raw.tasks)) throw new Error('请选择清醒备份文件');
  const store: Store = {
    entries: raw.entries.filter((item: Entry) => item && typeof item.id === 'string' && typeof item.content === 'string' && validDate(item.createdAt) && validDate(item.updatedAt)),
    tasks: raw.tasks.filter((item: Task) => item && typeof item.id === 'string' && typeof item.title === 'string' && validDate(item.createdAt) && typeof item.sourceId === 'string' && ['open', 'done', 'deferred', 'dropped'].includes(item.status)),
    // 旧版阶段性观察：v6.0 起不再展示，仍然完整收下，用户可以在「旧数据存档」里浏览或导出。
    judgments: (Array.isArray(raw.judgments) ? raw.judgments : []).filter((item: Judgment) => item && typeof item.id === 'string' && typeof item.topic === 'string' && typeof item.statement === 'string' && Array.isArray(item.supportIds) && Array.isArray(item.counterIds) && validDate(item.createdAt) && validDate(item.updatedAt) && ['candidate', 'confirmed', 'uncertain', 'withdrawn'].includes(item.status)).map((item: Judgment) => ({
      ...item,
      type: ['pattern', 'change', 'tension', 'question', 'hypothesis'].includes(item.type as string) ? item.type : undefined,
      versions: Array.isArray(item.versions) ? item.versions.filter((version: ObservationVersion) => version && typeof version.statement === 'string') : [],
      corrections: Array.isArray(item.corrections) ? item.corrections.filter((correction: ObservationCorrection) => correction && typeof correction.reason === 'string') : [],
      muted: Boolean(item.muted),
    })),
    memoryFeedback: raw.memoryFeedback && typeof raw.memoryFeedback === 'object' ? raw.memoryFeedback : {},
    // 总结跨了三代结构（v4 五栏 / v4.5 概要 / v5 回望），逐字段清洗，缺哪个都照常导入。
    summaries: (Array.isArray(raw.summaries) ? raw.summaries : []).filter((item: DailySummary) => item && typeof item.day === 'string' && validDate(item.generatedAt)).map((item: DailySummary) => ({
      day: item.day,
      generatedAt: item.generatedAt,
      model: String(item.model || ''),
      entryCount: Number(item.entryCount) || 0,
      sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.map(String) : [],
      ...(typeof item.overview === 'string' && item.overview ? { overview: item.overview } : {}),
      ...(typeof item.title === 'string' && item.title ? { title: item.title } : {}),
      ...(typeof item.question === 'string' && item.question ? { question: item.question } : {}),
      ...(Array.isArray(item.insights) ? { insights: item.insights.filter((insight: SummaryInsight) => insight && typeof insight.text === 'string' && Array.isArray(insight.sourceIds)).map((insight: SummaryInsight) => ({ text: insight.text, sourceIds: insight.sourceIds.map(String), ...(insight.kind ? { kind: insight.kind } : {}) })) } : {}),
      ...(typeof item.repeated === 'string' ? { repeated: item.repeated } : {}),
      ...(typeof item.unresolved === 'string' ? { unresolved: item.unresolved } : {}),
      ...(typeof item.connections === 'string' ? { connections: item.connections } : {}),
      ...(typeof item.emotion === 'string' ? { emotion: item.emotion } : {}),
      ...(typeof item.tomorrow === 'string' ? { tomorrow: item.tomorrow } : {}),
    })),
    digests: (Array.isArray(raw.digests) ? raw.digests : []).filter((item: MemoryDigest) => item && typeof item.id === 'string' && validDate(item.start) && validDate(item.end) && typeof item.summary === 'string' && validDate(item.generatedAt)).map((item: MemoryDigest) => ({
      ...item,
      title: typeof item.title === 'string' ? item.title : undefined,
      watch: typeof item.watch === 'string' ? item.watch : undefined,
      themes: Array.isArray(item.themes) ? item.themes.map(String) : [],
      changes: String(item.changes || ''),
      contradictions: String(item.contradictions || ''),
      evidence: Array.isArray(item.evidence) ? item.evidence.filter((evidence: MemoryEvidence) => evidence && typeof evidence.id === 'string' && typeof evidence.text === 'string').map((evidence: MemoryEvidence) => ({ id: evidence.id, date: typeof evidence.date === 'string' ? evidence.date : item.start, text: evidence.text })) : [],
      entryCount: Number(item.entryCount) || 0,
    })),
    // 「关于你」档案块是 v7 才有的；旧备份（v6）没有这一项，按空处理。
    profile: (Array.isArray(raw.profile) ? raw.profile : []).filter((item: ProfileItem) => item && typeof item.id === 'string' && typeof item.text === 'string' && ['identity', 'value', 'person', 'focus'].includes(item.kind)).map((item: ProfileItem) => ({
      ...item,
      evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : [],
      source: item.source === 'ai' ? 'ai' : 'user',
      confirmed: Boolean(item.confirmed),
    })),
    // 线索笔记是 v9 才有的；旧备份没有这一项，按空处理。线索本身每次由本地重新计算。
    threadNotes: (Array.isArray(raw.threadNotes) ? raw.threadNotes : []).filter((item: ThreadNote) => item && typeof item.id === 'string' && typeof item.topic === 'string' && typeof item.summary === 'string' && validDate(item.generatedAt)).map((item: ThreadNote) => ({
      id: item.id,
      topic: item.topic,
      summary: item.summary,
      turning: typeof item.turning === 'string' ? item.turning : undefined,
      openQuestion: typeof item.openQuestion === 'string' ? item.openQuestion : undefined,
      sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.map(String) : [],
      entryCount: Number(item.entryCount) || 0,
      generatedAt: item.generatedAt,
      model: String(item.model || ''),
    })),
    // ── 以下四项是 v10 洞察流的数据；v6~v9 的备份里没有，按空处理 ──
    insights: (Array.isArray(raw.insights) ? raw.insights : []).filter((item: Insight) => item && typeof item.id === 'string' && typeof item.content === 'string' && validDate(item.createdAt)).map((item: Insight) => ({
      id: item.id,
      content: item.content.slice(0, 120),
      confidence: confidenceOf(item.confidence),
      createdAt: item.createdAt,
      feedback: item.feedback === 'positive' || item.feedback === 'negative' ? item.feedback : null,
      direction: typeof item.direction === 'string' ? item.direction.slice(0, 12) : undefined,
      profileVersion: Number(item.profileVersion) || undefined,
    })),
    userProfile: readProfile(raw.userProfile),
    profileVersions: (Array.isArray(raw.profileVersions) ? raw.profileVersions : []).map((item: unknown) => readProfile(item)).filter((item: UserProfile | null): item is UserProfile => Boolean(item)).slice(-12),
    scenes: (Array.isArray(raw.scenes) ? raw.scenes : []).filter((item: Scene) => item && typeof item.id === 'string' && typeof item.theme === 'string' && validDate(item.lastActiveAt)).map((item: Scene) => ({
      id: item.id,
      theme: item.theme.slice(0, 24),
      mood: String(item.mood || ''),
      keywords: Array.isArray(item.keywords) ? item.keywords.map(String).slice(0, 8) : [],
      entryIds: Array.isArray(item.entryIds) ? item.entryIds.map(String) : [],
      lastActiveAt: item.lastActiveAt,
      createdAt: validDate(item.createdAt) ? item.createdAt : item.lastActiveAt,
      archived: Boolean(item.archived),
    })),
    runs: (Array.isArray(raw.runs) ? raw.runs : []).filter((item: InsightRun) => item && typeof item.day === 'string').map((item: InsightRun) => ({
      day: item.day,
      attempts: Number(item.attempts) || 0,
      accepted: Number(item.accepted) || 0,
      rejected: Array.isArray(item.rejected) ? item.rejected.map(String).slice(0, 40) : [],
    })),
  };
  const skipped = raw.entries.length + raw.tasks.length - store.entries.length - store.tasks.length;
  return { store, skipped };
}

/** 画像层是对象，形状不对就整个当没有——半残缺的画像会直接影响洞察质量。 */
function readProfile(value: unknown): UserProfile | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as UserProfile;
  if (typeof item.narrative !== 'string' || !item.narrative.trim()) return null;
  const list = (input: unknown) => (Array.isArray(input) ? input.map(String).filter(Boolean).slice(0, 12) : []);
  return {
    version: Number(item.version) || 1,
    updatedAt: validDate(item.updatedAt) ? item.updatedAt : new Date().toISOString(),
    narrative: item.narrative.trim().slice(0, 2400),
    patterns: list(item.patterns),
    values: list(item.values),
    tensions: list(item.tensions),
    currentThemes: list(item.currentThemes),
    basedOnEntries: Number(item.basedOnEntries) || undefined,
    sourceDays: typeof item.sourceDays === 'string' ? item.sourceDays : undefined,
  };
}

/**
 * 合并两份数据：同 id 保留后出现的那份；记录按 updatedAt 取较新的一条。
 * 画像层是整体覆盖（导入的那份更新才换），不能按条目合并——否则两次生成的画像会混成一团。
 */
export function mergeStores(current: Store, incoming: Store): Store {
  const byId = <T extends { id: string }>(old: T[], next: T[]) => [...new Map([...old, ...next].map(item => [item.id, item])).values()];
  const profile = incoming.userProfile && (!current.userProfile || incoming.userProfile.updatedAt > current.userProfile.updatedAt) ? incoming.userProfile : current.userProfile;
  return {
    entries: byId(current.entries, incoming.entries.filter(item => {
      const old = current.entries.find(entry => entry.id === item.id);
      return !old || item.updatedAt > old.updatedAt;
    })),
    tasks: byId(current.tasks, incoming.tasks),
    judgments: byId(current.judgments, incoming.judgments),
    memoryFeedback: { ...current.memoryFeedback, ...incoming.memoryFeedback },
    // 总结按天去重，同一天以导入的那份为准。
    summaries: [...new Map([...current.summaries, ...incoming.summaries].map(item => [item.day, item])).values()],
    digests: byId(current.digests, incoming.digests),
    profile: byId(current.profile, incoming.profile),
    threadNotes: byId(current.threadNotes, incoming.threadNotes),
    insights: byId(current.insights, incoming.insights).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    userProfile: profile,
    profileVersions: [...new Map([...current.profileVersions, ...incoming.profileVersions].map(item => [item.version, item])).values()].sort((a, b) => a.version - b.version).slice(-12),
    scenes: byId(current.scenes, incoming.scenes),
    runs: [...new Map([...current.runs, ...incoming.runs].map(item => [item.day, item])).values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30),
  };
}

/* ------------------------------ 旧数据存档 ------------------------------ */

/**
 * 旧版判断与周沉淀不再出现在界面上，但仍然完整留在设备里。
 * 这里把它们单独导出一份，用户可以拿去存档，或者在确认不需要之后清除。
 */
export function buildArchiveText(judgments: Judgment[], digests: MemoryDigest[]): string {
  return JSON.stringify({ app: 'qingxing-archive', kind: 'pre-insight-stream', exportedAt: new Date().toISOString(), judgments, digests }, null, 2);
}

export const archiveFileName = () => `清醒旧数据存档-${today()}.json`;

/** 备份文件的默认名字。 */
export const backupFileName = () => `qingxing-${today()}.json`;

/* --------------------------- 自动备份（目录授权） --------------------------- */

export type DirectoryHandleLike = {
  name: string;
  getFileHandle: (name: string, options: { create: boolean }) => Promise<FileSystemFileHandleLike>;
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

type FileSystemFileHandleLike = {
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
  }
}

/** 这台设备支不支持「授权一个目录，之后自动写备份」。 */
export const supportsAutoBackup = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

/** 自动备份写进目录的文件名：同一天覆盖同一个文件，不会攒出一堆垃圾。 */
export const autoBackupFileName = () => `清醒备份-${today()}.json`;

/** 让用户挑一个目录，用来放自动备份。 */
export async function pickBackupDirectory(): Promise<DirectoryHandleLike | null> {
  if (!window.showDirectoryPicker) throw new Error('这台设备不支持自动写入目录，会改用「导出」保存。');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  return handle;
}

/** 往已授权的目录里写一份备份。返回写入的文件名；没权限或失败会抛错。 */
export async function writeBackupToDirectory(handle: DirectoryHandleLike, text: string): Promise<string> {
  if (handle.queryPermission) {
    const state = await handle.queryPermission({ mode: 'readwrite' });
    if (state !== 'granted' && handle.requestPermission) {
      const asked = await handle.requestPermission({ mode: 'readwrite' });
      if (asked !== 'granted') throw new Error('没有拿到这个目录的写入许可。');
    }
  }
  const name = autoBackupFileName();
  const fileHandle = await handle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
  return name;
}

/**
 * 保存备份文件：优先走系统分享（套壳里也能存到「文件」或发出去），
 * 不支持分享时退回直接下载。
 */
export async function saveBackupFile(text: string, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([text], filename, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '清醒备份' });
      return 'shared';
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
