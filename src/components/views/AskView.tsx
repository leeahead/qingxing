'use client';

import type { RefObject } from 'react';
import type { ChatScope, Entry, Message } from '@/lib/types';
import type { EntryThread } from '@/lib/threads';
import { dateLabel, dayOf, timeOf } from '@/lib/utils';
import { Icon } from '@/components/Icon';

export type AskViewProps = {
  messages: Message[];
  chatInput: string;
  setChatInput: (value: string) => void;
  chatScope: ChatScope;
  setChatScope: (scope: ChatScope) => void;
  busy: boolean;
  ask: () => void;
  modelReady: boolean;
  setTyping: (value: boolean) => void;
  chatEndRef: RefObject<HTMLDivElement | null>;
  onOpenDay: (day: string) => void;
  /** 本地算出的反复话题，用作提问入口 */
  threads: EntryThread[];
};

/** 提问页：顾问模式。先引用原话，再区分事实、推断与建议。 */
export function AskView(props: AskViewProps) {
  const { messages, chatInput, setChatInput, chatScope, setChatScope, busy, ask, modelReady, setTyping, chatEndRef, onOpenDay, threads } = props;
  return <div className="content-column chat-page">
    <header className="page-heading">
      <span className="eyebrow">从自己的记录里，找一点线索</span>
      <h1>问问记忆</h1>
    </header>
    <div className="scope-switch" role="group" aria-label="选择回答依据">
      <button className={chatScope === 'all' ? 'active' : ''} onClick={() => setChatScope('all')}>记录 + 观察</button>
      <button className={chatScope === 'entries' ? 'active' : ''} onClick={() => setChatScope('entries')}>只看原始记录</button>
      <button className={chatScope === 'judgments' ? 'active' : ''} onClick={() => setChatScope('judgments')}>只看观察</button>
    </div>
    {!!threads.length && <section className="thread-asks">
      <span className="eyebrow">沿着一条线问</span>
      <div className="chip-row">{threads.slice(0, 5).map(thread => <button className="chip" key={thread.id} onClick={() => setChatInput(`关于「${thread.topic}」，我最近都在说什么？`)}>{thread.topic} · {thread.count} 条</button>)}</div>
    </section>}
    <div className="chat-messages" aria-live="polite">
      {!messages.length && <div className="chat-welcome card">
        <span className="welcome-icon"><Icon name="chat" size={29}/></span>
        <h2>那些没想完的，可以接着想</h2>
        <p>你不必从头解释自己。</p>
        {['关于工作，我以前怎么说？', '最近反复出现的事情是什么？', '帮我回看与家人有关的记录。'].map(text => <button key={text} onClick={() => setChatInput(text)}>{text}<Icon name="next" size={16}/></button>)}
      </div>}
      {messages.map((message, index) => <article className={`message card ${message.role}`} key={index}>
        <span className="eyebrow">{message.role === 'user' ? '你' : '清醒'}</span>
        <p>{message.content}</p>
        {!!message.sources?.length && <details>
          <summary>本次参考的 {message.sources.length} 条原文</summary>
          {message.sources.map(entry => <blockquote key={entry.id}><button className="quote-link" onClick={() => onOpenDay(dayOf(entry.createdAt))}><time>{dateLabel(dayOf(entry.createdAt))} · {timeOf(entry.createdAt)}</time></button>{entry.content}</blockquote>)}
        </details>}
      </article>)}
      {busy && <p className="loading-note">正在阅读相关记录并组织回答……</p>}
      <div ref={chatEndRef}/>
    </div>
    <form className="chat-composer card" onSubmit={event => { event.preventDefault(); ask(); }}>
      <textarea rows={2} aria-label="向记忆提问" placeholder="想从哪一件事说起？" value={chatInput} onChange={event => setChatInput(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}/>
      <footer>
        <span className="muted">{modelReady ? (chatScope === 'judgments' ? '仅使用阶段性观察' : chatScope === 'entries' ? '仅使用原始记录' : '原始记录 + 观察') : '本地检索模式 · 未连接模型'}</span>
        <button className="primary-button" type="submit" disabled={!chatInput.trim() || busy}><Icon name="send" size={17}/>提问</button>
      </footer>
    </form>
  </div>;
}
