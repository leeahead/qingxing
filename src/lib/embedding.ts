// 语义向量：可插拔的 provider。
//
// 优先用用户自己那个 OpenAI 兼容接口的 /embeddings——零新增依赖、零下载、模型质量更好。
// 接口不支持时回落到现有的关键词检索，功能降级而不是报错。
// 这一层刻意不引入 transformers.js / usearch 之类的本地大件（模型体积是整个应用产物的几十倍，
// 在手机套壳里下载与推理都不现实）；真需要离线向量时再在这里加一个本地 provider。

import type { Settings } from './types';

export type EmbeddingProbe = {
  ok: boolean;
  dimension?: number;
  message: string;
  model?: string;
};

export const embeddingsUrl = (settings: Settings) => {
  const base = settings.baseUrl.trim().replace(/\/$/, '');
  // 用户按常见习惯把完整路径填进来时不要再拼一次，否则会请求到 /embeddings/embeddings 而必然 404。
  return /\/embeddings$/i.test(base) ? base : `${base}/embeddings`;
};

/** 向量模型名：没单独填就用对话模型名。 */
export const embeddingModel = (settings: Settings) => (settings.embedModel || settings.model || '').trim();

const authHeaders = (settings: Settings) => ({
  'Content-Type': 'application/json',
  ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
});

/** 问一句「你这个接口能不能做向量」。设置页的「测试连接」用它。 */
export async function probeEmbedding(settings: Settings): Promise<EmbeddingProbe> {
  if (!settings.baseUrl.trim() || !embeddingModel(settings)) return { ok: false, message: '还没有填写接口地址与模型名。' };
  try {
    const response = await fetch(embeddingsUrl(settings), {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: authHeaders(settings),
      body: JSON.stringify({ model: embeddingModel(settings), input: ['测试'] }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const hint = response.status === 404 ? '这个接口不提供 /embeddings，会继续用关键词检索。' : '';
      return { ok: false, message: `服务返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}。${hint}` };
    }
    const result = await response.json();
    const vector = result?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length) return { ok: false, message: '接口有响应，但没有返回向量。' };
    return { ok: true, dimension: vector.length, model: embeddingModel(settings), message: `可用，向量长度 ${vector.length}。` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '请求失败。' };
  }
}

/** 批量取向量。接口不认批量时会按单条退回去。 */
export async function embedTexts(settings: Settings, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetch(embeddingsUrl(settings), {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: authHeaders(settings),
    body: JSON.stringify({ model: embeddingModel(settings), input: texts }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`服务返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}`);
  }
  const result = await response.json();
  const data: { index?: number; embedding?: number[] }[] = Array.isArray(result?.data) ? result.data : [];
  return texts.map((_, index) => {
    const vector = data.find(item => item?.index === index)?.embedding ?? data[index]?.embedding;
    return Array.isArray(vector) ? vector.map(Number) : [];
  });
}

/** 余弦相似度；维度不一致或空向量返回 0。 */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
