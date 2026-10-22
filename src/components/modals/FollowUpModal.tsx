'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Insight, Message } from '@/lib/types';
import { timeOf } from '@/lib/utils';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';

export type FollowUpModalProps = {
  insight: Insight;
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  modelReady: boolean;
  /** 这个月还剩几次「临时读原文」的机会（每月 20 次，用完就只能凭画像说） */
  rawReadsLeft: number;
  onSend: (question: string) => void;
  onDisagree: () => void;
  endRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
};

/**
 * 追问面板：临时对话，聊完就回到洞察流。
 * 对话内容不写进记忆——它是对话，不是用户说过的话。
 */
export function FollowUpModal(props: FollowUpModalProps) {
  const { insight, messages, input, setInput, busy, modelReady, rawReadsLeft, onSend, onDisagree, endRef, onClose } = props;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, busy, endRef]);

  return <Modal title="追问一下" onClose={onClose}>
    <p className="insight-echo">「{insight.content}」</p>
    <div className="chat-messages followup-messages" aria-live="polite">
      {!messages.length && <div className="followup-hint">
        <p>你可以问它「你为什么这么觉得」，也可以直接说「不对」。</p>
        <p className="muted">它不会补一条证据链给你。{rawReadsLeft > 0 ? `这个月它还可以临时翻原文 ${rawReadsLeft} 次。` : '这个月翻原文的次数用完了，它只能凭印象说。'}</p>
        <div className="button-row">
          <button className="quiet-button" onClick={() => onSend('你为什么这么觉得？')}>为什么这么觉得</button>
          <button className="quiet-button" onClick={() => onSend('那你觉得我该怎么办？')}>那怎么办</button>
          <button className="danger-button" onClick={onDisagree}>我不这么认为</button>
        </div>
      </div>}
      {messages.map((message, index) => <article className={`message card ${message.role}`} key={index}>
        <span className="eyebrow">{message.role === 'user' ? '你' : '清醒'}</span>
        <p>{message.content}</p>
      </article>)}
      {busy && <p className="loading-note">它在想怎么说……</p>}
      <div ref={endRef}/>
    </div>
    <form className="chat-composer followup-composer" onSubmit={event => { event.preventDefault(); const value = input.trim(); if (!value || busy) return; setInput(''); onSend(value); }}>
      <textarea ref={inputRef} rows={2} aria-label="追问" placeholder={modelReady ? '接着说一句……' : '还没连接模型，暂时不能追问'} value={input} disabled={!modelReady} onChange={event => setInput(event.target.value)}/>
      <footer>
        <span className="muted">聊完关掉就好，这些对话不进你的记忆</span>
        <button className="primary-button" type="submit" disabled={!input.trim() || busy || !modelReady}><Icon name="send" size={16}/>说</button>
      </footer>
    </form>
    <p className="muted followup-time">这条洞察来自 {new Date(insight.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' })} {timeOf(insight.createdAt)}</p>
  </Modal>;
}
