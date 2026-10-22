'use client';

import { useEffect, useRef } from 'react';
import type { Entry } from '@/lib/types';
import { dateLabel, dayOf, timeOf } from '@/lib/utils';
import { Icon } from './Icon';

export type EntryEcho = { entry: Entry; overlap: number; thread?: string };

/**
 * 一条记录卡片：默认只显示正文，操作收进“更多”。
 * 手机端长按 550ms 或右键也能打开操作面板；指针一移动就取消，避免滑动时误触。
 * echo 是本地算出的历史关联（「那天你也说过」），不经过 AI、不花 token。
 */
export function EntryCard({ entry, echo, onOpen, onEchoOpen }: { entry: Entry; echo?: EntryEcho | null; onOpen: (entry: Entry) => void; onEchoOpen?: (day: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  useEffect(() => () => cancel(), []);
  return <article className="entry-card" onPointerDown={event => { if (event.pointerType !== 'mouse') timer.current = setTimeout(() => onOpen(entry), 550); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerMove={cancel} onContextMenu={event => { event.preventDefault(); onOpen(entry); }}>
    <header><time>{timeOf(entry.createdAt)}</time><span>{entry.updatedAt !== entry.createdAt ? '已编辑' : '原始记录'}</span><button className="icon-button" aria-label={`记录操作：${entry.content.slice(0, 12)}`} onClick={() => onOpen(entry)}><Icon name="more" size={19}/></button></header>
    <p>{entry.content}</p>
    {echo && <button className="entry-echo" onClick={() => onEchoOpen?.(dayOf(echo.entry.createdAt))}>
      <Icon name="spark" size={13}/>
      <span>{echo.thread && <b className="echo-thread">「{echo.thread}」</b>}{dateLabel(dayOf(echo.entry.createdAt))} 你也说过：<i>{echo.entry.content.length > 42 ? `${echo.entry.content.slice(0, 42)}…` : echo.entry.content}</i></span>
    </button>}
  </article>;
}
