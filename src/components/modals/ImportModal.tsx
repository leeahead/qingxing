'use client';

import { useRef, useState } from 'react';
import type { Store } from '@/lib/types';
import { parseBackupText } from '@/lib/backup';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';

export type ImportModalProps = {
  onImport: (store: Store, mode: 'merge' | 'replace') => void;
  onClose: () => void;
};

/** 导入备份：选文件或粘贴文本，预览条数后选合并或整体替换。 */
export function ImportModal({ onImport, onClose }: ImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState<{ store: Store; skipped: number } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [error, setError] = useState('');

  function tryPreview(text: string) {
    try {
      setPreview(parseBackupText(text));
      setError('');
    } catch (cause) {
      setError(`无法导入：${cause instanceof Error ? cause.message : '文件格式不正确'}`);
    }
  }
  return <Modal title="恢复你的记忆" onClose={onClose}>
    <p className="modal-intro">从另一台手机带来的记录，可以在这里继续。旧版本（v6 ~ v9）的备份文件也能导入；那时的观察与周沉淀会放进「偏好与数据 → 旧数据存档」，不会被丢掉。</p>
    {!preview ? <>
      <button className="upload-drop" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" size={27}/>
        <strong>选择备份文件</strong>
        <span>支持清醒导出的备份</span>
      </button>
      <details>
        <summary>文件选择不可用？粘贴备份</summary>
        <textarea rows={5} value={paste} aria-label="粘贴备份内容" placeholder="在这里粘贴完整备份内容" onChange={event => setPaste(event.target.value)}/>
        <button className="secondary-button" disabled={!paste.trim()} onClick={() => tryPreview(paste)}>检查备份</button>
      </details>
      {error && <p className="form-error">{error}</p>}
    </> : <>
      <div className="import-summary">
        <h3>已识别备份</h3>
        <p>{preview.store.entries.length} 条记录 · {preview.store.tasks.length} 件事项 · {preview.store.insights.length} 条洞察{preview.store.userProfile ? ' · 含画像层' : ''}{preview.store.judgments.length ? ` · ${preview.store.judgments.length} 条旧观察` : ''}{preview.store.digests.length ? ` · ${preview.store.digests.length} 段旧周记忆` : ''}{preview.store.profile.length ? ` · ${preview.store.profile.length} 条「关于你」` : ''}{preview.store.summaries.length ? ` · ${preview.store.summaries.length} 份回望` : ''}</p>
        {preview.skipped > 0 && <p>跳过 {preview.skipped} 条无效数据</p>}
      </div>
      <label className="import-option"><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')}/><span>合并到本机<small>保留原有内容，同编号记录采用较新版本。</small></span></label>
      <label className="import-option"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')}/><span>完整替换<small>当前设备数据将被备份覆盖，请先导出。</small></span></label>
      <div className="button-row">
        <button className="quiet-button" onClick={() => setPreview(null)}>重新选择</button>
        <button className="primary-button" onClick={() => onImport(preview.store, mode)}>确认恢复</button>
      </div>
    </>}
    <input ref={fileRef} type="file" accept="application/json,.json,text/plain" hidden onChange={async event => {
      const file = event.target.files?.[0];
      if (file) { try { tryPreview(await file.text()); } catch { setError('文件读取失败，请尝试粘贴备份。'); } }
      event.target.value = '';
    }}/>
  </Modal>;
}
