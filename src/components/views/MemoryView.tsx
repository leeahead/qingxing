'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DailySummary, Entry, MemoryDigest, ProfileItem, Task, ThreadNote } from '@/lib/types';
import type { EntryThread } from '@/lib/threads';
import type { DayMemory } from '@/lib/threads';
import { dateLabel, dayOf, daysAgo, shortDate, threadTrendLabels, today } from '@/lib/utils';
import { EntryCard } from '@/components/EntryCard';
import type { EntryEcho } from '@/components/EntryCard';
import { Icon } from '@/components/Icon';
import { SummaryCard } from '@/components/SummaryCard';

export type MemoryViewProps = {
  entries: Entry[];
  counts: Map<string, number>;
  todaysEntries: Entry[];
  echoes: Map<string, EntryEcho>;
  streak: number;
  summaryFor: (day: string) => DailySummary | undefined;
  generateSummary: (day: string) => void;
  summaryBusy: boolean;
  summaryError: string;
  modelReady: boolean;
  onAddTask: (title: string) => void;
  openActions: (entry: Entry) => void;
  tasks: Task[];
  setStatus: (id: string, status: Task['status']) => void;
  thisDay: DayMemory[];
  threads: EntryThread[];
  threadNotes: ThreadNote[];
  focusThread: string | null;
  onFocusThreadConsumed: () => void;
  onGenerateThread: (topic: string) => void;
  threadBusy: boolean;
  threadError: string;
  profile: ProfileItem[];
  onOpenProfile: () => void;
  searchEntries: (query: string) => Promise<Entry[]>;
  tab: 'main' | 'timeline';
  setTab: (tab: 'main' | 'timeline') => void;
  focusDay: string | null;
  onFocusDayConsumed: () => void;
  onOpenDay: (day: string) => void;
  /** 旧版观察与周沉淀的条数；只在「旧数据存档」里出现 */
  legacyCount: number;
  legacyDigestCount: number;
  onOpenArchive: () => void;
};

/**
 * 记忆页：说过的话都在这里。
 * 洞察流不再给用户看原文，所以这一页要能顺畅地回到原话——
 * 今天的记录与回响、事项、每日回望、线索、时间线（热力图 / 月历 / 搜索 / 按天详情）。
 */
