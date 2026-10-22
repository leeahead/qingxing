'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { DailySummary, Entry, Task } from '@/lib/types';
import type { DayMemory, EntryThread } from '@/lib/threads';
import { dateLabel, dayOf, daysAgo, threadTrendLabels, today } from '@/lib/utils';
import { speechSupported, startDictation } from '@/lib/speech';
import type { Dictation } from '@/lib/speech';
import { EntryCard } from '@/components/EntryCard';
import type { EntryEcho } from '@/components/EntryCard';
import { Icon } from '@/components/Icon';
import { SummaryCard } from '@/components/SummaryCard';

export type NowViewProps = {
  entries: Entry[];
  todaysEntries: Entry[];
  echoes: Map<string, EntryEcho>;
  todayCount: number;
  streak: number;
  draft: string;
  editing: Entry | null;
  ready: boolean;
  setDraft: (value: string) => void;
  setEditing: (value: Entry | null) => void;
  saveEntry: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  setTyping: (value: boolean) => void;
  openActions: (entry: Entry) => void;
  activeTasks: Task[];
  setStatus: (id: string, status: Task['status']) => void;
  todaySummary?: DailySummary;
  summaryBusy: boolean;
  summaryError: string;
  modelReady: boolean;
  generateSummary: (day: string) => void;
  onAddTask: (title: string) => void;
  backupAgeDays: number | null;
  onOpenSettings: () => void;
  onOpenTimeline: () => void;
  onOpenDay: (day: string) => void;
  onAsk: () => void;
  threads: EntryThread[];
  onOpenThread: (topic: string) => void;
  thisDay: DayMemory[];
};

/**
 * 记录页：打开即写，写完立刻有回响。
 * 回响是本地的历史关联，不等 AI；回望卡在今晚才值得出现，白天不催。
 * 语音输入直接用浏览器自带能力，不经过第三方服务；不支持就干脆不显示。
 */
