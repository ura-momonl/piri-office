import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root,read,write} from '../automation/files.mjs';
import {enqueue,update,editStep,stepEditor} from './run.mjs';
import {saveSettings} from '../dashboard/settings.mjs';
import {submit,startReadyWork,execute} from '../agent/run.mjs';
import {backfillTask} from '../literature/curate.mjs';
if(process.env.PHD_ISOLATED_TESTS!=='1')throw Error('Use scripts/run-tests.mjs');

// New-task defaults live in the profile headers; saveSettings rewrites them, so restore the files afterwards.
const profileFiles=['mail','literature','presentation'].map(id=>path.join(root,'prompts/profiles',id+'.md'));
const saveProfiles=()=>profileFiles.map(f=>[f,fs.readFileSync(f)]);
const restoreProfiles=saved=>{for(const [f,b] of saved)fs.writeFileSync(f,b);};

test('new Claude-category work defaults to DeepSeek, explicit Claude choices and existing jobs remain intact',()=>{
 const queue=read('work/queue.json'),profiles=saveProfiles();
 try {
  saveSettings({'task_models.mail':'deepseek-flash','task_models.literature':'deepseek-flash','task_models.presentation':'deepseek-flash'});
  for(const profile of ['mail','literature','presentation']){
   const task=enqueue({title:'试用迁移 '+profile,profile,project_ids:[]});
   assert.equal(task.actor,'deepseek');assert.equal(task.status,'open');
  }
  const explicit=enqueue({title:'用户指定 Claude',profile:'literature',actor:'claude',project_ids:[]});
  assert.equal(explicit.actor,'claude');
 }finally{write('work/queue.json',queue);restoreProfiles(profiles);}
});

test('saved task models reach the selected executor; existing jobs and ordinary chat do not inherit the new defaults',async()=>{
 const saved={profiles:saveProfiles(),config:read('agent/config.json'),queue:read('work/queue.json'),sessions:read('.runtime/agent/sessions.json')};
 try {
  write('agent/config.json',{...saved.config,enabled:true});write('work/queue.json',{...saved.queue,items:[]});
  write('.runtime/agent/sessions.json',{sessions:[]});
  const old=enqueue({title:'原有文献任务',profile:'literature',project_ids:[],require_outputs:false});
  saveSettings({'task_models.mail':'opus','task_efforts.mail':'low','task_models.literature':saved.config.codex_model,'task_efforts.literature':'xhigh','task_models.presentation':'deepseek-flash','task_efforts.presentation':'max'});
  assert.deepEqual(read('work/queue.json').items.find(t=>t.id===old.id),old);
  const expected={mail:['claude','opus','low'],literature:['codex',saved.config.codex_model,'xhigh'],presentation:['deepseek','deepseek-flash','max']},tasks=[];
  for(const [profile,[actor,model,effort]] of Object.entries(expected)){
   const task=enqueue({title:'虚构任务 '+profile,goal:'只返回虚构完成文本',profile,project_ids:[],status:'queued',require_outputs:false});
   assert.deepEqual([task.actor,task.model,task.effort],[actor,model,effort]);tasks.push(task);
  }
  saveSettings({'task_efforts.mail':'high','task_efforts.literature':'high','task_efforts.presentation':'high'});
  const started=startReadyWork();assert.equal(started.length,3);const calls=[];
  for(const task of tasks)await execute(task.id,async(provider,_prompt,options)=>{
   if(options.purpose!=='title')calls.push([provider,options.model,options.effort]);return {result:'虚构任务完成'};
  });
  assert.deepEqual(calls,Object.values(expected));
  const ordinary=submit({text:'@Claude 请帮我写一封邮件'}),chat=read('work/queue.json').items.find(t=>t.id===ordinary.task_id);
  assert.equal(chat.model,undefined,'ordinary chat still uses the chat model, not task_models.mail');
  assert.equal(chat.effort,undefined,'ordinary chat still uses per-assistant effort, not task effort');
  const overridden=enqueue({title:'单项覆盖',profile:'mail',actor:'codex',model:saved.config.codex_model,effort:'medium',project_ids:[]});
  assert.equal(overridden.model,saved.config.codex_model);
  assert.equal(overridden.effort,'medium');
  assert.throws(()=>enqueue({title:'错误强度',profile:'presentation',effort:'xhigh',project_ids:[]}),/推理强度/);
  const otherActor=enqueue({title:'显式换助手',profile:'mail',actor:'codex',project_ids:[]});assert.equal(otherActor.model,undefined);assert.equal(otherActor.effort,undefined);
  const pending=enqueue({title:'之后改负责人',profile:'mail',project_ids:[]});assert.equal(pending.model,'opus');
  update({id:pending.id,actor:'deepseek'});assert.equal(read('work/queue.json').items.find(t=>t.id===pending.id).model,undefined);assert.equal(read('work/queue.json').items.find(t=>t.id===pending.id).effort,undefined);
  const edited=enqueue({title:'界面换负责人',profile:'presentation',project_ids:[]});assert.equal(edited.effort,'high');
  editStep({id:edited.id,revision:stepEditor(edited.id).revision,action:'content',actor:'claude'});assert.equal(read('work/queue.json').items.find(t=>t.id===edited.id).effort,undefined);
  const backfill=backfillTask({year:2020,citationFloor:'虚构条件'});assert.equal(backfill.actor,'codex');assert.equal(backfill.model,saved.config.codex_model);assert.equal(backfill.effort,'high');
  saveSettings({reasoning_effort:'xhigh',claude_reasoning_effort:'low',deepseek_reasoning_effort:'max'});
  const chatCalls=[];
  for(const provider of ['codex','claude','deepseek']){
   const job=submit({text:'@'+provider+' 只返回虚构文本'});
   await execute(job.task_id,async(p,_prompt,options)=>{if(options.purpose!=='title')chatCalls.push([p,options.effort]);return {result:'虚构完成'};});
  }
  assert.deepEqual(chatCalls,[['codex','xhigh'],['claude','low'],['deepseek','max']]);
 }finally{
  restoreProfiles(saved.profiles);write('agent/config.json',saved.config);write('work/queue.json',saved.queue);write('.runtime/agent/sessions.json',saved.sessions);
 }
});
