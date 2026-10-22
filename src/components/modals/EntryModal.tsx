'use client';

import { useState } from 'react';
import type { Entry } from '@/lib/types';
import { dateLabel, dayOf, timeOf } from '@/lib/utils';
import { Modal } from '@/components/Modal';

export type EntryModalProps = {
  entry: Entry;
  hasTask: boolean;
  taskTitle: string;
  setTaskTitle: (value: string) => void;
  onAddTask: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFeedback: (value: string) => void;
  onClose: () => void;
};

/** 「这条记忆」操作面板：编辑、标记、删除（可找回）、建事项。 */
export function EntryModal({ entry, hasTask, taskTitle, setTaskTitle, onAddTask, onEdit, onDelete, onFeedback, onClose }: EntryModalProps) {
  const [pendingDelete, setPendingDelete] = useState(false);
  return <Modal title="这条记忆" onClose={onClose}>
    <div className="source-preview">
      <time>{dateLabel(dayOf(entry.createdAt))} · {timeOf(entry.createdAt)}</time>
      <p>{entry.content}</p>
    </div>
    <div className="button-row">
      <button className="secondary-button" onClick={onEdit}>编辑记录</button>
      <button className="quiet-button" onClick={() => setPendingDelete(true)}>删除记录</button>
    </div>
    <div className="modal-section">
      <h3>这条记得准吗</h3>
      <div className="button-row">
        {['准确', '部分准确', '不准确', '暂不判断'].map(value => <button key={value} className={entry.feedback === value ? 'secondary-button' : 'quiet-button'} onClick={() => onFeedback(value)}>{value}</button>)}
      </div>
    </div>
    {pendingDelete && <div className="delete-confirm">
      <p>删除后关联事项保留，观察里的证据会显示为已删除。删掉的原文会进操作日志，可以在设置里找回。</p>
      <div className="button-row">
        <button className="danger-button" onClick={() => { setPendingDelete(false); onDelete(); }}>确认删除</button>
        <button className="quiet-button" onClick={() => setPendingDelete(false)}>取消</button>
      </div>
    </div>}
    <div className="modal-section">
      <h3>确认一件要做的事</h3>
      {hasTask
        ? <p className="muted">这条记录已经关联了事项。</p>
        : <>
          <label className="field-label">事项名称<input value={taskTitle} aria-label="事项名称" onChange={event => setTaskTitle(event.target.value)}/></label>
          <button className="secondary-button" disabled={!taskTitle.trim()} onClick={onAddTask}>建立事项</button>
        </>}
    </div>
  </Modal>;
}
