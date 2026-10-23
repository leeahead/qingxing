'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { termsFor } from '@/lib/topics';
import type { DailySummary, Entry, Insight, Message, ProfileItem, ProfileKind, Settings, Store, Task, Theme, UserProfile, View } from '@/lib/types';
import { VERSION, addDays, dayOf, mergeSettings, navItems, shortDate, streakOf, today, uid } from '@/lib/utils';
import { buildFollowUpRequest, buildInsightRequest, buildProfileProposalRequest, buildProfileRequest, buildSummaryRequest, buildThreadRequest, callModel, callPlainTextModel, callStructuredModel, parseInsightCandidate, parseProfileProposal, parseProfileRequest, parseSummary, parseThreadNote } from '@/lib/ai';
import type { ChatTurn, ModelTuning } from '@/lib/ai';
import { checkInsight } from '@/lib/harness';
import type { HarnessLevel } from '@/lib/harness';
import { activeScenes, buildScenes, entriesNeeded, keepProfileVersions, profileDue, profileSourceEntries, MIN_ENTRIES_FOR_INSIGHT } from '@/lib/memory';
import { applyFeedback, attemptsLeft, avoidedDirections, buildPreferenceBlock, firstRunQuota, mergeRun, qualityStats, remainingQuota, RUN_ATTEMPT_LIMIT, DEFAULT_DAILY_TARGET } from '@/lib/feedback';
import { archiveFileName, backupFileName, buildArchiveText, buildBackupText, mergeStores, pickBackupDirectory, saveBackupFile, supportsAutoBackup, writeBackupToDirectory } from '@/lib/backup';
import type { DirectoryHandleLike } from '@/lib/backup';
import { appendJournal, clearStorage, clearVectors, createSnapshot, deleteSnapshot, deleteVectors, findSettingsInSnapshots, listJournal, listSnapshots, readBackupMeta, readDirectoryHandle, readMirrorSettings, readMirrorState, readSnapshot, readState, readVectors, rescueSettingsOnce, saveDirectoryHandle, storageStatus, writeBackupMeta, writeMirrorState, writeState, writeVectors } from '@/lib/storage';
import type { JournalEvent, JournalKind, Snapshot, StorageStatus, VectorRow } from '@/lib/storage';
import { cosine, embedTexts, embeddingModel, probeEmbedding } from '@/lib/embedding';
import type { EmbeddingProbe } from '@/lib/embedding';
import { hasSimilarProfileText, buildProfileBlock } from '@/lib/profile';
import { buildThreads, memoriesOnThisDay, threadForEntry } from '@/lib/threads';
import { isInputField, watchKeyboard } from '@/lib/keyboard';
import type { KeyboardDiag } from '@/lib/keyboard';
import type { EntryEcho } from '@/components/EntryCard';
import { Icon } from '@/components/Icon';
import { ProfileModal } from '@/components/ProfileModal';
import { ArchiveModal } from '@/components/modals/ArchiveModal';
import { EntryModal } from '@/components/modals/EntryModal';
import { FollowUpModal } from '@/components/modals/FollowUpModal';
import { ImportModal } from '@/components/modals/ImportModal';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { InsightStreamView } from '@/components/views/InsightStreamView';
import { MemoryView } from '@/components/views/MemoryView';

const emptyStore: Store = { entries: [], tasks: [], judgments: [], memoryFeedback: {}, summaries: [], digests: [], profile: [], threadNotes: [], insights: [], userProfile: null, profileVersions: [], scenes: [], runs: [] };
const blankSettings: Settings = { baseUrl: '', apiKey: '', model: '' };
/** 设置里最多保留多少条键盘诊断记录；真机排查用，平时不打扰。 */
const DIAG_LIMIT = 8;
/** 追问时临时读原文的次数上限（每月）。 */
const RAW_READ_MONTHLY_LIMIT = 20;

