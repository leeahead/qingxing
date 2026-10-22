'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DailySummary, Entry, Judgment, MemoryDigest, ProfileItem, Task, ThreadNote } from '@/lib/types';
import type { EntryThread } from '@/lib/threads';
import { addDays, confidenceLabels, dateLabel, dayOf, judgmentStatusLabels, observationTypeLabels, shortDate, threadTrendLabels, today } from '@/lib/utils';
import { EntryCard } from '@/components/EntryCard';
import { Icon } from '@/components/Icon';
import { SummaryCard } from '@/components/SummaryCard';

export type ReviewViewProps = {
  entries: Entry[];
  counts: Map<string, number>;
  judgments: Judgment[];
  observationReviewFlags: Map<string, boolean>;
  openObservation: (item: Judgment) => void;
  observationBusy: boolean;
  observationError: string;
  observationScopeCount: number;
  generateObservations: () => void;
  modelReady: boolean;
  digests: MemoryDigest[];
  uncoveredWeekCount: number;
  onOpenDigests: () => void;
  profile: ProfileItem[];
  onOpenProfile: () => void;
  summaryFor: (day: string) => DailySummary | undefined;
  generateSummary: (day: string) => void;
  summaryBusy: boolean;
  summaryError: string;
  openActions: (entry: Entry) => void;
  searchEntries: (query: string) => Promise<Entry[]>;
  tab: 'main' | 'timeline';
  setTab: (tab: 'main' | 'timeline') => void;
  /** 从别处（回响、引用）跳进来时指定要看的那一天 */
  focusDay: string | null;
  onFocusDayConsumed: () => void;
  tasks: Task[];
  setStatus: (id: string, status: Task['status']) => void;
  /** 本地算出的反复话题 */
  threads: EntryThread[];
  /** 已经串过的线索笔记，按 topic 缓存 */
  threadNotes: ThreadNote[];
  focusThread: string | null;
  onFocusThreadConsumed: () => void;
  onGenerateThread: (topic: string) => void;
  threadBusy: boolean;
  threadError: string;
};

type Filter = 'all' | 'review' | 'candidate' | 'confirmed' | 'archived';

/**
 * 回看页：今天之外的所有「重新看一遍」都在这里。
 * 主层是观察与入口；时间线（热力图 / 月历 / 搜索 / 按天详情）是一个子层，不占导航。
 */
