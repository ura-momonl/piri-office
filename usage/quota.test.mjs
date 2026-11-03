import test from 'node:test';
import assert from 'node:assert/strict';
import {windowLive,remainingPercent,liveWindows,remainingFromUsed} from './quota.mjs';
if(process.env.PHD_ISOLATED_TESTS!=='1')throw new Error('Use scripts/run-tests.mjs');

const NOW=Date.parse('2026-10-31T12:00:00Z');
const past={remaining_percent:9,resets_at:'2026-10-31T10:00:00Z'};
const future={remaining_percent:42,resets_at:'2026-10-31T14:00:00Z'};
const plain={remaining_percent:7};

test('a window past its reset time has started over and counts as full',()=>{
  assert.equal(windowLive(past,NOW),false);assert.equal(remainingPercent(past,NOW),100);
  assert.equal(windowLive(future,NOW),true);assert.equal(remainingPercent(future,NOW),42);
  assert.equal(remainingPercent(plain,NOW),7,'a window without a reset time never starts over');
  assert.deepEqual(liveWindows([past,future,plain],NOW).map(w=>w.remaining_percent),[42,7]);
});

test('Codex used percent becomes remaining, never below zero',()=>{
  assert.equal(remainingFromUsed(18),82);assert.equal(remainingFromUsed(100),0);assert.equal(remainingFromUsed(104),0);
});