export function MemoryView(props: MemoryViewProps) {
  const {
    entries, counts, todaysEntries, echoes, streak, summaryFor, generateSummary, summaryBusy, summaryError, modelReady, onAddTask,
    openActions, tasks, setStatus, thisDay, threads, threadNotes, focusThread, onFocusThreadConsumed, onGenerateThread, threadBusy, threadError,
    profile, onOpenProfile, searchEntries, tab, setTab, focusDay, onFocusDayConsumed, onOpenDay, legacyCount, legacyDigestCount, onOpenArchive,
  } = props;
  const [month, setMonth] = useState(today().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);
  const [searching, setSearching] = useState(false);

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
  const activeTasks = tasks.filter(task => task.status === 'open' || task.status === 'deferred');

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
    <button className="back-row" onClick={() => setSelectedThread(null)}><Icon name="back" size={17}/>返回记忆</button>
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
      <button className="back-row" onClick={() => setTab('main')}><Icon name="back" size={17}/>返回记忆</button>
      <header className="page-heading"><span className="eyebrow">{entries.length} 条记录都在</span><h1>以往的日子</h1></header>
      <form className="search-row card" onSubmit={event => { event.preventDefault(); void runSearch(); }}>
        <Icon name="search" size={17}/>
        <input aria-label="搜索记录" placeholder="搜一个词、一个人、一件事" value={query} onChange={event => { setQuery(event.target.value); if (!event.target.value.trim()) setResults(null); }}/>
        <button className="secondary-button" type="submit" disabled={searching || !query.trim()}>{searching ? '搜索中' : '搜索'}</button>
      </form>
      {results && <section className="search-results">
        <div className="section-heading"><h3>找到 {results.length} 条</h3><button className="text-button" onClick={() => setResults(null)}>清除</button></div>
        {results.length ? <div className="entry-list">{results.slice(0, 30).map(entry => <EntryCard key={entry.id} entry={entry} onOpen={openActions}/>)}</div> : <p className="muted">没有找到。换个词试试。</p>}
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

  /* ── 主层：今天、事项、线索、入口 ── */
  const hour = new Date().getHours();
  const showSummary = Boolean(summaryFor(today())) || hour >= 20 || todaysEntries.length >= 5;
  const pendingProfile = profile.filter(item => !item.confirmed).length;
  return <div className="content-column memory-page">
    <header className="page-heading">
      <span className="eyebrow">{dateLabel(today())} · {entries.length} 条记录{streak >= 2 ? ` · 连续 ${streak} 天` : ''}</span>
      <h1>记忆</h1>
      <p>它说的那些话是猜的；这里是你自己说过的。</p>
    </header>

    <div className="entry-chips">
      <button className="entry-chip card" onClick={onOpenProfile}><Icon name="check" size={16}/><span>关于你<b>{profile.filter(item => item.confirmed).length} 条</b></span>{pendingProfile > 0 && <i className="chip-dot">{pendingProfile} 待确认</i>}</button>
      <button className="entry-chip card" onClick={() => setTab('timeline')}><Icon name="search" size={16}/><span>以往的日子<b>时间线</b></span></button>
      {(legacyCount > 0 || legacyDigestCount > 0) && <button className="entry-chip card" onClick={onOpenArchive}><Icon name="more" size={16}/><span>旧数据存档<b>{legacyCount + legacyDigestCount} 条</b></span></button>}
    </div>

    {!!thisDay.length && <section className="this-day card">
      <div className="section-heading"><h3>往年今天</h3><span className="muted">记忆自己走回来</span></div>
      {thisDay.map(({ entry, label }) => <button className="this-day-item" key={entry.id} onClick={() => onOpenDay(dayOf(entry.createdAt))}>
        <time>{label} · {dateLabel(dayOf(entry.createdAt))}</time>
        <p>{entry.content.length > 96 ? `${entry.content.slice(0, 96)}…` : entry.content}</p>
      </button>)}
    </section>}

    {!!activeTasks.length && <section className="task-strip card">
      <div className="section-heading"><h3>还开着的事 · {activeTasks.length}</h3><span className="muted">处理掉一件就少一件</span></div>
      <div className="task-rows">
        {activeTasks.slice(0, 4).map(task => {
          const age = daysAgo(task.createdAt);
          return <div className="task-row" key={task.id}>
            <button className="task-check" aria-label="完成" onClick={() => setStatus(task.id, 'done')}><Icon name="check" size={15}/></button>
            <span className="task-title" title={task.title}>{task.title}</span>
            {age >= 3 && <span className="task-age">{age} 天</span>}
            <button className="text-button" onClick={() => setStatus(task.id, 'dropped')}>放下</button>
            <button className="text-button" onClick={() => setStatus(task.id, 'deferred')}>以后</button>
          </div>;
        })}
      </div>
      {activeTasks.length > 4 && <p className="muted">还有 {activeTasks.length - 4} 件在下面的事项板里。</p>}
    </section>}

    {showSummary && <SummaryCard compact day={today()} summary={summaryFor(today())} entries={entries} entryCount={todaysEntries.length} busy={summaryBusy} error={summaryError} modelReady={modelReady} onGenerate={() => generateSummary(today())} onAddTask={onAddTask}/>}

    <section className="today-flow">
      <div className="section-heading"><h3>今天的记录</h3><span className="muted">{todaysEntries.length} 条</span></div>
      {todaysEntries.length ? <div className="entry-list">
        {todaysEntries.map(entry => <EntryCard key={entry.id} entry={entry} echo={echoes.get(entry.id)} onOpen={openActions} onEchoOpen={onOpenDay}/>)}
      </div> : <div className="empty-state card"><p>今天还没有记录。</p><p className="muted">在首页最上面那条框里写。写下来的东西不会消失，会在合适的时候回来找你。</p></div>}
    </section>

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

    <TaskBoard tasks={tasks} openActions={openActions} setStatus={setStatus} entries={entries}/>
  </div>;
}

/** 完整事项板：四个状态都能改，每条都能回到原文。 */
function TaskBoard({ tasks, setStatus, openActions, entries }: { tasks: Task[]; setStatus: (id: string, status: Task['status']) => void; openActions: (entry: Entry) => void; entries: Entry[] }) {
  const groups: [Task['status'], string][] = [['open', '待处理'], ['deferred', '以后处理'], ['done', '已经完成'], ['dropped', '已经放下']];
  if (!tasks.length) return null;
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
