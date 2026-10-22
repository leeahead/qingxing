// 存储层：IndexedDB 为主，localStorage 为镜像与兼容兜底。
//
// 为什么不做全量事件溯源：事件流在这里只做两件事——
//   1) 一份「只增不改的操作日志」：记下每次增删改、纠正、沉淀，删掉的原文也留一份，可回放、可撤销；
//   2) 一份「每日快照」：误操作（尤其是清空）能回滚。
// 界面仍然直接读 Store 形状，不用把每个读取都改写成投影。
// 收益拿到八成，代价只有十分之一。
//
// 全部函数都不抛错：IndexedDB 不可用（隐私模式、旧 WebView、配额被拒）时自动退回 localStorage，
// 应用照常能用，只是容量回到 5MB。

import type { BackupMeta, Entry, Settings, Store, Theme } from './types';
import { keys, uid } from './utils';

const BACKUP_META_KEY = 'qingxing.backup.v1';
const DIR_HANDLE_KEY = 'backupDir';
/** 记着“模型连接配置已经从快照里自动找回过一次”，避免反复复活用户主动清掉的配置。 */
const RESCUED_FLAG = 'qingxing.settings-rescued.v1';

const DB_NAME = 'qingxing';
const DB_VERSION = 2;
const STORE_STATE = 'state';
const STORE_JOURNAL = 'journal';
const STORE_SNAPSHOTS = 'snapshots';
const STORE_VECTORS = 'vectors';
const STATE_KEY = 'current';

/** 日志最多留多少条；快照最多留多少份。 */
const JOURNAL_LIMIT = 500;
const SNAPSHOT_LIMIT = 14;

export type PersistedState = { store: Store; settings: Settings; theme: Theme; updatedAt: string };

export type JournalKind =
  | 'entry.created' | 'entry.edited' | 'entry.deleted'
  | 'judgment.created' | 'judgment.updated'
  | 'summary.generated' | 'digest.generated'
  | 'profile.updated'
  | 'state.restored' | 'state.cleared';

export type JournalEvent = {
  id: string;
  at: string;
  kind: JournalKind;
  /** 一句话说明，界面上直接显示 */
  text: string;
  /** 只有删除记录时才带全文，用于恢复 */
  entry?: Entry;
};

export type Snapshot = { id: string; at: string; reason: string; state: PersistedState };

