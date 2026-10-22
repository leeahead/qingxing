'use client';

import { useState } from 'react';
import type { Judgment, MemoryDigest } from '@/lib/types';
import { dateLabel, dayOf, judgmentStatusLabels, shortDate } from '@/lib/utils';
import { Modal } from '@/components/Modal';

export type ArchiveModalProps = {
  judgments: Judgment[];
  digests: MemoryDigest[];
  onExport: () => void;
  onRemoveJudgment: (id: string) => void;
  onRemoveDigest: (id: string) => void;
  onClose: () => void;
};

/**
 * 旧数据存档。
 * 洞察流不再展示「可追溯的观察」与「按周沉淀的记忆」，但它们是你攒下来的东西：
 * 数据完整留在本机，可以在这里看、单独导出一份，或者确认不要了再删。
 */
export function ArchiveModal(props: ArchiveModalProps) {
  const { judgments, digests, onExport, onRemoveJudgment, onRemoveDigest, onClose } = props;
  const [tab, setTab] = useState<'judgments' | 'digests'>('judgments');
  const sortedJudgments = [...judgments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sortedDigests = [...digests].sort((a, b) => b.start.localeCompare(a.start));
  const empty = !judgments.length && !digests.length;

  return <Modal title="旧数据存档" onClose={onClose}>
    <p className="modal-intro">v6.0 起，AI 不再把话挂回原文，也不再按周沉淀。这一页只放旧版本留下的东西——它们没有消失，只是不再出现在你眼前。</p>
    {empty ? <div className="empty-state card"><p>这台设备上还没有旧数据。</p></div> : <>
      <div className="filter-row" role="group" aria-label="选择要看哪一类">
        <button className={`filter-chip${tab === 'judgments' ? ' active' : ''}`} onClick={() => setTab('judgments')}>旧观察 · {judgments.length}</button>
        <button className={`filter-chip${tab === 'digests' ? ' active' : ''}`} onClick={() => setTab('digests')}>旧周记忆 · {digests.length}</button>
      </div>
      <div className="button-row">
        <button className="secondary-button" onClick={onExport}>把旧数据单独导出一份</button>
      </div>
      <div className="archive-list">
        {tab === 'judgments' && (sortedJudgments.length ? sortedJudgments.map(item => <article className="archive-item" key={item.id}>
          <header>
            <span className="badge">{item.muted ? '已搁置' : judgmentStatusLabels[item.status]}</span>
            <time>{shortDate(dayOf(item.updatedAt))}</time>
          </header>
          <h4>{item.topic}</h4>
          <p>{item.statement}</p>
          <footer>
            <span className="muted">当时挂了两类证据：支持 {item.supportIds.length} 条 · 相反 {item.counterIds.length} 条</span>
            <button className="text-button" onClick={() => onRemoveJudgment(item.id)}>删掉这条</button>
          </footer>
          {!!item.corrections?.length && <details><summary>你当时的纠正（{item.corrections.length}）</summary>{item.corrections.map((correction, index) => <div className="archive-note" key={`${correction.at}-${index}`}><time>{dateLabel(dayOf(correction.at))}</time><p>{correction.reason}{correction.note ? `：${correction.note}` : ''}</p></div>)}</details>}
        </article>) : <div className="empty-state card"><p>没有旧观察。</p></div>)}
        {tab === 'digests' && (sortedDigests.length ? sortedDigests.map(item => <article className="archive-item" key={item.id}>
          <header>
            <time>{shortDate(item.start)}–{shortDate(item.end)}</time>
            <span className="muted">{item.entryCount} 条</span>
          </header>
          {item.title && <h4>{item.title}</h4>}
          <p>{item.summary}</p>
          {!!item.themes.length && <div className="chip-row">{item.themes.map(theme => <span className="chip" key={theme}>{theme}</span>)}</div>}
          <footer>
            <span className="muted">沉淀于 {dateLabel(dayOf(item.generatedAt))}</span>
            <button className="text-button" onClick={() => onRemoveDigest(item.id)}>删掉这段</button>
          </footer>
        </article>) : <div className="empty-state card"><p>没有旧周记忆。</p></div>)}
      </div>
      <p className="muted">完整备份（含洞察与画像）仍然在「偏好与数据 → 备份与换设备」里导出。删掉这里的东西不影响任何原始记录。</p>
    </>}
  </Modal>;
}
