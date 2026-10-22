'use client';

import { useState } from 'react';
import type { Entry, Judgment } from '@/lib/types';
import { addDays, confidenceLabels, correctionReasons, dateLabel, dayOf, judgmentStatusLabels, observationTypeLabels } from '@/lib/utils';
import { Modal } from '@/components/Modal';

export type ObservationModalProps = {
  item: Judgment;
  entries: Entry[];
  modelReady: boolean;
  revisionBusy: boolean;
  revisionError: string;
  onReview: (item: Judgment, status: Judgment['status']) => void;
  onRestore: (item: Judgment) => void;
  onSaveCorrection: (item: Judgment, reason: string, note: string) => void;
  onSaveEdit: (item: Judgment, topic: string, statement: string) => void;
  onRevise: (item: Judgment) => void;
  onClose: () => void;
};

/**
 * 观察详情：证据、反例、其他解释、推翻条件、纠正与版本历史。
 * 用户纠正 AI 的机制是产品核心，这里的全部动作都保留。
 */
export function ObservationModal(props: ObservationModalProps) {
  const { item, entries, modelReady, revisionBusy, revisionError, onReview, onRestore, onSaveCorrection, onSaveEdit, onRevise, onClose } = props;
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<{ topic: string; statement: string } | null>(null);
  const [editError, setEditError] = useState('');

  const supportEntries = item.supportIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
  const counterEntries = item.counterIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is Entry => Boolean(entry));
  const sortedSupport = [...supportEntries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const scopeStart = item.scopeStart || (sortedSupport.length ? dayOf(sortedSupport[0].createdAt) : '');
  const scopeEnd = item.scopeEnd || (sortedSupport.length ? dayOf(sortedSupport[sortedSupport.length - 1].createdAt) : '');

  return <Modal title="观察详情" onClose={onClose}>
    <div className="obs-detail-head">
      <div className="obs-badges">
        <span className={`badge status-badge status-${item.status}`}>{item.muted ? '已搁置' : judgmentStatusLabels[item.status]}</span>
        {item.type ? <span className="badge type-badge">{observationTypeLabels[item.type]}</span> : <span className="badge legacy-badge" title="v4.0 之前生成的观察没有类型、其他解释和推翻条件">旧观察</span>}
        {item.confidence && <span className="badge">{confidenceLabels[item.confidence]}</span>}
      </div>
      <h3>{item.topic}</h3>
      <p>{item.statement}</p>
      <div className="obs-detail-meta">
        <span>{item.scopeEntries || item.supportIds.length} 条证据</span>
        <span>{item.scopeDays || '—'} 个记录日</span>
        {scopeStart && <span>{dateLabel(scopeStart)} 至 {dateLabel(scopeEnd)}</span>}
        <span>上次核对 {item.lastReviewedAt ? dateLabel(dayOf(item.lastReviewedAt)) : '尚未核对'}</span>
        {item.nextReviewAt && <span>下次 {dateLabel(dayOf(item.nextReviewAt))}</span>}
      </div>
    </div>
    <section className="obs-section"><h4>支持证据</h4>{supportEntries.length ? supportEntries.map(entry => <blockquote className="obs-quote" key={entry.id}><time>{dateLabel(dayOf(entry.createdAt))}</time>{entry.content}</blockquote>) : <p className="muted">原始记录已删除，当前没有有效支持证据。</p>}</section>
    <section className="obs-section"><h4>相反证据</h4>{counterEntries.length ? counterEntries.map(entry => <blockquote className="obs-quote" key={entry.id}><time>{dateLabel(dayOf(entry.createdAt))}</time>{entry.content}</blockquote>) : <p className="muted">没有找到明确的反例；这不等于反例不存在。</p>}</section>
    <section className="obs-section"><h4>其他解释</h4><p className={item.alternative ? '' : 'muted'}>{item.alternative || '这条观察生成时还没有记录其他解释。可以点下面的“重新核对”，让 AI 补上其他解释和推翻条件。'}</p></section>
    <section className="obs-section"><h4>什么会推翻它</h4><p className={item.falsifier ? '' : 'muted'}>{item.falsifier || '这条观察生成时还没有写推翻条件。可以点下面的“重新核对”补上；没有推翻条件时，只把它当作临时线索。'}</p></section>
    <section className="obs-section"><h4>数据边界</h4><p className="muted">这只是你记录下来的部分，不等于全部生活；没有被记录的部分无法从这里推断。</p></section>
    {!!item.corrections?.length && <section className="obs-section"><h4>你的纠正</h4>{item.corrections.map((correction, index) => <div className="obs-version" key={`${correction.at}-${index}`}><time>{new Date(correction.at).toLocaleString('zh-CN')}</time><p>{correction.reason}{correction.note ? `：${correction.note}` : ''}</p></div>)}</section>}
    {revisionError && <p className="form-error">{revisionError}</p>}
    {(!!item.versions?.length || !!item.version) && <section className="obs-section"><h4>版本历史</h4><div className="obs-version"><time>当前 v{item.version || 1}</time><p>{item.statement}</p></div>{(item.versions || []).map(version => <div className="obs-version" key={`${version.version}-${version.at}`}><time>v{version.version} · {new Date(version.at).toLocaleString('zh-CN')}</time><p>{version.topic}：{version.statement}</p></div>)}</section>}
    {!correcting && !editing && <div className="button-row">
      {item.status !== 'confirmed' && item.status !== 'withdrawn' && <button className="secondary-button" onClick={() => onReview(item, 'confirmed')}>确认观察</button>}
      {item.status !== 'withdrawn' && <button className="quiet-button" onClick={() => onReview(item, 'uncertain')}>暂不确定</button>}
      {item.status !== 'withdrawn' ? <button className="danger-button" onClick={() => onReview(item, 'withdrawn')}>撤回</button> : <button className="quiet-button" onClick={() => onRestore(item)}>恢复待核对</button>}
    </div>}
    {!correcting && !editing && <div className="button-row">
      <button className="quiet-button" onClick={() => { setEditing({ topic: item.topic, statement: item.statement }); setEditError(''); }}>修改判断</button>
      <button className="quiet-button" onClick={() => setCorrecting(true)}>记录纠正</button>
      {!item.muted && <button className="quiet-button" disabled={revisionBusy || !modelReady} onClick={() => onRevise(item)}>{revisionBusy ? '正在重写……' : item.corrections?.length ? '按纠正重写' : item.type ? '重新核对' : '重新核对 · 补类型与推翻条件'}</button>}
      {item.muted && <button className="quiet-button" onClick={() => onRestore(item)}>恢复使用</button>}
    </div>}
    {editing && <section className="obs-section"><h4>修改判断</h4>
      <label className="field-label">主题<input value={editing.topic} onChange={event => setEditing(current => current ? { ...current, topic: event.target.value } : current)}/></label>
      <label className="field-label">判断<textarea rows={5} value={editing.statement} onChange={event => setEditing(current => current ? { ...current, statement: event.target.value } : current)}/></label>
      {editError && <p className="form-error">{editError}</p>}
      <div className="button-row">
        <button className="primary-button" onClick={() => {
          const topic = editing.topic.trim();
          const statement = editing.statement.trim();
          if (!topic || !statement) { setEditError('主题和判断都不能为空。'); return; }
          onSaveEdit(item, topic, statement);
          setEditing(null);
        }}>保存修改</button>
        <button className="quiet-button" onClick={() => setEditing(null)}>取消</button>
      </div>
    </section>}
    {correcting && <section className="obs-section"><h4>这条哪里不对</h4>
      <div className="correction-reasons">{correctionReasons.map(value => <button key={value} className={`filter-chip${reason === value ? ' active' : ''}`} onClick={() => setReason(value)}>{value}</button>)}</div>
      <label className="field-label">补充说明（可选）<textarea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="比如：那天的情况是……"/></label>
      <div className="button-row">
        <button className="primary-button" disabled={!reason} onClick={() => { onSaveCorrection(item, reason, note.trim()); setCorrecting(false); setReason(''); setNote(''); }}>保存纠正</button>
        <button className="quiet-button" onClick={() => setCorrecting(false)}>取消</button>
      </div>
    </section>}
  </Modal>;
}
