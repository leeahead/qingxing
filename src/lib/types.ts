// 「清醒」的数据模型。页面只依赖这里的类型，数据结构改动时同步更新导入/导出校验。
export type Entry = { id: string; content: string; createdAt: string; updatedAt: string; source: 'user' | 'chat'; feedback?: string };
export type Task = { id: string; title: string; status: 'open' | 'done' | 'deferred' | 'dropped'; sourceId: string; createdAt: string };
export type ObservationType = 'pattern' | 'change' | 'tension' | 'question' | 'hypothesis';
export type ObservationVersion = { version: number; topic: string; statement: string; at: string; reason: string };
export type ObservationCorrection = { reason: string; note: string; at: string };
export type Judgment = {
  id: string;
  topic: string;
  statement: string;
  supportIds: string[];
  counterIds: string[];
  status: 'candidate' | 'confirmed' | 'uncertain' | 'withdrawn';
  origin?: 'ai' | 'word';
  type?: ObservationType;
  alternative?: string;
  falsifier?: string;
  confidence?: 'weak' | 'medium' | 'strong';
  confidenceReason?: string;
  scopeStart?: string;
  scopeEnd?: string;
  scopeDays?: number;
  scopeEntries?: number;
  nextReviewAt?: string;
  lastReviewedAt?: string;
  versions?: ObservationVersion[];
  corrections?: ObservationCorrection[];
  muted?: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
};
export type Settings = { baseUrl: string; apiKey: string; model: string; embedModel?: string };
export type DailySummary = {
  day: string;
  overview?: string;
  repeated: string;
  unresolved: string;
  connections: string;
  emotion: string;
  tomorrow: string;
  generatedAt: string;
  model: string;
  entryCount: number;
  sourceIds: string[];
};
export type MemoryEvidence = { id: string; date: string; text: string };
export type MemoryDigest = {
  id: string;
  start: string;
  end: string;
  summary: string;
  themes: string[];
  changes: string;
  contradictions: string;
  evidence: MemoryEvidence[];
  entryCount: number;
  generatedAt: string;
  model: string;
};
/**
 * 「关于你」档案块的一行。
 * AI 提出的（source:'ai'）默认未确认，用户确认后才进入提示词。
 */
export type ProfileKind = 'identity' | 'value' | 'person' | 'focus';
export type ProfileItem = {
  id: string;
  kind: ProfileKind;
  text: string;
  /** 挂着的证据（记录 id）；用户手写的可以不挂 */
  evidenceIds: string[];
  source: 'user' | 'ai';
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
};
export type BackupMeta = {
  /** 上次把数据导出到设备之外的时间 */
  lastExportAt?: string;
  /** 上次导出时的条目数 */
  lastExportCount?: number;
  /** 已授权的自动备份目录名（File System Access） */
  autoDirName?: string;
  /** 上次自动写入目录的时间 */
  lastAutoAt?: string;
};
/** 一个已结束、有记录的自然周（周一到周日），用于沉淀长期记忆。 */
export type DigestWeek = { start: string; end: string; entries: Entry[] };
export type ChatScope = 'all' | 'entries' | 'judgments';
export type Store = { entries: Entry[]; tasks: Task[]; judgments: Judgment[]; memoryFeedback: Record<string, string>; summaries: DailySummary[]; digests: MemoryDigest[]; profile: ProfileItem[] };
export type Theme = 'dark' | 'light';
export type View = 'home' | 'memory' | 'judgments' | 'chat' | 'tasks';
export type Message = { role: 'user' | 'assistant'; content: string; sources?: Entry[] };
