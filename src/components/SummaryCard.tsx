'use client';

import type { DailySummary, Entry } from '@/lib/types';
import { insightKindLabels, timeOf } from '@/lib/utils';
import { Icon } from './Icon';

export type SummaryCardProps = {
  day: string;
  summary?: DailySummary;
  entries: Entry[];
  entryCount: number;
  busy: boolean;
  error: string;
  modelReady: boolean;
  onGenerate: () => void;
  /** 把「明天的一件事」直接变成事项，不改变原文 */
  onAddTask?: (title: string) => void;
  /** 紧凑模式：今天页用，引用默认收起 */
  compact?: boolean;
};

/**
 * 每日回望卡。新总结（v5）是「概览 + 挂证据的观察 + 悬着的事 + 明天的一件事」，
 * 每一部分都可以缺席；旧总结（v4 五栏）照旧显示，不强行套新结构。
 */
export function SummaryCard({ day, summary, entries, entryCount, busy, error, modelReady, onGenerate, onAddTask, compact }: SummaryCardProps) {
  const source = (id: string) => entries.find(entry => entry.id === id);
  if (!summary) {
    return <div className="summary-card card">
      <div className="summary-empty">
        <h3>{modelReady ? '今天还没有回望' : '连接模型后可以生成回望'}</h3>
        <p>{entryCount
          ? `今天有 ${entryCount} 条记录。让 AI 把它们读一遍，只说记录里有的东西。`
          : '还没有记录，先记几条再生成。'}
        </p>
      </div>
      {entryCount > 0 && <div className="button-row">
        <button className="primary-button" disabled={busy || !modelReady} onClick={onGenerate}>{busy ? '正在读今天的记录……' : '生成今天的回望'}</button>
      </div>}
      {error && <p className="form-error">{error}</p>}
    </div>;
  }
  const legacy: [string, string | undefined][] = [['今天反复出现', summary.repeated], ['还没有解决', summary.unresolved], ['与过去的连接', summary.connections], ['情绪回看', summary.emotion], ['明天的收窄', summary.tomorrow]];
  const isNew = Boolean(summary.insights?.length) || (!summary.repeated && !summary.connections && !summary.emotion);
  const nextStep = summary.tomorrow;
  return <article className="summary-card card">
    <header className="summary-head">
      <span className="eyebrow">回望 · {day}</span>
      <button className="text-button" disabled={busy || !modelReady} onClick={onGenerate}>{busy ? '正在重新生成……' : '重新生成'}</button>
    </header>
    {summary.title && <h2 className="summary-title">{summary.title}</h2>}
    {summary.overview && <p className="summary-overview">{summary.overview}</p>}
    {isNew ? <>
      {!!summary.insights?.length && <div className="insight-list">
        {summary.insights.map((insight, index) => <section className="insight-item" key={index}>
          <div className="insight-kind-row">
            {insight.kind && <span className={`insight-kind kind-${insight.kind}`}>{insightKindLabels[insight.kind]}</span>}
            <p><span className="insight-mark"><Icon name="spark" size={13}/></span>{insight.text}</p>
          </div>
          {compact
            ? <details><summary>依据（{insight.sourceIds.length}）</summary>{insight.sourceIds.map(id => { const item = source(id); return item ? <blockquote key={id}><time>{timeOf(item.createdAt)}</time>{item.content}</blockquote> : null; })}</details>
            : insight.sourceIds.map(id => { const item = source(id); return item ? <blockquote key={id}><time>{timeOf(item.createdAt)}</time>{item.content}</blockquote> : null; })}
        </section>)}
      </div>}
      {!summary.insights?.length && <p className="muted">今天没有值得特别指出的事。平淡的一天也是真实的一天。</p>}
      {summary.question && <div className="summary-question">
        <span className="eyebrow">可以接着想</span>
        <p>{summary.question}</p>
      </div>}
      {(summary.unresolved || nextStep) && <div className="summary-tail">
        {summary.unresolved && <p><b>还悬着：</b>{summary.unresolved}</p>}
        {nextStep && <p><b>明天的一件事：</b>{nextStep}{onAddTask && <button className="text-button" onClick={() => onAddTask(nextStep)}>记为事项</button>}</p>}
      </div>}
    </> : legacy.filter(([, text]) => text).map(([label, text]) => <section className="summary-block" key={label}><span className="badge">{label}</span><p>{text}</p></section>)}
    {!!summary.sourceIds.length && !compact && <details><summary>本次引用的 {summary.sourceIds.length} 条原文</summary>{summary.sourceIds.map(id => { const item = source(id); return item ? <blockquote key={id}><time>{timeOf(item.createdAt)}</time>{item.content}</blockquote> : null; })}</details>}
    <footer className="summary-meta">由 {summary.model || '模型'} 生成于 {new Date(summary.generatedAt).toLocaleString('zh-CN')} · 当天 {summary.entryCount} 条记录</footer>
    {error && <p className="form-error">{error}</p>}
  </article>;
}
