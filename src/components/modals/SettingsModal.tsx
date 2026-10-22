'use client';

import type { Entry, Settings, Theme, UserProfile } from '@/lib/types';
import type { JournalEvent, Snapshot, StorageStatus } from '@/lib/storage';
import type { EmbeddingProbe } from '@/lib/embedding';
import type { KeyboardDiag } from '@/lib/keyboard';
import type { QualityStats } from '@/lib/feedback';
import { chatEndpoint } from '@/lib/ai';
import { harnessReasonLabels, VERSION } from '@/lib/utils';
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
  onRecoverSettings: () => void;
  modelError: string;
  embedProbe: EmbeddingProbe | null;
  vectorBusy: boolean;
  vectorCount: number;
  entriesCount: number;
  onBuildVectors: () => void;
  autoBusy: boolean;
  onRunAutoPilot: () => void;
  onRebuildProfile: () => void;
  /** 当前 L3 画像 */
  profile: UserProfile | null;
  profileVersions: UserProfile[];
  insightCount: number;
  sceneCount: number;
  rawReadsLeft: number;
  stats: QualityStats;
  legacyCount: number;
  onOpenArchive: () => void;
  keyboardDiag: KeyboardDiag[];
  onClose: () => void;
};

const TEMPERATURES: [number, string, string][] = [
  [0.7, '稳一点', '少说，说得像已经发生过的事'],
  [0.8, '平衡', '默认。允许偶尔飘'],
  [0.9, '再跳一点', '更容易说出你没想到的连接'],
];
const LEVELS: ['strict' | 'balanced' | 'loose', string, string][] = [
  ['strict', '严', '一天可能只留 1 条'],
  ['balanced', '适中', '默认。太长、像汇报、空话都丢掉'],
  ['loose', '松', '允许短句子和新说法'],
];