export type StorageStatus = {
  mode: 'indexeddb' | 'localstorage';
  entries: number;
  tasks: number;
  judgments: number;
  journal: number;
  snapshots: number;
  usage?: number;
  quota?: number;
  lastError?: string;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;
let lastError = '';

function noteError(error: unknown) {
  lastError = error instanceof Error ? error.message : String(error);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { noteError(error); resolve(null); return; }
    // 打不开时不能把 null 永久缓存：升级被别的标签页挡住（onblocked）只说明这一刻不行，
    // 下次调用应该再试，否则整个会话都写不进 IndexedDB，用户会一直看到“写入失败”。
    const giveUp = (error?: unknown) => {
      if (error) noteError(error);
      dbPromise = null;
      resolve(null);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_JOURNAL)) db.createObjectStore(STORE_JOURNAL, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_VECTORS)) db.createObjectStore(STORE_VECTORS, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // 别的标签页要升级版本时让出连接，避免互相阻塞。
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => giveUp(request.error);
    request.onblocked = () => giveUp();
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  return requestResult(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

async function dbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  return requestResult(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

async function dbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await requestResult(tx.objectStore(store).put(value));
}

async function dbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await requestResult(tx.objectStore(store).delete(key));
}

/* ------------------------------ 镜像与兼容 ------------------------------ */

/** 从旧的 localStorage 结构读出状态（同时也是 IndexedDB 里没有数据时的回退来源）。 */
export function readMirrorState(): PersistedState | null {
  try {
    const loaded = Object.fromEntries(
      Object.entries(keys).map(([name, key]) => [name, JSON.parse(localStorage.getItem(key) || (name === 'memoryFeedback' ? '{}' : '[]'))]),
    ) as Store;
    if (!Array.isArray(loaded.entries) || !Array.isArray(loaded.tasks) || !Array.isArray(loaded.judgments)) return null;
    normalizeStore(loaded);
    const settings = { baseUrl: '', apiKey: '', model: '', ...JSON.parse(localStorage.getItem('qingxing.settings.v1') || '{}') } as Settings;
    const savedTheme = localStorage.getItem('qingxing.theme.v1');
    const theme: Theme = savedTheme === 'light' || savedTheme === 'mono' ? 'light' : 'dark';
    return { store: loaded, settings, theme, updatedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

/** 写一份 localStorage 镜像。IndexedDB 不可用时，这就是唯一的数据落点。 */
export function writeMirrorState(state: PersistedState): boolean {
  try {
    for (const [name, key] of Object.entries(keys)) localStorage.setItem(key, JSON.stringify(state.store[name as keyof Store]));
    localStorage.setItem('qingxing.settings.v1', JSON.stringify(state.settings));
    localStorage.setItem('qingxing.theme.v1', state.theme);
    return true;
  } catch {
    // 镜像写不进去不算失败：主存是 IndexedDB。
    return false;
  }
}

/**
 * 单独读镜像里的模型设置。
 * 主存与镜像可能不同步：一次写入失败、一次升级，都会让两边只存到一份配置。
 * 分开读，才知道该信谁，而不是让空的那边把配好的模型盖掉。
 */
export function readMirrorSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem('qingxing.settings.v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/* ------------------------------ 主存读写 ------------------------------ */

/**
 * 补齐 Store 里后来才新增的数组字段。
 * 老设备的主存与旧快照里没有 threadNotes / profile，读出来不补一下，
 * 界面拿到的就是 undefined，回看页一渲染 `threadNotes.find(...)` 直接崩。
 */
export function normalizeStore(store: Store): Store {
  if (!Array.isArray(store.entries)) store.entries = [];
  if (!Array.isArray(store.tasks)) store.tasks = [];
  if (!Array.isArray(store.judgments)) store.judgments = [];
  if (!store.memoryFeedback || typeof store.memoryFeedback !== 'object') store.memoryFeedback = {};
  if (!Array.isArray(store.summaries)) store.summaries = [];
  if (!Array.isArray(store.digests)) store.digests = [];
  if (!Array.isArray(store.profile)) store.profile = [];
  if (!Array.isArray(store.threadNotes)) store.threadNotes = [];
  return store;
}

export async function readState(): Promise<PersistedState | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const row = await dbGet<{ key: string; state: PersistedState }>(db, STORE_STATE, STATE_KEY);
    if (!row?.state?.store?.entries) return null;
    normalizeStore(row.state.store);
    // 早期版本存下的主存里可能没有设置这一段；补上空壳，
    // 不然界面会把「没有这一段」当成「用户没配过模型」。
    if (!row.state.settings || typeof row.state.settings !== 'object') row.state.settings = { baseUrl: '', apiKey: '', model: '' };
    return row.state;
  } catch (error) {
    noteError(error);
    return null;
  }
}

export async function writeState(state: PersistedState): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  try {
    await dbPut(db, STORE_STATE, { key: STATE_KEY, state: { ...state, updatedAt: new Date().toISOString() } });
    lastError = '';
    return true;
  } catch (error) {
    noteError(error);
    return false;
  }
}

/* ------------------------------ 操作日志 ------------------------------ */

export async function appendJournal(kind: JournalKind, text: string, entry?: Entry): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const event: JournalEvent = { id: uid(), at: new Date().toISOString(), kind, text, ...(entry ? { entry } : {}) };
    await dbPut(db, STORE_JOURNAL, event);
    const all = await dbGetAll<JournalEvent>(db, STORE_JOURNAL);
    if (all.length > JOURNAL_LIMIT) {
      const excess = all.sort((a, b) => a.at.localeCompare(b.at)).slice(0, all.length - JOURNAL_LIMIT);
      for (const old of excess) await dbDelete(db, STORE_JOURNAL, old.id);
    }
  } catch (error) {
    noteError(error);
  }
}

