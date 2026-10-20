'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { repeatedTopics, termsFor } from '@/lib/topics';
import type { ChatScope, DigestWeek, Entry, Judgment, MemoryDigest, Message, ProfileItem, ProfileKind, Settings, Store, Task, Theme, View } from '@/lib/types';
import { VERSION, addDays, confidenceLabels, correctionReasons, dateLabel, dayOf, judgmentStatusLabels, navItems, observationTypeLabels, profileKindLabels, shortDate, timeOf, today, uid, weekStart } from '@/lib/utils';
import { buildChatRequest, buildDigestRequest, buildObservationRequest, buildProfileProposalRequest, buildRevisionRequest, buildSummaryRequest, callModel, parseDigest, parseObservations, parseProfileProposal, parseRevision, parseSummary } from '@/lib/ai';
import { autoBackupFileName, backupFileName, buildBackupText, mergeStores, parseBackupText, pickBackupDirectory, saveBackupFile, supportsAutoBackup, writeBackupToDirectory } from '@/lib/backup';
import type { DirectoryHandleLike } from '@/lib/backup';
import { appendJournal, clearStorage, clearVectors, createSnapshot, deleteSnapshot, deleteVectors, listJournal, listSnapshots, readBackupMeta, readDirectoryHandle, readMirrorState, readSnapshot, readState, readVectors, saveDirectoryHandle, storageStatus, writeBackupMeta, writeMirrorState, writeState, writeVectors } from '@/lib/storage';
import type { JournalEvent, JournalKind, Snapshot, StorageStatus, VectorRow } from '@/lib/storage';
import { cosine, embedTexts, embeddingModel, probeEmbedding } from '@/lib/embedding';
import type { EmbeddingProbe } from '@/lib/embedding';
import { hasSimilarProfileText } from '@/lib/profile';
import { isInputField, watchKeyboard } from '@/lib/keyboard';
import type { KeyboardDiag } from '@/lib/keyboard';
import { EntryCard } from '@/components/EntryCard';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { ProfileModal } from '@/components/ProfileModal';
import { HomeView } from '@/components/views/HomeView';
import { MemoryView } from '@/components/views/MemoryView';
import { JudgmentsView } from '@/components/views/JudgmentsView';
import { ChatView } from '@/components/views/ChatView';
import { TasksView } from '@/components/views/TasksView';

const emptyStore: Store = { entries: [], tasks: [], judgments: [], memoryFeedback: {}, summaries: [], digests: [], profile: [] };
const blankSettings: Settings = { baseUrl: '', apiKey: '', model: '' };
/** 设置里最多保留多少条键盘诊断记录；真机排查用，平时不打扰。 */
const DIAG_LIMIT = 8;

