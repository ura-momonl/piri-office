import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { root, read, write } from '../automation/files.mjs';
import { readJsonl, takeBatchLock } from './batch-util.mjs';
import { fetch_arxiv } from './arxiv.mjs';
import { ingest as backfillIngest } from './backfill.mjs';
import { doiId } from './run.mjs';
if (process.env.PHD_ISOLATED_TESTS !== '1') throw new Error('Use scripts/run-tests.mjs');

// Searchable one-page PDF fixture (fictional text only).
function pdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(body + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('readJsonl skips a torn line instead of failing the whole resume', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'attempts.jsonl');
  assert.deepEqual(readJsonl(file), []);
  fs.writeFileSync(file, '{"doi":"a"}\n{"doi":"b"}\n{"doi":"c","res');
  assert.deepEqual(readJsonl(file).map(r => r.doi), ['a', 'b']);
  fs.appendFileSync(file, '\n{"doi":"d"}\n');
  assert.deepEqual(readJsonl(file).map(r => r.doi), ['a', 'b', 'd']);
});

test('takeBatchLock refuses a live batch and replaces a lock left by a dead process', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'RUNNING');
  takeBatchLock(lock, 'busy');
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  assert.throws(() => takeBatchLock(lock, 'busy'), /busy/);
  fs.writeFileSync(lock, '2147483646');
  takeBatchLock(lock, 'busy');
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  assert.equal(fs.readdirSync(dir).filter(f => f.startsWith('RUNNING.stale-')).length, 1);
});

test('arXiv fetch with a failed metadata lookup keeps the stored title, authors and year', async t => {
  const baseline = read('literature/catalog.json');
  const id = '2001.00001', doi = '10.48550/arxiv.' + id;
  const output = path.join(root, 'literature/fulltext', `arxiv-${id}.pdf`);
  write('literature/catalog.json', { ...baseline, papers: [{ id: doiId(doi), doi, title: 'Stored title', authors: ['Alice Kepler', 'Bruno Maxwell'], year: 2020 }] });
  t.after(() => { write('literature/catalog.json', baseline); fs.rmSync(output, { force: true }); t.mock.restoreAll(); });
  t.mock.method(globalThis, 'fetch', async value => {
    const url = new URL(value);
    if (url.hostname === 'export.arxiv.org') return new Response('slow down', { status: 429 });
    assert.equal(url.hostname, 'arxiv.org');
    return new Response(pdf('arXiv:' + id), { status: 200 });
  });
  const result = await fetch_arxiv(id);
  assert.equal(result.status, 'available', JSON.stringify(result));
  const stored = read('literature/catalog.json').papers.find(p => p.doi === doi);
  assert.equal(stored.title, 'Stored title');
  assert.deepEqual(stored.authors, ['Alice Kepler', 'Bruno Maxwell']);
  assert.equal(stored.year, 2020);
  assert.equal(path.resolve(stored.fulltext_path), output);
  assert.ok(!stored.metadata_source, 'metadata source is only recorded when the lookup worked');
});

test('backfill ingest keeps stored authors/date/year when OpenAlex has nothing, and updates them when it does', async t => {
  const baseline = read('literature/catalog.json');
  const doi = '10.5555/keep-metadata', year = 2099;
  const candidates = path.join(root, '.runtime/literature', `backfill-${year}.json`);
  fs.mkdirSync(path.dirname(candidates), { recursive: true });
  fs.writeFileSync(candidates, JSON.stringify({ year, items: [{ rank: 1, doi, title: 'Fictional backfill paper', journal: 'Fictional Journal', cites: 7,
    abstract: 'A fictional abstract that is already present so no abstract lookup is made.', abstract_from: 'fixture' }] }));
  write('literature/catalog.json', { ...baseline, papers: [{ id: doiId(doi), doi, title: 'Fictional backfill paper',
    authors: ['Alice Kepler'], date: '2021-02-03', year: 2021 }] });
  t.after(() => { write('literature/catalog.json', baseline); fs.rmSync(candidates, { force: true }); t.mock.restoreAll(); });
  let results = [];
  t.mock.method(globalThis, 'fetch', async value => {
    assert.equal(new URL(value).hostname, 'api.openalex.org');
    return Response.json({ results });
  });
  await backfillIngest({ year, ranks: [1] });
  let stored = read('literature/catalog.json').papers.find(p => p.doi === doi);
  assert.deepEqual(stored.authors, ['Alice Kepler']);
  assert.equal(stored.date, '2021-02-03');
  assert.equal(stored.year, 2021);
  results = [{ doi: 'https://doi.org/' + doi, publication_date: '2022-05-06', authorships: [{ author: { display_name: 'New Author' } }] }];
  await backfillIngest({ year, ranks: [1] });
  stored = read('literature/catalog.json').papers.find(p => p.doi === doi);
  assert.deepEqual(stored.authors, ['New Author']);
  assert.equal(stored.date, '2022-05-06');
  assert.equal(stored.year, 2022);
});
