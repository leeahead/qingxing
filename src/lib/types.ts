// 「清醒」的数据模型。页面只依赖这里的类型，数据结构改动时同步更新导入/导出校验。
export type Entry = { id: string; content: string; createdAt: string; updatedAt: string; source: 'user' | 'chat'; feedback?: string };
export type Task = { id: string; title: string; status: 'open' | 'done' | 'deferred' | 'dropped'; sourceId: string; createdAt: string };
export type ObservationType = 'pattern' | 'change' | 'tension' | 'question' | 'hypothesis';
export type ObservationVersion = { version: number; topic: string; statement: string; at: string; reason: string };
export type ObservationCorrection = { reason: string; note: string; at: string };
/**
 * 旧版「阶段性观察」。
 * v6.0 起转向洞察流，不再产生新观察，也不再展示证据链、纠正与版本历史；
 * 这份数据只是保留在设备本机，在「偏好与数据 → 旧数据存档」里可以浏览、导出或清除。
 */
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
export type Settings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  embedModel?: string;
  /** 默认开启；关掉后洞察与画像都要手动触发 */
  autoPilot?: boolean;
  lastAutoObservationAt?: string;
  lastAutoProfileAt?: string;
  lastAutoDigestAt?: string;
  /** 最近一次画像更新与洞察产出的时间戳（洞察流模式的节奏都靠这三个字段推进） */
  lastInsightAt?: string;
  lastProfileBuildAt?: string;
  /** 联想的跳跃程度：0.7 稳妥 / 0.8 平衡 / 0.9 跳跃。错误率偏高就往下调。 */
  insightTemperature?: number;
  /** Harness 自检严格度；太严会一天出不了几条，太松会全是废话 */
  harnessLevel?: 'strict' | 'balanced' | 'loose';
  /** 追问时读取原文的次数（按月份记，每月不超过 20 次） */
  rawReadMonth?: string;
  rawReadCount?: number;
};
/** 每日回望里的一条「值得注意」；必须挂真实记录 id，挂不上在解析层就被丢弃。 */
export type SummaryInsightKind = 'repeat' | 'change' | 'tension' | 'connection' | 'detail';
export type SummaryInsight = { text: string; sourceIds: string[]; kind?: SummaryInsightKind };
export type DailySummary = {
  day: string;
  /** 4–12 个字的小标题，来自当天的具体内容 */
  title?: string;
  overview?: string;
  /** v5 起的回望结构；旧总结没有这个字段 */
  insights?: SummaryInsight[];
  /** 一个从当天记录里长出来、值得继续想的问题 */
  question?: string;
  /** 以下为 v4 五栏结构的遗留字段；旧数据照常显示，新总结不再生成 repeated/connections/emotion */
  repeated?: string;
  unresolved?: string;
  connections?: string;
  emotion?: string;
  tomorrow?: string;
  generatedAt: string;
  model: string;
  entryCount: number;
  sourceIds: string[];
};
export type MemoryEvidence = { id: string; date: string; text: string };
/**
 * 旧版「按周沉淀」的长期记忆。
 * v6.0 起不再产生新的周沉淀（画像层取代了它），已有数据只在「旧数据存档」里浏览与导出。
 * evidence 保留为可选：老数据还在设备上，字段一删就读不回来了。
 */
export type MemoryDigest = {
  id: string;
  start: string;
  end: string;
  /** 这一周的一句话记忆 */
  title?: string;
  summary: string;
  themes: string[];
  changes: string;
  contradictions: string;
  /** 下周值得留意的一个具体问题 */
  watch?: string;
  evidence?: MemoryEvidence[];
  entryCount: number;
  generatedAt: string;
  model: string;
};
/**
 * 一条「线索」被 AI 按时间串起来之后的笔记。
 * 线索本身（哪些词、哪些记录）每次由本地重新计算，笔记只按 topic 缓存。
 */
export type ThreadNote = {
  id: string;
  topic: string;
  summary: string;
  turning?: string;
  openQuestion?: string;
  sourceIds: string[];
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
/**
 * 一条洞察。Harness 自检通过的才会留在这里——被丢弃的用户永远看不到。
 * direction 是内部的联想方向标签，不展示给用户，只用于反馈闭环：
 * 用户点「不对」时记住的是这个方向，而不是这一句话。
 */
export type Insight = {
  id: string;
  /** 洞察语句，一句话，不超过 50 字 */
  content: string;
  /** grounded = 多条碎片往同一方向汇聚；speculative = 模糊的直觉 */
  confidence: 'grounded' | 'speculative';
  createdAt: string;
  feedback?: 'positive' | 'negative' | null;
  /** 内部方向标签，例如「工作」「关系」「自我评价」 */
  direction?: string;
  /** 出自哪一版画像，便于回溯「最近它看我的方式变了」 */
  profileVersion?: number;
};
/**
 * L3 用户画像层：洞察的唯一依据。
 * narrative 是 400~500 字的整体描述（随使用时长可以变长），四个数组是它的骨架。
 */
export type UserProfile = {
  version: number;
  updatedAt: string;
  /** 整体描述：它读起来应该像「一个我认识很久的人」，不像一份体检表 */
  narrative: string;
  patterns: string[];
  values: string[];
  tensions: string[];
  currentThemes: string[];
  /** 这一版读了多少条原文、覆盖到哪一天，用于设置页显示进度 */
  basedOnEntries?: number;
  sourceDays?: string;
};
/** L2 场景层：按主题聚合的短期块，实时更新，14 天没有新记录就归档。 */
export type Scene = {
  id: string;
  theme: string;
  /** 情绪基调，本地按用词倾向判断 */
  mood: string;
  keywords: string[];
  entryIds: string[];
  lastActiveAt: string;
  createdAt: string;
  archived?: boolean;
};
/** 一天的产出账本：尝试了几条、留下几条、被自检丢掉的各是什么原因。 */
export type InsightRun = {
  day: string;
  attempts: number;
  accepted: number;
  /** 只记原因代号（太长/像在汇报/空话……），不记被丢弃的内容 */
  rejected: string[];
};
export type Store = {
  entries: Entry[];
  tasks: Task[];
  /** 旧数据：只在「旧数据存档」里出现，界面不再展示、也不再产生新的 */
  judgments: Judgment[];
  memoryFeedback: Record<string, string>;
  summaries: DailySummary[];
  /** 旧数据：同上 */
  digests: MemoryDigest[];
  profile: ProfileItem[];
  threadNotes: ThreadNote[];
  insights: Insight[];
  /** 当前生效的 L3 画像；还没生成时是 null */
  userProfile: UserProfile | null;
  /** 画像历史版本，最多 12 个（约 3 个月） */
  profileVersions: UserProfile[];
  scenes: Scene[];
  runs: InsightRun[];
};
export type Theme = 'dark' | 'light';
/** 底栏只有三个入口：洞察流（默认）、记忆、偏好与数据。 */
export type View = 'insight' | 'memory';
export type Message = { role: 'user' | 'assistant'; content: string; sources?: Entry[] };
