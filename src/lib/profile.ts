// 「关于你」档案块。
//
// 这是 AI 每次工作前都会先读一遍的「背景」：我是谁、我在意什么、有哪些重要的人、
// 眼下在纠结什么。它和「阶段性观察」是两回事：
//   观察 = 对具体片段的解释，可以被推翻、必须挂证据；
//   档案 = 用户本人确认过的背景，直接影响 AI 怎么读你的记录。
//
// 关键约束：AI 只能**提议**，落笔必须由用户确认。
// 未确认的候选不进提示词——这是「不把 AI 推断写成事实」这条原则在实现上的落点。

import type { ProfileItem, ProfileKind } from './types';
import { profileKindLabels } from './utils';

export const profileKinds: ProfileKind[] = ['identity', 'value', 'person', 'focus'];

/** 只有用户确认过的条目才允许进入提示词。 */
export const confirmedProfile = (items: ProfileItem[]): ProfileItem[] => items.filter(item => item.confirmed && item.text.trim());

/**
 * 生成注入提示词的背景块。没有确认过的条目就返回空串，不给模型任何暗示。
 */
export function buildProfileBlock(items: ProfileItem[]): string {
  const confirmed = confirmedProfile(items);
  if (!confirmed.length) return '';
  const lines: string[] = [];
  for (const kind of profileKinds) {
    const group = confirmed.filter(item => item.kind === kind);
    if (!group.length) continue;
    lines.push(`${profileKindLabels[kind]}：${group.map(item => item.text.trim()).join('；')}`);
  }
  if (!lines.length) return '';
  return [
    '以下是用户本人确认过的背景（不是新证据，也不是对你的判断）：',
    ...lines,
    '用法：读记录时把这些当作理解语境的线索；不要复述、不要当成对用户的新发现、不要用它们给用户贴标签。',
  ].join('\n');
}

/** 档案里出现过的证据 id，用于校验 AI 提议是否引用了真实记录。 */
export const profileEvidenceIds = (items: ProfileItem[]): Set<string> =>
  new Set(items.flatMap(item => item.evidenceIds));

/** 档案里是否已经说过某句话（避免 AI 反复提议同一条）。 */
export function hasSimilarProfileText(items: ProfileItem[], text: string): boolean {
  const target = text.trim().toLowerCase();
  if (!target) return true;
  return items.some(item => item.text.trim().toLowerCase() === target);
}
