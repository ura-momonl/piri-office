import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFramework, columnContext } from './framework.mjs';
import { ragDocs, formatRag, searchProjectNodes } from './rag.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../automation/files.mjs';
if (process.env.PHD_ISOLATED_TESTS !== '1') throw new Error('这些测试会写入所在目录，请用 node scripts/run-tests.mjs 在隔离副本里运行');

const doc = `# 项目
## 研究理解
<!--node {"id":"lg","type":"logic"}-->
### 主线
<!--node {"id":"main","kind":"info"}-->

主线正文。

## 时间日志
<!--node {"id":"tl","type":"timeline"}-->
### 母栏
<!--node {"id":"mother","kind":"info"}-->

母栏正文，没有任何固定标签。

#### 子栏
<!--node {"id":"child","kind":"info"}-->

子栏正文一句话。

##### T-20261101-01 子栏里的日志
<!--node {}-->

日志正文不应出现在固定披露里。

#### 另一个子栏
<!--node {"id":"other","kind":"info"}-->

另一个子栏的正文。

#### 没有正文的子栏
<!--node {"id":"bare","kind":"info"}-->
`;

test('固定披露只有所在子栏和母栏的正文全文，不依赖任何标签', () => {
  const parsed = parseFramework(doc);
  const out = columnContext(parsed, parsed.byId.get('child'));
  const { child, mother } = { child: parsed.byId.get('child'), mother: parsed.byId.get('mother') };
  assert.equal(out, `所在子栏「子栏」的正文：\n${child.body}\n\n所在母栏「母栏」的正文：\n${mother.body}`);
  assert.doesNotMatch(out, /另一个子栏|日志正文不应出现|主线正文/);
});

test('正文为空的栏不披露该栏；一级板块没有母栏', () => {
  const parsed = parseFramework(doc);
  assert.doesNotMatch(columnContext(parsed, parsed.byId.get('bare')), /所在子栏|没有正文的子栏/);
  assert.doesNotMatch(columnContext(parsed, parsed.byId.get('tl')), /所在母栏/);
});

test('检索文档不含当前栏和母栏，日志带编号', () => {
  const parsed = parseFramework(doc);
  const ids = ragDocs(parsed, 'child').map(d => d.id);
  assert.ok(!ids.includes('child') && !ids.includes('mother'));
  assert.ok(ids.includes('T-20261101-01') && ids.includes('other') && ids.includes('main'));
  const log = ragDocs(parsed, 'child').find(d => d.id === 'T-20261101-01');
  assert.match(log.title, /^T-20261101-01 子栏里的日志$/);
  assert.equal(log.snippet, '', '日志只给标题，不给正文开头');
  assert.equal(ragDocs(parsed, 'child').find(d => d.id === 'other').snippet, '另一个子栏的正文。');
});

test('检索按内容相似度排序，只给标题编号和正文开头一句；缓存只重算改过的节点', async () => {
  const projectId = 'rag-test', dir = path.join(root, 'workspace/projects', projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'FRAMEWORK.md'), doc);
  const calls = [];
  const embedder = {
    model: 'fake',
    async embed(texts, { query }) {
      calls.push({ n: texts.length, query });
      // 含“另一个”的文本落在第一维，其余落在第二维；维度补零到 1024
      return texts.map(t => { const v = new Array(1024).fill(0); v[/另一个/.test(t) ? 0 : 1] = 1; return v; });
    },
  };
  const hits = await searchProjectNodes({ projectId, nodeId: 'child', query: '另一个子栏' }, { embedder, k: 2 });
  assert.equal(hits[0].d.id, 'other');
  assert.match(formatRag(hits), /^与本卡片内容最相关的项目节点/);
  assert.match(formatRag(hits), /- 母栏 › 另一个子栏（other）：另一个子栏的正文。/);
  const all = await searchProjectNodes({ projectId, nodeId: 'child', query: '另一个子栏' }, { embedder });
  assert.equal(all.length, 3, '比第 1 名低 0.2 以上的被去掉，只留最少 3 条');
  const first = calls.filter(c => !c.query).reduce((a, c) => a + c.n, 0);
  await searchProjectNodes({ projectId, nodeId: 'child', query: '另一个子栏' }, { embedder, k: 2 });
  assert.equal(calls.filter(c => !c.query).reduce((a, c) => a + c.n, 0), first, '第二次不重新嵌入');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(root, '.runtime/projects-rag', projectId + '.json'), { force: true });
});
