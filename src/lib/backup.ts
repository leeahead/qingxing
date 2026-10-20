// 备份的导出、校验与合并。
// 备份文件包含记录、事项、阶段性观察、每日总结与长期记忆，不包含访问密钥。
// 校验集中在这里，界面只负责给出人话提示。

import type { DailySummary, Entry, Judgment, MemoryDigest, MemoryEvidence, ObservationCorrection, ObservationVersion, ProfileItem, Store, Task, Theme } from './types';
import { SCHEMA_VERSION, today, validDate } from './utils';

/** 导出成备份文本。 */
export function buildBackupText(data: Store, theme: Theme): string {
  return JSON.stringify({ app: 'qingxing', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...data, theme }, null, 2);
}

/**
 * 解析并校验备份文本。
 * 只接受清醒的备份格式；缺字段、类型不对的条目直接丢掉，不让脏数据进来。
 * 返回通过校验的数据，以及被丢弃的条目数量。
 */
export function parseBackupText(text: string): { store: Store; skipped: number } {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || !Array.isArray(raw.tasks)) throw new Error('请选择清醒备份文件');
  const store: Store = {
    entries: raw.entries.filter((item: Entry) => item && typeof item.id === 'string' && typeof item.content === 'string' && validDate(item.createdAt) && validDate(item.updatedAt)),
    tasks: raw.tasks.filter((item: Task) => item && typeof item.id === 'string' && typeof item.title === 'string' && validDate(item.createdAt) && typeof item.sourceId === 'string' && ['open', 'done', 'deferred', 'dropped'].includes(item.status)),
    judgments: (Array.isArray(raw.judgments) ? raw.judgments : []).filter((item: Judgment) => item && typeof item.id === 'string' && typeof item.topic === 'string' && typeof item.statement === 'string' && Array.isArray(item.supportIds) && Array.isArray(item.counterIds) && validDate(item.createdAt) && validDate(item.updatedAt) && ['candidate', 'confirmed', 'uncertain', 'withdrawn'].includes(item.status)).map((item: Judgment) => ({
      ...item,
      type: ['pattern', 'change', 'tension', 'question', 'hypothesis'].includes(item.type as string) ? item.type : undefined,
      versions: Array.isArray(item.versions) ? item.versions.filter((version: ObservationVersion) => version && typeof version.statement === 'string') : [],
      corrections: Array.isArray(item.corrections) ? item.corrections.filter((correction: ObservationCorrection) => correction && typeof correction.reason === 'string') : [],
      muted: Boolean(item.muted),
    })),
    memoryFeedback: raw.memoryFeedback && typeof raw.memoryFeedback === 'object' ? raw.memoryFeedback : {},
    summaries: (Array.isArray(raw.summaries) ? raw.summaries : []).filter((item: DailySummary) => item && typeof item.day === 'string' && typeof item.repeated === 'string' && typeof item.tomorrow === 'string' && validDate(item.generatedAt)),
    digests: (Array.isArray(raw.digests) ? raw.digests : []).filter((item: MemoryDigest) => item && typeof item.id === 'string' && validDate(item.start) && validDate(item.end) && typeof item.summary === 'string' && validDate(item.generatedAt)).map((item: MemoryDigest) => ({
      ...item,
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
  };
  const skipped = raw.entries.length + raw.tasks.length - store.entries.length - store.tasks.length;
  return { store, skipped };
}

/** 合并两份数据：同 id 保留后出现的那份；记录按 updatedAt 取较新的一条。 */
export function mergeStores(current: Store, incoming: Store): Store {
  const byId = <T extends { id: string }>(old: T[], next: T[]) => [...new Map([...old, ...next].map(item => [item.id, item])).values()];
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
  };
}

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
