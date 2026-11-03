import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../automation/files.mjs';
// A zone whose offset is not a whole hour (the office zone is read when the calendar module loads, so this needs its own file).
if (process.env.PHD_ISOLATED_TESTS !== '1') throw new Error('这些测试会改动所在目录的数据，请用 node scripts/run-tests.mjs 运行');

const file = path.join(root, 'weekly/config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.writeFileSync(file, JSON.stringify({ ...config, timezone: 'Asia/Kolkata' }, null, 2));
const { parseWhen, chicagoDay } = await import('./run.mjs');

test('a half-hour offset zone gets the right start and end of day', () => {
  assert.equal(parseWhen('2026-11-05').ms, Date.UTC(2026, 10, 4, 18, 30));              // 00:00 IST = 18:30Z the day before
  assert.equal(parseWhen('2026-11-05', 'end').ms, Date.UTC(2026, 10, 5, 18, 29, 59));   // 23:59:59 IST
  assert.equal(chicagoDay(Date.UTC(2026, 10, 4, 18, 29)), '2026-11-04');
  assert.equal(chicagoDay(Date.UTC(2026, 10, 4, 18, 30)), '2026-11-05');
});