export async function listJournal(limit = 30): Promise<JournalEvent[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const all = await dbGetAll<JournalEvent>(db, STORE_JOURNAL);
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  } catch (error) {
    noteError(error);
    return [];
  }
}

/* -------------------------------- 快照 -------------------------------- */

/** 记一份快照。清理掉超出份数上限的旧快照。 */
export async function createSnapshot(state: PersistedState, reason: string): Promise<Snapshot | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const snapshot: Snapshot = { id: uid(), at: new Date().toISOString(), reason, state: { ...state, updatedAt: new Date().toISOString() } };
    await dbPut(db, STORE_SNAPSHOTS, snapshot);
    const all = await dbGetAll<Snapshot>(db, STORE_SNAPSHOTS);
    if (all.length > SNAPSHOT_LIMIT) {
      const excess = all.sort((a, b) => a.at.localeCompare(b.at)).slice(0, all.length - SNAPSHOT_LIMIT);
      for (const old of excess) await dbDelete(db, STORE_SNAPSHOTS, old.id);
    }
    return snapshot;
  } catch (error) {
    noteError(error);
    return null;
  }
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const all = await dbGetAll<Snapshot>(db, STORE_SNAPSHOTS);
    return all.sort((a, b) => b.at.localeCompare(a.at));
  } catch (error) {
    noteError(error);
    return [];
  }
}

export async function readSnapshot(id: string): Promise<Snapshot | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const row = await dbGet<Snapshot>(db, STORE_SNAPSHOTS, id);
    if (!row?.state?.store) return row ?? null;
    normalizeStore(row.state.store);
    return row;
  } catch (error) {
    noteError(error);
    return null;
  }
}

/* ------------------------------ 向量缓存 ------------------------------ */

export type VectorRow = { id: string; vector: number[]; at: string; model?: string };

/** 读出已缓存的向量。 */
export async function readVectors(): Promise<Map<string, VectorRow>> {
  const db = await openDatabase();
  if (!db) return new Map();
  try {
    const all = await dbGetAll<VectorRow>(db, STORE_VECTORS);
    return new Map(all.map(row => [row.id, row]));
  } catch (error) {
    noteError(error);
    return new Map();
  }
}

/** 写入一批向量。 */
export async function writeVectors(rows: VectorRow[]): Promise<number> {
  const db = await openDatabase();
  if (!db || !rows.length) return 0;
  try {
    for (const row of rows) await dbPut(db, STORE_VECTORS, row);
    return rows.length;
  } catch (error) {
    noteError(error);
    return 0;
  }
}

/** 清空向量缓存（导入时整体替换了记录，旧向量全部作废）。 */
export async function clearVectors(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_VECTORS, 'readwrite');
    tx.objectStore(STORE_VECTORS).clear();
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });
  } catch (error) { noteError(error); }
}

/** 丢掉某个记录的向量（记录被删或被改时调用）。 */
export async function deleteVectors(ids: string[]): Promise<void> {
  const db = await openDatabase();
  if (!db || !ids.length) return;
  try { for (const id of ids) await dbDelete(db, STORE_VECTORS, id); } catch (error) { noteError(error); }
}

/* ------------------------------ 备份元信息 ------------------------------ */

/** 备份相关的元信息：上次导出时间、条数、是否授权了自动备份目录。 */
export function readBackupMeta(): BackupMeta {
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUP_META_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw as BackupMeta : {};
  } catch {
    return {};
  }
}

