// 只使用完整分词；不把任意相邻两个字当成词语。
const STOP_WORDS = new Set(('今天 昨天 明天 前天 后天 最近 现在 刚才 以后 之前 之后 时候 时间 每天 一天 今年 这次 那次 一下 一个 一些 什么 怎么 如何 为什么 这样 那样 这个 那个 这些 那些 因为 所以 但是 然后 还是 可能 应该 已经 觉得 感觉 事情 东西 问题 不是 没有 可以 需要 如果 自己 我们 你们 他们 她们 它们 大家 别人 以及 而且 其实 真的 比较 一直 经常 有点 一种 一样 看到 做到 说到 想到 记得 不想 不会 不能 不要 了这 只是 还有 这么 那么 一起 一点 很多 非常 特别 总是 完全 基本 确实 于是 甚至 当然 终于 开始 结束 知道 认为 发现 觉得自己 感觉自己 something today yesterday tomorrow').split(' '));
const FALLBACK_TOPICS = ['工作', '项目', '客户', '报价', '报告', '学习', '英语', '摄影', '运动', '睡眠', '家人', '关系', '沟通', '拖延', '焦虑', '辞职', '旅行', '阅读', '健康', '财务'];
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;

export function termsFor(text: string): string[] {
  const segments = segmenter
    ? [...segmenter.segment(text)].filter(part => part.isWordLike).map(part => part.segment.toLowerCase())
    : [...FALLBACK_TOPICS.filter(term => text.includes(term)), ...(text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])];
  return [...new Set(segments.filter(term => term.length >= 2 && !STOP_WORDS.has(term) && !/^\d+$/.test(term)))];
}

export function repeatedTopics(records: { content: string; createdAt: string }[], minimumDays = 1) {
  const topics = new Map<string, { count: number; days: Set<string> }>();
  for (const record of records) {
    for (const term of termsFor(record.content)) {
      const item = topics.get(term) || { count: 0, days: new Set<string>() };
      item.count += 1;
      item.days.add(new Date(record.createdAt).toLocaleDateString('sv-SE'));
      topics.set(term, item);
    }
  }
  return [...topics.entries()].filter(([, item]) => item.count >= 2 && item.days.size >= minimumDays)
    .sort((a, b) => b[1].days.size - a[1].days.size || b[1].count - a[1].count)
    .slice(0, 5).map(([topic, item]) => ({ topic, count: item.count, days: item.days.size }));
}
