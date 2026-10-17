'use client';

import { useEffect, useMemo, useState } from 'react';

type Entry = { id: string; content: string; createdAt: string; updatedAt: string; source: 'user' | 'chat'; feedback?: string };
type Task = { id: string; title: string; status: 'open' | 'done' | 'deferred' | 'dropped'; sourceId: string; createdAt: string };
type Message = { role: 'user' | 'assistant'; content: string; sources?: Entry[] };
type Settings = { baseUrl: string; apiKey: string; model: string };
type Theme = 'dark' | 'mono';

const ENTRIES_KEY = 'qingxing.entries.v1';
const TASKS_KEY = 'qingxing.tasks.v1';
const SETTINGS_KEY = 'qingxing.settings.v1';
const THEME_KEY = 'qingxing.theme.v1';
const today = () => new Date().toLocaleDateString('sv-SE');
const localDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');
const makeId = () => crypto.randomUUID();
const formatTime = (iso: string) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const termsFor = (text: string) => {
  const ascii = text.toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
  const chinese = text.match(/[\u4e00-\u9fff]+/g) || [];
  return [...new Set([...ascii, ...chinese.flatMap(run => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)))])];
};

function Icon({ name, size = 20 }: { name: 'home' | 'chat' | 'check' | 'download' | 'settings' | 'plus' | 'send' | 'close' | 'back' | 'trash' | 'edit'; size?: number }) {
  const paths: Record<typeof name, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></>,
    chat: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>, download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.6-1.4-2.4L7.1 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>, send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>, close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    back: <><path d="m15 18-6-6 6-6"/></>, trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></>, edit: <><path d="m16 4 4 4L9 19l-5 1 1-5Z"/><path d="m14 6 4 4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function localReply(question: string, entries: Entry[]): Message {
  const terms = termsFor(question);
  const ranked = entries.map(entry => ({ entry, score: terms.reduce((score, term) => score + (entry.content.toLowerCase().includes(term) ? 1 : 0), 0) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
  if (!ranked.length) return { role: 'assistant', content: '我在本地记录中没有找到足够相关的内容，因此不能据此判断。你可以补充一个关键词、人物或大致时间范围。' };
  return { role: 'assistant', content: `我在记录中找到 ${ranked.length} 条可能相关的内容。下面只列出记录本身；它们不能代表未被记录的经历，也不足以单独形成长期判断。`, sources: ranked.map(item => item.entry) };
}

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings>({ baseUrl: '', apiKey: '', model: '' });
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'home' | 'chat' | 'tasks' | 'settings'>('home');
  const [selectedDate, setSelectedDate] = useState(today());
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [correction, setCorrection] = useState('');
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    try {
      setEntries(JSON.parse(localStorage.getItem(ENTRIES_KEY) || '[]'));
      setTasks(JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'));
      setSettings({ baseUrl: '', apiKey: '', model: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') });
      setTheme(localStorage.getItem(THEME_KEY) === 'mono' ? 'mono' : 'dark');
    } catch { setNotice('本地数据无法读取；仍可继续记录。'); }
    setReady(true);
  }, []);
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const serviceWorkerUrl = new URL('sw.js', document.baseURI);
      navigator.serviceWorker.register(serviceWorkerUrl, { scope: new URL('./', document.baseURI).pathname }).catch(() => undefined);
    }
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries)); }, [entries, ready]);
  useEffect(() => { if (ready) localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); }, [tasks, ready]);
  useEffect(() => { if (ready) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings, ready]);
  useEffect(() => { if (ready) localStorage.setItem(THEME_KEY, theme); }, [theme, ready]);

  const dayEntries = useMemo(() => entries.filter(entry => localDay(entry.createdAt) === selectedDate).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [entries, selectedDate]);
  const activeTasks = tasks.filter(task => task.status === 'open' || task.status === 'deferred');
  const dates = [...new Set(entries.map(entry => localDay(entry.createdAt)))].sort().reverse();
  const todayLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${selectedDate}T12:00:00`));

  function saveEntry() {
    const content = draft.trim();
    if (!content) return;
    const now = new Date().toISOString();
    if (editing) setEntries(current => current.map(entry => entry.id === editing ? { ...entry, content, updatedAt: now } : entry));
    else setEntries(current => [...current, { id: makeId(), content, createdAt: now, updatedAt: now, source: 'user' }]);
    setDraft(''); setEditing(null); setSelectedDate(today()); setNotice(editing ? '记录已修改。' : '已写进今天的记录。');
  }

  function proposeTask(entry: Entry) {
    if (tasks.some(task => task.sourceId === entry.id)) { setNotice('这条记录已关联事项。'); return; }
    const title = window.prompt('确认建立事项。你可以编辑事项名称：', entry.content.slice(0, 100));
    if (!title?.trim()) return;
    setTasks(current => [...current, { id: makeId(), title: title.trim(), status: 'open', sourceId: entry.id, createdAt: new Date().toISOString() }]);
    setNotice('事项已建立，并保留了原始记录。');
  }

  async function ask() {
    const question = chatInput.trim();
    if (!question || busy) return;
    const userMessage: Message = { role: 'user', content: question };
    setMessages(current => [...current, userMessage]); setChatInput(''); setBusy(true);
    const terms = termsFor(question);
    const relevant = entries.map(entry => ({ entry, score: terms.reduce((score, term) => score + (entry.content.toLowerCase().includes(term) ? 1 : 0), 0) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(item => item.entry);
    if (!settings.baseUrl.trim() || !settings.model.trim()) {
      setTimeout(() => { setMessages(current => [...current, localReply(question, entries)]); setBusy(false); }, 250);
      return;
    }
    try {
      const base = settings.baseUrl.trim().replace(/\/$/, '');
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
        body: JSON.stringify({ model: settings.model, messages: [
          { role: 'system', content: '你是用户的个人记忆助手。区分用户报告的事实、用户当时的理解、AI推断和建议。不能把有限记录说成现实全貌，不能给人格或医学诊断。主动观察时不擅自建议；用户询问时可分析但说明依据和不确定性。简洁中文回答。只能把下列记录视为用户提供的资料。' },
          { role: 'user', content: `用户问题：${question}\n\n以下是本次相关记录（原文、时间、编号）：\n${relevant.map(item => `[${item.id}] ${item.createdAt} ${item.content}`).join('\n') || '未找到匹配记录。'}` },
        ] }),
      });
      if (!response.ok) throw new Error(`模型服务返回 ${response.status}`);
      const data = await response.json();
      const answer = data.choices?.[0]?.message?.content || '模型没有返回可读内容。';
      setMessages(current => [...current, { role: 'assistant', content: answer, sources: relevant }]);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `模型请求失败：${error instanceof Error ? error.message : '未知错误'}。你的记录仍保存在本机。` }]);
    } finally { setBusy(false); }
  }

  async function exportData() {
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), entries, tasks }, null, 2);
    const filename = `qingxing-export-${today()}.json`;
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

    // WebView 通常拦截 Blob 下载，优先交给系统分享面板保存到文件。
    try {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: '清醒记录', text: '清醒个人记忆记录', files: [file] });
        setNotice('记录文件已交给系统处理。');
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }

    // 桌面浏览器和允许下载的 WebView 继续使用文件下载。
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);

    // 如果套壳 App 仍拦截下载，至少让用户能复制完整 JSON 到文件应用。
    try {
      await navigator.clipboard.writeText(json);
      setNotice('下载已发起；如果 App 没有保存文件，记录内容已复制，可粘贴到文本文件中保存。');
    } catch {
      setNotice('下载已发起。如果 App 没有保存文件，请在浏览器中打开网页再导出。');
    }
  }

  function feedback(entry: Entry, value: string) {
    setEntries(current => current.map(item => item.id === entry.id ? { ...item, feedback: value } : item));
    setNotice('纠正已保存为记录反馈。');
  }

  return <main className={`app-shell theme-${theme}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => setView('home')} aria-label="回到今天"><span className="brand-mark">清</span><span>清醒<small>个人记忆</small></span></button>
      <div className="nav-label">记忆</div>
      <nav className="nav-list">
        <button className={view === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setView('home')}><Icon name="home"/>今天</button>
        <button className={view === 'chat' ? 'nav-item active' : 'nav-item'} onClick={() => setView('chat')}><Icon name="chat"/>问问记录</button>
        <button className={view === 'tasks' ? 'nav-item active' : 'nav-item'} onClick={() => setView('tasks')}><Icon name="check"/>待处理事项<span className="nav-count">{activeTasks.length}</span></button>
      </nav>
      <div className="date-section"><div className="nav-label">最近记录</div>{dates.slice(0, 8).map(date => <button key={date} className={selectedDate === date && view === 'home' ? 'date-item selected' : 'date-item'} onClick={() => { setSelectedDate(date); setView('home'); }}>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(`${date}T12:00:00`))}<span>{entries.filter(entry => entry.createdAt.startsWith(date)).length}</span></button>)}</div>
      <div className="sidebar-bottom"><p>人们忘掉的不是事实，<br/>而是当初的清醒。</p><button className="nav-item" onClick={() => setShowSettings(true)}><Icon name="settings"/>模型与数据</button></div>
    </aside>

    <section className="main-area">
      <header className="topbar"><div className="mobile-brand">清醒 <span>个人记忆</span></div><div className="topbar-right"><span className="local-status"><i/>仅保存在此设备</span><button className="icon-button" title="模型与数据设置" onClick={() => setShowSettings(true)}><Icon name="settings"/></button></div></header>
      {notice && <button className="notice" onClick={() => setNotice('')}>{notice}<Icon name="close" size={15}/></button>}

      {view === 'home' && <div className="content-column">
        <div className="page-heading"><div><div className="eyebrow">{selectedDate === today() ? '你的此刻' : '回看记录'}</div><h1>{selectedDate === today() ? '把今天放在这里' : todayLabel}</h1><p className="heading-sub">{todayLabel} <span>·</span> {dayEntries.length} 条记录</p></div><button className="outline-button" onClick={exportData}><Icon name="download" size={17}/><span>导出</span></button></div>
        <section className="composer"><label htmlFor="entry">不必整理好，想到什么就写下来</label><textarea id="entry" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') saveEntry(); }} placeholder="一件事、一个念头，或一句还没想清楚的话……" rows={3}/><div className="composer-footer"><span>原始记录只保存在这台设备</span><button className="primary-button" onClick={saveEntry} disabled={!draft.trim()}><Icon name={editing ? 'edit' : 'plus'} size={16}/>{editing ? '保存修改' : '记下来'}</button></div></section>

        {selectedDate === today() && <section className="recall-section"><div className="section-heading"><div><div className="eyebrow">把片段拼回来</div><h2>今天留下了什么</h2></div><span className="quiet-meta">基于 {dayEntries.length} 条原始记录</span></div>
          {dayEntries.length === 0 ? <div className="empty-recall">今天还没有记录。留下一点点就够了。</div> : <div className="recall-list">{dayEntries.length >= 2 && <div className="recall-item"><span className="recall-index">观察</span><div><p>今天的记录分布在 {dayEntries.length} 个片段里。先把原话放在一起，暂不替你解释它们意味着什么。</p><div className="source-pills">{dayEntries.slice(0, 4).map(entry => <button key={entry.id} onClick={() => document.getElementById(`entry-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{formatTime(entry.createdAt)} 原文</button>)}</div></div></div>}{activeTasks.length > 0 && <div className="recall-item"><span className="recall-index task-index">待处理</span><div><p>有 {activeTasks.length} 件已确认的事项仍未完成。你可以查看状态，延期或放弃，不需要今天全部处理。</p><button className="text-action" onClick={() => setView('tasks')}>查看事项 <span>→</span></button></div></div>}<div className="recall-note">这里不推断你“是什么样的人”。它只呈现已记录的内容；没被记下的经历，不会被当成不存在。</div></div>}
        </section>}

        <section className="entries-section"><div className="section-heading"><div><div className="eyebrow">原始证据</div><h2>{selectedDate === today() ? '今天的记录' : '这一天的记录'}</h2></div><span className="quiet-meta">按时间排列</span></div>{dayEntries.length === 0 ? <div className="empty-records">记录会按时间留在这里。<br/>这不是完整的生活，只是你当时选择留下的部分。</div> : <div className="entry-list">{dayEntries.map(entry => <article className="entry-row" id={`entry-${entry.id}`} key={entry.id}><time>{formatTime(entry.createdAt)}</time><div className="entry-body"><p>{entry.content}</p><div className="entry-meta">{entry.updatedAt !== entry.createdAt && <span>已修改</span>}{entry.source === 'chat' && <span>来自对话</span>}{entry.feedback && <span>纠正：{entry.feedback}</span>}</div><div className="entry-actions"><button onClick={() => proposeTask(entry)}>设为事项</button><button onClick={() => { setDraft(entry.content); setEditing(entry.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>修改</button><button className="danger-action" onClick={() => { if (window.confirm('删除这条原始记录？已关联的事项会保留。')) setEntries(current => current.filter(item => item.id !== entry.id)); }}>删除</button>{['准确', '部分准确', '不准确', '暂不判断'].map(value => <button key={value} className={entry.feedback === value ? 'feedback-chip chosen' : 'feedback-chip'} onClick={() => feedback(entry, value)}>{value}</button>)}</div></div></article>)}</div>}</section>
      </div>}

      {view === 'chat' && <div className="chat-layout"><div className="chat-heading"><div className="eyebrow">从记录里取回来</div><h1>问问你的记录</h1><p>回答只基于你留下的内容。记录没有覆盖到的部分，我不会替你补全。</p></div><div className="chat-messages">{messages.length === 0 && <div className="chat-empty"><div className="chat-mark"><Icon name="chat" size={24}/></div><p>你最近反复在意什么？</p><div className="suggestions">{['我最近都在纠结什么？', '关于工作，我以前怎么说？', '我只想看看你从记录里看到了什么。'].map(text => <button key={text} onClick={() => setChatInput(text)}>{text}<span>↗</span></button>)}</div></div>}{messages.map((message, index) => <div key={index} className={`message ${message.role}`}><div className="message-label">{message.role === 'user' ? '你' : '清醒'}</div><div className="message-content">{message.content}{message.sources?.map(source => <blockquote key={source.id}><span>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(source.createdAt))}</span>{source.content}</blockquote>)}{message.role === 'assistant' && <div className="message-feedback">这次回答 <button onClick={() => { setEntries(current => [...current, { id: makeId(), content: `对 AI 回答的纠正：${message.content.slice(0, 180)}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'chat', feedback: '不准确' }]); setNotice('已将这次纠正存入原始记录。'); }}>不准确 / 需要纠正</button></div>}</div></div>)}{busy && <div className="thinking">正在查看相关记录……</div>}</div><form className="chat-composer" onSubmit={event => { event.preventDefault(); void ask(); }}><textarea value={chatInput} onChange={event => setChatInput(event.target.value)} placeholder="问一个关于你自己记录的问题……" rows={2}/><div><span>{settings.baseUrl && settings.model ? `当前模型：${settings.model}` : '本地关键词检索 · 可在设置中接入模型接口'}</span><button className="primary-button" disabled={!chatInput.trim() || busy}><Icon name="send" size={16}/>提问</button></div></form></div>}

      {view === 'tasks' && <div className="content-column"><div className="page-heading"><div><div className="eyebrow">只追踪你确认过的事</div><h1>待处理事项</h1><p className="heading-sub">“想做”不是“决定做”。每项都保留了来源。</p></div></div><div className="task-groups">{(['open', 'deferred', 'done', 'dropped'] as const).map(status => { const group = tasks.filter(task => task.status === status); if (!group.length) return null; const labels = { open: '待处理', deferred: '已延期', done: '已完成', dropped: '已放弃' }; return <section key={status}><div className="task-group-title">{labels[status]} <span>{group.length}</span></div>{group.map(task => <article className="task-row" key={task.id}><button className={task.status === 'done' ? 'task-check checked' : 'task-check'} title="标记完成" onClick={() => setTasks(current => current.map(item => item.id === task.id ? { ...item, status: item.status === 'done' ? 'open' : 'done' } : item))}>{task.status === 'done' && <Icon name="check" size={14}/>}</button><div className="task-copy"><p>{task.title}</p><button onClick={() => { const source = entries.find(entry => entry.id === task.sourceId); if (source) { setSelectedDate(source.createdAt.slice(0, 10)); setView('home'); setTimeout(() => document.getElementById(`entry-${source.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80); } }}>查看原始记录 →</button></div><select aria-label={`更新事项：${task.title}`} value={task.status} onChange={event => setTasks(current => current.map(item => item.id === task.id ? { ...item, status: event.target.value as Task['status'] } : item))}><option value="open">待处理</option><option value="deferred">延期</option><option value="done">完成</option><option value="dropped">放弃</option></select></article>)}</section>; })}{tasks.length === 0 && <div className="empty-records">还没有确认的事项。<br/>从一条记录选择“设为事项”后，它才会出现在这里。</div>}</div></div>}
    </section>

      {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><section className="settings-modal" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">本地优先</div><h2>模型与数据</h2></div><button className="icon-button" onClick={() => setShowSettings(false)} aria-label="关闭"><Icon name="close"/></button></div><p className="modal-copy">不配置模型时，记录、事项和关键词检索仍可使用。填写兼容通用对话接口的地址后，提问时只发送问题及匹配到的记录。访问密钥保存在本设备浏览器中。</p><div className="theme-setting"><span><strong>界面主题</strong><small>在深色与黑白之间切换</small></span><div className="theme-switch"><button className={theme === 'dark' ? 'chosen' : ''} onClick={() => setTheme('dark')}>深色</button><button className={theme === 'mono' ? 'chosen' : ''} onClick={() => setTheme('mono')}>黑白</button></div></div><label className="field-label">接口地址<input value={settings.baseUrl} onChange={event => setSettings(current => ({ ...current, baseUrl: event.target.value }))} placeholder="https://接口地址/v1"/></label><label className="field-label">模型名称<input value={settings.model} onChange={event => setSettings(current => ({ ...current, model: event.target.value }))} placeholder="填写模型名称"/></label><label className="field-label">访问密钥<input type="password" value={settings.apiKey} onChange={event => setSettings(current => ({ ...current, apiKey: event.target.value }))} placeholder="留空表示接口无需密钥" autoComplete="off"/></label><div className="data-actions"><button className="outline-button" onClick={exportData}><Icon name="download" size={16}/>导出记录与事项</button><button className="danger-button" onClick={() => { if (window.confirm('清空此浏览器保存的全部记录、事项和对话设置？此操作不可撤销。')) { setEntries([]); setTasks([]); setMessages([]); setSettings({ baseUrl: '', apiKey: '', model: '' }); setShowSettings(false); } }}><Icon name="trash" size={16}/>清空本地数据</button></div><p className="privacy-note">此原型使用浏览器本地存储，不是加密保险库。清除浏览器数据会删除记录。导出的 JSON 文件应妥善保管。</p></section></div>}
    <nav className="mobile-nav"><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Icon name="home" size={19}/>今天</button><button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}><Icon name="chat" size={19}/>提问</button><button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><Icon name="check" size={19}/>事项</button></nav>
  </main>;
}