export default function Home() {
  const [data, setData] = useState<Store>(emptyStore);
  const [settings, setSettings] = useState<Settings>(blankSettings);
  const [theme, setTheme] = useState<Theme>('dark');
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('insight');
  const [memoryTab, setMemoryTab] = useState<'main' | 'timeline'>('main');
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [focusThread, setFocusThread] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [actionEntry, setActionEntry] = useState<Entry | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [backupText, setBackupText] = useState('');
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
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  /** 正在想下一条洞察（转圈与「别重复点」都靠它） */
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState('');
  const [profileBuilding, setProfileBuilding] = useState(false);
  // ── 追问：临时对话，关掉就清空，不写进记忆 ──
  const [followInsight, setFollowInsight] = useState<Insight | null>(null);
  const [followMessages, setFollowMessages] = useState<Message[]>([]);
  const [followInput, setFollowInput] = useState('');
  const [followBusy, setFollowBusy] = useState(false);
  const pilotRanRef = useRef(false);
  const autoVectorRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followEndRef = useRef<HTMLDivElement>(null);
  const { entries, tasks, judgments, summaries, digests, profile, threadNotes, insights, userProfile, scenes, runs } = data;
  const modelReady = Boolean(settings.baseUrl.trim() && settings.model.trim());
  // ── 洞察流的两个可调档位（设置页里改） ──
  const harnessLevel = (settings.harnessLevel || 'balanced') as HarnessLevel;
  /** 每天想留下几条：设置里 3 / 5 / 8，默认 5。尝试预算随它放大。 */
  const dailyTargetCount = settings.insightDailyTarget ?? DEFAULT_DAILY_TARGET;

  /**
   * 所有模型调用都从这里走：把最近一次失败的原因留下来，
   * 设置页能直接看到“到底是没配上，还是配上了但接口报错”。
   */
  async function askModel(payload: ChatTurn[], timeout = 90000, tuning: ModelTuning = {}): Promise<string> {
    try {
      const answer = await callModel(settings, payload, timeout, tuning);
      setModelError('');
      return answer;
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '未知错误');
      throw error;
    }
  }
  /**
   * 要模型回 JSON 的调用都走这里：思考模型常常只把话写在 reasoning_content 里，
   * 先试着从思考过程中捞答案，捞不到再取消长度上限重要一次，最后才把错误摊给用户。
   */
  async function askStructured(payload: ChatTurn[], timeout = 90000, tuning: ModelTuning = {}, jsonFromReasoning = true): Promise<string> {
    try {
      const answer = await callStructuredModel(settings, payload, { timeout, temperature: tuning.temperature, maxTokens: tuning.maxTokens, jsonFromReasoning });
      setModelError('');
      return answer;
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '未知错误');
      throw error;
    }
  }
  /** 自然语言回答（追问面板用）：只回思考过程时会自动再要一次。 */
  async function askPlain(payload: ChatTurn[], timeout = 60000, tuning: ModelTuning = {}): Promise<string> {
    try {
      const answer = await callPlainTextModel(settings, payload, { timeout, temperature: tuning.temperature });
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
        const weight = (state: typeof stored) => state ? state.store.entries.length + state.store.tasks.length + state.store.summaries.length + state.store.insights.length : 0;
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
    if (!serviceWorkerAvailable()) return;
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

  /**
   * L2 场景层：本地算，不花 token。
   * 记录一进来就重新聚合，算出稳定结果后才写回本机（写回前比对签名，避免边渲染边写）。
   */
  const savedSceneSignature = useRef('');
  useEffect(() => {
    if (!ready) return;
    const next = buildScenes(entries, data.scenes);
    const signature = next.map(scene => `${scene.theme}:${scene.entryIds.length}:${scene.lastActiveAt}:${scene.archived ? 'a' : ''}`).join('|');
    if (signature === savedSceneSignature.current) return;
    savedSceneSignature.current = signature;
    setData(current => ({ ...current, scenes: next }));
  }, [entries, ready, data.scenes]);

  // 自动整理：每次打开最多跑一轮（画像 → 洞察 → 补回望）。
  useEffect(() => {
    if (!ready || !modelReady || settings.autoPilot === false || pilotRanRef.current) return;
    const sessionKey = 'qingxing.insight-pilot.v1';
    try {
      if (sessionStorage.getItem(sessionKey) === '1') { pilotRanRef.current = true; return; }
      sessionStorage.setItem(sessionKey, '1');
    } catch { /* 隐私模式没有 sessionStorage，照常跑一次 */ }
    pilotRanRef.current = true;
    void runPilot();
  }, [ready, modelReady, settings.autoPilot]);

  /**
   * 一天的量不靠「重开应用」凑够：
   *   距上一条满 12 分钟，后台再补一轮；从别的 app 切回来且已隔 3 分钟，也补一轮。
   * 目标条数与尝试预算都用完了就安静下来。
   */
  const topUpRef = useRef<() => void>(() => {});
  useEffect(() => {
    topUpRef.current = () => {
      if (!ready || !modelReady || settings.autoPilot === false || !userProfile) return;
      if (insightBusy || autoBusy || profileBuilding) return;
      const left = remainingQuota(insights, runs, dailyTargetCount);
      if (left <= 0) return;
      void generateInsights(left, userProfile);
    };
  });
  useEffect(() => {
    if (!ready || !modelReady || settings.autoPilot === false) return;
    const since = settings.lastInsightAt ? Date.now() - Date.parse(settings.lastInsightAt) : Number.POSITIVE_INFINITY;
    const timer = setTimeout(() => topUpRef.current(), Math.max(20000, 12 * 60000 - since));
    return () => clearTimeout(timer);
  }, [ready, modelReady, settings.autoPilot, settings.lastInsightAt, insights.length, runs.length]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const since = settings.lastInsightAt ? Date.now() - Date.parse(settings.lastInsightAt) : Number.POSITIVE_INFINITY;
      if (since < 3 * 60000) return;
      topUpRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [settings.lastInsightAt]);

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
  /** 本地记忆脉络：反复出现的话题，不需要 AI，也不花 token。 */
  const threads = useMemo(() => buildThreads(entries), [entries]);
  const thisDay = useMemo(() => memoriesOnThisDay(entries, today()), [entries]);
  /** 最近 24 小时的原文：Harness 用它拦「复述用户刚说过的话」。 */
  const freshEntries = useMemo(() => { const cutoff = Date.now() - 86400000; return entries.filter(entry => Date.parse(entry.createdAt) >= cutoff); }, [entries]);
  /** 即时回响：今天每条记录找一条最相关的历史记录（分词交集 ≥ 2）。全部在本地算，不等 AI、不花 token。 */
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
  const backupAgeDays = useMemo(() => {
    if (!backupMeta.lastExportAt) return null;
    const days = Math.floor((Date.now() - Date.parse(backupMeta.lastExportAt)) / 86400000);
    return Number.isFinite(days) ? days : null;
  }, [backupMeta.lastExportAt]);
  const quotaLeft = ready && userProfile && modelReady ? remainingQuota(insights, runs, dailyTargetCount) : 0;
  const stats = useMemo(() => qualityStats(insights, runs), [insights, runs]);
  const rawReadsLeft = settings.rawReadMonth === today().slice(0, 7) ? Math.max(0, RAW_READ_MONTHLY_LIMIT - (settings.rawReadCount || 0)) : RAW_READ_MONTHLY_LIMIT;

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
    if (!window.confirm('确认清空本机全部记录、事项、洞察与画像？模型连接会保留，请先导出备份。')) return;
    await createSnapshot(currentState(), '清空前快照');
    // 模型连接是配置，不是记忆：清空记忆不该让模型又变回“没连上”。
    const kept = { ...settings };
    await clearStorage();
    const emptied = { store: emptyStore, settings: kept, theme, updatedAt: new Date().toISOString() };
    await writeState(emptied);
    writeMirrorState(emptied);
    setData(emptyStore);
    setSettings(kept);
    setFollowMessages([]);
    setFollowInsight(null);
    setBackupMeta({});
    setVectorCount(0);
    setEmbedProbe(null);
    await refreshStorage();
    setNotice('本机数据已清空，模型连接保留。清空前留了一份快照，可以在设置里恢复。');
  }

  // ── 记录 ──
  function saveEntry() {
    if (!draft.trim() || !ready) return;
    const now = new Date().toISOString();
    const entry: Entry = editing ? { ...editing, content: draft.trim(), updatedAt: now } : { id: uid(), content: draft.trim(), source: 'user', createdAt: now, updatedAt: now };
    setData(current => ({ ...current, entries: editing ? current.entries.map(item => item.id === entry.id ? entry : item) : [...current.entries, entry] }));
    logEvent(editing ? 'entry.edited' : 'entry.created', editing ? '修改了一条记忆' : '记下了一条新记忆');
    setDraft(''); setEditing(null);
    setNotice('已记下。它读到这些以后会说出来。');
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
  function addTaskFromText(text: string) {
    const title = text.trim().slice(0, 120);
    if (!title) return;
    if (tasks.some(task => task.title === title && (task.status === 'open' || task.status === 'deferred'))) { setNotice('这件事已经在事项里了。'); return; }
    setData(current => ({ ...current, tasks: [...current.tasks, { id: uid(), title, status: 'open', sourceId: '', createdAt: new Date().toISOString() }] }));
    setNotice('已记为事项，原始记录没有改动。');
  }
  function setStatus(id: string, status: Task['status']) { setData(current => ({ ...current, tasks: current.tasks.map(item => item.id === id ? { ...item, status } : item) })); }

  // ── 洞察：先生成，再检验 ──
  /**
   * 生成 count 条洞察。每一条都要过 Harness；没过就丢掉、再来一条。
   * 用户看不到被丢掉的句子，只在本页留下「今天尝试了几条、留下几条」。
   */
  async function generateInsights(count: number, baseProfile: UserProfile | null): Promise<number> {
    const profileNow = baseProfile ?? userProfile;
    if (!profileNow) { setInsightError('还没有画像层，我先读一遍你的记录。'); return 0; }
    if (insightBusy) return 0;
    setInsightBusy(true); setInsightError('');
    let accepted = 0;
    let attempts = 0;
    const rejects: string[] = [];
    // 本轮已留下的句子也要参与查重，否则一次生成 3 条会连着说同一件事。
    const seen: Insight[] = [...insights];
    const avoided = avoidedDirections(insights);
    const preference = buildPreferenceBlock(insights);
    const sceneTop = activeScenes(scenes.length ? scenes : buildScenes(entries, scenes), 3);
    const budgetLeft = attemptsLeft(runs, today(), dailyTargetCount);
    const rounds = Math.max(0, Math.min(RUN_ATTEMPT_LIMIT, budgetLeft));
    try {
      // 「先生成，再检验」：凑够今天该发的条数，或者用完本轮尝试预算为止。
      for (let attempt = 0; attempt < rounds && accepted < count; attempt++) {
        attempts++;
        const raw = await askStructured(buildInsightRequest({
          profile: profileNow,
          scenes: sceneTop,
          preference,
          said: seen.map(item => item.content),
          background: buildProfileBlock(profile) || undefined,
        }), 60000, { temperature: settings.insightTemperature ?? 0.8, maxTokens: 200 });
        const result = checkInsight(parseInsightCandidate(raw), { level: harnessLevel, existing: seen, freshEntries, avoided });
        if (!result.ok) { rejects.push(result.reason); continue; }
        const insight: Insight = {
          id: uid(),
          content: result.draft.content,
          confidence: result.draft.confidence,
          createdAt: new Date().toISOString(),
          feedback: null,
          direction: result.draft.direction,
          profileVersion: profileNow.version,
        };
        seen.push(insight);
        setData(current => ({ ...current, insights: [...current.insights, insight] }));
        accepted++;
      }
      setData(current => ({ ...current, runs: mergeRun(current.runs, today(), attempts, accepted, rejects) }));
      setSettings(current => ({ ...current, lastInsightAt: new Date().toISOString() }));
      if (accepted) logEvent('insight.generated', `留下了 ${accepted} 条洞察，自检丢掉 ${rejects.length} 条`);
    } catch (error) {
      setInsightError(error instanceof Error ? error.message : '这次没生成出来，等会儿再试。');
      setData(current => ({ ...current, runs: mergeRun(current.runs, today(), attempts, accepted, rejects) }));
    } finally { setInsightBusy(false); }
    return accepted;
  }

  /** 更新 L3 画像层；返回新版本，供同一轮洞察生成直接使用（不等 state 落定）。 */
  async function rebuildProfile(manual: boolean): Promise<UserProfile | null> {
    if (!modelReady) return null;
    if (entries.length < MIN_ENTRIES_FOR_INSIGHT) return null;
    if (!manual && !profileDue(settings.lastProfileBuildAt)) return userProfile;
    setProfileBuilding(true);
    try {
      const window = profileSourceEntries(entries, settings.lastProfileBuildAt);
      const raw = await askStructured(buildProfileRequest({
        entries: window.list,
        current: userProfile,
        scenes: activeScenes(scenes, 6),
        preference: buildPreferenceBlock(insights),
        background: buildProfileBlock(profile) || undefined,
        windowLabel: window.window,
      }), 120000, { temperature: 0.5 });
      const next = parseProfileRequest(raw, userProfile, { basedOnEntries: window.list.length, windowLabel: window.window });
      setData(current => ({ ...current, userProfile: next, profileVersions: keepProfileVersions([...current.profileVersions, next]) }));
      setSettings(current => ({ ...current, lastProfileBuildAt: next.updatedAt }));
      logEvent('profile.rebuilt', `画像层更新到第 ${next.version} 版（读了 ${window.list.length} 条）`);
      return next;
    } catch (error) {
      setInsightError(error instanceof Error ? error.message : '画像更新失败，等会儿再试。');
      return null;
    } finally { setProfileBuilding(false); }
  }

  /** 打开应用时的一轮：画像到期就更新，然后按当天配额补洞察，顺手补一份缺的回望。 */
  async function runPilot(manual = false) {
    if (autoBusy) return;
    setAutoBusy(true);
    const done: string[] = [];
    try {
      // 1) 补最近一天缺的每日回望（当天不补，避免过早下结论）
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
      // 2) 画像层：没有就先读 30 天，满了 7 天做增量
      let profileNow = userProfile;
      if (entries.length >= MIN_ENTRIES_FOR_INSIGHT && (manual || profileDue(settings.lastProfileBuildAt))) {
        const built = await rebuildProfile(manual);
        if (built) { profileNow = built; done.push(`画像第 ${built.version} 版`); }
      }
      // 3) 洞察：按今天的目标条数（设置里 3 / 5 / 8），昨天没发够的今天补；第一次开口至少 3 条
      const need = Math.max(remainingQuota(insights, runs, dailyTargetCount), insights.length ? 0 : firstRunQuota(insights, dailyTargetCount), manual ? 1 : 0);
      if (profileNow && need > 0) {
        const accepted = await generateInsights(need, profileNow);
        if (accepted) done.push(`${accepted} 条洞察`);
      }
    } finally {
      setAutoBusy(false);
      if (done.length) setNotice(`它整理了一下：${done.join('、')}。`);
    }
  }

  /** 用户对一条洞察的反应。不需要追问原因，不需要道歉。 */
  function giveFeedback(id: string, value: 'positive' | 'negative') {
    setData(current => ({ ...current, insights: applyFeedback(current.insights, id, value) }));
    const item = insights.find(entry => entry.id === id);
    logEvent('insight.feedback', value === 'positive' ? `认了一条（${item?.direction || '方向未记'}）` : `否了一条（${item?.direction || '方向未记'}）`);
    if (value === 'negative' && item && item.direction) setNotice('记住了，这个方向下次避开。');
  }

  // ── 追问（临时对话） ──
  function openFollowUp(insight: Insight) { setFollowInsight(insight); setFollowMessages([]); setFollowInput(''); }
  async function askFollowUp(question: string, rejected = false) {
    if (!followInsight || !question.trim() || followBusy) return;
    if (!modelReady) { setNotice('还没有连接模型，暂时不能追问。'); return; }
    setFollowBusy(true);
    setFollowMessages(current => [...current, { role: 'user', content: question }]);
    const history: ChatTurn[] = followMessages.map(({ role, content }) => ({ role, content }));
    try {
      // 例外条款：用户主动问「你为什么这么觉得」时，才临时读原文；每月不超过 20 次，读到的不进长期记忆。
      const wantsRaw = /为什么|凭什么|你怎么知道|依据/.test(question);
      const canRead = rawReadsLeft > 0;
      let sources: Entry[] = [];
      if (wantsRaw && canRead) {
        sources = await searchEntries(followInsight.content);
        setSettings(current => ({
          ...current,
          rawReadMonth: today().slice(0, 7),
          rawReadCount: (current.rawReadMonth === today().slice(0, 7) ? current.rawReadCount || 0 : 0) + 1,
        }));
      }
      const answer = await askPlain(buildFollowUpRequest({
        insight: followInsight.content,
        profile: userProfile,
        scenes: activeScenes(scenes, 3),
        question,
        history,
        sources,
        rejected,
      }), 60000, { temperature: settings.insightTemperature ?? 0.8 });
      setFollowMessages(current => [...current, { role: 'assistant', content: answer }]);
    } catch (error) {
      setFollowMessages(current => [...current, { role: 'assistant', content: `这次没说成：${error instanceof Error ? error.message : '未知错误'}` }]);
    } finally { setFollowBusy(false); setFollowInput(''); }
  }
  function disagreeInFollowUp() {
    if (!followInsight) return;
    giveFeedback(followInsight.id, 'negative');
    void askFollowUp('我不这么认为。', true);
  }

  // ── 旧数据存档 ──
  async function exportArchive() {
    const text = buildArchiveText(judgments, digests);
    const result = await saveBackupFile(text, archiveFileName());
    if (result === 'cancelled') return;
    setNotice('旧数据已单独导出一份。界面上的东西没动。');
  }
  function removeJudgment(id: string) {
    setData(current => ({ ...current, judgments: current.judgments.filter(item => item.id !== id) }));
    logEvent('archive.removed', '删掉了一条旧观察');
  }
  function removeDigest(id: string) {
    setData(current => ({ ...current, digests: current.digests.filter(item => item.id !== id) }));
    logEvent('archive.removed', '删掉了一段旧周记忆');
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
  async function proposeProfile() {
    if (profileBusy) return;
    if (!modelReady) { setProfileError('还没有连接模型。先在“偏好与数据”里填写接口地址与模型。'); return; }
    setProfileBusy(true); setProfileError('');
    try {
      const recent = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
      if (recent.length < 3) throw new Error('记录还太少，先记几天再让 AI 提议。');
      const allowedIds = new Set(recent.map(entry => entry.id));
      const raw = await askModel(buildProfileProposalRequest({ entries: recent, existing: profile }), 120000);
      const items = parseProfileProposal(raw, allowedIds)
        .filter(item => !hasSimilarProfileText(profile, item.text))
        .map(item => ({ id: uid(), kind: item.kind, text: item.text, evidenceIds: item.evidenceIds, source: 'ai' as const, confirmed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
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

  // ── 语义向量与检索 ──
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
  /** 全站统一的混合检索：字面命中 > 分词交集 > 语义召回，合并去重。 */
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

  // ── 每日回望 ──
  async function summarizeDay(day: string): Promise<DailySummary> {
    const dayEntries = entries.filter(entry => dayOf(entry.createdAt) === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!dayEntries.length) throw new Error('这一天没有记录。');
    if (!modelReady) throw new Error('还没有连接模型。请在“偏好与数据”中填写接口地址、模型名称和访问密钥。');
    const earlier = entries.filter(entry => dayOf(entry.createdAt) < day).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
    const previous = [...summaries].filter(item => item.day < day).sort((a, b) => a.day.localeCompare(b.day)).at(-1);
    const raw = await askModel(buildSummaryRequest(day, dayEntries, earlier, { profile, threads, previous }), 120000);
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

  function navigate(next: 'insight' | 'memory' | 'settings') {
    if (next === 'settings') { setShowSettings(true); return; }
    setShowSettings(false);
    setView(next);
    window.scrollTo({ top: 0 });
  }
  function openDayInTimeline(day: string) { setView('memory'); setMemoryTab('timeline'); setFocusDay(day); }
  function editEntry(entry: Entry) {
    setEditing(entry);
    setDraft(entry.content);
    setActionEntry(null);
    setView('insight');
    setTimeout(() => composerRef.current?.focus(), 60);
  }
  async function confirmImport(incoming: Store, mode: 'merge' | 'replace') {
    const replaced = mode === 'replace';
    const kept = replaced ? new Set(incoming.entries.map(entry => entry.id)) : new Set([...entries, ...incoming.entries].map(entry => entry.id));
    setData(current => replaced ? incoming : mergeStores(current, incoming));
    setImportOpen(false);
    setNotice('备份已恢复，欢迎继续记录。');
    void syncVectors(kept);
  }
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
    // 只有真的把数据交出去了才记时间：用户在分享面板点取消时不能算备份成功。
    if (result === 'cancelled') return;
    markExported(entries.length);
    if (backupMeta.autoDirName) {
      const ok = await runAutoBackup();
      if (!ok) setNotice('备份文件已保存，但自动备份到目录这一步没成功，请检查目录授权。');
    }
  }

  return <main className={`app-shell theme-${theme}${typing ? ' keyboard-open' : ''}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('insight')}><span className="brand-mark">清</span><span>清醒<small>留住当时的清醒</small></span></button>
      <nav>{navItems.map(item => <button key={item.id} className={`nav-item ${item.id === 'settings' ? (showSettings ? 'active' : '') : (view === item.id ? 'active' : '')}`} onClick={() => navigate(item.id)}><Icon name={item.icon}/>{item.label}</button>)}</nav>
      <div className="sidebar-bottom">
        <p>它说的都是猜的，<br/>你记下的才是真的。</p>
        <small>{VERSION}</small>
      </div>
    </aside>
    <section className="main-area">
      <header className="topbar">
        <span className="mobile-brand">清醒<span>洞察流</span></span>
        {(autoBusy || insightBusy || profileBuilding) && <span className="auto-pill" role="status"><i/>它正在想</span>}
        <span className="device-status"><i/>只存在这台设备</span>
        <button className="icon-button" aria-label="偏好与数据" onClick={() => setShowSettings(true)}><Icon name="settings"/></button>
      </header>
      {view === 'insight' && <InsightStreamView
        insights={insights} ready={ready} modelReady={modelReady} hasProfile={Boolean(userProfile)}
        needEntries={entriesNeeded(entries)} entryCount={entries.length} quotaLeft={quotaLeft}
        generating={insightBusy || profileBuilding} error={insightError} showIntro={!insights.length}
        draft={draft} editing={editing} todayCount={todaysEntries.length} setDraft={setDraft} setEditing={setEditing} saveEntry={saveEntry} composerRef={composerRef} setTyping={setTyping}
        onGenerate={() => void (userProfile ? generateInsights(Math.max(quotaLeft, 1), userProfile) : runPilot(true))}
        onFeedback={giveFeedback} onFollowUp={openFollowUp}
        onOpenMemory={() => navigate('memory')} onOpenSettings={() => setShowSettings(true)}
      />}
      {view === 'memory' && <MemoryView
        entries={entries} counts={counts} todaysEntries={todaysEntries} echoes={echoes} streak={streak}
        summaryFor={summaryFor} generateSummary={day => void generateSummary(day)} summaryBusy={summaryBusy} summaryError={summaryError} modelReady={modelReady} onAddTask={addTaskFromText}
        openActions={openActions} tasks={tasks} setStatus={setStatus} thisDay={thisDay}
        threads={threads} threadNotes={threadNotes}
        focusThread={focusThread} onFocusThreadConsumed={() => setFocusThread(null)}
        onGenerateThread={topic => void generateThreadNote(topic)} threadBusy={threadBusy} threadError={threadError}
        profile={profile} onOpenProfile={() => setShowProfile(true)}
        searchEntries={searchEntries} tab={memoryTab} setTab={setMemoryTab}
        focusDay={focusDay} onFocusDayConsumed={() => setFocusDay(null)} onOpenDay={openDayInTimeline}
        legacyCount={judgments.length} legacyDigestCount={digests.length} onOpenArchive={() => setShowArchive(true)}
      />}
    </section>

    <nav className="mobile-nav" aria-label="主导航">{navItems.map(item => <button key={item.id} className={item.id === 'settings' ? (showSettings ? 'active' : '') : (view === item.id ? 'active' : '')} aria-current={item.id !== 'settings' && view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>

    {notice && <button className="notice" role="status" onClick={() => setNotice('')}>{notice}<Icon name="close" size={15}/></button>}

    {actionEntry && <EntryModal
      entry={actionEntry}
      hasTask={tasks.some(item => item.sourceId === actionEntry.id)}
      taskTitle={taskTitle} setTaskTitle={setTaskTitle} onAddTask={addTask}
      onEdit={() => editEntry(actionEntry)}
      onDelete={() => { logEvent('entry.deleted', `删除了一条记忆：${actionEntry.content.slice(0, 20)}`, actionEntry); setData(current => ({ ...current, entries: current.entries.filter(item => item.id !== actionEntry.id) })); void dropVectors([actionEntry.id]); setActionEntry(null); }}
      onFeedback={value => {
        setData(current => ({ ...current, entries: current.entries.map(item => item.id === actionEntry.id ? { ...item, feedback: value, updatedAt: new Date().toISOString() } : item) }));
        setActionEntry(current => current ? { ...current, feedback: value } : null);
      }}
      onClose={() => setActionEntry(null)}
    />}
    {showProfile && <ProfileModal items={profile} entries={entries} busy={profileBusy} error={profileError} onClose={() => setShowProfile(false)} onAdd={addProfileItem} onUpdate={updateProfileItem} onRemove={removeProfileItem} onConfirm={confirmProfileItem} onPropose={() => void proposeProfile()}/>}
    {followInsight && <FollowUpModal
      insight={followInsight} messages={followMessages} input={followInput} setInput={setFollowInput}
      busy={followBusy} modelReady={modelReady} rawReadsLeft={rawReadsLeft}
      onSend={question => void askFollowUp(question)} onDisagree={disagreeInFollowUp} endRef={followEndRef}
      onClose={() => { setFollowInsight(null); setFollowMessages([]); }}
    />}
    {showArchive && <ArchiveModal
      judgments={judgments} digests={digests}
      onExport={() => void exportArchive()} onRemoveJudgment={removeJudgment} onRemoveDigest={removeDigest}
      onClose={() => setShowArchive(false)}
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
      autoBusy={autoBusy || insightBusy || profileBuilding} onRunAutoPilot={() => void runPilot(true)} onRebuildProfile={() => void rebuildProfile(true)}
      profile={userProfile} profileVersions={data.profileVersions} insightCount={insights.length}
      sceneCount={scenes.filter(item => !item.archived).length} rawReadsLeft={rawReadsLeft}
      stats={stats} legacyCount={judgments.length + digests.length} onOpenArchive={() => { setShowSettings(false); setShowArchive(true); }}
      keyboardDiag={keyboardDiag} onClose={() => setShowSettings(false)}
    />}
    {importOpen && <ImportModal onImport={confirmImport} onClose={() => setImportOpen(false)}/>}
  </main>;
}

function serviceWorkerAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}
