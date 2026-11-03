// 项目节点的语义检索：卡片挂在某个栏上时，按卡片内容检索项目里最相关的节点，只给标题、编号和正文开头一句，原文由 agent 用 projects read-nodes 自己读。
// 向量用 memory2 同一个本地 GPU 嵌入服务（不花额度），按节点内容哈希缓存，只有改过的节点才重新嵌入。检索失败就明确写出，不换成别的方式。
// promptFor 是同步的：turn 开始前先 prefetchProjectRag()（异步），promptFor 里的 projectRagContext() 读这次预取的结果。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from '../automation/files.mjs';
import { parseFramework, frameworkFile } from './framework.mjs';
import { GpuEmbedder } from '../memory2/embedder.mjs';
import { truncateNormalize, DEFAULT_DIM } from '../memory2/index.mjs';

// 最多 10 条；比第 1 名低 0.2 以上的不要（至少留 3 条）。2026-11-02 在 projects/search-eval.json 的 29 道短问和 11 条“卡片目标→它的日志”配对上看分数分布定的：
// 期望节点离第 1 名最远 0.19，第 8 名常常低 0.15～0.36；disk1 续做卡上，该栏的逻辑节点 A-Fig.3 排第 10，只取 8 条会漏掉。样本很小，只是方向性依据。
export const TOP_K = 10, CUTOFF = 0.2, MIN_HITS = 3;
const DOC_CHARS = 1200, SNIPPET_CHARS = 90, FRESH_MS = 30000, TIMEOUT_MS = 150000;
const cacheFile = projectId => path.join(root, '.runtime/projects-rag', projectId + '.json');
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const toB64 = v => Buffer.from(new Float32Array(v).buffer).toString('base64');
const fromB64 = s => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const oneLine = t => String(t || '').replace(/\s+/g, ' ').trim();

const titleOf = n => n.entry ? n.heading : n.title;
// 正文开头一句：第一条非空行，去掉列表符号。只给栏用：日志的标题本身就是说明，正文开头多是“分析日期……”之类，不如不占字；栏没有正文就没有这一句，只靠标题和路径。
const firstLine = body => oneLine(String(body || '').split(/\r?\n/).find(l => l.trim()).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')).slice(0, SNIPPET_CHARS);

// 参与检索的节点：有编号的栏和日志。当前栏和它的母栏已经整段披露，不再检索。
// 嵌入的文字是“上级栏标题 › … › 标题 + 正文”：栏没有正文时也带着它在项目里的位置（2026-11-02 在评测题上比只用标题 + 正文的平均名次靠前）。
export function ragDocs(parsed, nodeId) {
  const self = parsed.byId.get(nodeId);
  const skip = new Set(self ? [self, self.parent].filter(Boolean) : []);
  const docs = [];
  for (const n of parsed.nodes) {
    if (!n.id || skip.has(n)) continue;
    const title = titleOf(n), trail = [...n.ancestors.filter(a => a.level > 2).map(titleOf), title];
    const text = [trail.join(' › '), n.body].filter(Boolean).join('\n').slice(0, DOC_CHARS);
    const parent = n.parent && n.parent.level > 2 ? titleOf(n.parent) : '';
    docs.push({ id: n.id, title, label: parent ? `${parent} › ${title}` : title, snippet: n.body && !n.entry ? firstLine(n.body) : '', text, sha: sha(text) });
  }
  return docs;
}

function readCache(projectId, model) {
  try { const c = JSON.parse(fs.readFileSync(cacheFile(projectId), 'utf8')); if (c.model === model && c.dim === DEFAULT_DIM) return c; } catch { /* 没有缓存或已换模型：重建 */ }
  return { model, dim: DEFAULT_DIM, docs: {} };
}

export async function searchProjectNodes({ projectId, nodeId, query }, { embedder = new GpuEmbedder(), k = TOP_K } = {}) {
  if (!fs.existsSync(frameworkFile(projectId))) return [];
  const parsed = parseFramework(fs.readFileSync(frameworkFile(projectId), 'utf8'));
  const docs = ragDocs(parsed, nodeId);
  if (!docs.length || !oneLine(query)) return [];
  const cache = readCache(projectId, embedder.model);
  const todo = docs.filter(d => cache.docs[d.id]?.sha !== d.sha);
  if (todo.length) {
    const vectors = await embedder.embed(todo.map(d => d.text), { query: false });
    todo.forEach((d, i) => { cache.docs[d.id] = { sha: d.sha, v: toB64(truncateNormalize(vectors[i], DEFAULT_DIM)) }; });
    const live = new Set(docs.map(d => d.id).concat(parsed.nodes.filter(n => n.id).map(n => n.id)));
    for (const id of Object.keys(cache.docs)) if (!live.has(id)) delete cache.docs[id];
    fs.mkdirSync(path.dirname(cacheFile(projectId)), { recursive: true });
    fs.writeFileSync(cacheFile(projectId), JSON.stringify(cache));
  }
  const [q] = await embedder.embed([oneLine(query).slice(0, 2000)], { query: true });
  const qv = truncateNormalize(q, DEFAULT_DIM);
  const ranked = docs.map(d => ({ d, score: dot(qv, fromB64(cache.docs[d.id].v)) })).sort((a, b) => b.score - a.score).slice(0, k);
  return ranked.filter((h, i) => i < MIN_HITS || h.score >= ranked[0].score - CUTOFF);
}

export const formatRag = hits => hits.length
  ? `与本卡片内容最相关的项目节点（按内容检索；要原文用 projects read-nodes）：\n${hits.map(({ d }) => `- ${d.label}${d.title.startsWith(d.id) ? '' : `（${d.id}）`}${d.snippet ? '：' + d.snippet : ''}`).join('\n')}`
  : '';

const prefetched = new Map();
const keyOf = (projectId, nodeId, query) => [projectId, nodeId, sha(String(query))].join('\0');

export async function prefetchProjectRag({ projectId, nodeId, query }, options) {
  if (!projectId || !nodeId || !query) return;
  let text;
  try {
    let timer;
    const hits = await Promise.race([
      searchProjectNodes({ projectId, nodeId, query }, options),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('超时')), options?.timeoutMs ?? TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    text = formatRag(hits);
  } catch (e) { text = `项目节点检索失败（${oneLine(e.message).slice(0, 120)}），本次没有检索结果；可用 projects search 或 outline 自己查。`; }
  const now = Date.now();
  for (const [k, v] of prefetched) if (now - v.at > FRESH_MS) prefetched.delete(k);
  prefetched.set(keyOf(projectId, nodeId, query), { at: now, text });
}

export function projectRagContext({ projectId, nodeId, query }) {
  const hit = prefetched.get(keyOf(projectId, nodeId, query));
  return hit && Date.now() - hit.at <= FRESH_MS ? hit.text : '';
}
