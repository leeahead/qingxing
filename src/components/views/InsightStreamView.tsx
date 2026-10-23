'use client';

import type { RefObject } from 'react';
import type { Entry, Insight } from '@/lib/types';
import { insightConfidenceLabels, shortDate, timeOf, today } from '@/lib/utils';
import { Icon } from '@/components/Icon';
import { QuickCapture } from '@/components/QuickCapture';

export type InsightStreamProps = {
  insights: Insight[];
  ready: boolean;
  modelReady: boolean;
  /** L3 画像是否已经成形：没有画像就不该硬编洞察 */
  hasProfile: boolean;
  /** 冷启动：还差几条记录 */
  needEntries: number;
  entryCount: number;
  /** 今天还能再生成几条（配额与尝试预算共同决定） */
  quotaLeft: number;
  generating: boolean;
  error: string;
  /** 首次进入：只出现一次的那句话 */
  showIntro: boolean;
  // ── 快速记录 ──
  draft: string;
  editing: Entry | null;
  todayCount: number;
  setDraft: (value: string) => void;
  setEditing: (value: Entry | null) => void;
  saveEntry: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  setTyping: (value: boolean) => void;
  // ── 动作 ──
  onGenerate: () => void;
  onFeedback: (id: string, value: 'positive' | 'negative') => void;
  onFollowUp: (insight: Insight) => void;
  onOpenMemory: () => void;
  onOpenSettings: () => void;
};

/**
 * 洞察流：打开应用看到的第一个界面。
 * 一屏一条一条的猜测，按时间倒序；上面固定一个快速记录框。
 * 这里不出现原文、不出现证据数量——它只负责「说出来」和接住用户的反应。
 */
export function InsightStreamView(props: InsightStreamProps) {
  const {
    insights, ready, modelReady, hasProfile, needEntries, entryCount, quotaLeft, generating, error, showIntro,
    draft, editing, todayCount, setDraft, setEditing, saveEntry, composerRef, setTyping,
    onGenerate, onFeedback, onFollowUp, onOpenMemory, onOpenSettings,
  } = props;

  const newestFirst = [...insights].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dayCount = new Set(newestFirst.map(item => item.createdAt.slice(0, 10)));

  // 本机数据是异步读出来的。在读出来之前先摆一个和真实内容一样高的骨架，
  // 否则会出现「先闪一下空状态，再整页跳成卡片」。
  if (!ready) return <div className="content-column insight-page">
    <div className="stream-capture">
      <QuickCapture draft={draft} editing={editing} ready={false} todayCount={todayCount} setDraft={setDraft} setEditing={setEditing} saveEntry={saveEntry} composerRef={composerRef} setTyping={setTyping}/>
    </div>
    <div className="insight-skeleton" aria-hidden="true">
      <span className="sk sk-eyebrow"/>
      <span className="sk sk-title"/>
      <span className="sk sk-card"/>
      <span className="sk sk-card sk-short"/>
    </div>
  </div>;

  return <div className="content-column insight-page">
    <div className="stream-capture">
      <QuickCapture draft={draft} editing={editing} ready={ready} todayCount={todayCount} setDraft={setDraft} setEditing={setEditing} saveEntry={saveEntry} composerRef={composerRef} setTyping={setTyping}/>
    </div>

    <header className="page-heading stream-heading">
      <span className="eyebrow">{dayCount.size ? `${dayCount.size} 个日子·它说过 ${insights.length} 条` : '它还没开口'}</span>
      <h1>洞察流</h1>
    </header>

    {showIntro && <article className="insight-intro card">
      <p>我正在重新认识你。可能需要几天时间来找到节奏。在这之前，我的洞察可能会有些飘忽不定。</p>
      <p className="muted">你不需要给它找理由：觉得对就点一下👍，不对就点👎，或者直接划走。</p>
    </article>}

    {!modelReady && <div className="empty-state card">
      <p>还没有连接模型。</p>
      <p className="muted">洞察要由你自己配置的模型生成。接口地址、模型名和密钥只存在这台设备上。</p>
      <div className="button-row"><button className="primary-button" onClick={onOpenSettings}><Icon name="settings" size={17}/>去连接模型</button></div>
    </div>}

    {modelReady && !hasProfile && <div className="empty-state card">
      <p>{entryCount ? '我在把你说的话读成一个人。' : '先记几条，我才有东西可读。'}</p>
      <p className="muted">{needEntries > 0 ? `再多记 ${needEntries} 条（现在 ${entryCount} 条），我就读一遍，形成一个「我怎么看这个人」的底子，之后按你定的条数每天说几条。` : `已经够了。让我读一遍这 ${entryCount} 条记录，开始出洞察。`}</p>
      <div className="button-row">
        {needEntries === 0 && <button className="primary-button" disabled={generating} onClick={onGenerate}>{generating ? '正在读你的记录……' : '现在就读一遍'}</button>}
      </div>
    </div>}

    {error && <p className="form-error stream-error">{error}</p>}

    {hasProfile && !!newestFirst.length && <section className="insight-stream" aria-label="洞察流">
      {newestFirst.map(item => <InsightCard key={item.id} item={item} onFeedback={onFeedback} onFollowUp={onFollowUp}/>)}
    </section>}

    {hasProfile && !newestFirst.length && !generating && modelReady && <div className="empty-state card">
      <p>还没有留下任何一条。</p>
      <p className="muted">自检比较严：它宁可少发，不发废话。可以现在让它想一条，或者今天先记几笔。</p>
      <div className="button-row"><button className="primary-button" disabled={generating} onClick={onGenerate}>让它想一条</button></div>
    </div>}

    {!!insights.length && <div className="stream-footer">
      {generating
        ? <p className="loading-note"><i/>正在想下一条……</p>
        : quotaLeft > 0
          ? <button className="secondary-button" onClick={onGenerate}>再想一条（今天还能出 {quotaLeft} 条）</button>
          : <p className="muted">今天到这里。它说完了，你也可以去记两条。</p>}
      <button className="text-button" onClick={onOpenMemory}>看他原话 · 记忆</button>
    </div>}
  </div>;
}

function InsightCard({ item, onFeedback, onFollowUp }: { item: Insight; onFeedback: (id: string, value: 'positive' | 'negative') => void; onFollowUp: (insight: Insight) => void }) {
  const stamp = item.createdAt.slice(0, 10) === today() ? timeOf(item.createdAt) : `${shortDate(item.createdAt.slice(0, 10))} ${timeOf(item.createdAt)}`;
  return <article className="insight-card card" data-confidence={item.confidence}>
    <p className="insight-text">{item.content}</p>
    <footer className="insight-foot">
      <span className={`insight-confidence conf-${item.confidence}`}>{insightConfidenceLabels[item.confidence]}</span>
      <time className="insight-time">{stamp}</time>
      <div className="insight-actions">
        <button className={`fb-button${item.feedback === 'positive' ? ' on' : ''}`} aria-label="对" aria-pressed={item.feedback === 'positive'} onClick={() => onFeedback(item.id, 'positive')}><span>👍</span></button>
        <button className={`fb-button dislike${item.feedback === 'negative' ? ' on' : ''}`} aria-label="不对" aria-pressed={item.feedback === 'negative'} onClick={() => onFeedback(item.id, 'negative')}><span>👎</span></button>
        <button className="followup-button" onClick={() => onFollowUp(item)}>追问</button>
      </div>
    </footer>
  </article>;
}
