// Harness 层：先生成，再检验。
//
// 模型先自由地猜，输出之后由这里逐条检查；不通过就丢弃重生成。
// 用户永远看不到被丢弃的内容——这里只留下「为什么丢掉」的原因代号，
// 用来在「偏好与数据」里显示通过率，方便调整严格度。
//
// 分层：
//   硬规则（任何严格度都生效）：格式、长度、带引用、解释自己、贴标签、空话、猜测却用肯定句；
//   软规则（宽松档放行）：重复用户刚说过的话、与既往洞察雷同、字数过短。

import type { Entry, Insight } from './types';
import { termsFor } from './topics';

/** 一句话的字数上限（产品红线：洞察不超过 50 字）。 */
export const INSIGHT_CHAR_LIMIT = 50;

export type HarnessLevel = 'strict' | 'balanced' | 'loose';

export type InsightDraft = { content: string; confidence: 'grounded' | 'speculative'; direction?: string };

export type HarnessContext = {
  level: HarnessLevel;
  /** 设备上已有的洞察：用来查重、避开用户否定过的方向 */
  existing: Insight[];
  /** 最近 24 小时的原文：用来判断「是不是在复述他刚说过的话」 */
  freshEntries: Entry[];
  /** 近 7 天被点「不对」的方向标签 */
  avoided: string[];
};

export type HarnessResult = { ok: true; draft: InsightDraft } | { ok: false; reason: HarnessReason };
export type HarnessReason =
  | 'too_short' | 'too_long' | 'has_evidence' | 'self_explaining' | 'parroting'
  | 'report_tone' | 'overclaim' | 'labeling' | 'cliche' | 'duplicate' | 'avoided_direction';

const countChars = (value: string) => value.replace(/\s/g, '').length;

/** 模型有时会把两句话写成一条，或者带上下半句；只看第一条完整句子。 */
const firstSentence = (value: string) => value.split(/[\n\r]+/)[0].trim();

const hasAny = (value: string, patterns: (string | RegExp)[]) =>
  patterns.some(pattern => (typeof pattern === 'string' ? value.includes(pattern) : pattern.test(value)));

/* ── 各类违规的说法特征 ── */

/** 在引用原文或摆证据：新模式不需要证据链，出现就是违规。 */
const EVIDENCE = [
  '「', '」', '』', '“', '”', '『',
  // 模型写日期时常带空格（「10 月 18 日」），空格也要拦住
  /[一二三四五六七八九十百\d]{1,4}\s*月\s*[一二三四五六七八九十百\d]{1,3}\s*[日号]/,
  /上周\s*[一二三四五六日天]/,
  '这条记录', '那条记录', '记录里', '记录中', '原文', '原话', '你说过', '你提过', '你写过', '写过一句', '上面那条', '某条记录', '数据显示',
];

/** 在解释自己怎么得出的结论。 */
const SELF_EXPLAIN = ['基于', '根据', '综上', '综合', '由此', '我注意到', '我发现', '我看了', '我的判断', '我推理', '推出', '因此', '所以我觉得', '理由是'];

/** 语气像在汇报工作。 */
const REPORT_TONE = [/过去[一二三四五六七八九十\d]+[周天月年]/, /最近[一二三四五六七八九十\d]+[周天月年]/, /\d+\s*次/, /\d+\s*条/, /有\d+次/, '多次', '统计', '比例', '平均值', '检测到', '频率', '趋势显示', '呈现出'];

/** 贴标签或做诊断：可以说行为，不能给人定性。 */
const LABELING = [/症(?![状])/, '障碍', '人格', '型人格', '型人', '抑郁', '社恐', '强迫', '自恋', '创伤', '双相', '焦虑倾向', '内耗型', '讨好型', '回避型', '你就是个', '你这个人', '天生', '骨子里', '基因'];

/** 说了等于没说：换个人也成立的话。 */
const CLICHE = ['生活总有', '人生难免', '每个人都会', '谁不是这样', '慢慢来', '做自己', '做最好的自己', '照顾好自己', '未来可期', '一切都会好', '都会过去', '学会接受', '学会放下', '与自己和解', '和时间做朋友', '答案在你心里', '答案只有你自己知道', '勇敢一点', '别给自己太大压力', '保持平常心', '接受不完美', '每个人都有', '重要的是过程', '放平心态', '允许一切发生'];

/** 猜测却用了肯定句。 */
const ASSERTIVE = ['就是', '总是', '一定', '肯定', '从不', '永远', '显然', '根本', '注定', '逃不掉', '改不了', '只会'];
const HEDGE = ['可能', '也许', '像是', '像', '多半', '或许', '会不会', '猜', '看起来', '似乎', '大概', '有点', '感觉'];

/** 两条话是不是在说同一件事。 */
function overlap(a: string, b: string): number {
  const setA = termsFor(a);
  const setB = new Set(termsFor(b));
  if (!setA.length || !setB.size) return 0;
  const hit = setA.filter(term => setB.has(term)).length;
  return hit / Math.min(setA.length, setB.size);
}

const norm = (value?: string) => (value || '').trim().toLowerCase().slice(0, 12);

/**
 * 自检一条候选洞察。命中任意一条就返回丢弃原因，调用方直接重新生成。
 */
export function checkInsight(raw: InsightDraft | null, ctx: HarnessContext): HarnessResult {
  if (!raw || !raw.content) return { ok: false, reason: 'too_short' };
  const content = firstSentence(raw.content).replace(/^[\s>•\-*\d.、]+/, '');
  if (!content) return { ok: false, reason: 'too_short' };
  const chars = countChars(content);
  if (chars > INSIGHT_CHAR_LIMIT) return { ok: false, reason: 'too_long' };
  if (hasAny(content, EVIDENCE)) return { ok: false, reason: 'has_evidence' };
  if (hasAny(content, SELF_EXPLAIN)) return { ok: false, reason: 'self_explaining' };
  if (hasAny(content, REPORT_TONE)) return { ok: false, reason: 'report_tone' };
  if (hasAny(content, LABELING)) return { ok: false, reason: 'labeling' };
  if (hasAny(content, CLICHE)) return { ok: false, reason: 'cliche' };
  // 只是猜测却用了肯定句：让用户以为已经被验证过，这比废话更糟。
  if (raw.confidence !== 'grounded' && hasAny(content, ASSERTIVE) && !hasAny(content, HEDGE)) return { ok: false, reason: 'overclaim' };

  const direction = norm(raw.direction);
  if (direction && ctx.avoided.map(norm).includes(direction)) return { ok: false, reason: 'avoided_direction' };

  if (ctx.level !== 'loose') {
    if (chars < (ctx.level === 'strict' ? 12 : 8)) return { ok: false, reason: 'too_short' };
    // 他刚写完「今天好累」，它又说「你这两天很累」——这是废话，不是洞察。
    const threshold = ctx.level === 'strict' ? 0.55 : 0.7;
    if (ctx.freshEntries.some(entry => overlap(content, entry.content) >= threshold)) return { ok: false, reason: 'parroting' };
    const near = ctx.level === 'strict' ? 0.5 : 0.66;
    if (ctx.existing.some(item => overlap(content, item.content) >= near)) return { ok: false, reason: 'duplicate' };
  } else if (ctx.existing.some(item => overlap(content, item.content) >= 0.85)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, draft: { ...raw, content } };
}
