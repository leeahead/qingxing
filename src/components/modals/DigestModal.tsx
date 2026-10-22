'use client';

import { useState } from 'react';
import type { MemoryDigest } from '@/lib/types';
import { dateLabel, shortDate } from '@/lib/utils';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';

export type DigestModalProps = {
  digests: MemoryDigest[];
  digestCount: number;
  nextBatchCount: number;
  nextBatchStart?: string;
  nextBatchEntries: number;
  freshness: Map<string, string>;
  busy: boolean;
  progress: string;
  error: string;
  modelReady: boolean;
  onUpdate: () => void;
  onRedigest: (start: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
};

/** 长期记忆：按周沉淀、单周重做、删除。原始记录始终完整保留在本机。 */
export function DigestModal(props: DigestModalProps) {
  const { digests, nextBatchCount, nextBatchStart, nextBatchEntries, freshness, busy, progress, error, modelReady, onUpdate, onRedigest, onRemove, onClose } = props;
  const [redigestPending, setRedigestPending] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState<string | null>(null);
  const sorted = [...digests].sort((a, b) => b.start.localeCompare(a.start));
  return <Modal title="长期记忆" onClose={onClose}>
    <p className="modal-intro">把更早的记录每周沉淀成一段简短记忆。AI 观察时只带这些记忆和最近 30 天原文，不会每次重读全部历史。</p>
    <div className="digest-stats">
      <span>{digests.length} 段记忆</span>
      <span>{sorted.length ? `${shortDate(sorted[sorted.length - 1].start)} 至 ${shortDate(sorted[0].end)}` : '暂无覆盖'}</span>
    </div>
    <div className="digest-actions">
      <button className="primary-button" disabled={busy || !modelReady || !nextBatchCount} onClick={onUpdate}>{busy ? '正在沉淀……' : nextBatchCount ? `沉淀接下来 ${nextBatchCount} 周` : '已经沉淀完'}</button>
      {nextBatchCount > 0 && <span className="muted">共 {nextBatchEntries} 条记录{nextBatchStart ? ` · ${shortDate(nextBatchStart)} 起` : ''}</span>}
    </div>
    {progress && <p className="loading-note">{progress}</p>}
    {!modelReady && <p className="muted">先在“偏好与数据”里连接模型。</p>}
    {error && <p className="form-error">{error}</p>}
    <div className="digest-list">
      {sorted.length ? sorted.map(item => {
        const stale = freshness.get(item.id);
        // 模型经常自带「下周留意：」前缀，统一去掉，避免和界面标签重复。
        const watch = item.watch?.replace(/^下周(值得)?留意[:：]?\s*|^值得留意[:：]?\s*/, '').trim();
        return <article className="digest-item" key={item.id}>
          <header><time>{shortDate(item.start)}–{shortDate(item.end)}</time><span>{item.entryCount} 条</span></header>
          {item.title && <h4 className="digest-title">{item.title}</h4>}
          <p>{item.summary}</p>
          {!!item.themes.length && <div className="chip-row">{item.themes.map(theme => <span className="chip" key={theme}>{theme}</span>)}</div>}
          {watch && <p className="digest-watch"><Icon name="spark" size={13}/><span><b>下周留意：</b>{watch}</span></p>}
          <details><summary>变化、矛盾与证据</summary>
            {item.changes && <p><b>变化：</b>{item.changes}</p>}
            {item.contradictions && <p><b>矛盾：</b>{item.contradictions}</p>}
            {item.evidence.map(evidence => <blockquote key={evidence.id}><time>{dateLabel(evidence.date)}</time>{evidence.text}</blockquote>)}
            <p className="muted">生成于 {new Date(item.generatedAt).toLocaleString('zh-CN')} · {item.model}</p>
          </details>
          {stale && <p className="digest-stale"><Icon name="spark" size={13}/>{stale}</p>}
          {redigestPending === item.id ? <div className="digest-confirm">
            <p>会用这一周现在的原文重新沉淀，并替换这段记忆。</p>
            <div className="button-row"><button className="primary-button" disabled={busy} onClick={() => { onRedigest(item.start); setRedigestPending(null); }}>{busy ? '正在沉淀……' : '确认重新沉淀'}</button><button className="quiet-button" onClick={() => setRedigestPending(null)}>取消</button></div>
          </div> : removePending === item.id ? <div className="digest-confirm">
            <p>只删除这段周记忆，原始记录不动。这一周之后会重新出现在“待沉淀”里。</p>
            <div className="button-row"><button className="danger-button" onClick={() => { onRemove(item.id); setRemovePending(null); }}>确认删除这段记忆</button><button className="quiet-button" onClick={() => setRemovePending(null)}>取消</button></div>
          </div> : <div className="digest-item-actions">
            <button className="text-button" disabled={busy || !modelReady} onClick={() => { setRedigestPending(item.id); setRemovePending(null); }}>{stale ? '重新沉淀' : '重做这一周'}</button>
            <button className="text-button" disabled={busy} onClick={() => { setRemovePending(item.id); setRedigestPending(null); }}>删除这段</button>
          </div>}
        </article>;
      }) : <div className="empty-state"><p>还没有长期记忆。每次沉淀一周，几周后就能覆盖到更早的记录。</p></div>}
    </div>
  </Modal>;
}