export function writeBackupMeta(meta: BackupMeta): void {
  try { localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

/** 记住用户授权的自动备份目录（File System Access 的目录句柄可以存进 IndexedDB）。 */
export async function saveDirectoryHandle(handle: unknown): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try { await dbPut(db, STORE_STATE, { key: DIR_HANDLE_KEY, handle }); } catch (error) { noteError(error); }
}

export async function readDirectoryHandle<T = unknown>(): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const row = await dbGet<{ key: string; handle: T }>(db, STORE_STATE, DIR_HANDLE_KEY);
    return row?.handle ?? null;
  } catch (error) {
    noteError(error);
    return null;
  }
}

/* ------------------------------ 状态与清理 ------------------------------ */

export async function storageStatus(state: PersistedState | null): Promise<StorageStatus> {
  const db = await openDatabase();
  const journal = db ? (await listJournal(JOURNAL_LIMIT)).length : 0;
  const snapshots = db ? (await listSnapshots()).length : 0;
  let usage: number | undefined;
  let quota: number | undefined;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) { usage = estimate.usage; quota = estimate.quota; }
  } catch { /* 不支持就算了 */ }
  return {
    mode: db ? 'indexeddb' : 'localstorage',
    entries: state?.store.entries.length ?? 0,
    tasks: state?.store.tasks.length ?? 0,
    judgments: state?.store.judgments.length ?? 0,
    journal,
    snapshots,
    usage,
    quota,
    lastError: lastError || undefined,
  };
}

/** 删掉一份快照。 */
export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try { await dbDelete(db, STORE_SNAPSHOTS, id); } catch (error) { noteError(error); }
}

/**
 * 在快照里找模型连接配置。
 * 主存与镜像都空掉时，快照是唯一还留着接口地址与密钥的地方。
 */
export async function findSettingsInSnapshots(): Promise<{ settings: Partial<Settings>; at: string } | null> {
  const snapshots = await listSnapshots();
  for (const snapshot of snapshots) {
    const baseUrl = snapshot.state?.settings?.baseUrl;
    if (typeof baseUrl === 'string' && baseUrl.trim()) return { settings: snapshot.state.settings, at: snapshot.at };
  }
  return null;
}

/**
 * 自动找回一次模型连接配置。
 * 只找一次：用户主动把配置清空之后，不该每次打开都被塞回来。
 */
export async function rescueSettingsOnce(): Promise<{ settings: Partial<Settings>; at: string } | null> {
  try { if (localStorage.getItem(RESCUED_FLAG)) return null; } catch { /* ignore */ }
  const found = await findSettingsInSnapshots();
  if (!found) return null;
  try { localStorage.setItem(RESCUED_FLAG, '1'); } catch { /* ignore */ }
  return found;
}

/**
 * 清空本机数据（记录、事项、观察、总结、长期记忆、设置、主题、向量缓存与操作日志）。
 * 快照保留：清空前会自动留一份，那是最后的退路；要连它一起清掉，在设置里逐份删除即可。
 */
export async function clearStorage(): Promise<void> {
  const db = await openDatabase();
  if (db) {
    try {
      // 向量缓存也要清：留着会让设置页显示“已有 N / 0 条记录带向量”。
      const tx = db.transaction([STORE_STATE, STORE_JOURNAL, STORE_VECTORS], 'readwrite');
      tx.objectStore(STORE_STATE).clear();
      tx.objectStore(STORE_JOURNAL).clear();
      tx.objectStore(STORE_VECTORS).clear();
      await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });
    } catch (error) {
      noteError(error);
    }
  }
  try {
    for (const key of Object.values(keys)) localStorage.removeItem(key);
    localStorage.removeItem('qingxing.settings.v1');
    localStorage.removeItem('qingxing.theme.v1');
    // 备份元信息跟着一起清：目录句柄存在 state 里已经没了，
    // 留着「当前：某目录」会让“立即备份”看起来能用、实际什么都不做。
    localStorage.removeItem(BACKUP_META_KEY);
  } catch { /* ignore */ }
}