export default function Home() {
  const [data, setData] = useState<Store>(emptyStore);
  const [settings, setSettings] = useState<Settings>(blankSettings);
  const [theme, setTheme] = useState<Theme>('dark');
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('home');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [actionEntry, setActionEntry] = useState<Entry | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteBackup, setPasteBackup] = useState('');
  const [importPreview, setImportPreview] = useState<(Store & { skipped: number }) | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
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
  const [redigestPending, setRedigestPending] = useState<string | null>(null);
  const [removeDigestPending, setRemoveDigestPending] = useState<string | null>(null);
  const [detailJudgment, setDetailJudgment] = useState<Judgment | null>(null);
  const [observationFilter, setObservationFilter] = useState<'all' | 'candidate' | 'review' | 'confirmed' | 'archived'>('all');
  const [correcting, setCorrecting] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionNote, setCorrectionNote] = useState('');
  const [editingObservation, setEditingObservation] = useState<{ topic: string; statement: string } | null>(null);
  const [observationEditError, setObservationEditError] = useState('');
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionError, setRevisionError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { entries, tasks, judgments, summaries, digests, profile } = data;

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
        const source = weight(stored) > 0 || weight(mirror) === 0 ? stored : mirror;
        if (cancelled) return;
        if (!source) { setReady(true); void refreshStorage(); return; }
        setData(source.store);
        setSettings({ ...blankSettings, ...source.settings });
        setTheme(source.theme);
        setReady(true);
        if (source !== stored) await writeState(source);   // 旧数据第一次进来：搬进主存储
        // 每天留一份快照：误操作（尤其是清空）能回滚。
        const existing = await listSnapshots();
        if (!existing.length || dayOf(existing[0].at) !== today()) await createSnapshot(source, '每日快照');
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
  useEffect(() => { if (view !== 'chat') return; const frame = requestAnimationFrame(() => { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: busy ? 'smooth' : 'auto' }); }); return () => cancelAnimationFrame(frame); }, [messages, busy, view]);
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

  const counts = useMemo(() => { const map = new Map<string, number>(); for (const entry of entries) { const day = dayOf(entry.createdAt); map.set(day, (map.get(day) || 0) + 1); } return map; }, [entries]);
  const todaysEntries = entries.filter(entry => dayOf(entry.createdAt) === today()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeTasks = tasks.filter(task => task.status === 'open' || task.status === 'deferred');
  const topics = useMemo(() => repeatedTopics(entries, 2), [entries]);
  const observationScope = useMemo(() => { const cutoff = Date.now() - 30 * 86400000; return entries.filter(entry => Date.parse(entry.createdAt) >= cutoff).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60); }, [entries]);
  const digestWeeks = useMemo(() => { const map = new Map<string, Entry[]>(); for (const entry of entries) { const start = weekStart(entry.createdAt); const list = map.get(start) || []; list.push(entry); map.set(start, list); } return [...map.entries()].map(([start, list]) => ({ start, end: addDays(start, 6), entries: list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) })).filter(week => week.end < today()).sort((a, b) => a.start.localeCompare(b.start)); }, [entries]);
  const coveredWeeks = useMemo(() => new Set(digests.map(item => item.start)), [digests]);
  const uncoveredWeeks = useMemo(() => digestWeeks.filter(week => !coveredWeeks.has(week.start)), [digestWeeks, coveredWeeks]);
  const nextDigestBatch = uncoveredWeeks.slice(0, 3);
  const digestEntryCount = nextDigestBatch.reduce((sum, week) => sum + week.entries.length, 0);
  const sortedDigests = useMemo(() => [...digests].sort((a, b) => b.start.localeCompare(a.start)), [digests]);
  // 一段长期记忆是否已经和本周原文对不上：记录被增删改、或上一次沉淀只读到部分记录（上限 100 条）。
  const digestFreshness = useMemo(() => { const map = new Map<string, string>(); for (const item of digests) { const week = digestWeeks.find(entry => entry.start === item.start); if (!week || !week.entries.length) { map.set(item.id, '这一周已经没有记录了'); continue; } const changed = week.entries.some(entry => entry.createdAt > item.generatedAt || entry.updatedAt > item.generatedAt); if (changed || week.entries.length !== item.entryCount) map.set(item.id, '这一周的原文有变化，可能已经对不上'); } return map; }, [digests, digestWeeks]);
  const latestDigests = useMemo(() => [...digests].sort((a, b) => a.start.localeCompare(b.start)).slice(-24), [digests]);
  const observationReviewFlags = useMemo(() => { const map = new Map<string, boolean>(); for (const item of judgments) { if (item.status === 'withdrawn' || item.muted) { map.set(item.id, false); continue; } const due = item.nextReviewAt ? item.nextReviewAt <= today() : addDays(dayOf(item.createdAt), 21) <= today(); let fresh = false; if (!due) { const terms = new Set(termsFor(`${item.topic} ${item.statement}`)); const since = item.lastReviewedAt || item.createdAt; fresh = entries.some(entry => entry.createdAt > since && termsFor(entry.content).some(term => terms.has(term))); } map.set(item.id, due || fresh); } return map; }, [judgments, entries]);
  const observationStats = useMemo(() => ({ candidate: judgments.filter(item => item.status === 'candidate').length, confirmed: judgments.filter(item => item.status === 'confirmed').length, review: judgments.filter(item => observationReviewFlags.get(item.id)).length, archived: judgments.filter(item => item.status === 'withdrawn' || item.muted).length, active: judgments.filter(item => item.status !== 'withdrawn' && !item.muted).length }), [judgments, observationReviewFlags]);
  const visibleJudgments = useMemo(() => { const list = judgments.filter(item => { if (observationFilter === 'all') return true; if (observationFilter === 'candidate') return item.status === 'candidate'; if (observationFilter === 'confirmed') return item.status === 'confirmed'; if (observationFilter === 'archived') return item.status === 'withdrawn' || !!item.muted; return observationReviewFlags.get(item.id) === true; }); return [...list].sort((a, b) => Number(observationReviewFlags.get(b.id) || 0) - Number(observationReviewFlags.get(a.id) || 0) || b.updatedAt.localeCompare(a.updatedAt)); }, [judgments, observationFilter, observationReviewFlags]);
  const dayTopics = useMemo(() => repeatedTopics(todaysEntries), [todaysEntries]);
  const historicalEcho = entries.filter(entry => dayOf(entry.createdAt) !== today()).map(entry => ({ entry, overlap: termsFor(entry.content).filter(term => todaysEntries.some(current => termsFor(current.content).includes(term))) })).filter(item => item.overlap.length >= 2).sort((a, b) => b.overlap.length - a.overlap.length).slice(0, 2);
  const selectedEntries = entries.filter(entry => selectedDay && dayOf(entry.createdAt) === selectedDay).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const summaryFor = (day: string) => summaries.find(item => item.day === day);
  const confirmedJudgments = judgments.filter(item => item.status === 'confirmed');
  const modelReady = Boolean(settings.baseUrl.trim() && settings.model.trim());
  const searchResults = entries.filter(entry => entry.content.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const calendar = useMemo(() => { const [year, number] = month.split('-').map(Number); const first = (new Date(year, number - 1, 1).getDay() + 6) % 7; return [...Array(first).fill(null), ...Array.from({ length: new Date(year, number, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)] as (string | null)[]; }, [month]);
  const heatDays = useMemo(() => { const start = new Date(`${today()}T12:00:00`); start.setDate(start.getDate() - 97); return Array.from({ length: 98 }, (_, i) => { const day = new Date(start); day.setDate(day.getDate() + i); return dayOf(day); }); }, []);

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
    setData(snapshot.state.store);
    setSettings({ ...blankSettings, ...snapshot.state.settings });
    setTheme(snapshot.state.theme);
    writeMirrorState(snapshot.state);
    await writeState(snapshot.state);
    await appendJournal('state.restored', `恢复到 ${new Date(snapshot.at).toLocaleString('zh-CN')} 的快照`);
    await refreshStorage();
    setNotice('已经回到那份快照的状态。');
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
    await createSnapshot(currentState(), '清空前快照');
    await clearStorage();
    setData(emptyStore);
    setSettings(blankSettings);
    setMessages([]);
    // 备份元信息与向量计数都是“本机数据”的一部分，清空后要一起归零，
    // 否则界面会显示“上次备份是今天”“已有 N 条向量”这类不存在的事实。
    setBackupMeta({});
    setVectorCount(0);
    setEmbedProbe(null);
    await refreshStorage();
    setNotice('本机数据已清空。清空前留了一份快照，可以在下面恢复。');
  }

  // ── 「关于你」档案块 ──
  function addProfileItem(kind: ProfileKind, text: string) {
    if (!text.trim()) return;
    const now = new Date().toISOString();
    const item: ProfileItem = { id: uid(), kind, text: text.trim().slice(0, 120), evidenceIds: [], source: 'user', confirmed: true, createdAt: now, updatedAt: now };
    setData(current => ({ ...current, profile: [...current.profile, item] }));
    logEvent('profile.updated', `写了一条${profileKindLabels[kind]}：${item.text.slice(0, 16)}`);
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
  async function proposeProfile() {
    if (profileBusy) return;
    if (!modelReady) { setProfileError('还没有连接模型。先在“偏好与数据”里填写接口地址与模型。'); return; }
    setProfileBusy(true); setProfileError('');
    try {
      const recent = entries.slice(0, 60);
      if (recent.length < 3) { setProfileError('记录还太少，先记几天再让 AI 提议。'); return; }
      const allowedIds = new Set(recent.map(entry => entry.id));
      const raw = await callModel(settings, buildProfileProposalRequest({ entries: recent, existing: profile }), 120000);
      const proposals = parseProfileProposal(raw, allowedIds).filter(item => !hasSimilarProfileText(profile, item.text));
      if (!proposals.length) { setProfileError('这次没有找到足够有把握的背景条目。可以自己写。'); return; }
      const now = new Date().toISOString();
      const items: ProfileItem[] = proposals.map(item => ({ id: uid(), kind: item.kind, text: item.text, evidenceIds: item.evidenceIds, source: 'ai', confirmed: false, createdAt: now, updatedAt: now }));
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
  /** 距离上次把数据带出设备过了多少天（没备份过返回 null）。 */
  const backupAgeDays = useMemo(() => {
    if (!backupMeta.lastExportAt) return null;
    const days = Math.floor((Date.now() - Date.parse(backupMeta.lastExportAt)) / 86400000);
    return Number.isFinite(days) ? days : null;
  }, [backupMeta.lastExportAt]);

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
      const answer = await callModel(settings, [{ role: 'user', content: '回复两个字：可以' }], 30000);
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

  function navigate(next: View) { setView(next); setSelectedDay(null); setQuery(''); window.scrollTo({ top: 0 }); }  function openDay(day: string) { setSelectedDay(day); setQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function changeMonth(delta: number) { const [year, number] = month.split('-').map(Number); const next = new Date(year, number - 1 + delta, 1); setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`); }
  function saveEntry() { if (!draft.trim() || !ready) return; const now = new Date().toISOString(); const entry: Entry = editing ? { ...editing, content: draft.trim(), updatedAt: now } : { id: uid(), content: draft.trim(), source: 'user', createdAt: now, updatedAt: now }; setData(current => ({ ...current, entries: editing ? current.entries.map(item => item.id === entry.id ? entry : item) : [...current.entries, entry] })); logEvent(editing ? 'entry.edited' : 'entry.created', editing ? '修改了一条记忆' : '记下了一条新记忆'); setDraft(''); setEditing(null); setNotice('已妥善记下。'); if (editing) void dropVectors([entry.id]); }
  function openActions(entry: Entry) { setActionEntry(entry); setTaskTitle(entry.content.slice(0, 100)); setPendingDelete(false); }
  function addTask() { if (!actionEntry || !taskTitle.trim()) return; if (tasks.some(item => item.sourceId === actionEntry.id)) { setNotice('这条记录已关联事项。'); return; } setData(current => ({ ...current, tasks: [...current.tasks, { id: uid(), title: taskTitle.trim(), status: 'open', sourceId: actionEntry.id, createdAt: new Date().toISOString() }] })); setActionEntry(null); setNotice('已建立事项，原始记录仍保留。'); }
  function setStatus(id: string, status: Task['status']) { setData(current => ({ ...current, tasks: current.tasks.map(item => item.id === id ? { ...item, status } : item) })); }
  function updateJudgment(id: string, status: Judgment['status']) { setData(current => ({ ...current, judgments: current.judgments.map(item => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item) })); }
  function openObservation(item: Judgment) { setDetailJudgment(item); setCorrecting(false); setEditingObservation(null); setCorrectionReason(''); setCorrectionNote(''); setObservationEditError(''); setRevisionError(''); }
  function reviewObservation(item: Judgment, status: Judgment['status']) {
    const now = new Date().toISOString();
    const updated: Judgment = { ...item, status, lastReviewedAt: now, nextReviewAt: status === 'withdrawn' ? undefined : addDays(dayOf(now), status === 'confirmed' ? 30 : 14), updatedAt: now };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === item.id ? updated : entry) }));
    setDetailJudgment(updated);
  }
  function restoreObservation(item: Judgment) {
    const now = new Date().toISOString();
    const updated: Judgment = { ...item, muted: false, status: 'candidate', lastReviewedAt: now, nextReviewAt: addDays(dayOf(now), 14), updatedAt: now };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === item.id ? updated : entry) }));
    setDetailJudgment(updated);
    setNotice('已恢复为待核对。');
  }
  function saveCorrection() {
    if (!detailJudgment || !correctionReason) return;
    const now = new Date().toISOString();
    const muted = correctionReason === '以后不再使用';
    const status: Judgment['status'] = correctionReason === '不准确' || muted ? 'withdrawn' : 'uncertain';
    const updated: Judgment = {
      ...detailJudgment, status, muted: muted || !!detailJudgment.muted,
      confidence: correctionReason === '只发生过一次' ? 'weak' : detailJudgment.confidence,
      corrections: [...(detailJudgment.corrections || []), { reason: correctionReason, note: correctionNote.trim(), at: now }],
      lastReviewedAt: now,
      nextReviewAt: status === 'withdrawn' ? undefined : addDays(dayOf(now), 14),
      updatedAt: now,
    };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === updated.id ? updated : entry) }));
    setDetailJudgment(updated); setCorrecting(false); setCorrectionReason(''); setCorrectionNote(''); logEvent('judgment.updated', `纠正了一条观察：${detailJudgment.topic}`); setNotice('已记录你的纠正。');
  }
  function saveObservationEdit() {
    if (!detailJudgment || !editingObservation) return;
    const topic = editingObservation.topic.trim();
    const statement = editingObservation.statement.trim();
    if (!topic || !statement) { setObservationEditError('主题和判断都不能为空。'); return; }
    const now = new Date().toISOString();
    const currentVersion = detailJudgment.version || 1;
    const updated: Judgment = {
      ...detailJudgment, topic, statement, version: currentVersion + 1,
      versions: [...(detailJudgment.versions || []), { version: currentVersion, topic: detailJudgment.topic, statement: detailJudgment.statement, at: now, reason: '用户修改' }],
      lastReviewedAt: now, nextReviewAt: addDays(dayOf(now), 21), updatedAt: now,
    };
    setData(current => ({ ...current, judgments: current.judgments.map(entry => entry.id === updated.id ? updated : entry) }));
    setDetailJudgment(updated); setEditingObservation(null); setObservationEditError(''); setNotice('已保存修改，旧版本保留在历史里。');
  }
  function createJudgment(topic: string) { const source = entries.filter(entry => termsFor(entry.content).includes(topic)); const now = new Date().toISOString(); setData(current => ({ ...current, judgments: [...current.judgments, { id: uid(), topic, statement: `“${topic}”在 ${new Set(source.map(entry => dayOf(entry.createdAt))).size} 个记录日中出现。它可能值得回看，目前不能据此推断行为或人格。`, supportIds: source.map(entry => entry.id), counterIds: [], status: 'candidate', origin: 'word', type: 'question', confidence: 'weak', confidenceReason: '仅基于词语重复，没有核对具体情境', nextReviewAt: addDays(today(), 21), versions: [], corrections: [], version: 1, createdAt: now, updatedAt: now }] })); logEvent('judgment.created', `保存了一条候选观察：${topic}`); setNotice('已保存候选观察，请先查看原文。'); }
  async function reviseObservation(item: Judgment) {
    if (revisionBusy || !modelReady) return;
    setRevisionBusy(true); setRevisionError('');
    try {
      const support = item.supportIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
      const counter = item.counterIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
      const since = item.lastReviewedAt || item.createdAt;
      const fresh = entries.filter(entry => entry.createdAt > since).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
      const raw = await callModel(settings, buildRevisionRequest({ item, support, counter, corrections: item.corrections || [], fresh }), 90000);
      const draft = parseRevision(raw, item);
      const now = new Date().toISOString();
      const currentVersion = item.version || 1;
      const updated: Judgment = {
        ...item, statement: draft.statement, type: draft.type,
        alternative: draft.alternative,
        falsifier: draft.falsifier,
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
  async function generateObservations() {
    if (observationBusy) return;
    if (!modelReady) { setObservationError('还没有连接模型。请先在“偏好与数据”里填写接口地址、模型名称和访问密钥。'); return; }
    const scope = observationScope;
    if (scope.length < 3 && !digests.length) { setObservationError('最近 30 天的记录还太少，也还没有长期记忆；先积累一些再让 AI 观察。'); return; }
    const scopeIds = new Set(scope.map(entry => entry.id));
    const recentTerms = new Set(scope.flatMap(entry => termsFor(entry.content)));
    const counterPool = entries.filter(entry => !scopeIds.has(entry.id)).map(entry => ({ entry, score: termsFor(entry.content).filter(term => recentTerms.has(term)).length })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt)).slice(0, 8).map(item => item.entry);
    const allowedIds = new Set([...scope.map(entry => entry.id), ...counterPool.map(entry => entry.id), ...latestDigests.flatMap(item => item.evidence.map(evidence => evidence.id))]);
    setObservationBusy(true); setObservationError('');
    try {
      const raw = await callModel(settings, buildObservationRequest({ scope, counterPool, digests: latestDigests, judgments, profile }), 120000);
      const { created, note } = parseObservations(raw, { allowedIds, entries, existingTopics: judgments.map(item => item.topic) });
      if (!created.length) { setObservationError(note || '这次没有找到足够可靠的新观察。可以等记录多一些再试，或查看下面的词语线索。'); return; }
      setData(current => ({ ...current, judgments: [...current.judgments, ...created] }));
      setNotice(`已生成 ${created.length} 条候选观察，请逐条核对证据。`);
      setTimeout(() => document.getElementById('saved-observations')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (error) {
      setObservationError(error instanceof Error ? error.message : '生成失败，请稍后重试。');
    } finally { setObservationBusy(false); }
  }
  async function digestWeek(week: DigestWeek, known: MemoryDigest[]) {
    setDigestProgress(`正在沉淀 ${shortDate(week.start)}–${shortDate(week.end)}…`);
    const previous = known.filter(item => item.end < week.start).sort((a, b) => a.end.localeCompare(b.end)).at(-1);
    const raw = await callModel(settings, buildDigestRequest(week, previous, judgments.filter(item => item.status === 'confirmed'), profile), 120000);
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
      setRedigestPending(null);
      setNotice(`已按本周 ${week.entries.length} 条记录重新沉淀。`);
      logEvent('digest.generated', `重新沉淀了 ${shortDate(week.start)} 那一周`);
    } catch (error) {
      setDigestError(digestErrorText(error, '重新沉淀失败，原来的记忆保持不变。'));
    } finally { setDigestBusy(false); setDigestProgress(''); }
  }
  function removeDigest(id: string) {
    setData(current => ({ ...current, digests: current.digests.filter(item => item.id !== id) }));
    setRemoveDigestPending(null);
    setNotice('已删除这段长期记忆，原始记录没有改动。需要时可以重新沉淀。');
  }
  function previewImport(text: string) { try { const { store, skipped } = parseBackupText(text); setImportPreview({ ...store, skipped }); } catch (error) { setNotice(`无法导入：${error instanceof Error ? error.message : '文件格式不正确'}`); } }
  function confirmImport() {
    if (!importPreview) return;
    const incoming: Store = { entries: importPreview.entries, tasks: importPreview.tasks, judgments: importPreview.judgments, memoryFeedback: importPreview.memoryFeedback, summaries: importPreview.summaries, digests: importPreview.digests, profile: importPreview.profile };
    const replaced = importMode === 'replace';
    const kept = replaced ? new Set(incoming.entries.map(entry => entry.id)) : new Set([...entries, ...incoming.entries].map(entry => entry.id));
    setData(current => replaced ? incoming : mergeStores(current, incoming));
    setImportPreview(null);
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
    // 否则首页的“还没备份过”提醒会消失，用户会以为数据已经带出设备了。
    if (result === 'cancelled') return;
    markExported(entries.length);
    if (backupMeta.autoDirName) {
      const ok = await runAutoBackup();
      if (!ok) setNotice('备份文件已保存，但自动备份到目录这一步没成功，请检查目录授权。');
    }
  }
  // 检索：先按分词命中打分；同时试一次语义召回（缓存里有向量时），两者合并去重。
  async function scopedSources(question: string) {
    const words = termsFor(question);
    const scored = entries.map(entry => ({ entry, score: termsFor(entry.content).filter(word => words.includes(word)).length })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    const keyword = (scored.length ? scored : [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(entry => ({ entry, score: 0 }))).slice(0, 12).map(item => item.entry);
    // 「仅观察」范围用不到原文，不必再为一次语义检索等一趟网络。
    const semantic = chatScope !== 'judgments' ? await semanticSources(question) : [];
    if (!semantic.length) return keyword;
    const seen = new Set<string>();
    const merged: Entry[] = [];
    for (const entry of [...semantic, ...keyword]) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      merged.push(entry);
      if (merged.length >= 12) break;
    }
    return merged;
  }

  async function ask() {
    const question = chatInput.trim();
    if (!question || busy) return;
    setMessages(current => [...current, { role: 'user', content: question }]);
    setChatInput('');
    setBusy(true);
    const sources = await scopedSources(question);
    const useEntries = chatScope !== 'judgments';
    const useJudgments = chatScope !== 'entries';
    try {
      if (!modelReady) {
        setMessages(current => [...current, { role: 'assistant', content: sources.length ? `找到 ${sources.length} 条可能相关的原始记录。当前是本地检索模式，只展示原文，不作推断。在“偏好与数据”中连接模型后，可以进行真正的分析。` : '暂未找到相关记录。可以补充人物、主题或具体事件；连接模型后也可以直接提问。', sources: useEntries ? sources : [] }]);
        return;
      }
      const answer = await callModel(settings, buildChatRequest({ question, scope: chatScope, sources, confirmed: confirmedJudgments, history: messages.map(({ role, content }) => ({ role, content })), profile }));
      setMessages(current => [...current, { role: 'assistant', content: answer, sources: useEntries ? sources : [] }]);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `这次请求没有完成：${error instanceof Error ? error.message : '未知错误'}。请检查接口地址、访问密钥、模型名称，以及接口是否允许浏览器跨域访问。原始记录没有受到影响。` }]);
    } finally { setBusy(false); }
  }

  async function generateSummary(day: string) {
    const dayEntries = entries.filter(entry => dayOf(entry.createdAt) === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!dayEntries.length || summaryBusy) return;
    setSummaryBusy(true); setSummaryError('');
    try {
      if (!modelReady) { setSummaryError('还没有连接模型。请在“偏好与数据”中填写接口地址、模型名称和访问密钥。'); return; }
      const earlier = entries.filter(entry => dayOf(entry.createdAt) < day).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
      const raw = await callModel(settings, buildSummaryRequest(day, dayEntries, earlier), 120000);
      const summary = parseSummary(raw, day, dayEntries, settings.model);
      setData(current => ({ ...current, summaries: [...current.summaries.filter(item => item.day !== day), summary] }));
      logEvent('summary.generated', `生成了 ${day} 的总结`);
      setNotice('这一天的总结已生成并保存在本机。');
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : '生成失败，请稍后重试。');
    } finally { setSummaryBusy(false); }
  }
  const header = (eyebrow: string, title: string, subtitle: string) => <header className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div></header>;
  const entryList = (items: Entry[]) => <div className="entry-list">{items.map(entry => <EntryCard key={entry.id} entry={entry} onOpen={openActions}/>)}</div>;
  // 五个视图共用同一份数据与回调；视图组件只负责渲染，状态仍留在这里。
  const viewProps = { entries, tasks, judgments, summaries, digests, settings, modelReady, counts, topics, todaysEntries, dayTopics, historicalEcho, activeTasks, observationScope, observationStats, observationFilter, observationReviewFlags, visibleJudgments, chatScope, messages, chatInput, busy, digestBusy, digestProgress, digestError, digestEntryCount, nextDigestBatch, sortedDigests, digestFreshness, redigestPending, removeDigestPending, observationBusy, observationError, uncoveredWeeks, summaryBusy, summaryError, selectedDay, selectedEntries, month, calendar, heatDays, query, searchResults, draft, editing, ready, setView, setSelectedDay, setMonth, setQuery, setDraft, setEditing, setChatScope, setChatInput, setObservationFilter, setShowSummary, setShowDigests, setRedigestPending, setRemoveDigestPending, setDigestError, setStatus, setNotice, setTyping, setShowSettings, navigate, openDay, changeMonth, openActions, saveEntry, openObservation, createJudgment, ask, generateSummary, generateObservations, updateDigests, redigestWeek, removeDigest, summaryFor, composerRef, chatEndRef, header, entryList, profileCount: profile.filter(item => item.confirmed).length, profileTotal: profile.length, onOpenProfile: () => setShowProfile(true), backupAgeDays };
  return <main className={`app-shell theme-${theme}${typing ? ' keyboard-open' : ''}`}>
    <aside className="sidebar"><button className="brand" onClick={() => navigate('home')}><span className="brand-mark">清</span><span>清醒<small>留住当时的清醒</small></span></button><nav>{navItems.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><Icon name={item.icon}/>{item.label}</button>)}</nav><div className="sidebar-bottom"><p>人们忘掉的不是事实，<br/>而是当初的清醒。</p><button className="nav-item" onClick={() => setShowSettings(true)}><Icon name="settings"/>偏好与数据</button><small>{VERSION}</small></div></aside>
    <section className="main-area"><header className="topbar"><span className="mobile-brand">清醒<span>个人记忆</span></span><span className="device-status"><i/>记录保存在本机</span><button className="icon-button" aria-label="偏好与数据" onClick={() => setShowSettings(true)}><Icon name="settings"/></button></header>
      {view === 'home' && <HomeView {...viewProps}/>}
      {view === 'memory' && <MemoryView {...viewProps}/>}
      {view === 'judgments' && <JudgmentsView {...viewProps}/>}
      {view === 'chat' && <ChatView {...viewProps}/>}
      {view === 'tasks' && <TasksView {...viewProps}/>}
    </section>

    <nav className="mobile-nav" aria-label="主导航">{navItems.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>

    {notice && <button className="notice" role="status" onClick={() => setNotice('')}>{notice}<Icon name="close" size={15}/></button>}

    {actionEntry && <Modal title="这条记忆" onClose={() => setActionEntry(null)}><div className="source-preview"><time>{dateLabel(dayOf(actionEntry.createdAt))} · {timeOf(actionEntry.createdAt)}</time><p>{actionEntry.content}</p></div><div className="button-row"><button className="secondary-button" onClick={() => { setEditing(actionEntry); setDraft(actionEntry.content); setActionEntry(null); navigate('home'); setTimeout(() => composerRef.current?.focus(), 50); }}>编辑记录</button><button className="quiet-button" onClick={() => setPendingDelete(true)}>删除记录</button></div><div className="modal-section"><h3>标记这条记录</h3><div className="button-row">{['准确', '部分准确', '不准确', '暂不判断'].map(value => <button key={value} className={actionEntry.feedback === value ? 'secondary-button' : 'quiet-button'} onClick={() => { setData(current => ({ ...current, entries: current.entries.map(item => item.id === actionEntry.id ? { ...item, feedback: value, updatedAt: new Date().toISOString() } : item) })); setActionEntry(current => current ? { ...current, feedback: value } : null); }}>{value}</button>)}</div></div>{pendingDelete && <div className="delete-confirm"><p>删除原文后，关联事项保留，判断证据会显示为已删除。</p><button className="danger-button" onClick={() => { logEvent('entry.deleted', `删除了一条记忆：${actionEntry.content.slice(0, 20)}`, actionEntry); setData(current => ({ ...current, entries: current.entries.filter(item => item.id !== actionEntry.id) })); void dropVectors([actionEntry.id]); setActionEntry(null); }}>确认删除</button></div>}<div className="modal-section"><h3>确认一件要做的事</h3><label className="field-label">事项名称<input value={taskTitle} onChange={event => setTaskTitle(event.target.value)}/></label><button className="secondary-button" onClick={addTask}>建立事项</button></div></Modal>}
    {showProfile && <ProfileModal items={profile} entries={entries} busy={profileBusy} error={profileError} onClose={() => setShowProfile(false)} onAdd={addProfileItem} onUpdate={updateProfileItem} onRemove={removeProfileItem} onConfirm={confirmProfileItem} onPropose={() => void proposeProfile()}/>}
    {showSummary && <Modal title="把今天重新看一遍" onClose={() => setShowSummary(false)}>{(() => { const s = summaryFor(today()); return <><p className="modal-intro">基于今天 {todaysEntries.length} 条原始记录{s ? `，由 ${s.model} 生成` : ''}。AI 只读取今天的记录，不补充未记录的事实。</p>{!todaysEntries.length ? <div className="empty-state"><p>今天还没有记录，暂不形成总结。</p></div> : <>{s ? <div className="ai-summary">{s.overview && <p className="summary-overview">{s.overview}</p>}{[['今天反复出现', s.repeated], ['还没有解决', s.unresolved], ['与过去的连接', s.connections], ['情绪回看', s.emotion], ['明天的收窄', s.tomorrow]].filter(([, text]) => text).map(([label, text]) => <section className="summary-block" key={label}><span className="badge">{label}</span><p>{text}</p></section>)}{s.sourceIds.length > 0 && <details><summary>本次引用的 {s.sourceIds.length} 条原文</summary>{s.sourceIds.map(id => { const source = entries.find(entry => entry.id === id); return source ? <blockquote key={id}><time>{timeOf(source.createdAt)}</time>{source.content}</blockquote> : null; })}</details>}<p className="muted">生成于 {new Date(s.generatedAt).toLocaleString('zh-CN')} · 共 {s.entryCount} 条记录</p></div> : <div className="ai-empty"><h3>{modelReady ? '还没有生成今天的总结' : '连接模型后可以生成总结'}</h3><p>{modelReady ? `今天有 ${todaysEntries.length} 条记录。让模型把它们整理成一份可以五分钟读完的总结。` : '在“偏好与数据”中填写接口地址与模型，AI 就能阅读今天的记录并生成总结。'}</p></div>}<div className="button-row"><button className="primary-button" disabled={summaryBusy || !modelReady} onClick={() => void generateSummary(today())}>{summaryBusy ? '正在整理今天的记录……' : s ? '重新生成' : '生成今天的总结'}</button><button className="quiet-button" onClick={() => { setShowSummary(false); navigate('memory'); openDay(today()); }}>看原始记录</button></div>{summaryError && <p className="form-error">{summaryError}</p>}{!modelReady && <p className="muted">没有连接模型时，仍然可以在“记忆”里按日期阅读原文。</p>}</>}</>; })()}</Modal>}
    {showSettings && <Modal title="偏好与数据" onClose={() => setShowSettings(false)}><section className="settings-section"><div className="section-heading"><h3>外观</h3><span className="muted">跟随你的阅读习惯</span></div><div className="theme-choices"><button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><span className="theme-preview preview-light"/>白色<span>明亮、温和</span></button><button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><span className="theme-preview preview-dark"/>深色<span>安静、柔和</span></button></div></section><section className="settings-section"><h3>备份与换设备</h3><p className="muted">备份包含记录、事项与阶段性观察，不包含访问密钥。</p><div className="button-row"><button className="secondary-button" onClick={() => void exportData()}><Icon name="download" size={17}/>导出备份</button><button className="secondary-button" onClick={() => { setShowSettings(false); setImportOpen(true); }}><Icon name="upload" size={17}/>导入备份</button></div>{backupText && <details><summary>文件未保存？复制完整备份</summary><textarea className="backup-text" readOnly value={backupText} aria-label="完整备份内容"/><button className="quiet-button" onClick={async () => { try { await navigator.clipboard.writeText(backupText); setNotice('备份已复制。'); } catch { setNotice('请长按备份文本，全选后复制。'); } }}>复制备份</button></details>}</section><section className="settings-section"><h3>模型连接</h3><p className="muted">不连接模型也能记录与检索。静态网页直接请求接口，需要服务支持浏览器跨域。</p><label className="field-label">接口地址<input placeholder="填写完整接口地址，结尾为 /v1" value={settings.baseUrl} onChange={event => setSettings(current => ({ ...current, baseUrl: event.target.value }))}/></label><label className="field-label">模型名称<input placeholder="填写模型名称" value={settings.model} onChange={event => setSettings(current => ({ ...current, model: event.target.value }))}/></label><label className="field-label">访问密钥<input type="password" autoComplete="off" value={settings.apiKey} onChange={event => setSettings(current => ({ ...current, apiKey: event.target.value }))}/></label><label className="field-label">向量模型（可选）<input placeholder="留空就用上面的模型名" value={settings.embedModel || ''} onChange={event => setSettings(current => ({ ...current, embedModel: event.target.value }))}/></label></section><section className="settings-section"><div className="section-heading"><h3>本机存储</h3><span className="muted">{storageInfo ? (storageInfo.mode === 'indexeddb' ? 'IndexedDB' : '浏览器存储') : '读取中'}</span></div><p className="muted">{storageInfo ? `${storageInfo.entries} 条记录 · ${storageInfo.tasks} 件事项 · ${storageInfo.judgments} 条观察${storageInfo.usage ? ` · 已用 ${(storageInfo.usage / 1048576).toFixed(1)} MB${storageInfo.quota ? ` / 可用 ${(storageInfo.quota / 1048576).toFixed(0)} MB` : ''}` : ''}` : ''}{storageInfo?.lastError ? ` · ${storageInfo.lastError}` : ''}</p><div className="button-row"><button className="secondary-button" onClick={() => void takeSnapshot('手动快照')}>立即存一份快照</button></div>{!!snapshots.length && <div className="snapshot-list">{snapshots.map(snapshot => <div className="snapshot-item" key={snapshot.id}><div><time>{new Date(snapshot.at).toLocaleString('zh-CN')}</time><small>{snapshot.reason}</small></div><div className="button-row"><button className="text-button" onClick={() => void restoreSnapshotById(snapshot.id)}>恢复</button><button className="text-button" onClick={() => void removeSnapshot(snapshot.id)}>删除</button></div></div>)}</div>}{!!journal.length && <details className="journal-list"><summary>操作记录（最近 {journal.length} 条）</summary>{journal.map(event => <div className="journal-item" key={event.id}><time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><span>{event.text}</span>{event.kind === 'entry.deleted' && event.entry && <button className="text-button" onClick={() => void restoreDeletedEntry(event.entry as Entry)}>找回</button>}</div>)}</details>}</section><section className="settings-section"><h3>连接与检索</h3><p className="muted">先测一下接口通不通，再看它支不支持向量（/embeddings）。支持的话，提问时会用语义去找相关记录；不支持就继续用关键词，不影响别的功能。</p><label className="field-label">向量模型<input placeholder="填写支持 /embeddings 的模型名；留空则用上面的模型名称" value={settings.embedModel || ''} onChange={event => setSettings(current => ({ ...current, embedModel: event.target.value }))}/></label><div className="button-row"><button className="secondary-button" onClick={() => void testConnection()}>测试连接</button><button className="secondary-button" disabled={vectorBusy || !modelReady} onClick={() => void buildVectors()}>{vectorBusy ? '正在生成向量……' : entries.length - vectorCount > 0 ? `为记录生成向量（还有 ${entries.length - vectorCount} 条）` : '为记录生成向量'}</button></div>{embedProbe && <p className={embedProbe.ok ? 'muted' : 'form-error'}>向量接口：{embedProbe.message}</p>}<p className="muted">已有 {vectorCount} / {entries.length} 条记录带向量。记录被修改或删除时，对应的向量会自动作废。</p></section><section className="settings-section"><h3>自动备份</h3><p className="muted">{backupMeta.lastExportAt ? `上次把数据带出设备是 ${new Date(backupMeta.lastExportAt).toLocaleString('zh-CN')}，共 ${backupMeta.lastExportCount ?? 0} 条。` : '还没有把数据带出过设备。数据只在这台设备上，换手机或清缓存都会丢。'}</p>{supportsAutoBackup() ? <div className="button-row"><button className="secondary-button" onClick={() => void authorizeAutoBackup()}>{backupMeta.autoDirName ? `换个目录（当前：${backupMeta.autoDirName}）` : '选一个目录自动备份'}</button>{backupMeta.autoDirName && <button className="secondary-button" onClick={() => void runAutoBackup()}>立即备份一次</button>}</div> : <p className="muted">这台设备不支持自动写入目录，请用「导出备份」存到网盘或文件里。</p>}{backupMeta.lastAutoAt && <p className="muted">自动备份最近一次：{new Date(backupMeta.lastAutoAt).toLocaleString('zh-CN')}。目录授权可能被浏览器回收，失效时会提示重新选择。</p>}</section>{keyboardDiag.length > 0 && <details className="settings-section"><summary>键盘与底栏诊断</summary><p className="muted">记录最近几次软键盘与底部导航的状态变化，用于真机排查，不影响正常使用。</p><ul className="diag-list">{keyboardDiag.map((entry, index) => <li key={index}><span>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>{entry.label}{entry.detail ? ` · ${entry.detail}` : ''}</li>)}</ul></details>}<details className="settings-section"><summary>数据管理与版本</summary><p className="muted">{VERSION} · 本机存储 · 不自动同步</p><button className="danger-button" onClick={() => { if (window.confirm('确认清空本机全部记录、事项与判断？请先导出备份。')) { void clearEverything(); } }}>清空本机数据</button><p className="muted">清空前会自动留一份快照，可以在「本机存储」里恢复。</p></details></Modal>}
    {detailJudgment && (() => {
      const item = detailJudgment!;
      const supportEntries = item.supportIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
      const counterEntries = item.counterIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
      const sortedSupport = [...supportEntries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const scopeStart = item.scopeStart || (sortedSupport.length ? dayOf(sortedSupport[0].createdAt) : '');
      const scopeEnd = item.scopeEnd || (sortedSupport.length ? dayOf(sortedSupport[sortedSupport.length - 1].createdAt) : '');
      return <Modal title="观察详情" onClose={() => setDetailJudgment(null)}>
        <div className="obs-detail-head">
          <div className="obs-badges"><span className="badge">{item.muted ? '已搁置' : judgmentStatusLabels[item.status]}</span>{item.type ? <span className="badge type-badge">{observationTypeLabels[item.type]}</span> : <span className="badge legacy-badge" title="v4.0 之前生成的观察没有类型、其他解释和推翻条件">旧观察</span>}{item.confidence && <span className="badge">{confidenceLabels[item.confidence]}</span>}</div>
          <h3>{item.topic}</h3>
          <p>{item.statement}</p>
          <div className="obs-detail-meta"><span>{item.scopeEntries || item.supportIds.length} 条证据</span><span>{item.scopeDays || '—'} 个记录日</span>{scopeStart && <span>{dateLabel(scopeStart)} 至 {dateLabel(scopeEnd)}</span>}<span>上次核对 {item.lastReviewedAt ? dateLabel(dayOf(item.lastReviewedAt)) : '尚未核对'}</span>{item.nextReviewAt && <span>下次 {dateLabel(dayOf(item.nextReviewAt))}</span>}</div>
        </div>
        <section className="obs-section"><h4>支持证据</h4>{supportEntries.length ? supportEntries.map(entry => <blockquote className="obs-quote" key={entry.id}><time>{dateLabel(dayOf(entry.createdAt))}</time>{entry.content}</blockquote>) : <p className="muted">原始记录已删除，当前没有有效支持证据。</p>}</section>
        <section className="obs-section"><h4>相反证据</h4>{counterEntries.length ? counterEntries.map(entry => <blockquote className="obs-quote" key={entry.id}><time>{dateLabel(dayOf(entry.createdAt))}</time>{entry.content}</blockquote>) : <p className="muted">没有找到明确的反例；这不等于反例不存在。</p>}</section>
        <section className="obs-section"><h4>其他解释</h4><p className={item.alternative ? '' : 'muted'}>{item.alternative || '这条观察生成时还没有记录其他解释。可以点下面的“重新核对”，让 AI 补上其他解释和推翻条件。'}</p></section>
        <section className="obs-section"><h4>什么会推翻它</h4><p className={item.falsifier ? '' : 'muted'}>{item.falsifier || '这条观察生成时还没有写推翻条件。可以点下面的“重新核对”补上；没有推翻条件时，只把它当作临时线索。'}</p></section>
        <section className="obs-section"><h4>数据边界</h4><p className="muted">这只是你记录下来的部分，不等于全部生活；没有被记录的部分无法从这里推断。</p></section>
        {!!item.corrections?.length && <section className="obs-section"><h4>你的纠正</h4>{item.corrections.map((correction, index) => <div className="obs-version" key={`${correction.at}-${index}`}><time>{new Date(correction.at).toLocaleString('zh-CN')}</time><p>{correction.reason}{correction.note ? `：${correction.note}` : ''}</p></div>)}</section>}
        {revisionError && <p className="form-error">{revisionError}</p>}
        {(!!item.versions?.length || !!item.version) && <section className="obs-section"><h4>版本历史</h4><div className="obs-version"><time>当前 v{item.version || 1}</time><p>{item.statement}</p></div>{(item.versions || []).map(version => <div className="obs-version" key={`${version.version}-${version.at}`}><time>v{version.version} · {new Date(version.at).toLocaleString('zh-CN')}</time><p>{version.topic}：{version.statement}</p></div>)}</section>}
        {!correcting && !editingObservation && <div className="button-row">{item.status !== 'confirmed' && item.status !== 'withdrawn' && <button className="secondary-button" onClick={() => reviewObservation(item, 'confirmed')}>确认观察</button>}{item.status !== 'withdrawn' && <button className="quiet-button" onClick={() => reviewObservation(item, 'uncertain')}>暂不确定</button>}{item.status !== 'withdrawn' ? <button className="danger-button" onClick={() => reviewObservation(item, 'withdrawn')}>撤回</button> : <button className="quiet-button" onClick={() => restoreObservation(item)}>恢复待核对</button>}</div>}
        {!correcting && !editingObservation && <div className="button-row"><button className="quiet-button" onClick={() => { setEditingObservation({ topic: item.topic, statement: item.statement }); setObservationEditError(''); }}>修改判断</button><button className="quiet-button" onClick={() => setCorrecting(true)}>记录纠正</button>{!item.muted && <button className="quiet-button" disabled={revisionBusy || !modelReady} onClick={() => void reviseObservation(item)}>{revisionBusy ? '正在重写……' : item.corrections?.length ? '按纠正重写' : item.type ? '重新核对' : '重新核对 · 补类型与推翻条件'}</button>}{item.muted && <button className="quiet-button" onClick={() => restoreObservation(item)}>恢复使用</button>}</div>}
        {editingObservation && <section className="obs-section"><h4>修改判断</h4><label className="field-label">主题<input value={editingObservation.topic} onChange={event => setEditingObservation(current => current ? { ...current, topic: event.target.value } : current)}/></label><label className="field-label">判断<textarea rows={5} value={editingObservation.statement} onChange={event => setEditingObservation(current => current ? { ...current, statement: event.target.value } : current)}/></label>{observationEditError && <p className="form-error">{observationEditError}</p>}<div className="button-row"><button className="primary-button" onClick={saveObservationEdit}>保存修改</button><button className="quiet-button" onClick={() => setEditingObservation(null)}>取消</button></div></section>}
        {correcting && <section className="obs-section"><h4>这条哪里不对</h4><div className="correction-reasons">{correctionReasons.map(reason => <button key={reason} className={`filter-chip ${correctionReason === reason ? 'active' : ''}`} onClick={() => setCorrectionReason(reason)}>{reason}</button>)}</div><label className="field-label">补充说明（可选）<textarea rows={3} value={correctionNote} onChange={event => setCorrectionNote(event.target.value)} placeholder="比如：那天的情况是……"/></label><div className="button-row"><button className="primary-button" disabled={!correctionReason} onClick={saveCorrection}>保存纠正</button><button className="quiet-button" onClick={() => setCorrecting(false)}>取消</button></div></section>}
      </Modal>;
    })()}
    {showDigests && <Modal title="长期记忆" onClose={() => setShowDigests(false)}>
      <p className="modal-intro">把更早的记录每周沉淀成一段简短记忆。原始记录仍完整保存在本机；AI 观察时只带这些记忆和最近 30 天原文，不会每次重读全部历史。</p>
      <div className="digest-stats"><span>{digests.length} 段记忆</span><span>{sortedDigests.length ? `${shortDate(sortedDigests[sortedDigests.length - 1].start)} 至 ${shortDate(sortedDigests[0].end)}` : '暂无覆盖'}</span></div>
      <div className="digest-actions">
        <button className="primary-button" disabled={digestBusy || !modelReady || !nextDigestBatch.length} onClick={() => void updateDigests()}>{digestBusy ? '正在沉淀……' : nextDigestBatch.length ? `沉淀接下来 ${nextDigestBatch.length} 周` : '已经沉淀完'}</button>
        {nextDigestBatch.length > 0 && <span className="muted">共 {digestEntryCount} 条记录 · {shortDate(nextDigestBatch[0].start)} 起</span>}
      </div>
      {digestProgress && <p className="loading-note">{digestProgress}</p>}
      {!modelReady && <p className="muted">先在“偏好与数据”里连接模型。</p>}
      {digestError && <p className="form-error">{digestError}</p>}
      <div className="digest-list">
        {sortedDigests.length ? sortedDigests.map(item => {
          const stale = digestFreshness.get(item.id);
          return <article className="digest-item" key={item.id}>
            <header><time>{shortDate(item.start)}–{shortDate(item.end)}</time><span>{item.entryCount} 条</span></header>
            <p>{item.summary}</p>
            {!!item.themes.length && <div className="chip-row">{item.themes.map(theme => <span className="chip" key={theme}>{theme}</span>)}</div>}
            <details><summary>变化、矛盾与证据</summary>
              {item.changes && <p><b>变化：</b>{item.changes}</p>}
              {item.contradictions && <p><b>矛盾：</b>{item.contradictions}</p>}
              {item.evidence.map(evidence => <blockquote key={evidence.id}><time>{dateLabel(evidence.date)}</time>{evidence.text}</blockquote>)}
              <p className="muted">生成于 {new Date(item.generatedAt).toLocaleString('zh-CN')} · {item.model}</p>
            </details>
            {stale && <p className="digest-stale"><Icon name="spark" size={13}/>{stale}</p>}
            {redigestPending === item.id ? <div className="digest-confirm"><p>会用这一周现在的原文重新沉淀，并替换这段记忆。确认后不能撤销。</p><div className="button-row"><button className="primary-button" disabled={digestBusy} onClick={() => void redigestWeek(item.start)}>{digestBusy ? '正在沉淀……' : '确认重新沉淀'}</button><button className="quiet-button" onClick={() => setRedigestPending(null)}>取消</button></div></div>
            : removeDigestPending === item.id ? <div className="digest-confirm"><p>只删除这段周记忆，原始记录不动。这一周之后会重新出现在“待沉淀”里。</p><div className="button-row"><button className="danger-button" onClick={() => removeDigest(item.id)}>确认删除这段记忆</button><button className="quiet-button" onClick={() => setRemoveDigestPending(null)}>取消</button></div></div>
            : <div className="digest-item-actions"><button className="text-button" disabled={digestBusy || !modelReady} onClick={() => { setRedigestPending(item.id); setRemoveDigestPending(null); setDigestError(''); }}>{stale ? '重新沉淀' : '重做这一周'}</button><button className="text-button" disabled={digestBusy} onClick={() => { setRemoveDigestPending(item.id); setRedigestPending(null); setDigestError(''); }}>删除这段</button></div>}
          </article>;
        }) : <div className="empty-state"><p>还没有长期记忆。每次沉淀一周，几周后就能覆盖到更早的记录。</p></div>}
      </div>
    </Modal>}
    {importOpen && <Modal title="恢复你的记忆" onClose={() => { setImportOpen(false); setImportPreview(null); }}><p className="modal-intro">从另一台手机带来的记录，可以在这里继续。</p>{!importPreview ? <><button className="upload-drop" onClick={() => fileRef.current?.click()}><Icon name="upload" size={27}/><strong>选择备份文件</strong><span>支持清醒导出的备份</span></button><details><summary>文件选择不可用？粘贴备份</summary><textarea rows={5} value={pasteBackup} placeholder="在这里粘贴完整备份内容" onChange={event => setPasteBackup(event.target.value)}/><button className="secondary-button" disabled={!pasteBackup.trim()} onClick={() => previewImport(pasteBackup)}>检查备份</button></details></> : <><div className="import-summary"><h3>已识别备份</h3><p>{importPreview.entries.length} 条记录 · {importPreview.tasks.length} 件事项 · {importPreview.judgments.length} 条观察{importPreview.digests.length ? ` · ${importPreview.digests.length} 段长期记忆` : ''}{importPreview.profile.length ? ` · ${importPreview.profile.length} 条「关于你」` : ''}</p>{importPreview.skipped > 0 && <p>跳过 {importPreview.skipped} 条无效数据</p>}</div><label className="import-option"><input type="radio" checked={importMode === 'merge'} onChange={() => setImportMode('merge')}/><span>合并到本机<small>保留原有内容，同编号记录采用较新版本。</small></span></label><label className="import-option"><input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')}/><span>完整替换<small>当前设备数据将被备份覆盖，请先导出。</small></span></label><div className="button-row"><button className="quiet-button" onClick={() => setImportPreview(null)}>重新选择</button><button className="primary-button" onClick={confirmImport}>确认恢复</button></div></>}</Modal>}
    <input ref={fileRef} type="file" accept="application/json,.json,text/plain" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { try { previewImport(await file.text()); } catch { setNotice('文件读取失败，请尝试粘贴备份。'); } } event.target.value = ''; }}/>
  </main>;
}
