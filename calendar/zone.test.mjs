import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../automation/files.mjs';
// The office zone is weekly/config.json's timezone, read when the calendar module loads: each file here sets it first, in the throw-away copy.
if (process.env.PHD_ISOLATED_TESTS !== '1') throw new Error('这些测试会改动所在目录的数据，请用 node scripts/run-tests.mjs 运行');

const file = path.join(root, 'weekly/config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.writeFileSync(file, JSON.stringify({ ...config, timezone: 'America/Los_Angeles' }, null, 2));
const { parseWhen, chicagoDay } = await import('./run.mjs');

test('a date alone is the whole day in the office zone, across a daylight-saving change', () => {
  assert.equal(parseWhen('2026-11-05').ms, Date.UTC(2026, 10, 5, 8));              // 00:00 PST = 08:00Z
  assert.equal(parseWhen('2026-11-05', 'end').ms, Date.UTC(2026, 10, 6, 7, 59, 59)); // 23:59:59 PST
  assert.equal(parseWhen('2026-03-08').ms, Date.UTC(2026, 2, 8, 8));               // the day clocks go forward starts in PST
  assert.equal(parseWhen('2026-03-08', 'end').ms, Date.UTC(2026, 2, 9, 6, 59, 59)); // and ends in PDT
});

test('the day of an instant is read in the office zone', () => {
  assert.equal(chicagoDay(Date.UTC(2026, 10, 5, 7, 30)), '2026-11-04'); // 23:30 PST the day before
  assert.equal(chicagoDay(Date.UTC(2026, 10, 5, 8, 30)), '2026-11-05');
});