export function ReviewView(props: ReviewViewProps) {
  const { entries, counts, judgments, observationReviewFlags, openObservation, observationBusy, observationError, observationScopeCount, generateObservations, modelReady, digests, uncoveredWeekCount, onOpenDigests, profile, onOpenProfile, summaryFor, generateSummary, summaryBusy, summaryError, openActions, searchEntries, tab, setTab, focusDay, onFocusDayConsumed, tasks, setStatus, threads, threadNotes, focusThread, onFocusThreadConsumed, onGenerateThread, threadBusy, threadError } = props;
  const [filter, setFilter] = useState<Filter>('all');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [taskTab, setTaskTab] = useState(false);

  useEffect(() => {
    if (!focusDay) return;
    setSelectedDay(focusDay);
    setResults(null);
    setQuery('');
    onFocusDayConsumed();
    window.scrollTo({ top: 0 });
  }, [focusDay, onFocusDayConsumed]);

  useEffect(() => {
    if (!focusThread) return;
    setSelectedThread(focusThread);
    setResults(null);
    setQuery('');
    onFocusThreadConsumed();
    window.scrollTo({ top: 0 });
  }, [focusThread, onFocusThreadConsumed]);

  useEffect(() => { if (tab === 'timeline') setSelectedThread(null); }, [tab]);

  const visible = useMemo(() => {
    const list = judgments.filter(item => {
      if (filter === 'all') return true;
      if (filter === 'candidate') return item.status === 'candidate';
      if (filter === 'confirmed') return item.status === 'confirmed';
      if (filter === 'archived') return item.status === 'withdrawn' || !!item.muted;
      return observationReviewFlags.get(item.id) === true;
    });
    return [...list].sort((a, b) => Number(observationReviewFlags.get(b.id) || 0) - Number(observationReviewFlags.get(a.id) || 0) || b.updatedAt.localeCompare(a.updatedAt));
  }, [judgments, filter, observationReviewFlags]);
  const stats = useMemo(() => ({
    review: judgments.filter(item => observationReviewFlags.get(item.id)).length,
    active: judgments.filter(item => item.status !== 'withdrawn' && !item.muted).length,
  }), [judgments, observationReviewFlags]);

  const heatDays = useMemo(() => {
    const start = new Date(`${today()}T12:00:00`);
    start.setDate(start.getDate() - 97);
    return Array.from({ length: 98 }, (_, i) => { const day = new Date(start); day.setDate(day.getDate() + i); return dayOf(day); });
  }, []);
  const calendar = useMemo(() => {
    const [year, number] = month.split('-').map(Number);
    const first = (new Date(year, number - 1, 1).getDay() + 6) % 7;
    return [...Array(first).fill(null), ...Array.from({ length: new Date(year, number, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)] as (string | null)[];
  }, [month]);
  const recentDays = useMemo(() => [...counts.keys()].filter(day => day <= today()).sort((a, b) => b.localeCompare(a)).slice(0, 7), [counts]);
  const selectedEntries = entries.filter(entry => selectedDay && dayOf(entry.createdAt) === selectedDay).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeThread = selectedThread ? threads.find(thread => thread.topic === selectedThread) : undefined;
  const activeThreadNote = selectedThread ? threadNotes.find(note => note.topic === selectedThread) : undefined;
  const threadEntryIds = new Set(activeThread?.entryIds ?? activeThreadNote?.sourceIds ?? []);
  const activeThreadEntries = entries.filter(entry => threadEntryIds.has(entry.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function changeMonth(delta: number) {
    const [year, number] = month.split('-').map(Number);
    const next = new Date(year, number - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  }
  function openDay(day: string) { setSelectedDay(day); setResults(null); setQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  async function runSearch() {
    const value = query.trim();
    if (!value) { setResults(null); return; }
    setSearching(true);
    try { setResults(await searchEntries(value)); } finally { setSearching(false); }
  }

  /* ── 线索子层：同一个话题按时间串起来 ── */
  if (tab === 'main' && selectedThread) return <div className="content-column thread-page">
    <button className="back-row" onClick={() => setSelectedThread(null)}><Icon name="back" size={17}/>返回回看</button>
    <header className="page-heading">
      <span className="eyebrow">一条反复出现的线{activeThread ? ` · ${activeThread.count} 条 · 跨 ${activeThread.days.length} 个记录日` : ''}</span>
      <h1>{selectedThread}</h1>
      <p>{activeThread ? `${shortDate(activeThread.start)} 到 ${shortDate(activeThread.end)} · ${threadTrendLabels[activeThread.trend]}` : '这条线现在还没有新的记录，但已经串过的笔记还留在这里。'}</p>
    </header>
    {activeThreadNote ? <article className="thread-note card">
      <header>
        <span className="eyebrow">AI 按时间串过一遍</span>
        <button className="text-button" disabled={threadBusy || !modelReady} onClick={() => onGenerateThread(selectedThread)}>{threadBusy ? '正在重串……' : '重新串一遍'}</button>
      </header>
      <p className="thread-note-summary">{activeThreadNote.summary}</p>
      {activeThreadNote.turning && <p className="thread-note-line"><b>转折：</b>{activeThreadNote.turning}</p>}
      {activeThreadNote.openQuestion && <p className="thread-note-line open"><b>现在还悬着：</b>{activeThreadNote.openQuestion}</p>}
      <footer className="summary-meta">由 {activeThreadNote.model || '模型'} 串于 {new Date(activeThreadNote.generatedAt).toLocaleString('zh-CN')} · 当时 {activeThreadNote.entryCount} 条记录</footer>
    </article> : <div className="thread-note card thread-note-empty">
      <p>这些记录在同一个话题上来来回回，但还只是散落的片段。让 AI 按时间读一遍，看看它最早在说什么、后来怎么变、现在停在哪里。</p>
      <div className="button-row">
        <button className="primary-button" disabled={threadBusy || !modelReady} onClick={() => onGenerateThread(selectedThread)}>{threadBusy ? '正在读这条线……' : '让 AI 把这条线串起来'}</button>
      </div>
      {!modelReady && <p className="muted">连接模型后可以串联；原始记录不受影响。</p>}
    </div>}
    {threadError && <p className="form-error">{threadError}</p>}
    <section className="thread-entries">
      <div className="section-heading"><h3>这条线上的 {activeThreadEntries.length} 条</h3><span className="muted">从早到晚</span></div>
      {activeThreadEntries.length ? <div className="entry-list">{activeThreadEntries.map(entry => <div className="thread-entry" key={entry.id}>
        <time>{dateLabel(dayOf(entry.createdAt))}</time>
        <EntryCard entry={entry} onOpen={openActions}/>
      </div>)}</div> : <div className="empty-state card"><p>这条线现在没有可显示的记录。</p><p className="muted">删除的记录不会回来；这条线索笔记仍留着当时引用的内容。</p></div>}
    </section>
  </div>;

  /* ── 时间线子层 ── */
  if (tab === 'timeline') {
    if (selectedDay) return <div className="content-column timeline-page">
      <button className="back-row" onClick={() => setSelectedDay(null)}><Icon name="back" size={17}/>返回时间线</button>
      <header className="page-heading"><span className="eyebrow">{selectedEntries.length} 条记录</span><h1>{dateLabel(selectedDay)}</h1></header>
      <SummaryCard day={selectedDay} summary={summaryFor(selectedDay)} entries={entries} entryCount={selectedEntries.length} busy={summaryBusy} error={summaryError} modelReady={modelReady} onGenerate={() => generateSummary(selectedDay)}/>
      <div className="entry-list">{selectedEntries.map(entry => <EntryCard key={entry.id} entry={entry} onOpen={openActions}/>)}</div>
    </div>;
    return <div className="content-column timeline-page">
      <button className="back-row" onClick={() => setTab('main')}><Icon name="back" size={17}/>返回回看</button>
      <header className="page-heading"><span className="eyebrow">{entries.length} 条记录都在</span><h1>以往的日子</h1></header>
      <form className="search-row card" onSubmit={event => { event.preventDefault(); void runSearch(); }}>
        <Icon name="search" size={17}/>
        <input aria-label="搜索记录" placeholder="搜一个词、一个人、一件事" value={query} onChange={event => { setQuery(event.target.value); if (!event.target.value.trim()) setResults(null); }}/>
        <button className="secondary-button" type="submit" disabled={searching || !query.trim()}>{searching ? '搜索中' : '搜索'}</button>
      </form>
      {results && <section className="search-results">
        <div className="section-heading"><h3>找到 {results.length} 条</h3><button className="text-button" onClick={() => setResults(null)}>清除</button></div>
        {results.length ? <div className="entry-list">{results.slice(0, 30).map(entry => <EntryCard key={entry.id} entry={entry} onOpen={openActions}/>)}</div> : <p className="muted">没有找到。换个词，或问「提问」页。</p>}
      </section>}
      {!results && <>
        <section className="heat-section card">
          <div className="section-heading"><h3>最近十四周</h3><span className="muted">{[...counts.keys()].filter(day => heatDays.includes(day)).length} 个记录日</span></div>
          <div className="heat-grid" role="img" aria-label="最近 98 天的记录热力图">
            {heatDays.map(day => {
              const count = counts.get(day) || 0;
              const future = day > today();
              return <button key={day} className={`heat-cell heat-${Math.min(4, count)}`} disabled={future || !count} title={`${dateLabel(day)} · ${count} 条`} aria-label={`${dateLabel(day)}，${count} 条记录`} onClick={() => openDay(day)}/>;
            })}
          </div>
        </section>
        <section className="calendar-section card">
          <div className="calendar-head">
            <button className="icon-button" aria-label="上个月" onClick={() => changeMonth(-1)}><Icon name="back" size={17}/></button>
            <h3>{month.replace('-', ' 年 ')} 月</h3>
            <button className="icon-button" aria-label="下个月" disabled={month >= today().slice(0, 7)} onClick={() => changeMonth(1)}><Icon name="next" size={17}/></button>
          </div>
          <div className="calendar-grid">
            {['一', '二', '三', '四', '五', '六', '日'].map(label => <span className="calendar-weekday" key={label}>{label}</span>)}
            {calendar.map((day, index) => day
              ? <button key={day} className={`calendar-day${day === today() ? ' today' : ''}${counts.get(day) ? ' has-entries' : ''}`} disabled={day > today()} onClick={() => counts.get(day) ? openDay(day) : undefined}>
                {Number(day.slice(-2))}
                {counts.get(day) ? <i className="day-dot"/> : null}
              </button>
              : <span key={`gap-${index}`}/>)}
          </div>
          <div className="button-row"><button className="quiet-button" onClick={() => { setMonth(today().slice(0, 7)); openDay(today()); }}>回到今天</button></div>
        </section>
        {!!recentDays.length && <section className="recent-days">
          <div className="section-heading"><h3>最近的日子</h3></div>
          <div className="chip-row">{recentDays.map(day => <button className="chip" key={day} onClick={() => openDay(day)}>{shortDate(day)} · {counts.get(day)} 条</button>)}</div>
        </section>}
      </>}
    </div>;
  }

  /* ── 主层：观察与入口 ── */
  const pendingProfile = profile.filter(item => !item.confirmed).length;
  const openTasks = tasks.filter(task => task.status === 'open' || task.status === 'deferred');
  return <div className="content-column review-page">
    <header className="page-heading">
      <span className="eyebrow">说过的话不会消失</span>
      <h1>回看</h1>
      <p>AI 的观察只是候选，你确认过才算数。</p>
    </header>

    <div className="entry-chips">
      <button className="entry-chip card" onClick={onOpenProfile}><Icon name="check" size={16}/><span>关于你<b>{profile.filter(item => item.confirmed).length} 条</b></span>{pendingProfile > 0 && <i className="chip-dot">{pendingProfile} 待确认</i>}</button>
      <button className="entry-chip card" onClick={onOpenDigests}><Icon name="calendar" size={16}/><span>长期记忆<b>{digests.length} 段</b></span>{uncoveredWeekCount > 0 && <i className="chip-dot">{uncoveredWeekCount} 周待沉淀</i>}</button>
      <button className="entry-chip card" onClick={() => setTab('timeline')}><Icon name="search" size={16}/><span>以往的日子<b>时间线</b></span></button>
    </div>

    {!!threads.length && <section className="thread-section-main">
      <div className="section-heading"><h3>记忆里的线索</h3><span className="muted">{threadNotes.length ? `${threadNotes.length} 条已经串过` : '点一条，把散落的记录连起来'}</span></div>
      <div className="thread-grid">
        {threads.map(thread => {
          const note = threadNotes.find(item => item.topic === thread.topic);
          return <button className="thread-card card" key={thread.id} aria-label={`${thread.topic}：${thread.count} 条记录，跨 ${thread.days.length} 个记录日`} onClick={() => { setSelectedThread(thread.topic); window.scrollTo({ top: 0 }); }}>
            <header><h4>{thread.topic}</h4><span className={`thread-trend trend-${thread.trend}`}>{threadTrendLabels[thread.trend]}</span></header>
            <p>{note ? `${note.summary.slice(0, 80)}${note.summary.length > 80 ? '…' : ''}` : `${shortDate(thread.start)} 第一次出现，最近一次是 ${shortDate(thread.end)}。`}</p>
            <footer><span>{thread.count} 条 · {thread.days.length} 天</span>{note ? <span className="badge">已串过</span> : <span className="thread-open">按时间串起来 →</span>}</footer>
          </button>;
        })}
      </div>
    </section>}

    <section className="obs-section-main">
      <div className="section-heading">
        <h3>阶段性观察{stats.active ? ` · ${stats.active} 条活跃` : ''}</h3>
        <button className="secondary-button" disabled={observationBusy || !modelReady} onClick={generateObservations}>{observationBusy ? 'AI 正在读……' : `让 AI 读最近 ${observationScopeCount} 条`}</button>
      </div>
      {observationError && <p className="form-error">{observationError}</p>}
      <div className="filter-row" role="group" aria-label="筛选观察">
        {([['all', '全部'], ['review', `需重看${stats.review ? ` ${stats.review}` : ''}`], ['candidate', '待核对'], ['confirmed', '已确认'], ['archived', '已归档']] as [Filter, string][]).map(([value, label]) => <button key={value} className={`filter-chip${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      {visible.length ? <div className="obs-list">
        {visible.map(item => {
          const needsReview = observationReviewFlags.get(item.id);
          return <article className="obs-card card" key={item.id} role="button" tabIndex={0} onClick={() => openObservation(item)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openObservation(item); } }}>
            <header>
              {item.type ? <span className="badge type-badge">{observationTypeLabels[item.type]}</span> : <span className="badge legacy-badge">旧观察</span>}
              <span className={`badge status-badge status-${item.status}`}>{item.muted ? '已搁置' : judgmentStatusLabels[item.status]}</span>
              {needsReview && item.status !== 'withdrawn' && !item.muted && <span className="badge review-badge">需重看</span>}
            </header>
            <h4>{item.topic}</h4>
            <p>{item.statement}</p>
            <footer>
              <span>证据 {item.supportIds.length}</span>
              {!!item.counterIds.length && <span>反例 {item.counterIds.length}</span>}
              {item.confidence && <span>{confidenceLabels[item.confidence]}</span>}
              {item.nextReviewAt && item.status !== 'withdrawn' && <span>核对 {shortDate(item.nextReviewAt)}</span>}
            </footer>
          </article>;
        })}
      </div> : <div className="empty-state card">
        <p>{judgments.length ? '这个筛选下没有观察。' : '还没有观察。'}</p>
        <p className="muted">{judgments.length ? '换个筛选看看。' : modelReady ? `记录积累几天后，让 AI 读一遍最近 ${observationScopeCount} 条，找值得回看的模式。它给的每条都必须挂你的原话，你可以随时纠正或撤回。` : '连接模型后，AI 可以定期读你的记录，提出值得回看的观察。'}</p>
      </div>}
    </section>

    {!!openTasks.length && <section className="task-section">
      <div className="section-heading"><h3>事项 · {openTasks.length} 件还开着</h3><button className="text-button" onClick={() => setTaskTab(current => !current)}>{taskTab ? '收起' : '全部处理'}</button></div>
      {taskTab && <TaskBoard tasks={tasks} openActions={openActions} setStatus={setStatus} entries={entries}/>}
    </section>}
  </div>;
}

/** 完整事项板：四个状态都能改，每条都能回到原文。 */
function TaskBoard({ tasks, setStatus, openActions, entries }: { tasks: Task[]; setStatus: (id: string, status: Task['status']) => void; openActions: (entry: Entry) => void; entries: Entry[] }) {
  const groups: [Task['status'], string][] = [['open', '待处理'], ['deferred', '以后处理'], ['done', '已经完成'], ['dropped', '已经放下']];
  return <div className="task-board">
    {groups.map(([status, label]) => {
      const list = tasks.filter(task => task.status === status);
      if (!list.length) return null;
      return <div className="task-group" key={status}>
        <h4>{label} · {list.length}</h4>
        {list.map(task => {
          const source = entries.find(entry => entry.id === task.sourceId);
          return <div className="task-row full" key={task.id}>
            <button className="task-check" aria-label={status === 'done' ? '重新打开' : '完成'} onClick={() => setStatus(task.id, status === 'done' ? 'open' : 'done')}><Icon name="check" size={15}/></button>
            <span className="task-title" title={task.title}>{task.title}</span>
            {source && <button className="text-button" onClick={() => openActions(source)}>原文</button>}
            <select aria-label="状态" value={task.status} onChange={event => setStatus(task.id, event.target.value as Task['status'])}>
              {groups.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
            </select>
          </div>;
        })}
      </div>;
    })}
  </div>;
}
