import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root,read,write} from '../automation/files.mjs';
import {PROVIDERS,providerStatus} from './providers.mjs';
import {submit,execute,agentSnapshot,invokeNative,titleSession} from './run.mjs';
import {enqueue} from '../work/run.mjs';
import {judgePending} from './mail.mjs';
import {refreshQuota} from '../usage/run.mjs';
import {settingsView,saveSettings} from '../dashboard/settings.mjs';
import {createServer} from '../dashboard/server.mjs';
import {launchEdge} from '../automation/browser-launch.mjs';
import {withoutTitle} from '../automation/titleless.mjs';
import {memory2Tick} from '../memory2/auto.mjs';
import {profilesView} from '../prompts/profiles.mjs';

if(process.env.PHD_ISOLATED_TESTS!=='1')throw new Error('Use scripts/run-tests.mjs');
const modes=selected=>Object.fromEntries(PROVIDERS.map(p=>[p,selected.includes(p)?'on':'off']));
async function office(selected,fn){
  const files=['agent/config.json','work/queue.json','.runtime/agent/sessions.json'];
  const saved=files.map(file=>read(file));
  try {
    write('agent/config.json',{...saved[0],provider_modes:modes(selected),memory_v2:{enabled:false},automatic_codex_reset_credit:false});
    write('work/queue.json',{...saved[1],items:[]});write('.runtime/agent/sessions.json',{sessions:[]});
    return await fn();
  }finally{files.forEach((file,i)=>write(file,saved[i]));}
}

