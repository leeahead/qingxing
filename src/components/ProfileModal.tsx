'use client';

import type { Entry, ProfileItem, ProfileKind } from '@/lib/types';
import { dateLabel, dayOf, profileKindLabels } from '@/lib/utils';
import { Icon } from '@/components/Icon';

const kinds: ProfileKind[] = ['identity', 'value', 'person', 'focus'];

export type ProfileModalProps = {
  items: ProfileItem[];
  entries: Entry[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onAdd: (kind: ProfileKind, text: string) => void;
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onConfirm: (id: string) => void;
  onPropose: () => void;
};

/**
 * 「关于你」档案块。
 * 用户确认过的条目会进入 AI 的提示词；AI 提议的条目默认待确认，不生效。
 */
export function ProfileModal({ items, entries, busy, error, onClose, onAdd, onUpdate, onRemove, onConfirm, onPropose }: ProfileModalProps) {
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label="关于你" onClick={event => event.stopPropagation()}>
    <header className="modal-head"><h2>关于你</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><Icon name="close"/></button></header>
    <p className="modal-intro">这些是你自己确认过的背景，AI 每次读你的记录前都会先看一遍。AI 只能提议，落下的是你确认过的。</p>
    {kinds.map(kind => {
      const group = items.filter(item => item.kind === kind);
      const pending = group.filter(item => !item.confirmed);
      return <section className="settings-section profile-group" key={kind}>
        <div className="section-heading"><h3>{profileKindLabels[kind]}</h3><span className="muted">{group.length} 条</span></div>
        {group.length ? group.map(item => {
          const source = entries.find(entry => item.evidenceIds.includes(entry.id));
          return <div className={`profile-item${item.confirmed ? '' : ' pending'}`} key={item.id}>
            <p>{item.text}</p>
            <div className="profile-item-meta">
              {item.source === 'ai' && <span className="badge">AI 提议</span>}
              {!item.confirmed && <span className="badge review-badge">待确认</span>}
              {source && <span className="muted">依据 {dateLabel(dayOf(source.createdAt))} 的记录</span>}
            </div>
            <div className="button-row">
              {!item.confirmed && <button className="secondary-button" onClick={() => onConfirm(item.id)}>确认这条</button>}
              <button className="quiet-button" onClick={() => { const next = window.prompt('改成你自己的话', item.text); if (next && next.trim() && next !== item.text) onUpdate(item.id, next.trim()); }}>修改</button>
              <button className="quiet-button" onClick={() => onRemove(item.id)}>删除</button>
            </div>
          </div>;
        }) : <p className="muted">还没有写。</p>}
        {pending.length > 0 && <p className="muted">待确认的条目不会进入 AI 的提示词。</p>}
        <AddRow kind={kind} onAdd={onAdd}/>
      </section>;
    })}
    <div className="button-row"><button className="primary-button" disabled={busy} onClick={onPropose}>{busy ? '正在读最近的记录……' : '让 AI 提议几条'}</button></div>
    {error && <p className="form-error">{error}</p>}
    <p className="muted">AI 提议必须挂上真实记录才会出现；你也可以完全自己写。</p>
  </section></div>;
}

function AddRow({ kind, onAdd }: { kind: ProfileKind; onAdd: (kind: ProfileKind, text: string) => void }) {
  return <div className="profile-add"><input placeholder={`写一条${profileKindLabels[kind]}`} aria-label={`添加${profileKindLabels[kind]}`} onKeyDown={event => { const input = event.currentTarget; if (event.key === 'Enter' && input.value.trim()) { onAdd(kind, input.value.trim()); input.value = ''; } }} onBlur={event => { const input = event.currentTarget; if (input.value.trim()) { onAdd(kind, input.value.trim()); input.value = ''; } }}/></div>;
}