/** 偏好与数据：外观、备份、模型连接、洞察流与画像、自动整理、旧数据、本机存储、诊断、清空。 */
export function SettingsModal(props: SettingsModalProps) {
  const {
    settings, setSettings, theme, setTheme, backupMeta, backupText, supportsAuto, onExport, onOpenImport, onAuthorizeDir, onRunAutoBackup,
    storageInfo, snapshots, journal, onSnapshot, onRestoreSnapshot, onRemoveSnapshot, onRestoreEntry, onClearAll,
    onTestConnection, onRecoverSettings, modelError, embedProbe, vectorBusy, vectorCount, entriesCount, onBuildVectors,
    autoBusy, onRunAutoPilot, onRebuildProfile, profile, profileVersions, insightCount, sceneCount, rawReadsLeft, stats,
    legacyCount, onOpenArchive, keyboardDiag, onClose,
  } = props;
  const temperature = settings.insightTemperature ?? 0.8;
  const level = settings.harnessLevel ?? 'balanced';
  return <Modal title="偏好与数据" onClose={onClose}>
    <section className="settings-section">
      <div className="section-heading"><h3>外观</h3><span className="muted">跟随你的阅读习惯</span></div>
      <div className="theme-choices">
        <button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><span className="theme-preview preview-light"/>白色<span>明亮、温和</span></button>
        <button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><span className="theme-preview preview-dark"/>深色<span>安静、柔和</span></button>
      </div>
    </section>

    <section className="settings-section">
      <h3>洞察流</h3>
      <p className="muted">它读你的记录，凝成一份「怎么看这个人」的画像，再每天说 2 到 4 条猜测。说的话不带你原文，也不列证据。</p>
      <div className="profile-card">
        {profile ? <>
          <div className="profile-head">
            <b>画像层 v{profile.version}</b>
            <span className="muted">{new Date(profile.updatedAt).toLocaleDateString('zh-CN')} 更新 · 正文 {profile.narrative.length} 字</span>
          </div>
          <p className="profile-narrative">{profile.narrative}</p>
          {!!profile.patterns.length && <p className="profile-line"><b>常见模式：</b>{profile.patterns.join('；')}</p>}
          {!!profile.values.length && <p className="profile-line"><b>在意的事：</b>{profile.values.join('；')}</p>}
          {!!profile.tensions.length && <p className="profile-line"><b>长期拉扯：</b>{profile.tensions.join('；')}</p>}
          {!!profile.currentThemes.length && <p className="profile-line"><b>眼下主题：</b>{profile.currentThemes.join('；')}</p>}
          <p className="muted">依据：{profile.sourceDays || '—'}（{profile.basedOnEntries ?? 0} 条）。历史 {profileVersions.length} 版，最多留 12 版。活跃场景 {sceneCount} 个。</p>
        </> : <p className="muted">还没有画像层。记够 12 条以后，它会读最近 30 天的记录生成第一版。</p>}
        <div className="button-row">
          <button className="secondary-button" disabled={autoBusy || !entriesCount} onClick={onRebuildProfile}>{profile ? '现在就重读一遍画像' : '现在就读一遍记录'}</button>
        </div>
      </div>
      <div className="insight-stats">
        <span>已说过 {insightCount} 条</span>
        <span>👍 {stats.positive} · 👎 {stats.negative}</span>
        <span>近 7 天：尝试 {stats.attempts} 条，留下 {stats.accepted} 条{stats.ratio ? `（每 ${stats.ratio} 条留 1 条）` : ''}</span>
        <span>追问读原文：本月还能读 {rawReadsLeft} 次</span>
      </div>
      {!!stats.topReasons.length && <p className="muted">自检丢掉最多的：{stats.topReasons.map(item => `${harnessReasonLabels[item.reason] || item.reason}（${item.count}）`).join('、')}。</p>}

      <div className="section-heading"><h3>联想的大胆度</h3><span className="muted">temperature</span></div>
      <div className="filter-row" role="group" aria-label="选择大胆度">
        {TEMPERATURES.map(([value, label, hint]) => <button key={value} className={`filter-chip${temperature === value ? ' active' : ''}`} title={hint} onClick={() => setSettings(current => ({ ...current, insightTemperature: value }))}>{label}</button>)}
      </div>
      <p className="muted">觉得它猜得太离谱就往「稳一点」调；觉得它老说安全的话就往「再跳一点」调。</p>

      <div className="section-heading"><h3>自检严格度</h3><span className="muted">Harness</span></div>
      <div className="filter-row" role="group" aria-label="选择自检严格度">
        {LEVELS.map(([value, label, hint]) => <button key={value} className={`filter-chip${level === value ? ' active' : ''}`} title={hint} onClick={() => setSettings(current => ({ ...current, harnessLevel: value }))}>{label}</button>)}
      </div>
      <p className="muted">一条都不发出来就往「松」调；废话变多就往「严」调。硬规则（带引用、解释自己、贴标签、空话）在任何一档都生效。</p>
      <div className="button-row"><button className="secondary-button" disabled={autoBusy} onClick={onRunAutoPilot}>{autoBusy ? '正在想……' : '现在就想一条'}</button></div>
    </section>

    <section className="settings-section">
      <div className="section-heading"><h3>它自己什么时候干活</h3><span className="muted">{settings.autoPilot === false ? '已关闭' : '默认开启'}</span></div>
      <div className="auto-row">
        <div>
          <b>打开应用时自己来一轮</b>
          <p>先补一份缺的每日回望，画像到 7 天就更新，然后按今天的额度出洞察（2 到 4 条，昨天没发够的今天补）。每天最多尝试 12 次，不固定时间。</p>
          {settings.embedModel?.trim() ? <p>填了向量模型时，也会在后台安静地补齐向量。</p> : null}
        </div>
        <button className={`switch${settings.autoPilot === false ? '' : ' on'}`} role="switch" aria-checked={settings.autoPilot !== false} aria-label="打开时自动整理" onClick={() => setSettings(current => ({ ...current, autoPilot: current.autoPilot === false }))}><i/></button>
      </div>
      <p className="muted">{settings.lastInsightAt ? `最近一次出洞察：${new Date(settings.lastInsightAt).toLocaleString('zh-CN')}` : '还没生成过洞察。'}</p>
    </section>

    <section className="settings-section">
      <h3>备份与换设备</h3>
      <p className="muted">备份包含记录、事项、洞察、画像与场景，不包含访问密钥。</p>
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
      {!settings.baseUrl.trim() && snapshots.some(item => item.state?.settings?.baseUrl?.trim()) && <div className="recover-row">
        <div>
          <b>这台设备上没找到接口地址</b>
          <p>可能是换版本时丢了。快照里还留着当时的地址与密钥，可以找回来。</p>
        </div>
        <button className="secondary-button" onClick={onRecoverSettings}>从快照找回</button>
      </div>}
      <label className="field-label">接口地址<input placeholder="填写完整接口地址，结尾为 /v1" value={settings.baseUrl} onChange={event => setSettings(current => ({ ...current, baseUrl: event.target.value }))}/></label>
      <label className="field-label">模型名称<input placeholder="填写模型名称" value={settings.model} onChange={event => setSettings(current => ({ ...current, model: event.target.value }))}/></label>
      <label className="field-label">访问密钥<input type="password" autoComplete="off" value={settings.apiKey} onChange={event => setSettings(current => ({ ...current, apiKey: event.target.value }))}/></label>
      <label className="field-label">向量模型（可选）<input placeholder="填写支持 /embeddings 的模型名；留空则用上面的模型名" value={settings.embedModel || ''} onChange={event => setSettings(current => ({ ...current, embedModel: event.target.value }))}/></label>
      {settings.baseUrl.trim() && <p className="muted">实际请求：{chatEndpoint(settings)}</p>}
      <div className="button-row">
        <button className="secondary-button" onClick={onTestConnection}>测试连接</button>
        <button className="secondary-button" disabled={vectorBusy} onClick={onBuildVectors}>{vectorBusy ? '正在生成向量……' : entriesCount - vectorCount > 0 ? `为记录生成向量（还有 ${entriesCount - vectorCount} 条）` : '为记录生成向量'}</button>
      </div>
      {embedProbe && <p className={embedProbe.ok ? 'muted' : 'form-error'}>向量接口：{embedProbe.message}</p>}
      {modelError && <p className="form-error">上一次调用模型失败：{modelError}</p>}
      <p className="muted">已有 {vectorCount} / {entriesCount} 条记录带向量。追问时想找相关记录会用到；不支持向量就退回关键词，不影响别的功能。</p>
    </section>

    <section className="settings-section">
      <div className="section-heading"><h3>旧数据存档</h3><span className="muted">{legacyCount ? `${legacyCount} 项留在本机` : '没有旧数据'}</span></div>
      <p className="muted">v6.0 起不再展示「可追溯的观察」与「按周沉淀的记忆」，旧数据没被删掉，也不再产生新的。想核对可以从别的方式接回去。</p>
      <div className="button-row"><button className="secondary-button" disabled={!legacyCount} onClick={onOpenArchive}>浏览旧数据</button></div>
    </section>

    <section className="settings-section">
      <div className="section-heading"><h3>本机存储</h3><span className="muted">{storageInfo ? (storageInfo.mode === 'indexeddb' ? 'IndexedDB' : '浏览器存储') : '读取中'}</span></div>
      <p className="muted">{storageInfo ? `${storageInfo.entries} 条记录 · ${storageInfo.tasks} 件事项 · ${storageInfo.insights} 条洞察${storageInfo.usage ? ` · 已用 ${(storageInfo.usage / 1048576).toFixed(1)} MB${storageInfo.quota ? ` / 可用 ${(storageInfo.quota / 1048576).toFixed(0)} MB` : ''}` : ''}` : ''}{storageInfo?.lastError ? ` · ${storageInfo.lastError}` : ''}</p>
      <div className="button-row"><button className="secondary-button" onClick={onSnapshot}>立即存一份快照</button></div>
      {!!snapshots.length && <div className="snapshot-list">
        {snapshots.map(snapshot => <div className="snapshot-item" key={snapshot.id}>
          <div><time>{new Date(snapshot.at).toLocaleString('zh-CN')}</time><small>{snapshot.reason}</small></div>
          <div className="button-row"><button className="text-button" onClick={() => onRestoreSnapshot(snapshot.id)}>恢复</button><button className="text-button" onClick={() => onRemoveSnapshot(snapshot.id)}>删除</button></div>
        </div>)}
      </div>}
      {!!journal.length && <details className="journal-list">
        <summary>操作记录（最近 {journal.length} 条）</summary>
        {journal.map(event => {
          const deleted = event.kind === 'entry.deleted' ? event.entry : undefined;
          return <div className="journal-item" key={event.id}>
            <time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
            <span>{event.text}</span>
            {deleted && <button className="text-button" onClick={() => onRestoreEntry(deleted)}>找回</button>}
          </div>;
        })}
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
      <p className="muted">清空前会自动留一份快照，可以在「本机存储」里恢复。模型连接是配置，会保留。</p>
    </details>
  </Modal>;
}
