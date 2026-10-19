'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * 通用弹窗：锁定背景滚动、Esc 关闭、关闭后把焦点还给打开它的元素。
 * onClose 用 ref 保存，避免调用方每次渲染都重建 keydown 监听。
 */
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const active = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', handler);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', handler); active?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><header className="modal-head"><h2>{title}</h2><button ref={closeRef} className="icon-button" aria-label="关闭" onClick={onClose}><Icon name="close"/></button></header>{children}</section></div>;
}
