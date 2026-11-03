import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root,read,write} from '../automation/files.mjs';
import {initializeSetup,setupStatus,setupCommand,launchSetup,saveSetupCredentials,connectSetup} from './setup.mjs';
import {createServer} from './server.mjs';
import {agentSnapshot,submit} from '../agent/run.mjs';
import {claudeArgs} from '../agent/claude.mjs';
import {codexLaunch} from '../agent/codex.mjs';
import {spawnSync} from 'node:child_process';
import {launchEdge} from '../automation/browser-launch.mjs';

if(process.env.PHD_ISOLATED_TESTS!=='1')throw new Error('Use scripts/run-tests.mjs');
const cfgFile='agent/config.json',stateFile='.runtime/setup.json';
const authKeys=['USERPROFILE','APPDATA','CODEX_HOME','CLAUDE_CONFIG_DIR','MAIL_FLOW_CODEX_BIN','WORKFLOW_CLAUDE_BIN','OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'];
async function fresh(fn){
  const files=[cfgFile,stateFile,'.runtime/agent/sessions.json','work/queue.json','work/turns.json','.runtime/usage/runs.jsonl','.runtime/deepseek-harness/credentials.json','.runtime/deepseek-harness/provider.json','.runtime/commandcode/credentials.json'];
  const saved=new Map(files.map(f=>[f,fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f)):null]));
  const env=new Map(authKeys.map(k=>[k,process.env[k]]));
  const folder=fs.mkdtempSync(path.join(root,'.runtime/setup-test-'));
  try{
    for(const f of [stateFile,'.runtime/usage/runs.jsonl','.runtime/deepseek-harness/credentials.json','.runtime/commandcode/credentials.json'])fs.rmSync(path.join(root,f),{force:true});
    const cfg=read(cfgFile);write(cfgFile,{...cfg,enabled:true,provider_modes:{codex:'auto',claude:'auto',deepseek:'auto'},automatic_mail_judgment:true,automatic_cards:true,memory_v2:{...cfg.memory_v2,enabled:true,auto:{...cfg.memory_v2?.auto,enabled:true}}});
    write('.runtime/agent/sessions.json',{sessions:[]});write('work/queue.json',{...read('work/queue.json'),items:[]});
    for(const k of authKeys)delete process.env[k];
    Object.assign(process.env,{USERPROFILE:folder,APPDATA:folder,CODEX_HOME:path.join(folder,'.codex'),CLAUDE_CONFIG_DIR:path.join(folder,'.claude'),MAIL_FLOW_CODEX_BIN:path.join(folder,'codex.mjs'),WORKFLOW_CLAUDE_BIN:path.join(folder,'claude.exe')});
    const install=p=>fs.writeFileSync(p==='codex'?process.env.MAIL_FLOW_CODEX_BIN:process.env.WORKFLOW_CLAUDE_BIN,'// offline fixture');
    const login=p=>{const directory=p==='codex'?process.env.CODEX_HOME:process.env.CLAUDE_CONFIG_DIR;fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,p==='codex'?'auth.json':'.credentials.json'),JSON.stringify(p==='codex'?{tokens:{access_token:'fixture-only'}}:{claudeAiOauth:{accessToken:'fixture-only'}}));};
    return await fn({folder,install,login});
  }finally{
    for(const [k,v]of env)if(v===undefined)delete process.env[k];else process.env[k]=v;
    for(const [f,bytes]of saved){const file=path.join(root,f);if(bytes===null)fs.rmSync(file,{force:true});else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}}
    fs.rmSync(folder,{recursive:true,force:true});
  }
}
const serving=async(options,fn)=>{const server=createServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{return await fn(server,`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(r=>server.close(r));}};
const post=(base,action,body,origin=base)=>fetch(base+'/api/setup/'+action,{method:'POST',headers:{'content-type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});

test('fresh office pauses all automatic model work, while an existing office keeps its settings',()=>fresh(async()=>{
  initializeSetup();assert.equal(read(stateFile).pending,true);
  const cfg=read(cfgFile);for(const key of ['enabled','automatic_mail_judgment','automatic_cards','automatic_codex_reset_credit'])assert.equal(cfg[key],false,key);
  assert.equal(cfg.memory_v2.auto.enabled,false);
  assert.equal(cfg.memory_v2.enabled,false,'a first chat does not depend on a separate embedding runtime');
  assert.equal(Object.values(setupStatus().providers).some(p=>p.available),false);
  assert.throws(()=>submit({text:'未完成接入时试着聊天'}),/接入向导完成连接测试/);
  assert.equal(read('work/queue.json').items.length,0,'unverified messages do not become surprise work after connection');
  fs.rmSync(path.join(root,stateFile));
  write(cfgFile,{...cfg,enabled:true,automatic_mail_judgment:true});
  write('.runtime/agent/sessions.json',{sessions:[{messages:[{role:'assistant',text:'old conversation'}]}]});
  const before=fs.readFileSync(path.join(root,cfgFile));initializeSetup();
  assert.ok(fs.readFileSync(path.join(root,cfgFile)).equals(before));assert.equal(read(stateFile).legacy,true);
}));

test('install/login actions are fixed, confirmed, and never claim that a launched console completed the action',()=>fresh(async({install})=>{
  assert.match(setupCommand('codex','install'),/@openai\/codex/);assert.match(setupCommand('claude','install'),/https:\/\/claude.ai\/install.ps1/);
  const sdk=setupCommand('deepseek','install');assert.match(sdk,/deepseek-harness-sdk==0.2.1rc2/);assert.match(sdk,/@deepseek-ai\/dsh@0.2.1-rc.4/);assert.doesNotMatch(sdk,/bypass|Set-ExecutionPolicy|runas/i);
  let calls=0;const launcher=async({code,confirmed})=>{calls++;assert.equal(confirmed,true);assert.doesNotMatch(code,/api_key/);return {started:true,pid:123};};
  await assert.rejects(launchSetup({provider:'codex',action:'install'},{launcher}),/确认/);
  const result=await launchSetup({provider:'codex',action:'install',confirmed:true},{launcher});assert.equal(calls,1);assert.match(result.message,/不代表.*成功/);
  install('codex');await launchSetup({provider:'codex',action:'login',confirmed:true},{launcher});assert.equal(calls,2);
  await assert.rejects(launchSetup({provider:'codex; Remove-Item',action:'install',confirmed:true},{launcher}),/请选择/);assert.equal(calls,2);
}));

test('all generated installation and login commands parse in the actual Windows PowerShell without executing installers',{skip:process.platform!=='win32'},()=>fresh(async({folder})=>{
  for(const [provider,action] of [['codex','install'],['claude','install'],['deepseek','install'],['codex','login'],['claude','login']]){
    const file=path.join(folder,provider+'-'+action+'.ps1');fs.writeFileSync(file,'\uFEFF'+setupCommand(provider,action));
    const quoted="'"+file.replace(/'/g,"''")+"'";
    const command=`$t=$null; $e=$null; [System.Management.Automation.Language.Parser]::ParseFile(${quoted},[ref]$t,[ref]$e)|Out-Null; if($e.Count){$e|ForEach-Object{Write-Output $_.Message}; exit 1}`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,provider+' '+action+': '+result.stdout+result.stderr);
  }
}));

test('credentials remain only in the chosen local store, never in state responses or the other channel',()=>fresh(async()=>{
  initializeSetup();
  const secret='fixture-私密-key';
  const result=saveSetupCredentials({provider:'deepseek',channel:'official',api_key:secret,confirmed:true});
  assert.ok(!JSON.stringify(result).includes(secret));assert.equal(read('.runtime/deepseek-harness/credentials.json').api_key,secret);
  assert.equal(read('.runtime/deepseek-harness/credentials.json').base_url,'https://api.deepseek.com/anthropic');
  saveSetupCredentials({provider:'deepseek',channel:'commandcode',api_key:'second-fixture',confirmed:true});
  assert.equal(saveSetupCredentials({provider:'deepseek',channel:'official',api_key:'',confirmed:true}).reused,true);
  assert.equal(read('.runtime/deepseek-harness/provider.json').provider,'official');
  saveSetupCredentials({provider:'deepseek',channel:'commandcode',api_key:'',confirmed:true});
  assert.equal(read('.runtime/deepseek-harness/credentials.json').api_key,secret);
  assert.equal(read('.runtime/deepseek-harness/provider.json').provider,'commandcode');
  assert.equal(read(cfgFile).enabled,false,'saving a key cannot start queued or background work');
  assert.throws(()=>saveSetupCredentials({provider:'deepseek',api_key:'bad\nkey',confirmed:true}),/控制字符/);
}));

test('failed test makes one tool-less request, restores the provider switch, and never exposes native errors or enables automation',()=>fresh(async({install,login})=>{
  initializeSetup();install('codex');login('codex');
  const cfg=read(cfgFile);write(cfgFile,{...cfg,provider_modes:{...cfg.provider_modes,codex:'off'}});
  let calls=0;const runner=async(provider,prompt,options)=>{calls++;assert.equal(provider,'codex');assert.equal(options.mode,'ask');assert.equal(options.purpose,'setup-test');assert.equal(options.systemPrompt,'');assert.match(prompt,/只回复 OK/);assert.ok(!prompt.includes('projects/catalog'));throw new Error('credential-secret-must-not-escape');};
  await assert.rejects(connectSetup({provider:'codex',model:'gpt-6.1-sol',confirmed:false},{runner}),/确认/);assert.equal(calls,0);
  await assert.rejects(connectSetup({provider:'codex',model:'gpt-6.1-sol',confirmed:true},{runner}),e=>!e.message.includes('credential-secret') && /未重复发起/.test(e.message));
  assert.equal(calls,1);assert.equal(read(cfgFile).provider_modes.codex,'off');assert.equal(read(cfgFile).enabled,false);assert.equal(read(stateFile).pending,true);
}));

test('connection cannot overlap or restart the backend; native authentication works without a local token file and adopts the chosen model',()=>fresh(async({install})=>{
  initializeSetup();install('claude');
  assert.equal(setupStatus().providers.claude.configured,false,'native credential-store login can be verified by the explicit test');
  let release,calls=0;const wait=new Promise(r=>release=r);
  const pending=connectSetup({provider:'claude',model:'sonnet',confirmed:true},{runner:async()=>{calls++;await wait;return {result:'OK'};}});
  await assert.rejects(connectSetup({provider:'claude',model:'sonnet',confirmed:true},{runner:async()=>{calls++;}}),/正在进行/);
  assert.throws(()=>saveSetupCredentials({provider:'deepseek',api_key:'unrelated',confirmed:true}),/正在进行/);
  await serving({restartBackend:()=>{}},async(_,base)=>{
    assert.equal((await (await fetch(base+'/health')).json()).background_busy,true);
    const res=await fetch(base+'/api/backend/restart',{method:'POST',headers:{Origin:base,'content-type':'application/json'},body:'{}'});assert.equal(res.status,409);
  });
  release();const result=await pending;assert.equal(result.connected,true);assert.equal(result.testing,false);assert.equal(calls,1);
  const cfg=read(cfgFile);assert.equal(cfg.enabled,true);assert.equal(cfg.default_provider,'claude');assert.equal(cfg.claude_model,'sonnet');assert.equal(cfg.automatic_mail_judgment,false);assert.equal(cfg.memory_v2.auto.enabled,false);
}));

test('setup POST endpoints reject missing/cross origins, accept local confirmed input, and do not echo keys',()=>fresh(async()=>serving({},async(_,base)=>{
  for(const origin of ['', 'https://elsewhere.example'])for(const action of ['launch','credentials','connect'])assert.equal((await post(base,action,{},origin)).status,403);
  const res=await post(base,'credentials',{provider:'deepseek',api_key:'api-fixture-private',confirmed:true});assert.equal(res.status,200);assert.ok(!(await res.text()).includes('api-fixture-private'));
  assert.equal((await (await fetch(base+'/api/setup')).json()).state.pending,true);
})));

test('optional desktop absence/presence changes only MCP activation, never core chat tools',()=>fresh(async({folder})=>{
  const file=path.join(root,'software/computer-use/mcp.json'),before=fs.readFileSync(file);
  try{
    const command=path.join(folder,'optional-desktop.exe');fs.writeFileSync(file,JSON.stringify({mcpServers:{'windows-mcp':{command,args:[],env:{}}}}));
    const args=claudeArgs('sonnet');assert.equal(args.includes('--mcp-config'),false);assert.ok(args.includes('--strict-mcp-config'));assert.ok(args.includes('default'));
    assert.ok(codexLaunch('普通聊天').overrides.includes('mcp_servers.windows-mcp.enabled=false'));
    fs.writeFileSync(command,'fixture');
    assert.ok(claudeArgs('sonnet').includes('--mcp-config'));assert.ok(codexLaunch('普通聊天').overrides.includes('mcp_servers.windows-mcp.enabled=true'));
  }
  finally{fs.writeFileSync(file,before);}
}));

test('fresh native path: explicit HTTP test starts a child process, then the first real chat reaches the same provider without other subscriptions',()=>fresh(async({login})=>{
  process.env.MAIL_FLOW_CODEX_BIN=path.join(root,'agent/fixtures/available-codex.mjs');login('codex');
  await serving({},async(_,base)=>{
    const result=await post(base,'connect',{provider:'codex',model:'gpt-6.1-sol',confirmed:true});assert.equal(result.status,200,await result.clone().text());
    const cfg=read(cfgFile);write(cfgFile,{...cfg,title_provider:'claude',codex_resume_sessions:[]});
    const res=await fetch(base+'/api/chat',{method:'POST',headers:{Origin:base,'content-type':'application/json'},body:JSON.stringify({text:'第一条普通聊天'})});assert.equal(res.status,200);
    const job=await res.json(),end=Date.now()+15000;let session;
    do{session=agentSnapshot().sessions.find(s=>s.id===job.session_id);if(session?.messages.some(m=>m.role==='assistant'&&!m.interim))break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<end);
    assert.ok(session.messages.some(m=>m.provider==='codex' && m.text==='原生进程已完成：无需其他订阅助手。'));
  });
}));

test('browser: zero-provider home -> install -> login -> one test -> first-chat entry, with no implicit model request',()=>fresh(async({install,login})=>{
  let native=0,launches=0;
  await serving({setupRunner:async()=>{native++;return {result:'OK'};},setupLauncher:async({code})=>{launches++;if(code.includes('install --global'))install('codex');else login('codex');return {started:true,pid:123};}},async(_,base)=>{
    let browser;
    try{
      browser=await launchEdge();const page=await browser.newPage({viewport:{width:1280,height:900}});
      page.on('dialog',dialog=>dialog.accept());await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
      await page.goto(base);await page.locator('[data-open-setup]').waitFor({state:'visible'});assert.equal(native,0);
      await page.screenshot({path:path.join(root,'.runtime/setup-home.png')});
      await page.locator('[data-open-setup]').click();await page.locator('[data-setup-action="install"]').click();
      await page.waitForFunction(()=>document.querySelector('[data-setup-message]').textContent.includes('打开窗口不代表'));
      await page.locator('[data-setup-action="refresh"]').click();await page.locator('[data-setup-action="login"]').click();
      await page.waitForFunction(()=>document.querySelector('[data-setup-message]').textContent.includes('打开窗口不代表'));
      await page.locator('[data-setup-action="refresh"]').click();assert.equal(native,0);assert.equal(launches,2);
      await page.locator('[data-setup-action="connect"]').click();await page.locator('[data-setup-action="chat"]').waitFor({state:'visible'});assert.equal(native,1);
      await page.screenshot({path:path.join(root,'.runtime/setup-connected.png'),fullPage:true});
      await page.locator('[data-setup-action="chat"]').click();await page.waitForFunction(()=>document.getElementById('first-run').hidden);
      assert.equal(await page.locator('[data-mention="@Codex"]').isEnabled(),true);assert.equal(await page.locator('[data-mention="@Claude"]').isDisabled(),true);
      await page.locator('.nav[data-page="more"]').click();await page.locator('.more-tab[data-page="connections"]').click();await page.locator('[data-settings-tab="setup"]').click();
      await page.locator('[data-setup-provider]').selectOption('deepseek');
      await page.locator('[data-setup-key]').fill('browser-fixture-private');
      const saved=page.waitForResponse(r=>r.url().endsWith('/api/setup/credentials'));
      await page.locator('[data-setup-action="save"]').click();
      assert.ok(!(await (await saved).text()).includes('browser-fixture-private'));
      await page.waitForFunction(()=>document.querySelector('[data-setup-key]').value==='');
      assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes('browser-fixture-private'));
      assert.equal(native,1,'saving an API key is not a hidden connection test');
      await page.screenshot({path:path.join(root,'.runtime/setup-api.png'),fullPage:true});
    }finally{await browser?.close();}
  });
}));
