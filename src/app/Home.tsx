'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { termsFor } from '@/lib/topics';
import type { ChatScope, DailySummary, DigestWeek, Entry, Judgment, MemoryDigest, Message, ProfileItem, ProfileKind, Settings, Store, Task, Theme, ThreadNote, View } from '@/lib/types';
import { VERSION, addDays, dayOf, daysAgo, mergeSettings, navItems, shortDate, streakOf, today, uid, weekStart } from '@/lib/utils';
import { buildChatRequest, buildDigestRequest, buildObservationRequest, buildProfileProposalRequest, buildRevisionRequest, buildSummaryRequest, buildThreadRequest, callModel, parseDigest, parseObservations, parseProfileProposal, parseRevision, parseSummary, parseThreadNote } from '@/lib/ai';
import type { ChatTurn } from '@/lib/ai';
import { backupFileName, buildBackupText, mergeStores, pickBackupDirectory, saveBackupFile, supportsAutoBackup, writeBackupToDirectory } from '@/lib/backup';
import type { DirectoryHandleLike } from '@/lib/backup';
import { appendJournal, clearStorage, clearVectors, createSnapshot, deleteSnapshot, deleteVectors, findSettingsInSnapshots, listJournal, listSnapshots, readBackupMeta, readDirectoryHandle, readMirrorSettings, readMirrorState, readSnapshot, readState, readVectors, rescueSettingsOnce, saveDirectoryHandle, storageStatus, writeBackupMeta, writeMirrorState, writeState, writeVectors } from '@/lib/storage';
import type { JournalEvent, JournalKind, Snapshot, StorageStatus, VectorRow } from '@/lib/storage';
import { cosine, embedTexts, embeddingModel, probeEmbedding } from '@/lib/embedding';
import type { EmbeddingProbe } from '@/lib/embedding';
import { hasSimilarProfileText } from '@/lib/profile';
import { buildThreads, memoriesOnThisDay, threadForEntry } from '@/lib/threads';
import { isInputField, watchKeyboard } from '@/lib/keyboard';
import type { KeyboardDiag } from '@/lib/keyboard';
import type { EntryEcho } from '@/components/EntryCard';
import { Icon } from '@/components/Icon';
import { ProfileModal } from '@/components/ProfileModal';
import { DigestModal } from '@/components/modals/DigestModal';
import { EntryModal } from '@/components/modals/EntryModal';
import { ImportModal } from '@/components/modals/ImportModal';
import { ObservationModal } from '@/components/modals/ObservationModal';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { NowView } from '@/components/views/NowView';
import { ReviewView } from '@/components/views/ReviewView';
import { AskView } from '@/components/views/AskView';

const emptyStore: Store = { entries: [], tasks: [], judgments: [], memoryFeedback: {}, summaries: [], digests: [], profile: [], threadNotes: [] };
const blankSettings: Settings = { baseUrl: '', apiKey: '', model: '' };
/** 设置里最多保留多少条键盘诊断记录；真机排查用，平时不打扰。 */
const DIAG_LIMIT = 8;