test('auto detects each CLI independently from local installation and login evidence, without exposing credentials',()=>{
  const dir=fs.mkdtempSync(path.join(root,'.runtime/provider-detect-'));
  try {
    const env={USERPROFILE:dir,APPDATA:dir,CODEX_HOME:dir,CLAUDE_CONFIG_DIR:dir,MAIL_FLOW_CODEX_BIN:path.join(dir,'codex.mjs'),WORKFLOW_CLAUDE_BIN:path.join(dir,'claude.exe')};
    const cfg={provider_modes:{deepseek:'off'}};
    assert.equal(providerStatus(cfg,env).codex.available,false);
    fs.writeFileSync(env.MAIL_FLOW_CODEX_BIN,'');fs.writeFileSync(path.join(dir,'auth.json'),JSON.stringify({tokens:{access_token:'fixture-private'}}));
    let status=providerStatus(cfg,env);
    assert.equal(status.codex.available,true);assert.equal(status.claude.available,false);
    fs.writeFileSync(env.WORKFLOW_CLAUDE_BIN,'');fs.writeFileSync(path.join(dir,'.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'fixture-private'}}));
    status=providerStatus(cfg,env);assert.equal(status.claude.available,true);
    fs.writeFileSync(path.join(dir,'auth.json'),'broken');
    assert.equal(providerStatus(cfg,env).codex.available,false,'an installed CLI alone is not a configured subscription');
    fs.writeFileSync(path.join(dir,'auth.json'),'{"tokens":{}}');
    assert.equal(providerStatus(cfg,env).codex.available,false,'an empty token container is not login evidence');
    assert.equal(providerStatus({provider_modes:{codex:'off',claude:'off',deepseek:'off'}},env).claude.available,false);
    assert.ok(!JSON.stringify(status).includes('fixture-private'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

for(const provider of PROVIDERS)test(`only ${provider}: submit, execute, reply, follow-up and new task defaults work without the other subscriptions`,()=>office([provider],async()=>{
  const job=submit({text:'普通用户的新对话'});assert.equal(job.provider,provider);
  const calls=[];
  const runner=withoutTitle(async(p,prompt,opts)=>{calls.push(p);assert.equal(opts.mode,'work');return {result:'仅用已有助手完成回复'};});
  await execute(job.task_id,runner);
  const follow=submit({text:'接着做',session_id:job.session_id});assert.equal(follow.provider,provider);
  await execute(follow.task_id,runner);
  const group=submit({text:'@all 一起看看'});assert.equal(group.provider,provider);
  await execute(group.task_id,runner);
  assert.deepEqual(calls,[provider,provider,provider]);
  assert.equal(agentSnapshot().sessions.find(s=>s.id===job.session_id).messages.at(-1).text,'仅用已有助手完成回复');
  assert.equal(read('work/queue.json').items.find(i=>i.id===group.task_id).status,'done');
  const task=enqueue({title:'默认文献任务',profile:'literature',status:'open'});
  assert.equal(task.actor,provider);
  const policy=profilesView().find(p=>p.id==='literature');
  if(policy.actor!==provider){assert.equal(task.model,undefined);assert.equal(task.effort,undefined,'foreign model/effort do not leak onto the new actor');}
}));

test('explicit missing colleague is rejected before writing messages or jobs; @两位 does not become an unnamed third person',()=>office(['deepseek'],async()=>{
  const before=JSON.stringify(agentSnapshot().sessions),queue=JSON.stringify(read('work/queue.json'));
  assert.throws(()=>submit({text:'@Codex 看看'}),/Codex 当前不可用.*已停用/);
  assert.throws(()=>submit({text:'@两位 看看'}),/暂无可用助手/);
  assert.equal(JSON.stringify(agentSnapshot().sessions),before);assert.equal(JSON.stringify(read('work/queue.json')),queue);
  await assert.rejects(invokeNative('codex','unused',{directory:path.join(root,'.runtime/must-not-launch')}),/当前不可用/);
  assert.equal(fs.existsSync(path.join(root,'.runtime/must-not-launch')),false);
}));

test('a missing previous speaker falls back for a new unmentioned turn, while old ownership and messages remain unchanged',()=>office(['codex'],async()=>{
  const job=submit({text:'first'});await execute(job.task_id,withoutTitle(async()=>({result:'prior response'})));
  const old=read('work/queue.json').items.find(i=>i.id===job.task_id);
  const cfg=read('agent/config.json');write('agent/config.json',{...cfg,provider_modes:modes(['claude'])});
  assert.equal(submit({text:'continue',session_id:job.session_id}).provider,'claude');
  assert.equal(read('work/queue.json').items.find(i=>i.id===old.id).actor,old.actor);
  assert.ok(agentSnapshot().sessions.find(s=>s.id===job.session_id).messages.some(m=>m.text==='prior response' && m.provider==='codex'));
}));

test('normal chat reaches the real native child-process boundary with both other providers absent',()=>office(['codex'],async()=>{
  const previous=process.env.MAIL_FLOW_CODEX_BIN;
  process.env.MAIL_FLOW_CODEX_BIN=path.join(root,'agent/fixtures/available-codex.mjs');
  try {
    const cfg=read('agent/config.json');write('agent/config.json',{...cfg,title_provider:'claude',codex_resume_sessions:[]});
    const job=submit({text:'确认只有一家助手也能真正开始执行。'});
    await execute(job.task_id);
    const item=read('work/queue.json').items.find(i=>i.id===job.task_id);
    assert.equal(item.status,'done');
    const reply=agentSnapshot().sessions.find(s=>s.id===job.session_id).messages.at(-1);
    assert.equal(reply.provider,'codex');assert.equal(reply.text,'原生进程已完成：无需其他订阅助手。');
    assert.ok(fs.existsSync(path.join(root,'.runtime/agent/runs',job.task_id,'events.jsonl')));
  }finally{if(previous===undefined)delete process.env.MAIL_FLOW_CODEX_BIN;else process.env.MAIL_FLOW_CODEX_BIN=previous;}
}));

test('zero providers: backend and program actions remain usable, model requests explain setup, and quota refresh starts no provider',()=>office([],async()=>{
  assert.throws(()=>submit({text:'hello'}),/尚无可用助手.*无需集齐订阅/);
  assert.equal(submit({text:'生成周计划'}).provider,'program');
  await refreshQuota(); // A network/native call here would fail or hang: all three must be skipped.
  const result=await judgePending({config:{...read('agent/config.json'),automatic_mail_judgment:true},invoke:()=>{throw new Error('must not call');}});
  assert.equal(result.skipped,'provider-unavailable');
  assert.equal(await titleSession('not-a-session'),null);
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/health`)).status,200);}finally{await new Promise(r=>server.close(r));}
}));

test('mail/title/memory helpers can be explicitly configured for the sole provider without changing the chat model',()=>office(['claude'],async()=>{
  const chat=read('agent/config.json').claude_model;
  saveSettings({mail_provider:'claude',mail_screen_model:'haiku',mail_judgment_model:'sonnet',title_provider:'claude',title_model:'haiku','memory_extract.claude.model':'haiku'});
  let cfg=read('agent/config.json');assert.equal(cfg.mail_provider,'claude');assert.equal(cfg.memory_extract.claude.provider,'claude');assert.equal(cfg.claude_model,chat);
  assert.ok(settingsView().fields.find(f=>f.key==='memory_extract.deepseek.model'));
  saveSettings({title_provider:'deepseek',title_model:'deepseek-flash',title_effort:'off','memory_extract.deepseek.model':'deepseek-flash','memory_extract.deepseek.effort':'max'});
  cfg=read('agent/config.json');assert.equal(cfg.title_effort,'off');assert.equal(cfg.memory_extract.deepseek.provider,'deepseek');
  assert.throws(()=>saveSettings({mail_provider:'codex'}),/邮件粗筛模型/,'a provider switch cannot leave foreign tier models behind');
}));

test('mail judging actually uses the selected non-Codex provider and its model',()=>office(['claude'],async()=>{
  const directory=fs.mkdtempSync(path.join(root,'.runtime/provider-mail-'));
  try {
    fs.writeFileSync(path.join(directory,'review-packet.json'),JSON.stringify({packet_id:'only-claude',messages:[{id:'source-message',fingerprint:'f1',related_task_ids:[]}],tasks:[]}));
    const cfg={...read('agent/config.json'),automatic_mail_judgment:true,mail_provider:'claude',mail_screen_model:'haiku',mail_screen_effort:'low'};
    const seen=[];
    const result=await judgePending({directory,config:cfg,invoke:async(provider,prompt,options)=>{
      seen.push([provider,options.model]);const p=JSON.parse(prompt.split('判断包：\n')[1]);
      return {result:JSON.stringify({packet_id:p.packet_id,decisions:p.messages.map(m=>({message_id:m.id,decision:'ignore'}))})};
    },apply:async()=>({applied:1})});
    assert.equal(result.applied,1);assert.deepEqual(seen,[['claude','haiku']]);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}));

test('default memory maintenance skips unavailable owners/extractors without attempts or model calls',()=>office([],async()=>{
  const result=await memory2Tick({now:Date.now(),config:{owners:PROVIDERS,idle_minutes:0,ingest_hours:24,consolidate_hours:168}});
  assert.equal(result.state,'nothing-due');assert.deepEqual(result.done,[]);
}));

test('browser: one-provider configuration is visible, missing mention buttons are disabled, and settings save without a restart',()=>office(['claude'],async()=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;let browser;
  try {
    browser=await launchEdge();const page=await browser.newPage();
    await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
    await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('[data-mention="@Codex"]').disabled);
    assert.equal(await page.locator('[data-mention="@Claude"]').isEnabled(),true);
    assert.equal(await page.locator('[data-mention="@DeepSeek"]').isDisabled(),true);
    assert.match(await page.locator('#message').getAttribute('placeholder'),/可用助手：Claude/);
    await page.locator('.nav[data-page="more"]').click();
    await page.locator('.more-tab[data-page="connections"]').click();
    await page.locator('[data-settings-tab="models"]').click();
    assert.equal(await page.locator('[id="set-provider_modes.claude"]').inputValue(),'on');
    await page.locator('[id="set-provider_modes.codex"]').selectOption('on');
    await page.locator('[data-settings-section="models"] [data-settings-save]').click();
    await page.waitForFunction(()=>document.querySelector('[data-settings-section="models"] .settings-status').textContent.includes('保存'));
    assert.equal(read('agent/config.json').provider_modes.codex,'on');
    await page.locator('#set-title_provider').selectOption('deepseek');
    assert.ok((await page.locator('#set-title_effort option').allTextContents()).includes('off'),'changing the provider refreshes the paired effort picker too');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}));
