'use client';

import type { Entry, Settings, Theme } from '@/lib/types';
import type { JournalEvent, Snapshot, StorageStatus } from '@/lib/storage';
import type { EmbeddingProbe } from '@/lib/embedding';
import type { KeyboardDiag } from '@/lib/keyboard';
import { VERSION } from '@/lib/utils';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';

export type SettingsModalProps = {
  settings: Settings;
  setSettings: (update: (current: Settings) => Settings) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  backupMeta: { lastExportAt?: string; lastExportCount?: number; autoDirName?: string; lastAutoAt?: string };
  backupText: string;
  supportsAuto: boolean;
  onExport: () => void;
  onOpenImport: () => void;
  onAuthorizeDir: () => void;
  onRunAutoBackup: () => void;
  storageInfo: StorageStatus | null;
  snapshots: Snapshot[];
  journal: JournalEvent[];
  onSnapshot: () => void;
  onRestoreSnapshot: (id: string) => void;
  onRemoveSnapshot: (id: string) => void;
  onRestoreEntry: (entry: Entry) => void;
  onClearAll: () => void;
  onTestConnection: () => void;
  embedProbe: EmbeddingProbe | null;
  vectorBusy: boolean;
  vectorCount: number;
  entriesCount: number;
  onBuildVectors: () => void;
  autoBusy: boolean;
  onRunAutoPilot: () => void;
  keyboardDiag: KeyboardDiag[];
  onClose: () => void;
};

