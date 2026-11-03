import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root,archivedTurns} from './files.mjs';
import {workDetail,run} from '../work/run.mjs';
if(process.env.PHD_ISOLATED_TESTS!=='1')throw new Error('Use scripts/run-tests.mjs');

const dir=path.join(root,'.runtime/work/archive'),file=path.join(dir,'turns-2999-01.jsonl');
const archived={id:'0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',title:'归档的对话轮',kind:'framework',actor:'deepseek',executor:'deepseek',project_ids:[],goal:'归档轮正文',status:'open',created_at:'2999-01-01T00:00:00.000Z',updated_at:'2999-01-01T00:00:00.000Z'};

test('archived turns stay readable: work handoff finds the body and work list turns shows unfinished ones',async()=>{
  fs.mkdirSync(dir,{recursive:true});const before=fs.existsSync(file) ? fs.readFileSync(file,'utf8') : null;
  try{
    fs.writeFileSync(file,JSON.stringify(archived)+'\n{"broken":');
    assert.deepEqual(archivedTurns().filter(i=>i.id===archived.id).map(i=>i.goal),['归档轮正文'],'a torn last line does not hide earlier rounds');
    const log=console.log;let out='';
    try{console.log=(...args)=>{out+=args.join(' ')+'\n';};await run('handoff',archived.id);}finally{console.log=log;}
    const receipt=JSON.parse(out);
    assert.equal(receipt.goal,'归档轮正文');assert.equal(receipt.status,'open');
    const listed=workDetail('turns',{version:1,items:[]});
    assert.ok(listed.unfinished.some(i=>i.id===archived.id),'an unfinished archived turn is listed');
    assert.match(listed.coverage,/归档对话轮 \d+ 条/);
  }finally{if(before===null)fs.rmSync(file,{force:true});else fs.writeFileSync(file,before);}
});
