// Only through scripts/run-tests.mjs: fictional tasks, no model or external calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, write } from '../automation/files.mjs';
import { submit } from '../agent/run.mjs';
import { update } from '../work/run.mjs';
import { addTrigger, cancelTrigger, fireDue } from './run.mjs';
if (process.env.PHD_ISOLATED_TESTS !== '1') throw new Error('Use scripts/run-tests.mjs');

const file = '.runtime/trigger/triggers.json';
const withState = async fn => {
  const saved = Object.fromEntries(['agent/config.json', 'work/queue.json', '.runtime/agent/sessions.json'].map(f => [f, read(f)]));
  const savedTriggers = read(file);
  write('agent/config.json', { ...saved['agent/config.json'], enabled: false });
  write(file, { triggers: [] });
  const parent = submit({ text: '@Codex 定时来源。', title: '定时来源' });
  update({ id: parent.task_id, status: 'done', handoff: '已安排' });
  try { await fn({ handoff: { provider: 'codex', task_id: parent.task_id }, parent }); }
  finally { for (const [f, v] of Object.entries(saved)) write(f, v); if (savedTriggers) write(file, savedTriggers); else write(file, { triggers: [] }); }
};

test('a trigger waits, then opens one handoff conversation for the receiver', async () => withState(async ({ handoff, parent }) => {
  const now = Date.now();
  const added = addTrigger({ at: new Date(now + 60000).toISOString(), title: '到点测试', text: '@Claude 请接着登记。' }, { now, handoff });
  assert.equal(added.status, 'scheduled');
  assert.deepEqual(await fireDue({ now: now + 30000 }), [], 'not due yet');
  const sessionsBefore = read('.runtime/agent/sessions.json').sessions.length;
  const [fired] = await fireDue({ now: now + 61000 });
  assert.equal(fired.status, 'fired');
  const sessions = read('.runtime/agent/sessions.json').sessions;
  assert.equal(sessions.length, sessionsBefore + 1);
  const message = sessions.find(s => s.id === fired.session_id).messages[0];
  assert.equal(message.role, 'handoff');
  assert.equal(message.text, '@Claude 请接着登记。');
  assert.equal(message.handoff.task_id, parent.task_id);
  assert.deepEqual(await fireDue({ now: now + 120000 }), [], 'fires once');
  assert.equal(read('.runtime/agent/sessions.json').sessions.length, sessions.length);
}));

test('late beyond grace is missed; cancelled and failed sends are not retried', async () => withState(async ({ handoff }) => {
  const now = Date.now();
  const late = addTrigger({ in_minutes: 1, grace_minutes: 5, text: '@Claude 迟到。' }, { now, handoff });
  const [missed] = await fireDue({ now: now + 10 * 60000 }).then(() => read(file).triggers);
  assert.equal(missed.id, late.id);
  assert.equal(missed.status, 'missed');
  const gone = addTrigger({ in_minutes: 1, text: '@Claude 取消。' }, { now, handoff });
  cancelTrigger(gone.id);
  const bad = addTrigger({ in_minutes: 1, text: '@Claude 会失败。' }, { now, handoff });
  let calls = 0;
  const send = async () => { calls++; throw new Error('后端拒绝'); };
  await fireDue({ now: now + 2 * 60000, send });
  await fireDue({ now: now + 3 * 60000, send });
  assert.equal(calls, 1);
  const states = Object.fromEntries(read(file).triggers.map(t => [t.id, t]));
  assert.equal(states[gone.id].status, 'cancelled');
  assert.equal(states[bad.id].status, 'failed');
  assert.equal(states[bad.id].error, '后端拒绝');
}));

test('a crash during sending is recorded as interrupted, never re-sent', async () => withState(async ({ handoff }) => {
  const now = Date.now();
  const t = addTrigger({ in_minutes: 1, text: '@Claude 中断。' }, { now, handoff });
  const state = read(file);
  state.triggers[0].status = 'firing';
  write(file, state);
  let calls = 0;
  await fireDue({ now: now + 2 * 60000, send: async () => { calls++; return {}; } });
  assert.equal(calls, 0);
  assert.equal(read(file).triggers.find(x => x.id === t.id).status, 'failed');
}));

test('cancel needs an id and a unique prefix; an empty id never cancels the first trigger', async () => withState(async ({ handoff }) => {
  const now = Date.now();
  const a = addTrigger({ in_minutes: 5, text: '@Claude 甲。' }, { now, handoff });
  assert.throws(() => cancelTrigger(''), /需要触发 id/);
  assert.throws(() => cancelTrigger(), /需要触发 id/);
  assert.equal(read(file).triggers[0].status, 'scheduled');
  const state = read(file);
  state.triggers.push({ ...state.triggers[0], id: a.id.slice(0, 4) + 'zzzz' });
  state.triggers.push({ ...state.triggers[0], id: a.id.slice(0, 4) + 'yyyy' });
  write(file, state);
  assert.throws(() => cancelTrigger(a.id.slice(0, 4)), /前缀不唯一/);
  assert.equal(cancelTrigger(a.id).status, 'cancelled', 'a full id wins over longer ids sharing its prefix');
  assert.throws(() => cancelTrigger('nope-none'), /未找到/);
}));

test('a trigger added or cancelled while a send is awaited is not overwritten', async () => withState(async ({ handoff }) => {
  const now = Date.now();
  const due = addTrigger({ in_minutes: 1, text: '@Claude 到点。' }, { now, handoff });
  const other = addTrigger({ in_minutes: 30, text: '@Claude 稍后取消。' }, { now, handoff });
  let late;
  const send = async () => {
    late = addTrigger({ in_minutes: 40, text: '@Claude 发送期间新增。' }, { now, handoff }); // what another process would do
    cancelTrigger(other.id);
    return { session_id: 's1', task_id: 't1' };
  };
  const [fired] = await fireDue({ now: now + 2 * 60000, send });
  assert.equal(fired.id, due.id);
  const states = Object.fromEntries(read(file).triggers.map(t => [t.id, t]));
  assert.equal(states[due.id].status, 'fired');
  assert.equal(states[late.id].status, 'scheduled', 'the trigger added during the send survives');
  assert.equal(states[other.id].status, 'cancelled', 'the cancellation made during the send survives');
}));

test('bad schedules are rejected', async () => withState(async ({ handoff }) => {
  const now = Date.now();
  assert.throws(() => addTrigger({ at: '2026-10-22T20:00:00', text: 'x' }, { now, handoff }), /时区/);
  assert.throws(() => addTrigger({ at: new Date(now + 1000).toISOString(), text: 'x' }, { now, handoff }), /20 秒/);
  assert.throws(() => addTrigger({ in_minutes: 5, text: '  ' }, { now, handoff }), /text/);
  assert.throws(() => addTrigger({ in_minutes: 5, at: new Date(now + 3600000).toISOString(), text: 'x' }, { now, handoff }), /只给一个/);
}));
