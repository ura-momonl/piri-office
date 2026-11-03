import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root,read,write} from '../automation/files.mjs';
import {pageRegistry,pageById,pageGroups,pageAssets,renderPageShell} from './pages.mjs';
import {createServer} from './server.mjs';
import {launchEdge} from '../automation/browser-launch.mjs';
if(process.env.PHD_ISOLATED_TESTS!=='1')throw new Error('Use scripts/run-tests.mjs');

test('every registered page has content, a renderer, navigation and public assets',()=>{
  const template=fs.readFileSync(path.join(root,'dashboard/index.html'),'utf8');
  const ids=pageRegistry.map(p=>p.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual([...template.matchAll(/<section data-page-content="([^"]+)">/g)].map(m=>m[1]).sort(),[...ids].sort());
  const html=renderPageShell(template);
  for(const p of pageRegistry){
    assert.equal(pageById[p.id],p);assert.equal(typeof p.render,'function');
    assert.ok(html.includes(`id="page-${p.id}"`),p.id);
    assert.ok(html.includes(`data-page="${p.id}"`),p.id);
    if(p.group)assert.ok(pageGroups[p.group]);
  }
  for(const file of Object.values(pageAssets))assert.ok(fs.existsSync(path.join(root,'dashboard',file)),file);
});

test('unknown POSTs are 404 without touching work; JSON policy and per-route limits survive',async()=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body='{}',headers={'content-type':'application/json'})=>fetch(base+route,{method:'POST',headers,body});
  const saved=['work/queue.json','work/turns.json'].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]);
  try{
    const shell=await fetch(base+'/');assert.equal(shell.status,200);assert.ok(shell.headers.get('etag'));
    assert.equal((await fetch(base+'/',{headers:{'if-none-match':shell.headers.get('etag')}})).status,304,'generated HTML keeps static revalidation');
    assert.ok((await shell.text()).includes('id="page-chat"'));
    for(const route of ['/api/not-registered','/api/task-updat','/api/settings/unknown'])assert.equal((await post(route)).status,404,route);
    assert.equal((await post('/api/not-registered','not json',{})).status,404);
    const oversized=await post('/api/task-update',JSON.stringify({id:'missing',padding:'x'.repeat(16000)}));
    assert.equal(oversized.status,400);assert.match((await oversized.json()).error,/request too large/);
    const largePrompt=await post('/api/prompts/preview',JSON.stringify({id:'turn/request',body:'x'.repeat(17000)}));
    assert.equal(largePrompt.status,200,'prompt route retains its larger body budget');
    assert.equal((await post('/api/task-update','{}',{'content-type':'text/plain'})).status,400);
    const foreign=await post('/api/task-update','{}',{'content-type':'application/json',origin:'http://foreign.example'});
    assert.equal(foreign.status,400);assert.match((await foreign.json()).error,/Origin mismatch/);
    assert.equal((await post('/api/chat')).status,403,'chat still distinguishes user and assistant entry');
    for(const [f,body] of saved)assert.equal(fs.readFileSync(path.join(root,f),'utf8'),body,f);
  }finally{await new Promise(r=>server.close(r));}
});

test('real Edge navigates every registered page through the generated controls and scoped state', {timeout:90000},async()=>{
  const config=read('agent/config.json');write('agent/config.json',{...config,enabled:false});
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;let browser;
  try{
    for(const asset of ['/pages.mjs',...Object.keys(pageAssets)]){
      const response=await fetch(base+asset);assert.equal(response.status,200,asset);
    }
    browser=await launchEdge();const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.route('**/api/usage/refresh',r=>r.fulfill({json:{}}));
    await page.route('**/api/companion/notes',r=>r.fulfill({json:{enabled:false,messages:[]}}));
    await page.goto(base);await page.locator('#page-chat[aria-busy="false"]').waitFor();
    for(const p of pageRegistry){
      const sidebar=pageGroups[p.group]?.sidebar.id || p.sidebar.id;
      await page.locator(`.nav[data-page="${sidebar}"]`).click();
      if(p.group)await page.locator(`#${pageGroups[p.group].tabs} [data-page="${p.id}"]`).click();
      await page.locator(`#page-${p.id}[aria-busy="false"]`).waitFor();
      assert.equal(await page.locator('.page:visible').getAttribute('id'),'page-'+p.id,p.id);
      assert.equal(await page.locator('#page-title').textContent(),p.title);
      assert.equal((await fetch(base+'/api/state?page='+p.id)).status,200,p.id);
    }
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(root,'.runtime/page-registry-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.nav[data-page="chat"]').click();await page.locator('#page-chat[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('#chat-tabs').isVisible(),true);
    await page.screenshot({path:path.join(root,'.runtime/page-registry-mobile.png'),fullPage:true});
  }finally{await browser?.close();await new Promise(r=>server.close(r));write('agent/config.json',config);}
});