/** 偏好与数据：外观、备份、模型连接、自动整理、本机存储、检索、诊断、清空。 */
export function SettingsModal(props: SettingsModalProps) {
  const { settings, setSettings, theme, setTheme, backupMeta, backupText, supportsAuto, onExport, onOpenImport, onAuthorizeDir, onRunAutoBackup, storageInfo, snapshots, journal, onSnapshot, onRestoreSnapshot, onRemoveSnapshot, onRestoreEntry, onClearAll, onTestConnection, embedProbe, vectorBusy, vectorCount, entriesCount, onBuildVectors, autoBusy, onRunAutoPilot, keyboardDiag, onClose } = props;
  const lastAuto = Math.max(...[settings.lastAutoDigestAt, settings.lastAutoObservationAt, settings.lastAutoProfileAt].map(value => value ? Date.parse(value) : 0));
  return <Modal title="偏好与数据" onClose={onClose}>
    <section className="settings-section">
      <div className="section-heading"><h3>外观</h3><span className="muted">跟随你的阅读习惯</span></div>
      <div className="theme-choices">
        <button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><span className="theme-preview preview-light"/>白色<span>明亮、温和</span></button>
        <button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><span className="theme-preview preview-dark"/>深色<span>安静、柔和</span></button>
      </div>
    </section>

    <section className="settings-section">
      <h3>备份与换设备</h3>
      <p className="muted">备份包含记录、事项、观察、回望与长期记忆，不包含访问密钥。</p>
      <div className="button-row">
        <button className="secondary-button" onClick={onExport}><Icon name="download" size={17}/>导出备份</button>
        <button className="secondary-button" onClick={onOpenImport}><Icon name="upload" size={17}/>导入备份</button>
      </div>
      {backupText && <details>
        <summary>文件未保存？复制完整备份</summary>
        <textarea className="backup-text" readOnly value={backupText} aria-label="完整备份内容"/>
        <button className="quiet-button" onClick={async () => { try { await navigator.clipboard.writeText(backupText); } catch { /* 长按文本手动复制 */ } }}>复制备份</button>
      </details>}
      <p className="muted">{backupMeta.lastExportAt ? `上次把数据带出设备是 ${new Date(backupMeta.lastExportAt).toLocaleString('zh-CN')}，共 ${backupMeta.lastExportCount ?? 0} 条。` : '还没有把数据带出过设备。数据只在这台设备上，换手机或清缓存都会丢。'}</p>
      {supportsAuto ? <div className="button-row">
        <button className="secondary-button" onClick={onAuthorizeDir}>{backupMeta.autoDirName ? `换个目录（当前：${backupMeta.autoDirName}）` : '选一个目录自动备份'}</button>
        {backupMeta.autoDirName && <button className="secondary-button" onClick={onRunAutoBackup}>立即备份一次</button>}
      </div> : <p className="muted">这台设备不支持自动写入目录，请用「导出备份」存到网盘或文件里。</p>}
      {backupMeta.lastAutoAt && <p className="muted">自动备份最近一次：{new Date(backupMeta.lastAutoAt).toLocaleString('zh-CN')}。目录授权可能被浏览器回收，失效时会提示重新选择。</p>}
    </section>

    <section className="settings-section">
      <h3>模型连接</h3>
      <p className="muted">不连接模型也能记录与检索。静态网页直接请求接口，需要服务支持浏览器跨域。</p>
      <label className="field-label">接口地址<input placeholder="填写完整接口地址，结尾为 /v1" value={settings.baseUrl} onChange={event => setSettings(current => ({ ...current, baseUrl: event.target.value }))}/></label>
      <label className="field-label">模型名称<input placeholder="填写模型名称" value={settings.model} onChange={event => setSettings(current => ({ ...current, model: event.target.value }))}/></label>
      <label className="field-label">访问密钥<input type="password" autoComplete="off" value={settings.apiKey} onChange={event => setSettings(current => ({ ...current, apiKey: event.target.value }))}/></label>
      <label className="field-label">向量模型（可选）<input placeholder="填写支持 /embeddings 的模型名；留空则用上面的模型名" value={settings.embedModel || ''} onChange={event => setSettings(current => ({ ...current, embedModel: event.target.value }))}/></label>
      <div className="button-row">
        <button className="secondary-button" onClick={onTestConnection}>测试连接</button>
        <button className="secondary-button" disabled={vectorBusy} onClick={onBuildVectors}>{vectorBusy ? '正在生成向量……' : entriesCount - vectorCount > 0 ? `为记录生成向量（还有 ${entriesCount - vectorCount} 条）` : '为记录生成向量'}</button>
      </div>
      {embedProbe && <p className={embedProbe.ok ? 'muted' : 'form-error'}>向量接口：{embedProbe.message}</p>}
      <p className="muted">已有 {vectorCount} / {entriesCount} 条记录带向量。支持向量时，搜索与提问会用语义找相关记录；不支持就退回关键词，不影响别的功能。</p>
    </section>

    <section className="settings-section">
      <div className="section-heading"><h3>自动整理</h3><span className="muted">{settings.autoPilot === false ? '已关闭' : '默认开启'}</span></div>
      <div className="auto-row">
        <div>
          <b>打开时自己整理一遍</b>
          <p>补最近缺的回望、沉淀一个已经结束的周、记录足够多时生成候选观察与背景提议。每次打开最多跑一轮；所有结果都可以修改、重做或撤回，不会替你做结论。</p>
          {settings.embedModel?.trim() ? <p>填写了向量模型时，也会在后台安静地补齐向量。</p> : null}
        </div>
        <button className={`switch${settings.autoPilot === false ? '' : ' on'}`} role="switch" aria-checked={settings.autoPilot !== false} aria-label="打开时自动整理" onClick={() => setSettings(current => ({ ...current, autoPilot: current.autoPilot === false }))}><i/></button>
      </div>
      <div className="button-row"><button className="secondary-button" disabled={autoBusy || !settings.baseUrl.trim() || !settings.model.trim()} onClick={onRunAutoPilot}>{autoBusy ? '正在整理……' : '现在整理一次'}</button></div>
      <p className="muted">{lastAuto ? `最近一次自动整理：${new Date(lastAuto).toLocaleString('zh-CN')}` : '还没有自动整理过。连接模型后，打开应用时会先整理一轮。'}</p>
    </section>

    <section className="settings-section">
      <div className="section-heading"><h3>本机存储</h3><span className="muted">{storageInfo ? (storageInfo.mode === 'indexeddb' ? 'IndexedDB' : '浏览器存储') : '读取中'}</span></div>
      <p className="muted">{storageInfo ? `${storageInfo.entries} 条记录 · ${storageInfo.tasks} 件事项 · ${storageInfo.judgments} 条观察${storageInfo.usage ? ` · 已用 ${(storageInfo.usage / 1048576).toFixed(1)} MB${storageInfo.quota ? ` / 可用 ${(storageInfo.quota / 1048576).toFixed(0)} MB` : ''}` : ''}` : ''}{storageInfo?.lastError ? ` · ${storageInfo.lastError}` : ''}</p>
      <div className="button-row"><button className="secondary-button" onClick={onSnapshot}>立即存一份快照</button></div>
      {!!snapshots.length && <div className="snapshot-list">
        {snapshots.map(snapshot => <div className="snapshot-item" key={snapshot.id}>
          <div><time>{new Date(snapshot.at).toLocaleString('zh-CN')}</time><small>{snapshot.reason}</small></div>
          <div className="button-row"><button className="text-button" onClick={() => onRestoreSnapshot(snapshot.id)}>恢复</button><button className="text-button" onClick={() => onRemoveSnapshot(snapshot.id)}>删除</button></div>
        </div>)}
      </div>}
      {!!journal.length && <details className="journal-list">
        <summary>操作记录（最近 {journal.length} 条）</summary>
        {journal.map(event => <div className="journal-item" key={event.id}>
          <time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
          <span>{event.text}</span>
          {event.kind === 'entry.deleted' && event.entry && <button className="text-button" onClick={() => onRestoreEntry(event.entry as Entry)}>找回</button>}
        </div>)}
      </details>}
    </section>

    {keyboardDiag.length > 0 && <details className="settings-section">
      <summary>键盘与底栏诊断</summary>
      <p className="muted">记录最近几次软键盘与底部导航的状态变化，用于真机排查，不影响正常使用。</p>
      <ul className="diag-list">
        {keyboardDiag.map((entry, index) => <li key={index}><span>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>{entry.label}{entry.detail ? ` · ${entry.detail}` : ''}</li>)}
      </ul>
    </details>}

    <details className="settings-section">
      <summary>数据管理与版本</summary>
      <p className="muted">{VERSION} · 本机存储 · 不自动同步</p>
      <button className="danger-button" onClick={onClearAll}>清空本机数据</button>
      <p className="muted">清空前会自动留一份快照，可以在「本机存储」里恢复。</p>
    </details>
  </Modal>;
}
