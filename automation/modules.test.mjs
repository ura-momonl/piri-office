import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

if(process.env.PHD_ISOLATED_TESTS!=='1')throw new Error('Use scripts/run-tests.mjs');
const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));

test('every registered module entry file exists and exports run', () => {
  // Read the source instead of importing: some entries (dashboard, tui) start servers when loaded.
  for(const [id,m] of Object.entries(config.modules)) {
    const url=new URL(m.entry,import.meta.url);
    assert.ok(fs.existsSync(url),`${id}: entry ${m.entry} is missing`);
    assert.match(fs.readFileSync(url,'utf8'),/export\s+(async\s+)?function\s+run\b|export\s+const\s+run\b|export\s*\{[^}]*\brun\b/,`${id}: entry must export run(action, argument)`);
  }
});