export function NowView(props: NowViewProps) {
  const { entries, todaysEntries, echoes, todayCount, streak, draft, editing, ready, setDraft, setEditing, saveEntry, composerRef, setTyping, openActions, activeTasks, setStatus, todaySummary, summaryBusy, summaryError, modelReady, generateSummary, onAddTask, backupAgeDays, onOpenSettings, onOpenTimeline, onOpenDay, onAsk, threads, onOpenThread, thisDay } = props;
  const hour = new Date().getHours();
  const showSummary = Boolean(todaySummary) || hour >= 20 || todaysEntries.length >= 5;
  const [voiceReady, setVoiceReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const dictationRef = useRef<Dictation | null>(null);
  const voiceBaseRef = useRef('');
  const voiceInterimRef = useRef('');
  const discardVoiceRef = useRef(false);

  useEffect(() => setVoiceReady(speechSupported()), []);
  useEffect(() => () => { discardVoiceRef.current = true; dictationRef.current?.abort(); }, []);

  function toggleDictation() {
    if (listening) { dictationRef.current?.stop(); return; }
    setVoiceError('');
    voiceBaseRef.current = draft.trim() ? `${draft.trimEnd()} ` : '';
    voiceInterimRef.current = '';
    discardVoiceRef.current = false;
    const session = startDictation({
      onTranscript: (text, final) => {
        if (final) {
          voiceBaseRef.current += text;
          voiceInterimRef.current = '';
          setDraft(voiceBaseRef.current);
        } else {
          voiceInterimRef.current = text;
          setDraft(`${voiceBaseRef.current}${text}`);
        }
      },
      onEnd: () => {
        // 手动停止时保留最后一段还没定稿的话；按保存时则不要把它重新写回输入框。
        if (!discardVoiceRef.current && voiceInterimRef.current) setDraft(`${voiceBaseRef.current}${voiceInterimRef.current}`);
        discardVoiceRef.current = false;
        voiceInterimRef.current = '';
        dictationRef.current = null;
        setListening(false);
      },
      onError: message => { setVoiceError(message); dictationRef.current = null; setListening(false); },
    });
    if (session) { dictationRef.current = session; setListening(true); }
    else setVoiceError('这个浏览器不支持语音输入，先手写也可以。');
  }

  function submitEntry() {
    if (!draft.trim() || !ready) return;
    if (listening) {
      discardVoiceRef.current = true;
      dictationRef.current?.stop();
      setListening(false);
    }
    saveEntry();
  }

  return <div className="content-column now-page">
    <header className="page-heading">
      <span className="eyebrow">{dateLabel(today())}{todayCount ? ` · 今天第 ${todayCount} 条` : ''}{streak >= 2 ? ` · 连续 ${streak} 天` : ''}</span>
      <h1>现在想说什么</h1>
    </header>

    {(backupAgeDays === null || backupAgeDays >= 3) && <button className="notice-card card" onClick={onOpenSettings}>
      <Icon name="download" size={17}/>
      <span>{backupAgeDays === null ? '这些记录还没离开过这台设备。做一次备份，换手机也不丢。' : `已经 ${backupAgeDays} 天没有备份了。点一下把记录带出设备。`}</span>
    </button>}

    <form className="composer card" onSubmit={event => { event.preventDefault(); submitEntry(); }}>
      <textarea id="composer" ref={composerRef} rows={3} placeholder="发生了什么、想到什么，直接写下来……" aria-label="记下来" value={draft} onChange={event => setDraft(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); submitEntry(); } }}/>
      <footer>
        <span className="muted">{listening ? '正在听写 · 说到这里就好' : editing ? '正在修改一条记录' : <>只存在这台设备上<span className="keyboard-hint"> · Ctrl+Enter 保存</span></>}</span>
        <div className="button-row">
          {voiceReady && <button type="button" className={`mic-button${listening ? ' listening' : ''}`} aria-label={listening ? '停止语音输入' : '用语音记录'} aria-pressed={listening} onClick={toggleDictation}><Icon name={listening ? 'stop' : 'mic'} size={17}/><span>{listening ? '停止' : '语音'}</span></button>}
          {editing && <button type="button" className="quiet-button" onClick={() => { setEditing(null); setDraft(''); }}>取消修改</button>}
          <button className="primary-button" type="submit" disabled={!draft.trim() || !ready}>{editing ? '保存修改' : '记下来'}</button>
        </div>
      </footer>
      {listening && <p className="voice-hint">说完点“停止”，或者直接点“记下来”。识别结果只写入这台设备。</p>}
      {voiceError && <p className="voice-hint error">{voiceError}</p>}
    </form>

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
      {activeTasks.length > 4 && <p className="muted">还有 {activeTasks.length - 4} 件在「回看 · 事项」里。</p>}
    </section>}

    {showSummary && <SummaryCard compact day={today()} summary={todaySummary} entries={entries} entryCount={todaysEntries.length} busy={summaryBusy} error={summaryError} modelReady={modelReady} onGenerate={() => generateSummary(today())} onAddTask={onAddTask}/>}

    <section className="today-flow">
      <div className="section-heading"><h3>今天的记录</h3><span className="muted">{todaysEntries.length} 条</span></div>
      {todaysEntries.length ? <div className="entry-list">
        {todaysEntries.map(entry => <EntryCard key={entry.id} entry={entry} echo={echoes.get(entry.id)} onOpen={openActions} onEchoOpen={onOpenDay}/>)}
      </div> : <div className="empty-state card"><p>今天还没有记录。</p><p className="muted">一条也够。写下来的东西不会消失，会在合适的时候回来找你。</p></div>}
    </section>

    {!!threads.length && <section className="thread-strip-section">
      <div className="section-heading"><h3>记忆里的线索</h3><span className="muted">同一条线，已经在不同日子出现</span></div>
      <div className="thread-strip">
        {threads.slice(0, 6).map(thread => <button className="thread-pill card" key={thread.id} onClick={() => onOpenThread(thread.topic)}>
          <b>{thread.topic}</b>
          <span>{thread.count} 条 · {thread.days.length} 天 · {threadTrendLabels[thread.trend]}</span>
        </button>)}
      </div>
    </section>}

    <div className="quick-row">
      <button className="quick-card card" onClick={onOpenTimeline}><Icon name="calendar" size={19}/><span>回看以往<small>日历、热力图与搜索</small></span></button>
      <button className="quick-card card" onClick={onAsk}><Icon name="chat" size={19}/><span>问问记忆<small>从记录里找线索</small></span></button>
    </div>
  </div>;
}
