import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root} from './files.mjs';
import {ensureOffice} from './first-run.mjs';

if(process.env.PHD_ISOLATED_TESTS!=='1')throw new Error('Use scripts/run-tests.mjs --files=automation/first-run.test.mjs');

const files=['projects/catalog.json','calendar/events.json','procurement/catalog.json','literature/catalog.json'];
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));

test('a published copy without personal data gets empty, readable stores on first start',()=>{
  for(const f of files)fs.rmSync(path.join(root,f),{force:true});
  fs.rmSync(path.join(root,'workspace/projects'),{recursive:true,force:true});
  assert.deepEqual(ensureOffice(),files);
  assert.deepEqual(read('projects/catalog.json').projects,[]);
  assert.deepEqual(read('calendar/events.json').events,[]);
  assert.deepEqual(read('procurement/catalog.json').requests,[]);
  assert.deepEqual(read('literature/catalog.json').papers,[]);
  assert.ok(fs.statSync(path.join(root,'workspace/projects')).isDirectory());
});

test('an existing office is never rewritten',()=>{
  fs.writeFileSync(path.join(root,'calendar/events.json'),'{"events":[{"id":"keep"}]}\n');
  assert.deepEqual(ensureOffice(),[]);
  assert.equal(read('calendar/events.json').events[0].id,'keep');
});
