import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
// A synchronous scope in which repeated reads of one file share a single parse. Nothing else in this
// process can write while it runs, and write() below drops the entry. Results are read-only inside it.
let shared = null;
export function sharedReads(fn) {
  if (shared) return fn();
  shared = new Map();
  try { return fn(); } finally { shared = null; }
}
// work/queue.json is one list to every caller but two files on disk once work/turns.json exists: queue.json keeps the to-do steps (what the weekly plan,
// the board and the agents maintain); turns.json keeps the append-only record each chat message leaves (a chat turn: it carries an executor and is not
// awaiting acceptance). read() merges them (a step wins if an id is in both, which a crash between the two writes could leave); write() splits them again.
// Without turns.json (before work/run.mjs splitQueue runs) nothing changes. A record is classified by what it is now, so one that gets accepted moves over.
const QUEUE = 'work/queue.json', TURNS = 'work/turns.json';
// Every queue read parses this whole file (and the dashboard's 10 s beat reads it several times), so it is kept to about ten days of rounds.
const TURNS_MAX_BYTES = 8 * 1048576, TURNS_KEEP_BYTES = 6 * 1048576;
// A round that has not finished is live state (a queued message, a running turn): it stays however old it is.
const UNFINISHED = new Set(['queued', 'active', 'open', 'waiting_user']);
export const isTurnRecord = i => !!i.operation_id || (!!i.executor && i.review?.state !== 'pending');
// The one tolerant JSON file reader (UTF-8 BOM allowed) for callers that already hold a path.
export const readJsonFile = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const parse = readJsonFile;
// Where the local workbench backend listens when PHD_DASHBOARD_PORT is not set.
export const dashboardPort = () => Number(process.env.PHD_DASHBOARD_PORT || 18787);
// turns.json holds one record per chat round, is rewritten whole on every queue write and otherwise only grows
// (~250 rounds and ~0.5MB a day). Past TURNS_MAX_BYTES the oldest rounds move to .runtime/work/archive/turns-<month>.jsonl:
// nothing is dropped, the board and the weekly plan just stop carrying months-old rounds in the file they read.
function capTurns(items) {
  const sized = items.map(item => ({ item, bytes: Buffer.byteLength(JSON.stringify(item, null, 2)) + 8 }));
  if (sized.reduce((n, x) => n + x.bytes, 0) <= TURNS_MAX_BYTES) return items;
  let kept = 0, bytes = 0;
  for (let n = sized.length - 1; n >= 0; n--) {
    bytes += sized[n].bytes;
    if (bytes > TURNS_KEEP_BYTES) break;
    kept++;
  }
  const byMonth = new Map(), older = sized.slice(0, sized.length - kept), live = older.filter(x => UNFINISHED.has(x.item.status));
  for (const { item } of older.filter(x => !UNFINISHED.has(x.item.status))) {
    const month = /^\d{4}-\d{2}/.test(String(item.created_at)) ? String(item.created_at).slice(0, 7) : 'undated';
    byMonth.set(month, [...(byMonth.get(month) || []), item]);
  }
  for (const [month, list] of byMonth) {
    const file = path.join(root, '.runtime/work/archive', `turns-${month}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, list.map(item => JSON.stringify(item)).join('\n') + '\n');
  }
  return [...live, ...sized.slice(sized.length - kept)].map(x => x.item);
}
// Rounds that outgrew turns.json live in .runtime/work/archive/turns-<month>.jsonl, one JSON record per line.
// Reading is additive: write() never merges them back, so the archive stays the only copy of those rounds.
export function archivedTurns() {
  const dir = path.join(root, '.runtime/work/archive');
  if (!fs.existsSync(dir)) return [];
  const seen = new Map();
  for (const name of fs.readdirSync(dir).filter(n => /^turns-.+\.jsonl$/.test(n)).sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item?.id && !seen.has(item.id)) seen.set(item.id, item);
      } catch { /* a torn last line from a killed writer: the rounds before it still read */ }
    }
  }
  return [...seen.values()];
}
function mergeQueue(steps, turns) {
  const own = new Set(steps.items.map(i => i.id)), B = turns.items.filter(i => !own.has(i.id)), A = steps.items, items = [];
  // Keep each list's own order (steps can be re-ordered by hand); interleave by creation time.
  for (let a = 0, b = 0; a < A.length || b < B.length;)
    items.push(b >= B.length || (a < A.length && String(A[a].created_at) <= String(B[b].created_at)) ? A[a++] : B[b++]);
  return { ...steps, items };
}
// Lost-update guard for the queue: every process does read -> change -> write of the whole file, so a write made from a stale read silently erases another
// process's change (a finished card back to active, a handoff gone). read() stamps what it saw; write() refuses when the files changed since.
// Test fixtures restore a saved snapshot on purpose (isolated copy, one owner), so the guard is off under the test runner unless OFFICE_QUEUE_GUARD=1.
const queueStamps = new WeakMap();
const guardOn = () => process.env.PHD_ISOLATED_TESTS !== '1' || process.env.OFFICE_QUEUE_GUARD === '1';
const queueStamp = () => [QUEUE, TURNS].map(f => { try { const st = fs.statSync(path.join(root, f)); return st.mtimeMs + ':' + st.size; } catch { return '-'; } }).join('|');
export const read = (relative, fallback) => {
  if (shared?.has(relative)) return shared.get(relative);
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return fallback;
  const stamp = relative === QUEUE ? queueStamp() : null;
  let value = parse(file);
  if (relative === QUEUE && fs.existsSync(path.join(root, TURNS))) value = mergeQueue(value, parse(path.join(root, TURNS)));
  if (stamp) queueStamps.set(value, stamp);
  shared?.set(relative, value);
  return value;
};
function writeNow(relative, value) {
  shared?.delete(relative);
  if (relative === QUEUE && guardOn() && queueStamps.has(value) && queueStamps.get(value) !== queueStamp())
    throw new Error('work/queue.json 在读取之后已被另一处更新，本次写入已放弃以免覆盖；请重新读取后再试');
  if (relative === QUEUE && fs.existsSync(path.join(root, TURNS))) {
    writeText(QUEUE, JSON.stringify({ ...value, items: value.items.filter(i => !isTurnRecord(i)) }, null, 2) + '\n');
    const file = path.join(root, TURNS), turns = value.items.filter(isTurnRecord);
    // Only a log that already passed the cap is worth measuring record by record.
    const items = fs.statSync(file).size > TURNS_MAX_BYTES ? capTurns(turns) : turns;
    const text = JSON.stringify({ version: value.version, items }, null, 2) + '\n';
    // Most writes change only steps: do not rewrite the large turn log when it is unchanged.
    if (fs.readFileSync(file, 'utf8') !== text) writeText(TURNS, text);
    return;
  }
  writeText(relative, JSON.stringify(value, null, 2) + '\n');
}
export function write(relative, value) {
  writeNow(relative, value);
  if (relative === QUEUE && value && typeof value === 'object') queueStamps.set(value, queueStamp());
}
function writeText(relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Each writer keeps its own staged value during a short Windows replacement lock.
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx' });
    for(let attempt=0;;attempt++) {
      try { fs.renameSync(temporary, file); break; }
      catch(error) {
        // This is a bounded retry of the same atomic file operation, not task/model replay.
        // Persistent permissions and other failures still propagate; never delete the target.
        if(process.platform!=='win32' || !['EPERM','EACCES','EBUSY'].includes(error.code) || attempt===3)throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, [20,50,100][attempt]);
      }
    }
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Already renamed, or leave a locked staging file. */ }
  }
}
export function input(file) { return parse(path.resolve(file)); }
export function checkProjects(ids = []) {
  const known = new Set(read('projects/catalog.json').projects.map(p => p.id));
  if (!Array.isArray(ids) || ids.some(id => !known.has(id))) throw new Error('Unknown project ID');
  return [...new Set(ids)];
}