export default function Home() {
  const [data, setData] = useState<Store>(emptyStore);
  const [settings, setSettings] = useState<Settings>(blankSettings);
  const [theme, setTheme] = useState<Theme>('dark');
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('now');
  const [reviewTab, setReviewTab] = useState<'main' | 'timeline'>('main');
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [actionEntry, setActionEntry] = useState<Entry | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [backupText, setBackupText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [keyboardDiag, setKeyboardDiag] = useState<KeyboardDiag[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageStatus | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [journal, setJournal] = useState<JournalEvent[]>([]);
  const [showProfile, setShowProfile] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [backupMeta, setBackupMeta] = useState<{ lastExportAt?: string; lastExportCount?: number; autoDirName?: string; lastAutoAt?: string }>({});
  const [embedProbe, setEmbedProbe] = useState<EmbeddingProbe | null>(null);
  const [modelError, setModelError] = useState('');
  const [vectorBusy, setVectorBusy] = useState(false);
  const [vectorCount, setVectorCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [chatScope, setChatScope] = useState<ChatScope>('all');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [observationBusy, setObservationBusy] = useState(false);
  const [observationError, setObservationError] = useState('');
  const [showDigests, setShowDigests] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestError, setDigestError] = useState('');
  const [digestProgress, setDigestProgress] = useState('');
  const [detailJudgment, setDetailJudgment] = useState<Judgment | null>(null);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionError, setRevisionError] = useState('');
  const [focusThread, setFocusThread] = useState<string | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const autoRanRef = useRef(false);
  const autoVectorRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { entries, tasks, judgments, summaries, digests, profile, threadNotes } = data;
  const modelReady = Boolean(settings.baseUrl.trim() && settings.model.trim());

  /**
   * 所有模型调用都从这里走：把最近一次失败的原因留下来，
   * 设置页能直接看到“到底是没配上，还是配上了但接口报错”。
   */
  async function askModel(payload: ChatTurn[], timeout = 90000): Promise<string> {
    try {
      const answer = await callModel(settings, payload, timeout);
      setModelError('');
      return answer;
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '未知错误');
      throw error;
    }
  }

  // 读取本机数据：优先 IndexedDB（容量大得多），没有就退回旧的 localStorage 结构并顺手搬过去。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await readState();
        const mirror = readMirrorState();
        // 主存为准；但如果主存是空的而镜像里有内容（旧设备迁移、或主存曾被清空），
        // 以镜像为准，别让已经写下的记忆凭空消失。
        const weight = (state: typeof stored) => state ? state.store.entries.length + state.store.tasks.length + state.store.judgments.length + state.store.summaries.length + state.store.digests.length : 0;
        // 镜像里只有模型设置、还没有任何记录时也要用它：先配模型、后写记录是正常顺序。
        const hasSettings = (state: typeof stored) => Boolean(state?.settings?.baseUrl?.trim() || state?.settings?.model?.trim());
        const source = weight(stored) > 0 || (weight(mirror) === 0 && !hasSettings(mirror)) ? stored : mirror;
        if (cancelled) return;
        if (!source) { setReady(true); void refreshStorage(); return; }
        // 模型设置可能只存在主存或镜像的一边（某次写入失败、或升级时只搬了一半）。
        // 两边都读，空的那边不覆盖有值的那边——已经配好的模型不该“凭空消失”。
        const merged = mergeSettings(source.settings, readMirrorSettings());
        setData(source.store);
        setSettings(merged);
        setTheme(source.theme);
        setReady(true);
        if (source !== stored) await writeState({ ...source, settings: merged });   // 旧数据第一次进来：搬进主存储
        // 每天留一份快照：误操作（尤其是清空）能回滚。
        const existing = await listSnapshots();
        if (!existing.length || dayOf(existing[0].at) !== today()) await createSnapshot({ ...source, settings: merged }, '每日快照');
        // 两边都空了，说明配置在别处丢了：快照里还留着，自动找回一次并告诉用户。
        if (!merged.baseUrl.trim()) {
          const rescued = await rescueSettingsOnce();
          if (rescued) {
            setSettings(current => mergeSettings(rescued.settings, current));
            setNotice(`模型连接配置丢了，已从 ${new Date(rescued.at).toLocaleDateString('zh-CN')} 的快照找回。`);
          }
        }
        setBackupMeta(readBackupMeta());
        setVectorCount((await readVectors()).size);
        void refreshStorage();
      } catch {
        if (!cancelled) { setNotice('读取本地数据失败。请先导出或检查浏览器存储，避免覆盖原数据。'); setReady(true); }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // 落盘：主存写 IndexedDB，同时留一份 localStorage 镜像（IndexedDB 不可用时镜像就是唯一落点）。
  useEffect(() => {
    if (!ready) return;
    const state = { store: data, settings, theme, updatedAt: new Date().toISOString() };
    const timer = setTimeout(() => {
      void (async () => {
        const saved = await writeState(state);
        writeMirrorState(state);
        if (!saved) setNotice('本机存储写入失败，最近修改可能没有保存，请导出备份。');
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [data, ready, settings, theme]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  // 旧版本注册过的 Service Worker 会把页面锁在旧缓存里，导致“发布后手机看不到新版”。
  // 这里只做一次性清理：确实存在旧注册时才注销并清缓存，然后刷新一次；本地数据不受影响。
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (!registrations.length) return;
        await Promise.all(registrations.map(item => item.unregister()));
        if ('caches' in window) { const names = await caches.keys(); await Promise.all(names.filter(name => name.startsWith('qingxing')).map(name => caches.delete(name))); }
        const flag = 'qingxing.swCleared.v1';
        if (sessionStorage.getItem(flag)) return;
        sessionStorage.setItem(flag, '1');
        window.location.reload();
      } catch { /* 清理失败不阻塞应用，下次打开会再试 */ }
    })();
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (view !== 'ask') return; const frame = requestAnimationFrame(() => { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: busy ? 'smooth' : 'auto' }); }); return () => cancelAnimationFrame(frame); }, [messages, busy, view]);
  // 软键盘与底部导航：键盘收起时输入框常还留着焦点，CSS 兜底会把底栏一直藏住。
  // 这里在确认键盘确实收起时让输入框失焦，底栏随之恢复，不需要用户再点一下屏幕。
  useEffect(() => watchKeyboard({
    onState: state => setTyping(state.up),
    onDismissed: () => {
      const active = document.activeElement;
      if (isInputField(active)) active.blur();
      setTyping(false);
    },
    onDiag: entry => setKeyboardDiag(current => [...current, entry].slice(-DIAG_LIMIT)),
  }), []);

  // 打开「偏好与数据」时刷新一次存储状态、快照与操作记录。
  useEffect(() => { if (showSettings) void refreshStorage(); }, [showSettings]);

  // 自动整理：每次打开最多跑一轮。所有结果都仍是候选或可重做的整理，不会替用户下结论。
  useEffect(() => {
    if (!ready || !modelReady || settings.autoPilot === false || autoRanRef.current) return;
    const sessionKey = 'qingxing.autopilot.v1';
    try {
      if (sessionStorage.getItem(sessionKey) === '1') { autoRanRef.current = true; return; }
      sessionStorage.setItem(sessionKey, '1');
    } catch { /* 隐私模式没有 sessionStorage，照常跑一次 */ }
    autoRanRef.current = true;
    void runAutoPilot();
  }, [ready, modelReady, settings.autoPilot]);

  // 自动补向量：只在用户填了「向量模型」时进行；失败就安静地退回关键词检索。
  useEffect(() => {
    if (!ready || !settings.embedModel?.trim() || !entries.length) return;
    const timer = setTimeout(() => void autoIndexVectors(), 9000);
    return () => clearTimeout(timer);
  }, [ready, settings.embedModel, entries.length]);

  const counts = useMemo(() => { const map = new Map<string, number>(); for (const entry of entries) { const day = dayOf(entry.createdAt); map.set(day, (map.get(day) || 0) + 1); } return map; }, [entries]);
  const todaysEntries = useMemo(() => entries.filter(entry => dayOf(entry.createdAt) === today()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [entries]);
  const streak = useMemo(() => streakOf(counts), [counts]);
  const activeTasks = useMemo(() => tasks.filter(task => task.status === 'open' || task.status === 'deferred'), [tasks]);
  const observationScope = useMemo(() => { const cutoff = Date.now() - 30 * 86400000; return entries.filter(entry => Date.parse(entry.createdAt) >= cutoff).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60); }, [entries]);
  const digestWeeks = useMemo(() => { const map = new Map<string, Entry[]>(); for (const entry of entries) { const start = weekStart(entry.createdAt); const list = map.get(start) || []; list.push(entry); map.set(start, list); } return [...map.entries()].map(([start, list]) => ({ start, end: addDays(start, 6), entries: list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) })).filter(week => week.end < today()).sort((a, b) => a.start.localeCompare(b.start)); }, [entries]);
  const coveredWeeks = useMemo(() => new Set(digests.map(item => item.start)), [digests]);
  const uncoveredWeeks = useMemo(() => digestWeeks.filter(week => !coveredWeeks.has(week.start)), [digestWeeks, coveredWeeks]);
  const nextDigestBatch = uncoveredWeeks.slice(0, 3);
  const digestEntryCount = nextDigestBatch.reduce((sum, week) => sum + week.entries.length, 0);
  // 一段长期记忆是否已经和本周原文对不上：记录被增删改、或上一次沉淀只读到部分记录（上限 100 条）。
  const digestFreshness = useMemo(() => { const map = new Map<string, string>(); for (const item of digests) { const week = digestWeeks.find(entry => entry.start === item.start); if (!week || !week.entries.length) { map.set(item.id, '这一周已经没有记录了'); continue; } const changed = week.entries.some(entry => entry.createdAt > item.generatedAt || entry.updatedAt > item.generatedAt); if (changed || week.entries.length !== item.entryCount) map.set(item.id, '这一周的原文有变化，可能已经对不上'); } return map; }, [digests, digestWeeks]);
  const latestDigests = useMemo(() => [...digests].sort((a, b) => a.start.localeCompare(b.start)).slice(-24), [digests]);
  /** 本地记忆脉络：反复出现的话题，不需要 AI，也不花 token。 */
  const threads = useMemo(() => buildThreads(entries), [entries]);
  const thisDay = useMemo(() => memoriesOnThisDay(entries, today()), [entries]);
  const observationReviewFlags = useMemo(() => { const map = new Map<string, boolean>(); for (const item of judgments) { if (item.status === 'withdrawn' || item.muted) { map.set(item.id, false); continue; } const due = item.nextReviewAt ? item.nextReviewAt <= today() : addDays(dayOf(item.createdAt), 21) <= today(); let fresh = false; if (!due) { const terms = new Set(termsFor(`${item.topic} ${item.statement}`)); const since = item.lastReviewedAt || item.createdAt; fresh = entries.some(entry => entry.createdAt > since && termsFor(entry.content).some(term => terms.has(term))); } map.set(item.id, due || fresh); } return map; }, [judgments, entries]);
  /**
   * 即时回响：今天每条记录找一条最相关的历史记录（分词交集 ≥ 2）。
   * 全部在本地算，不等 AI、不花 token；这是「记完立刻有价值」的最小闭环。
   */
  const echoes = useMemo(() => {
    const map = new Map<string, EntryEcho>();
    if (!todaysEntries.length) return map;
    const past = entries.filter(entry => dayOf(entry.createdAt) !== today()).map(entry => ({ entry, terms: new Set(termsFor(entry.content)) }));
    for (const item of todaysEntries) {
      const terms = termsFor(item.content);
      if (terms.length < 2) continue;
      let best: Entry | null = null;
      let bestScore = 1;
      for (const candidate of past) {
        let score = 0;
        for (const term of terms) if (candidate.terms.has(term)) score++;
        if (score >= 2 && (score > bestScore || (score === bestScore && best && candidate.entry.createdAt > best.createdAt))) { best = candidate.entry; bestScore = score; }
      }
      if (best) map.set(item.id, { entry: best, overlap: bestScore, thread: threadForEntry(item, threads)?.topic });
    }
    return map;
  }, [entries, todaysEntries, threads]);
  const summaryFor = (day: string) => summaries.find(item => item.day === day);
  const confirmedJudgments = judgments.filter(item => item.status === 'confirmed');
  const backupAgeDays = useMemo(() => {
    if (!backupMeta.lastExportAt) return null;
    const days = Math.floor((Date.now() - Date.parse(backupMeta.lastExportAt)) / 86400000);
    return Number.isFinite(days) ? days : null;
  }, [backupMeta.lastExportAt]);

  // ── 存储：状态刷新、操作日志、快照与恢复 ──
  const currentState = () => ({ store: data, settings, theme, updatedAt: new Date().toISOString() });
  async function refreshStorage() {
    setStorageInfo(await storageStatus(currentState()));
    setSnapshots(await listSnapshots());
    setJournal(await listJournal(12));
  }
  function logEvent(kind: JournalKind, text: string, entry?: Entry) {
    void appendJournal(kind, text, entry).then(() => refreshStorage());
  }
  async function takeSnapshot(reason: string) {
    const snapshot = await createSnapshot(currentState(), reason);
    await refreshStorage();
    setNotice(snapshot ? '已存下一份快照。' : '这台设备暂时存不下快照。');
  }
  async function restoreSnapshotById(id: string) {
    const snapshot = await readSnapshot(id);
    if (!snapshot) { setNotice('找不到这份快照。'); return; }
    // 恢复的是记忆，不是模型连接：当前的配置优先，快照里的配置只补空缺。
    const kept = mergeSettings(settings, snapshot.state.settings);
    setData(snapshot.state.store);
    setSettings(kept);
    setTheme(snapshot.state.theme);
    const restored = { ...snapshot.state, settings: kept };
    writeMirrorState(restored);
    await writeState(restored);
    await appendJournal('state.restored', `恢复到 ${new Date(snapshot.at).toLocaleString('zh-CN')} 的快照`);
    await refreshStorage();
    setNotice('已经回到那份快照的状态。');
  }
  /** 从最近的快照里把模型连接配置找回来（地址、密钥都在快照里）。 */
  async function recoverSettings() {
    const found = await findSettingsInSnapshots();
    if (!found) { setNotice('这些快照里没有可用的模型连接配置。'); return; }
    // 当前已有的值优先，快照只补空缺。
    const recovered = mergeSettings(settings, found.settings);
    setSettings(recovered);
    await writeState({ ...currentState(), settings: recovered });
    writeMirrorState({ ...currentState(), settings: recovered });
    setNotice(`已从 ${new Date(found.at).toLocaleString('zh-CN')} 的快照找回模型连接配置。`);
  }
  async function restoreDeletedEntry(entry: Entry) {
    setData(current => current.entries.some(item => item.id === entry.id) ? current : { ...current, entries: [...current.entries, entry] });
    await appendJournal('entry.created', `找回了一条被删除的记忆：${entry.content.slice(0, 20)}`);
    await refreshStorage();
    setNotice('这条记忆已经回来了。');
  }
  async function removeSnapshot(id: string) {
    await deleteSnapshot(id);
    await refreshStorage();
    setNotice('这份快照已删除。');
  }
  async function clearEverything() {
    if (!window.confirm('确认清空本机全部记录、事项与判断？模型连接会保留，请先导出备份。')) return;
    await createSnapshot(currentState(), '清空前快照');
    // 模型连接是配置，不是记忆：清空记忆不该让模型又变回“没连上”。
    const kept = { ...settings };
    await clearStorage();
    const emptied = { store: emptyStore, settings: kept, theme, updatedAt: new Date().toISOString() };
    await writeState(emptied);
    writeMirrorState(emptied);
    setData(emptyStore);
    setSettings(kept);
    setMessages([]);
    // 备份元信息与向量计数都是“本机数据”的一部分，清空后要一起归零，
    // 否则界面会显示“上次备份是今天”“已有 N 条向量”这类不存在的事实。
    setBackupMeta({});
    setVectorCount(0);
    setEmbedProbe(null);
    await refreshStorage();
    setNotice('本机数据已清空，模型连接保留。清空前留了一份快照，可以在设置里恢复。');
  }

  // ── 「关于你」档案块 ──
  function addProfileItem(kind: ProfileKind, text: string) {
    if (!text.trim()) return;
    const now = new Date().toISOString();
    const item: ProfileItem = { id: uid(), kind, text: text.trim().slice(0, 120), evidenceIds: [], source: 'user', confirmed: true, createdAt: now, updatedAt: now };
    setData(current => ({ ...current, profile: [...current.profile, item] }));
    logEvent('profile.updated', `写了一条档案：${item.text.slice(0, 16)}`);
  }
  function updateProfileItem(id: string, text: string) {
    setData(current => ({ ...current, profile: current.profile.map(item => item.id === id ? { ...item, text: text.trim().slice(0, 120), updatedAt: new Date().toISOString() } : item) }));
    logEvent('profile.updated', '改了一条档案');
  }
  function removeProfileItem(id: string) {
    setData(current => ({ ...current, profile: current.profile.filter(item => item.id !== id) }));
    logEvent('profile.updated', '删掉了一条档案');
  }
  function confirmProfileItem(id: string) {
    setData(current => ({ ...current, profile: current.profile.map(item => item.id === id ? { ...item, confirmed: true, updatedAt: new Date().toISOString() } : item) }));
    logEvent('profile.updated', '确认了一条档案');
  }
  async function createProfileProposals(): Promise<ProfileItem[]> {
    if (!modelReady) throw new Error('还没有连接模型。先在“偏好与数据”里填写接口地址与模型。');
    // 取最近的 60 条；entries 是按写入顺序追加的，不能直接 slice(0, 60)。
    const recent = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
    if (recent.length < 3) throw new Error('记录还太少，先记几天再让 AI 提议。');
    const allowedIds = new Set(recent.map(entry => entry.id));
    const raw = await askModel(buildProfileProposalRequest({ entries: recent, existing: profile }), 120000);
    const proposals = parseProfileProposal(raw, allowedIds).filter(item => !hasSimilarProfileText(profile, item.text));
    const now = new Date().toISOString();
    return proposals.map(item => ({ id: uid(), kind: item.kind, text: item.text, evidenceIds: item.evidenceIds, source: 'ai', confirmed: false, createdAt: now, updatedAt: now }));
  }
  async function proposeProfile() {
    if (profileBusy) return;
    setProfileBusy(true); setProfileError('');
    try {
      const items = await createProfileProposals();
      if (!items.length) { setProfileError('这次没有找到足够有把握的背景条目。可以自己写。'); return; }
      setData(current => ({ ...current, profile: [...current.profile, ...items] }));
      setNotice(`AI 提议了 ${items.length} 条，你确认后才会生效。`);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '提议失败，请稍后重试。');
    } finally { setProfileBusy(false); }
  }

  // ── 自动备份 ──
  function markExported(count: number) {
    const meta = { ...backupMeta, lastExportAt: new Date().toISOString(), lastExportCount: count };
    setBackupMeta(meta);
    writeBackupMeta(meta);
  }
  async function runAutoBackup(): Promise<boolean> {
    const handle = await readDirectoryHandle<DirectoryHandleLike>();
    if (!handle) {
      // 句柄可能因为清空数据或浏览器回收而失效；这时要把界面上的“已授权”一起撤掉，
      // 否则用户点“立即备份一次”会以为备份过了。
      const meta = { ...backupMeta, autoDirName: undefined, lastAutoAt: undefined };
      setBackupMeta(meta);
      writeBackupMeta(meta);
      setNotice('自动备份目录的授权已经失效，请重新选一个目录。');
      return false;
    }
    try {
      const name = await writeBackupToDirectory(handle, buildBackupText(data, theme));
      const meta = { ...backupMeta, autoDirName: handle.name, lastAutoAt: new Date().toISOString(), lastExportAt: new Date().toISOString(), lastExportCount: entries.length };
      setBackupMeta(meta);
      writeBackupMeta(meta);
      setNotice(`已自动备份到「${handle.name}」里的 ${name}。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '自动备份失败。');
      return false;
    }
  }
  async function authorizeAutoBackup() {
    try {
      const handle = await pickBackupDirectory();
      if (!handle) return;
      await saveDirectoryHandle(handle);
      const meta = { ...backupMeta, autoDirName: handle.name };
      setBackupMeta(meta);
      writeBackupMeta(meta);
      await runAutoBackup();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setNotice(error instanceof Error ? error.message : '没有拿到目录授权。');
    }
  }

  // ── 语义向量 ──
  /** 记录被改或被删时，旧向量必须一起丢掉，否则语义召回会按旧内容命中。 */
  async function dropVectors(ids: string[]) {
    if (!ids.length) return;
    await deleteVectors(ids);
    setVectorCount(current => Math.max(0, current - ids.length));
  }
  async function testConnection() {
    if (!modelReady) { setNotice('还没有连接模型。先填写接口地址与模型名。'); return; }
    setEmbedProbe(null);
    try {
      const answer = await askModel([{ role: 'user', content: '回复两个字：可以' }], 30000);
      setNotice(`对话接口正常：${answer.slice(0, 20)}`);
    } catch (error) {
      setNotice(`对话接口失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
    setEmbedProbe(await probeEmbedding(settings));
  }
  async function buildVectors() {
    if (vectorBusy) return;
    setVectorBusy(true);
    try {
      const existing = await readVectors();
      const pending = entries.filter(entry => !existing.has(entry.id));
      if (!pending.length) { setVectorCount(existing.size); setNotice('所有记录都已有向量。'); return; }
      const batch = pending.slice(0, 40);
      const vectors = await embedTexts(settings, batch.map(entry => entry.content));
      const rows: VectorRow[] = [];
      batch.forEach((entry, index) => { const vector = vectors[index]; if (vector?.length) rows.push({ id: entry.id, vector, at: new Date().toISOString(), model: embeddingModel(settings) }); });
      await writeVectors(rows);
      const all = await readVectors();
      setVectorCount(all.size);
      setNotice(`已为 ${rows.length} 条记录生成向量，缓存里共 ${all.size} 条。`);
    } catch (error) {
      setNotice(`生成向量失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally { setVectorBusy(false); }
  }
  /**
   * 语义召回：只要缓存里有向量就试一次，接口不支持或失败就返回空、由关键词兜底。
   * 不依赖「测试连接」的结果——那是内存状态，刷新就没了，会让语义检索悄悄失效。
   */
  async function semanticSources(question: string): Promise<Entry[]> {
    try {
      const vectors = await readVectors();
      if (!vectors.size) return [];
      const [queryVector] = await embedTexts(settings, [question]);
      if (!queryVector?.length) return [];
      return entries
        .map(entry => { const row = vectors.get(entry.id); return row ? { entry, score: cosine(queryVector, row.vector) } : null; })
        .filter((item): item is { entry: Entry; score: number } => !!item && item.score > 0.2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map(item => item.entry);
    } catch {
      return [];
    }
  }
  /**
   * 全站统一的混合检索：字面命中 > 分词交集 > 语义召回，合并去重。
   * 提问、时间线搜索都用这一套，同一个词不会再出现两种结果。
   */
  async function searchEntries(question: string): Promise<Entry[]> {
    const literal = question.trim().toLowerCase();
    const words = termsFor(question);
    const scored = entries
      .map(entry => {
        let score = literal && entry.content.toLowerCase().includes(literal) ? 10 : 0;
        score += termsFor(entry.content).filter(word => words.includes(word)).length;
        return { entry, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
      .slice(0, 24);
    const semantic = await semanticSources(question);
    const seen = new Set(scored.map(item => item.entry.id));
    const merged = scored.map(item => item.entry);
    for (const entry of semantic) {
      if (seen.has(entry.id) || merged.length >= 36) continue;
      seen.add(entry.id);
      merged.push(entry);
    }
    return merged;
  }

  function navigate(next: View) { setView(next); window.scrollTo({ top: 0 }); }
  function openDayInTimeline(day: string) { setView('review'); setReviewTab('timeline'); setFocusDay(day); }
  function saveEntry() {
    if (!draft.trim() || !ready) return;
    const now = new Date().toISOString();
    const entry: Entry = editing ? { ...editing, content: draft.trim(), updatedAt: now } : { id: uid(), content: draft.trim(), source: 'user', createdAt: now, updatedAt: now };
    setData(current => ({ ...current, entries: editing ? current.entries.map(item => item.id === entry.id ? entry : item) : [...current.entries, entry] }));
    logEvent(editing ? 'entry.edited' : 'entry.created', editing ? '修改了一条记忆' : '记下了一条新记忆');
    setDraft(''); setEditing(null);
    setNotice('已妥善记下。');
    if (editing) void dropVectors([entry.id]);
  }
  function openActions(entry: Entry) { setActionEntry(entry); setTaskTitle(entry.content.slice(0, 60)); }
  function addTask() {
    if (!actionEntry || !taskTitle.trim()) return;
    if (tasks.some(item => item.sourceId === actionEntry.id)) { setNotice('这条记录已关联事项。'); return; }
    setData(current => ({ ...current, tasks: [...current.tasks, { id: uid(), title: taskTitle.trim(), status: 'open', sourceId: actionEntry.id, createdAt: new Date().toISOString() }] }));
    setActionEntry(null);
    setNotice('已建立事项，原始记录仍保留。');
  }
  function setStatus(id: string, status: Task['status']) { setData(current => ({ ...current, tasks: current.tasks.map(item => item.id === id ? { ...item, status } : item) })); }
  function openObservation(item: Judgment) { setDetailJudgment(item); setRevisionError(''); }
  function reviewObservation(item: Judgment, status: Judgment['status']) {
    const now = new Date().toISOString();
    const updated: Judgment = { ...item, status, lastReviewedAt: now, nextReviewAt: status === 'withdrawn' ? undefined : addDays(dayOf(now), status === 'confirmed' ? 30 : 14), updatedAt: now };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === item.id ? updated : entry) }));
    setDetailJudgment(updated);
  }
  function restoreObservation(item: Judgment) {
    const now = new Date().toISOString();
    const updated: Judgment = { ...item, muted: false, status: 'candidate', lastReviewedAt: now, nextReviewAt: addDays(dayOf(now), 14), updatedAt: now };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === item.id ? updated : item) }));
    setDetailJudgment(updated);
    setNotice('已恢复为待核对。');
  }
  function saveCorrection(item: Judgment, reason: string, note: string) {
    const now = new Date().toISOString();
    const muted = reason === '以后不再使用';
    const status: Judgment['status'] = reason === '不准确' || muted ? 'withdrawn' : 'uncertain';
    const updated: Judgment = {
      ...item, status, muted: muted || !!item.muted,
      confidence: reason === '只发生过一次' ? 'weak' : item.confidence,
      corrections: [...(item.corrections || []), { reason, note, at: now }],
      lastReviewedAt: now,
      nextReviewAt: status === 'withdrawn' ? undefined : addDays(dayOf(now), 14),
      updatedAt: now,
    };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === updated.id ? updated : entry) }));
    setDetailJudgment(updated);
    logEvent('judgment.updated', `纠正了一条观察：${item.topic}`);
    setNotice('已记录你的纠正。');
  }
  function saveObservationEdit(item: Judgment, topic: string, statement: string) {
    const now = new Date().toISOString();
    const currentVersion = item.version || 1;
    const updated: Judgment = {
      ...item, topic, statement, version: currentVersion + 1,
      versions: [...(item.versions || []), { version: currentVersion, topic: item.topic, statement: item.statement, at: now, reason: '用户修改' }],
      lastReviewedAt: now, nextReviewAt: addDays(dayOf(now), 21), updatedAt: now,
    };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === updated.id ? updated : entry) }));
    setDetailJudgment(updated);
    setNotice('已保存修改，旧版本保留在历史里。');
  }
  async function reviseObservation(item: Judgment) {
    if (revisionBusy || !modelReady) return;
    setRevisionBusy(true); setRevisionError('');
    try {
      const support = item.supportIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
      const counter = item.counterIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
      const since = item.lastReviewedAt || item.createdAt;
      const fresh = entries.filter(entry => entry.createdAt > since).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
      const raw = await askModel(buildRevisionRequest({ item, support, counter, corrections: item.corrections || [], fresh }), 90000);
      const revised = parseRevision(raw, item);
      const now = new Date().toISOString();
      const currentVersion = item.version || 1;
      const updated: Judgment = {
        ...item, statement: revised.statement, type: revised.type,
        alternative: revised.alternative,
        falsifier: revised.falsifier,
        version: currentVersion + 1,
        versions: [...(item.versions || []), { version: currentVersion, topic: item.topic, statement: item.statement, at: now, reason: (item.corrections && item.corrections.length) ? '按纠正重写' : '重新核对' }],
        status: 'candidate', lastReviewedAt: now, nextReviewAt: addDays(dayOf(now), 21), updatedAt: now,
      };
      setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === updated.id ? updated : entry) }));
      setDetailJudgment(updated); logEvent('judgment.updated', `重写了一条观察：${item.topic}`); setNotice('已生成修改版，请核对新的判断。');
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : '重写失败，请稍后重试。');
    } finally { setRevisionBusy(false); }
  }
  async function createObservations(): Promise<{ created: Judgment[]; note: string }> {
    const scope = observationScope;
    if (scope.length < 3 && !digests.length) throw new Error('最近 30 天的记录还太少，也还没有长期记忆；先积累一些再让 AI 观察。');
    const scopeIds = new Set(scope.map(entry => entry.id));
    const recentTerms = new Set(scope.flatMap(entry => termsFor(entry.content)));
    const counterPool = entries.filter(entry => !scopeIds.has(entry.id)).map(entry => ({ entry, score: termsFor(entry.content).filter(term => recentTerms.has(term)).length })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt)).slice(0, 8).map(item => item.entry);
    const allowedIds = new Set([...scope.map(entry => entry.id), ...counterPool.map(entry => entry.id), ...latestDigests.flatMap(item => item.evidence.map(evidence => evidence.id))]);
    const raw = await askModel(buildObservationRequest({ scope, counterPool, digests: latestDigests, judgments, profile, threads, recentSummaries: summaries.slice(-3) }), 120000);
    return parseObservations(raw, { allowedIds, entries, existingTopics: judgments.map(item => item.topic) });
  }
  async function generateObservations() {
    if (observationBusy) return;
    if (!modelReady) { setObservationError('还没有连接模型。请先在“偏好与数据”里填写接口地址、模型名称和访问密钥。'); return; }
    setObservationBusy(true); setObservationError('');
    try {
      const { created, note } = await createObservations();
      if (!created.length) { setObservationError(note || '这次没有找到足够可靠的新观察。可以等记录多一些再试。'); return; }
      setData(current => ({ ...current, judgments: [...current.judgments, ...created] }));
      setNotice(`已生成 ${created.length} 条候选观察，请逐条核对证据。`);
    } catch (error) {
      setObservationError(error instanceof Error ? error.message : '生成失败，请稍后重试。');
    } finally { setObservationBusy(false); }
  }
  async function digestWeek(week: DigestWeek, known: MemoryDigest[]) {
    setDigestProgress(`正在沉淀 ${shortDate(week.start)}–${shortDate(week.end)}…`);
    const previous = known.filter(item => item.end < week.start).sort((a, b) => a.end.localeCompare(b.end)).at(-1);
    const raw = await askModel(buildDigestRequest(week, previous, judgments.filter(item => item.status === 'confirmed'), profile, threads), 120000);
    return parseDigest(raw, week, settings.model);
  }
  function digestErrorText(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
  async function updateDigests() {
    if (digestBusy) return;
    if (!modelReady) { setDigestError('还没有连接模型。请先在“偏好与数据”里填写接口地址、模型名称和访问密钥。'); return; }
    const batch = nextDigestBatch;
    if (!batch.length) { setDigestError('所有可用的周都已经沉淀。'); return; }
    setDigestBusy(true); setDigestError('');
    const known = [...digests];
    let saved = 0;
    try {
      for (let index = 0; index < batch.length; index++) {
        const week = batch[index];
        setDigestProgress(`正在沉淀 ${shortDate(week.start)}–${shortDate(week.end)}（${index + 1}/${batch.length}）…`);
        const digest = await digestWeek(week, known);
        setData(current => ({ ...current, digests: [...current.digests, digest] }));
        known.push(digest); saved++;
      }
      setNotice(`已沉淀 ${saved} 周，长期记忆共 ${digests.length + saved} 段。`);
      logEvent('digest.generated', `沉淀了 ${saved} 周长期记忆`);
    } catch (error) {
      setDigestError(`${digestErrorText(error, '沉淀失败，请稍后重试。')}${saved ? `（已完成 ${saved} 周，其余未保存。）` : ''}`);
    } finally { setDigestBusy(false); setDigestProgress(''); }
  }
  // 单周重做：已沉淀的周在记录有增删改后可以重来；按 start 替换，id 保持不变，其它周不受影响。
  async function redigestWeek(start: string) {
    if (digestBusy) return;
    if (!modelReady) { setDigestError('还没有连接模型。请先在“偏好与数据”里填写接口地址、模型名称和访问密钥。'); return; }
    const week = digestWeeks.find(item => item.start === start);
    if (!week || !week.entries.length) { setDigestError('这一周已经没有任何记录，无法重新沉淀。可以直接删除这段记忆。'); return; }
    setDigestBusy(true); setDigestError('');
    try {
      const digest = await digestWeek(week, digests.filter(item => item.start !== start));
      setData(current => ({ ...current, digests: [...current.digests.filter(item => item.start !== start), digest] }));
      setNotice(`已按本周 ${week.entries.length} 条记录重新沉淀。`);
      logEvent('digest.generated', `重新沉淀了 ${shortDate(week.start)} 那一周`);
    } catch (error) {
      setDigestError(digestErrorText(error, '重新沉淀失败，原来的记忆保持不变。'));
    } finally { setDigestBusy(false); setDigestProgress(''); }
  }
  function removeDigest(id: string) {
    setData(current => ({ ...current, digests: current.digests.filter(item => item.id !== id) }));
    setNotice('已删除这段长期记忆，原始记录没有改动。需要时可以重新沉淀。');
  }
  function confirmImport(incoming: Store, mode: 'merge' | 'replace') {
    const replaced = mode === 'replace';
    const kept = replaced ? new Set(incoming.entries.map(entry => entry.id)) : new Set([...entries, ...incoming.entries].map(entry => entry.id));
    setData(current => replaced ? incoming : mergeStores(current, incoming));
    setImportOpen(false);
    setNotice('备份已恢复，欢迎继续记录。');
    void syncVectors(kept);
  }
  /**
   * 导入后收拾向量缓存：整体替换时全部作废，合并时只丢掉本机已经没有的记录。
   * 这一步失败也不影响数据本身，语义召回只是少几条候选。
   */
  async function syncVectors(kept: Set<string>) {
    const vectors = await readVectors();
    if (!vectors.size) return;
    const stale = [...vectors.keys()].filter(id => !kept.has(id));
    if (stale.length === vectors.size) { await clearVectors(); setVectorCount(0); return; }
    if (!stale.length) return;
    await deleteVectors(stale);
    setVectorCount(vectors.size - stale.length);
  }
  async function exportData() {
    const text = buildBackupText(data, theme);
    setBackupText(text);
    const result = await saveBackupFile(text, backupFileName());
    // 只有真的把数据交出去了才记时间：用户在分享面板点取消时不能算备份成功，
    // 否则“还没备份过”的提醒会消失，用户会以为数据已经带出设备了。
    if (result === 'cancelled') return;
    markExported(entries.length);
    if (backupMeta.autoDirName) {
      const ok = await runAutoBackup();
      if (!ok) setNotice('备份文件已保存，但自动备份到目录这一步没成功，请检查目录授权。');
    }
  }

  async function ask() {
    const question = chatInput.trim();
    if (!question || busy) return;
    setMessages(current => [...current, { role: 'user', content: question }]);
    setChatInput('');
    setBusy(true);
    const questionTerms = new Set(termsFor(question));
    const matchedThreads = threads.filter(thread => thread.terms.some(term => questionTerms.has(term))).slice(0, 2);
    const found = await searchEntries(question);
    // 问题命中某条线索时，把这条线上更早的记录也带上；否则模型只能看到零散几天的片段。
    const threadEntries = matchedThreads.flatMap(thread => thread.entryIds).map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
    const merged = [...new Map([...found, ...threadEntries].map(entry => [entry.id, entry])).values()];
    const sources = merged.length ? merged.slice(0, 14) : [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
    const useEntries = chatScope !== 'judgments';
    try {
      if (!modelReady) {
        setMessages(current => [...current, { role: 'assistant', content: sources.length ? `找到 ${sources.length} 条可能相关的原始记录。当前是本地检索模式，只展示原文，不作推断。在“偏好与数据”中连接模型后，可以进行真正的分析。` : '暂未找到相关记录。可以补充人物、主题或具体事件；连接模型后也可以直接提问。', sources: useEntries ? sources : [] }]);
        return;
      }
      const answer = await askModel(buildChatRequest({ question, scope: chatScope, sources, confirmed: confirmedJudgments, history: messages.map(({ role, content }) => ({ role, content })), profile, digests: latestDigests, threadNotes, recentSummaries: summaries.slice(-2), threads: matchedThreads.length ? matchedThreads : threads }), 120000);
      setMessages(current => [...current, { role: 'assistant', content: answer, sources: useEntries ? sources : [] }]);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `这次请求没有完成：${error instanceof Error ? error.message : '未知错误'}。请检查接口地址、访问密钥、模型名称，以及接口是否允许浏览器跨域访问。原始记录没有受到影响。` }]);
    } finally { setBusy(false); }
  }

  async function summarizeDay(day: string): Promise<DailySummary> {
    const dayEntries = entries.filter(entry => dayOf(entry.createdAt) === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!dayEntries.length) throw new Error('这一天没有记录。');
    if (!modelReady) throw new Error('还没有连接模型。请在“偏好与数据”中填写接口地址、模型名称和访问密钥。');
    const earlier = entries.filter(entry => dayOf(entry.createdAt) < day).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
    const previous = [...summaries].filter(item => item.day < day).sort((a, b) => a.day.localeCompare(b.day)).at(-1);
    const raw = await askModel(buildSummaryRequest(day, dayEntries, earlier, { profile, threads, previous, digests: latestDigests.slice(-2) }), 120000);
    return parseSummary(raw, day, dayEntries, settings.model);
  }
  async function generateSummary(day: string) {
    if (summaryBusy) return;
    setSummaryBusy(true); setSummaryError('');
    try {
      const summary = await summarizeDay(day);
      setData(current => ({ ...current, summaries: [...current.summaries.filter(item => item.day !== day), summary] }));
      logEvent('summary.generated', `生成了 ${day} 的回望`);
      setNotice('这一天的回望已生成并保存在本机。');
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : '生成失败，请稍后重试。');
    } finally { setSummaryBusy(false); }
  }

  function addTaskFromText(text: string) {
    const title = text.trim().slice(0, 120);
    if (!title) return;
    if (tasks.some(task => task.title === title && (task.status === 'open' || task.status === 'deferred'))) { setNotice('这件事已经在事项里了。'); return; }
    setData(current => ({ ...current, tasks: [...current.tasks, { id: uid(), title, status: 'open', sourceId: '', createdAt: new Date().toISOString() }] }));
    setNotice('已记为事项，原始记录没有改动。');
  }

  // ── 线索串联 ──
  async function generateThreadNote(topic: string) {
    if (threadBusy) return;
    const thread = threads.find(item => item.topic === topic);
    if (!thread) { setThreadError('这条线索现在找不到记录了。'); return; }
    const list = thread.entryIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (list.length < 2) { setThreadError('这条线索只有一条记录，暂时串不起来。'); return; }
    if (!modelReady) { setThreadError('还没有连接模型。请在“偏好与数据”里填写接口地址、模型名称和访问密钥。'); return; }
    setThreadBusy(true); setThreadError('');
    try {
      const raw = await askModel(buildThreadRequest(topic, list, profile), 120000);
      const note = parseThreadNote(raw, topic, list, settings.model);
      setData(current => ({ ...current, threadNotes: [...current.threadNotes.filter(item => item.topic !== topic), note] }));
      logEvent('summary.generated', `把「${topic}」这条线索串了起来`);
      setNotice('这条线已经串好，保存在本机，随时可以重做。');
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : '串联失败，请稍后重试。');
    } finally { setThreadBusy(false); }
  }

  // ── 自动整理 ──
  async function runAutoPilot() {
    if (autoBusy) return;
    setAutoBusy(true);
    const done: string[] = [];
    try {
      // 1) 补最近一天缺的回望（当天不补，避免过早下结论）
      const missingDay = [...new Set(entries.map(entry => dayOf(entry.createdAt)))]
        .filter(day => day < today() && day >= addDays(today(), -7) && !summaries.some(item => item.day === day))
        .sort((a, b) => b.localeCompare(a))[0];
      if (missingDay) {
        try {
          const summary = await summarizeDay(missingDay);
          setData(current => ({ ...current, summaries: [...current.summaries.filter(item => item.day !== missingDay), summary] }));
          done.push(`${shortDate(missingDay)} 的回望`);
        } catch { /* 接口失败或内容不足，下个会话再试 */ }
      }
      // 2) 沉淀一个已结束、还没覆盖的周
      const week = uncoveredWeeks[0];
      if (week) {
        try {
          const digest = await digestWeek(week, digests);
          setData(current => ({ ...current, digests: [...current.digests, digest] }));
          setSettings(current => ({ ...current, lastAutoDigestAt: new Date().toISOString() }));
          done.push(`「${digest.title || shortDate(week.start)}」这一周`);
        } catch { /* 下个会话再试 */ }
      }
      // 3) 新记录足够多时，自动生成候选观察；用户仍需逐条核对
      const sinceObservation = settings.lastAutoObservationAt ? Date.parse(settings.lastAutoObservationAt) : 0;
      const freshForObservation = entries.filter(entry => Date.parse(entry.createdAt) > sinceObservation).length;
      const observationDue = settings.lastAutoObservationAt ? freshForObservation >= 10 : entries.length >= 14;
      if (observationDue && judgments.length < 40) {
        try {
          const { created } = await createObservations();
          if (created.length) {
            setData(current => ({ ...current, judgments: [...current.judgments, ...created] }));
            done.push(`${created.length} 条候选观察`);
          }
          setSettings(current => ({ ...current, lastAutoObservationAt: new Date().toISOString() }));
        } catch { /* 数据还不够或接口失败，下个会话再试 */ }
      }
      // 4) 每两周、新记录足够多时，提议几条背景；默认待确认
      const sinceProfile = settings.lastAutoProfileAt ? Date.parse(settings.lastAutoProfileAt) : 0;
      const freshForProfile = entries.filter(entry => Date.parse(entry.createdAt) > sinceProfile).length;
      const profileDue = (settings.lastAutoProfileAt ? freshForProfile >= 25 : entries.length >= 30) && (!settings.lastAutoProfileAt || Date.now() - sinceProfile >= 14 * 86400000);
      if (profileDue && profile.filter(item => !item.confirmed).length < 6) {
        try {
          const items = await createProfileProposals();
          if (items.length) {
            setData(current => ({ ...current, profile: [...current.profile, ...items] }));
            done.push(`${items.length} 条背景提议`);
          }
          setSettings(current => ({ ...current, lastAutoProfileAt: new Date().toISOString() }));
        } catch { /* 下个会话再试 */ }
      }
    } finally {
      setAutoBusy(false);
      if (done.length) setNotice(`AI 已自动整理：${done.join('、')}。所有结果都可以修改、重做或撤回。`);
    }
  }

  async function autoIndexVectors() {
    if (autoVectorRef.current || !settings.embedModel?.trim()) return;
    autoVectorRef.current = true;
    try {
      const existing = await readVectors();
      let pending = entries.filter(entry => !existing.has(entry.id));
      let rounds = 0;
      while (pending.length && rounds < 2) {
        const batch = pending.slice(0, 24);
        const vectors = await embedTexts(settings, batch.map(entry => entry.content));
        const rows: VectorRow[] = [];
        batch.forEach((entry, index) => { const vector = vectors[index]; if (vector?.length) rows.push({ id: entry.id, vector, at: new Date().toISOString(), model: embeddingModel(settings) }); });
        if (!rows.length) break;
        await writeVectors(rows);
        rounds++;
        const updated = await readVectors();
        pending = pending.filter(entry => !updated.has(entry.id));
        setVectorCount(updated.size);
      }
    } catch { /* 接口不支持 /embeddings 时保持关键词检索，不打扰用户 */ }
    finally { autoVectorRef.current = false; }
  }

  return <main className={`app-shell theme-${theme}${typing ? ' keyboard-open' : ''}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('now')}><span className="brand-mark">清</span><span>清醒<small>留住当时的清醒</small></span></button>
      <nav>{navItems.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><Icon name={item.icon}/>{item.label}</button>)}</nav>
      <div className="sidebar-bottom">
        <p>人们忘掉的不是事实，<br/>而是当初的清醒。</p>
        <button className="nav-item" onClick={() => setShowSettings(true)}><Icon name="settings"/>偏好与数据</button>
        <small>{VERSION}</small>
      </div>
    </aside>
    <section className="main-area">
      <header className="topbar">
        <span className="mobile-brand">清醒<span>个人记忆</span></span>
        {autoBusy && <span className="auto-pill" role="status"><i/>AI 正在自动整理</span>}
        <span className="device-status"><i/>记录保存在本机</span>
        <button className="icon-button" aria-label="偏好与数据" onClick={() => setShowSettings(true)}><Icon name="settings"/></button>
      </header>
      {view === 'now' && <NowView
        entries={entries} todaysEntries={todaysEntries} echoes={echoes} todayCount={todaysEntries.length} streak={streak}
        draft={draft} editing={editing} ready={ready} setDraft={setDraft} setEditing={setEditing} saveEntry={saveEntry} composerRef={composerRef} setTyping={setTyping} openActions={openActions}
        activeTasks={activeTasks} setStatus={setStatus}
        todaySummary={summaryFor(today())} summaryBusy={summaryBusy} summaryError={summaryError} modelReady={modelReady} generateSummary={generateSummary}
        onAddTask={addTaskFromText}
        backupAgeDays={backupAgeDays} onOpenSettings={() => setShowSettings(true)}
        onOpenTimeline={() => { setView('review'); setReviewTab('timeline'); window.scrollTo({ top: 0 }); }}
        onOpenDay={openDayInTimeline} onAsk={() => navigate('ask')}
        threads={threads} thisDay={thisDay}
        onOpenThread={topic => { setFocusThread(topic); setReviewTab('main'); navigate('review'); }}
      />}
      {view === 'review' && <ReviewView
        entries={entries} counts={counts} judgments={judgments} observationReviewFlags={observationReviewFlags} openObservation={openObservation}
        observationBusy={observationBusy} observationError={observationError} observationScopeCount={observationScope.length} generateObservations={generateObservations} modelReady={modelReady}
        digests={digests} uncoveredWeekCount={uncoveredWeeks.length} onOpenDigests={() => setShowDigests(true)}
        profile={profile} onOpenProfile={() => setShowProfile(true)}
        summaryFor={summaryFor} generateSummary={generateSummary} summaryBusy={summaryBusy} summaryError={summaryError}
        openActions={openActions} searchEntries={searchEntries}
        tab={reviewTab} setTab={setReviewTab} focusDay={focusDay} onFocusDayConsumed={() => setFocusDay(null)}
        tasks={tasks} setStatus={setStatus}
        threads={threads} threadNotes={threadNotes}
        focusThread={focusThread} onFocusThreadConsumed={() => setFocusThread(null)}
        onGenerateThread={topic => void generateThreadNote(topic)} threadBusy={threadBusy} threadError={threadError}
      />}
      {view === 'ask' && <AskView
        messages={messages} chatInput={chatInput} setChatInput={setChatInput} chatScope={chatScope} setChatScope={setChatScope}
        busy={busy} ask={ask} modelReady={modelReady} setTyping={setTyping} chatEndRef={chatEndRef} onOpenDay={openDayInTimeline}
        threads={threads}
      />}
    </section>

    <nav className="mobile-nav" aria-label="主导航">{navItems.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>

    {notice && <button className="notice" role="status" onClick={() => setNotice('')}>{notice}<Icon name="close" size={15}/></button>}

    {actionEntry && <EntryModal
      entry={actionEntry}
      hasTask={tasks.some(item => item.sourceId === actionEntry.id)}
      taskTitle={taskTitle} setTaskTitle={setTaskTitle} onAddTask={addTask}
      onEdit={() => { setEditing(actionEntry); setDraft(actionEntry.content); setActionEntry(null); setView('now'); setTimeout(() => composerRef.current?.focus(), 50); }}
      onDelete={() => { logEvent('entry.deleted', `删除了一条记忆：${actionEntry.content.slice(0, 20)}`, actionEntry); setData(current => ({ ...current, entries: current.entries.filter(item => item.id !== actionEntry.id) })); void dropVectors([actionEntry.id]); setActionEntry(null); }}
      onFeedback={value => {
        setData(current => ({ ...current, entries: current.entries.map(item => item.id === actionEntry.id ? { ...item, feedback: value, updatedAt: new Date().toISOString() } : item) }));
        setActionEntry(current => current ? { ...current, feedback: value } : null);
      }}
      onClose={() => setActionEntry(null)}
    />}
    {showProfile && <ProfileModal items={profile} entries={entries} busy={profileBusy} error={profileError} onClose={() => setShowProfile(false)} onAdd={addProfileItem} onUpdate={updateProfileItem} onRemove={removeProfileItem} onConfirm={confirmProfileItem} onPropose={() => void proposeProfile()}/>}
    {detailJudgment && <ObservationModal
      item={detailJudgment} entries={entries} modelReady={modelReady} revisionBusy={revisionBusy} revisionError={revisionError}
      onReview={reviewObservation} onRestore={restoreObservation} onSaveCorrection={saveCorrection} onSaveEdit={saveObservationEdit} onRevise={item => void reviseObservation(item)}
      onClose={() => setDetailJudgment(null)}
    />}
    {showDigests && <DigestModal
      digests={digests} digestCount={digests.length} nextBatchCount={nextDigestBatch.length} nextBatchStart={nextDigestBatch[0]?.start} nextBatchEntries={digestEntryCount}
      freshness={digestFreshness} busy={digestBusy} progress={digestProgress} error={digestError} modelReady={modelReady}
      onUpdate={() => void updateDigests()} onRedigest={start => void redigestWeek(start)} onRemove={removeDigest}
      onClose={() => setShowDigests(false)}
    />}
    {showSettings && <SettingsModal
      settings={settings} setSettings={update => { setModelError(''); setSettings(update); }} theme={theme} setTheme={setTheme}
      backupMeta={backupMeta} backupText={backupText} supportsAuto={supportsAutoBackup()}
      onExport={() => void exportData()} onOpenImport={() => { setShowSettings(false); setImportOpen(true); }}
      onAuthorizeDir={() => void authorizeAutoBackup()} onRunAutoBackup={() => void runAutoBackup()}
      storageInfo={storageInfo} snapshots={snapshots} journal={journal}
      onSnapshot={() => void takeSnapshot('手动快照')} onRestoreSnapshot={id => void restoreSnapshotById(id)} onRemoveSnapshot={id => void removeSnapshot(id)}
      onRestoreEntry={entry => void restoreDeletedEntry(entry)} onClearAll={() => void clearEverything()}
      onTestConnection={() => void testConnection()} onRecoverSettings={() => void recoverSettings()} modelError={modelError} embedProbe={embedProbe}
      vectorBusy={vectorBusy} vectorCount={vectorCount} entriesCount={entries.length} onBuildVectors={() => void buildVectors()}
      autoBusy={autoBusy} onRunAutoPilot={() => void runAutoPilot()}
      keyboardDiag={keyboardDiag} onClose={() => setShowSettings(false)}
    />}
    {importOpen && <ImportModal onImport={confirmImport} onClose={() => setImportOpen(false)}/>}
  </main>;
}
