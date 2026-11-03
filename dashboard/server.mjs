import {pageAssets,renderPageShell} from './pages.mjs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {FILE_LIMITS} from '../agent/files.mjs';
import {IMAGE_LIMITS,sniffImageMime} from '../agent/images.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { root, read, sharedReads, dashboardPort } from '../automation/files.mjs';
import { openLedger, ledgerFile } from '../mail-flow/ledger.mjs';
import { ensureQueue, splitQueue, enqueue, setStepStatus, renderPlan, workSnapshot, stepEditor, editStep, moveStep, newStepEditor, addStep } from '../work/run.mjs';
import { agentSnapshot, findSessions, submit, sendChat, editMessage, drain, stop, markCardTasks, deleteSession, renameSession, pinSession, recoverInterruptedWork, answerQuestion } from '../agent/run.mjs';
import {availableProviders,defaultProvider,providerNames} from '../agent/providers.mjs';
import {initializeSetup,setupStatus,launchSetup,saveSetupCredentials,connectSetup,setupBusy} from './setup.mjs';
import { weeklySnapshot, weekView, weekOf, planningWeek, markdown, tick, addIntent, updateIntent, removeIntent, saveReview, startIntent } from '../weekly/run.mjs';
import { usageSnapshot, refreshQuota, quotaView } from '../usage/run.mjs';
import { backupData } from '../automation/backup.mjs';
import { ensureOffice } from '../automation/first-run.mjs';
import { housekeepingDaily } from '../housekeeping/run.mjs';
import { inboxItems, acknowledgeInbox, inboxActivity, undoAcknowledgment } from './inbox.mjs';
import { reviewDetails } from './review.mjs';
import { sessionForCard } from './cards.mjs';
import { focusProject, resolveLink, proposeLinks, renderAllStatus, setProjectArchived, resolveProjectFile, attachProjectFiles, projectNode, withFramework, setNodeStatus } from '../projects/run.mjs';
import { judgePending, pickBareCards, automationToday, automationBudget } from '../agent/mail.mjs';
import { taskHandler, taskEvidence } from '../mail-flow/flow.mjs';
import {projectEditor,editProjectFramework,addRelated} from '../projects/run.mjs';
import {upcoming,calendarData,addEvent,addEvents,updateEvent,removeEvent} from '../calendar/run.mjs';
import {memory2Tick} from '../memory2/auto.mjs';
import {memoryVersion} from '../memory2/telemetry.mjs';
import {runtimeCodeStatus} from '../automation/file-state.mjs';
import {splitState} from './ui-state.mjs';
import {avatarView,avatarCss,setCustomAvatar,customFile} from './avatars.mjs';
import {executionRows,runningSubagents} from './activity.mjs';
import {migrateSessionBaselines} from '../agent/file-baselines.mjs';
import {chatReadState,markChatRead} from './chat-read.mjs';
import {promptOverview,promptFragment,promptPreview,promptSnapshot} from '../prompts/view.mjs';
import {promptRuns,promptRun} from '../prompts/runs.mjs';
import {profilesView,saveProfile,newProfile} from '../prompts/profiles.mjs';
import {savePrivateSkill,removePrivateSkill} from '../prompts/private-skills.mjs';
import {saveFragment,newFragment,moveFragment,removeFragment,snapshot as acceptSnapshot} from '../prompts/run.mjs';
import {instrumentCatalog,instrumentCode,openInstrumentCode,runInstrumentCode,saveInstrument} from '../instruments/library.mjs';
import {launchPowerShell} from './powershell.mjs';
import {settingsView,saveSettings,skillsView} from './settings.mjs';
import {runGithubUpdate} from './github-update.mjs';
import {createSpeech,SPEECH_LIMITS} from './speech.mjs';
import {resolveLocalFile,resolveWorkspaceFile,openInDefaultApp,localFileHeaders,localFileRequestAllowed,revealInExplorer,localActionAllowed} from './local-files.mjs';
import {literatureList,literaturePaper} from '../literature/view.mjs';
import {ensureDailyRecommendations} from '../literature/daily.mjs';
import {fireDue} from '../trigger/run.mjs';
import {officeZone} from '../automation/zone.mjs';
import {checkUpdates as checkDeepSeekUpdates} from '../software/deepseek-harness/updates.mjs';
// Raw activity stays in the agent store; the rail receives task/tool summaries only.
function uiAgent(agent,items) {
  return {...agent,executions:executionRows(agent,items),subagents:runningSubagents(agent,items),sessions:agent.sessions.map(({activity,...session})=>session)};
}
export const snapshot=(options)=>sharedReads(()=>buildSnapshot(options));
// The project page only lists papers linked to a project. The full catalog is ~80 MB, so keep just those papers and re-read only when the file changes.
let projectPapersCache;
function projectLiterature() {
  const file=path.join(root,'literature/catalog.json');
  if(!fs.existsSync(file))return {papers:[]};
  const stat=fs.statSync(file),key=stat.size+':'+stat.mtimeMs;
  if(projectPapersCache?.key!==key){const catalog=read('literature/catalog.json');projectPapersCache={key,value:{...catalog,papers:catalog.papers.filter(p=>p.project_ids?.length)}};}
  return projectPapersCache.value;
}
export function buildSnapshot({page}={}) {
  // No page is the complete internal/legacy snapshot. Scoped HTTP reads build
  // only the visible page plus the shared rail, inbox count and account quota.
  const scoped=page!==undefined && page!==null;
  const needs=(...pages)=>!scoped || pages.includes(page);
  const file = ledgerFile; let mail = {tasks:[],pending:0,lastRun:null,sent:[]};
  if (fs.existsSync(file)) {
    const db = openLedger();
    try {
      mail.tasks = db.prepare('SELECT id,title,status,action,check_at,deadline FROM tasks ORDER BY check_at').all();
      mail.sent = db.prepare("SELECT data FROM messages WHERE json_extract(data,'$.folder')='sent' ORDER BY json_extract(data,'$.received') DESC LIMIT 10").all().map(r => { const m = JSON.parse(r.data); return {subject:m.subject,recipients:m.recipients,received:m.received,link:m.link}; });
      mail.pending = db.prepare("SELECT count(*) AS n FROM messages WHERE state='pending'").get().n;
      const last = db.prepare("SELECT value FROM meta WHERE key='lastRun'").get();
      mail.lastRun = last ? JSON.parse(last.value) : null;
    } finally { db.close(); }
  }
  const projects = read('projects/catalog.json');
  const work=read('work/queue.json');
  const agent=uiAgent(agentSnapshot(),work.items);
  return {code:runtimeCodeStatus(),office_timezone:officeZone(),agent_read_at:chatReadState(),
    projects:needs('projects') ? withFramework(projects.projects) : projects.projects.map(({id,name,archived_at})=>({id,name,archived_at})),
    links:needs('projects') ? projects.links : [],mail,work:workSnapshot(),agent,
    inbox:inboxItems(mail.tasks,work.items,projects.links,undefined,false,agent.sessions),
    usage:needs('usage','inbox') ? usageSnapshot() : {quota:quotaView(),runs:[]},
    ...(needs('weekly') ? {calendar:upcoming(calendarData(mail.tasks,work.items,projects.links),new Date(),400,true)} : {}),
    ...(needs('inbox') ? {inbox_activity:inboxActivity(),automation:automationToday()} : {}),
    ...(needs('procurement') ? {procurement:read('procurement/catalog.json')} : {}),
    ...(needs('projects') ? {literature:projectLiterature(),project_events:read('calendar/events.json',{events:[]}).events} : {}),
    ...(needs('weekly','projects') ? {weekly:weeklySnapshot()} : {}),
    ...(needs('connections') ? {software:read('software/catalog.json'),
      connections:{claude_installed:fs.existsSync(process.env.WORKFLOW_CLAUDE_BIN || path.join(process.env.USERPROFILE||process.env.HOME||'','.local/bin/claude.exe')),
        discord_configured:!!process.env.DISCORD_BOT_TOKEN, discord_config_file:fs.existsSync(path.join(root,'.runtime/discord.env'))}} : {})};
}
// Which correspondence a mail matter is about, from the full stored thread (not the three-message preview): the newest incoming message gives the
// counterpart and subject. Without any incoming message the entry stays neutral rather than guessing a counterpart or reusing the background task name.
function mailThread(taskId) {
  const messages=taskEvidence(path.join(root,'.runtime/mail-flow'),taskId,{complete:true})?.source_messages || [];
  const clean=subject=>String(subject || '').replace(/^((re|fw|fwd|回复|转发)\s*[:：]\s*)+/i,'').trim();
  const incoming=messages.findLast(x=>!/sent/i.test(x.folder || ''));
  if(incoming)return {sender:String(incoming.sender || '').replace(/^.*</,'').replace(/>.*$/,'').trim() || null,subject:clean(incoming.subject) || null};
  const latest=messages.at(-1);
  return {sender:null,subject:latest ? clean(latest.subject) || null : null};
}
// A card's reply option becomes a bounded follow-up task; clicks and the unattended loop both come through here.
function respondToCard(card,action,s) {
  const session=sessionForCard(s.agent.sessions,card,read('work/queue.json').items);
  // A mail card goes to exactly one agent: the one already handling that mail, i.e. the tier that last decided its task, on that tier's own
  // model and effort. Tasks decided before tiers were recorded go to the judgment tier. Other cards keep their own actor. Routing is by @, so say it.
  const tier=card.source==='mail' ? taskHandler(path.join(root,'.runtime/mail-flow'),card.source_id) || 'judgment' : null,config=read('agent/config.json');
  const provider=tier ? defaultProvider(config.mail_provider || 'codex') : card.actor;
  const mention=providerNames[provider] ? '@'+providerNames[provider]+' ' : '';
  // "让 agent 处理" on a mail card means: follow up this correspondence. The thread (counterpart and subject), not the background judgment's
  // task name, identifies the work; the background judgment stays in the mail evidence as a suggestion.
  const thread=card.source==='mail' && action.id==='agent-handle' ? mailThread(card.source_id) : null;
  const about=thread && [thread.sender,thread.subject && `邮件主题「${thread.subject}」`].filter(Boolean).join('，');
  const request=thread
    ? `${mention}跟进这段往来${about ? '：'+about : ''}。\n${action.reply || action.label}\n原事项：${card.id}`
    : `${mention}针对${card.category}「${card.title}」，我选择：${action.label}。
${action.reply || action.label}
${card.source==='mail' ? '后台对事项的初步判断（不是用户确认的事实，也不限定交付物）' : '事项材料'}：${card.detail}
原事项：${card.id}`;
  const item=submit({title:thread ? (thread.sender || thread.subject ? ['跟进',thread.sender,thread.subject].filter(Boolean).join(' · ') : '跟进 · 邮件往来') : `${action.label} · ${card.title}`,...(tier && provider===(config.mail_provider || 'codex') ? {model:config[`mail_${tier}_model`],effort:config[`mail_${tier}_effort`]} : {}),text:request,session_id:session?.id,project_id:card.project_ids[0],inbox_reply:{id:card.id,fingerprint:card.fingerprint,key:card.key,action_id:action.id,label:action.label}});
  void drain().catch(e=>console.error(e.message));
  return item;
}
// The unattended loop (user-approved 2026-10-05): new mail is judged, then cards without AI-written options get them prepared once per card version.
let automating=false;
export async function automate() {
  if(automating)return;automating=true;
  try {
    const config=read('agent/config.json');
    try {backupData();} catch(e) {console.error('备份失败：'+e.message);}
    try {housekeepingDaily();} catch(e) {console.error('定时清理失败：'+e.message);}
    await judgePending();
    proposeLinks(snapshot().mail.tasks.filter(t=>t.status!=='done'));
    markCardTasks();
    renderAllStatus();
    if(config.automatic_cards && availableProviders(config).length) {
      const s=snapshot();
      const left=automationBudget({config}).left,busy=left<=0 || s.work.items.some(i=>['queued','active'].includes(i.status));
      for(const card of pickBareCards(s.inbox,{limit:Math.min(2,left),busy}))respondToCard(card,card.actions[0],s);
    }
  } catch(e) {console.error(e.message);}
  try {ensureDailyRecommendations();}catch(e){console.error('每日文献推荐：'+e.message);}
  // One small public npm metadata request per 24h, beside the existing beat.
  // Do not hold mail/memory work on the network check; no installer or model.
  void checkDeepSeekUpdates().catch(e=>console.error('DSH 版本检测：'+e.message));
  // memory2 upkeep (extract, cluster, profile) is slow and model-bound, so it runs beside the beat instead of holding it; it has its own busy guard.
  try {void memory2Tick().then(r=>{for(const l of r.done || [])console.log('memory2：'+JSON.stringify(l));}).catch(e=>console.error('memory2：'+e.message));} catch(e) {console.error('memory2：'+e.message);}
  automating=false;
}
// Lets the launcher tell a server started before the latest code change from a current one.
const startedAt=new Date().toISOString();
// The backend owns every running agent: if it dies, their turns die with it, and the launcher truncates output.log/error.log on each start.
// This append-only file keeps the evidence. A "start" with no later "exit" for that pid means the process was killed from outside
// (TerminateProcess leaves no trace); an "uncaught" entry is a code or transient-IO error. Transient errors are survived, a burst is not.
function recordProcessLifecycle() {
  const file=path.join(root,'.runtime/dashboard/crash.log'),recent=[];
  const log=(kind,detail='')=>{try {fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,`${new Date().toISOString()} pid=${process.pid} ${kind} ${detail}\n`);} catch {}};
  log('start',`ppid=${process.ppid} node=${process.version}`);
  const failed=(kind)=>(error)=>{
    log(kind,String(error?.stack || error).replace(/\s*\n\s*/g,' | '));
    const now=Date.now();recent.push(now);while(recent.length && now-recent[0]>60000)recent.shift();
    if(recent.length>10){log('exit','too many uncaught errors within 60s');process.exit(1);}
  };
  process.on('uncaughtException',failed('uncaught'));
  process.on('unhandledRejection',failed('unhandled'));
  for(const signal of ['SIGINT','SIGTERM','SIGBREAK','SIGHUP'])process.on(signal,()=>{log('signal',signal);process.exit(0);});
  process.on('exit',code=>log('exit',`code=${code}`));
}
function launchBackendRestart({port,pid}) {
  return new Promise((resolve,reject)=>{
    // Detached is required so the helper outlives this process; a detached powershell.exe launched directly exits
    // at once with code 0 without running the script (no console), so cmd.exe supplies the hidden console.
    const child=spawn('cmd.exe',['/d','/c','powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'dashboard/Restart-Backend.ps1'),'-Port',String(port),'-ExpectedProcessId',String(pid)],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});
    child.on('error',reject);
    child.on('exit',code=>code===0 ? resolve() : reject(new Error('后端重启未完成，详情见 .runtime/dashboard/restart-error.log')));
    child.unref();
  });
}
export function createServer({restartBackend,noteRunner,noteRandom,openCode,runCode,openLocalFile=openInDefaultApp,speech=createSpeech(),setupRunner,setupLauncher}={}) {
  initializeSetup();
  const assets = {'/':'index.html','/app.js':'app.js','/workspace.js':'workspace.js','/icons.js':'icons.js','/style.css':'style.css','/workspace.css':'workspace.css','/vendor/pico.min.css':'vendor/pico.min.css'};
  // Only these pure shipped modules are public, never account or runtime files.
  assets['/usage/metrics.mjs']='../usage/metrics.mjs';
  assets['/usage/quota.mjs']='../usage/quota.mjs';
  Object.assign(assets,pageAssets,{'/pages.mjs':'pages.mjs','/theme.css':'theme.css','/theme.js':'theme.js','/format.js':'format.js'});
  assets['/powershell.js']='powershell.js';assets['/voice-input.js']='voice-input.js';
  for(const file of ['markdown.js','local-file-types.js','markdown.css','vendor/markdown/marked.js','vendor/markdown/purify.js','vendor/markdown/katex.js','vendor/markdown/katex.min.css'])assets['/'+file]=file;
  const fontDirectory=path.join(root,'dashboard/vendor/markdown/fonts');
  for(const font of (fs.existsSync(fontDirectory) ? fs.readdirSync(fontDirectory) : []).filter(f=>/^KaTeX_[\w-]+\.(woff2?|ttf)$/.test(f)))assets['/vendor/markdown/fonts/'+font]='vendor/markdown/fonts/'+font;
  // JSON mutation routes own their body limit and handler together. Local OS/setup
  // and binary speech endpoints retain their own protocols.
  const chatLimit=Math.ceil((FILE_LIMITS.total+IMAGE_LIMITS.total)*4/3)+1024*1024;
  const chatReceipt=async (request,{res})=>{
    const job=await sendChat(request);
    const item={...job,session:agentSnapshot().sessions.find(s=>s.id===job.session_id),task:read('work/queue.json').items.find(t=>t.id===job.task_id)};
    // Receipt means persisted, not answered. Flush it before native startup does synchronous work.
    res.once('finish',()=>setImmediate(()=>{if(!server.restartPending)void drain().catch(e=>console.error(e.message));}));
    return item;
  };
  const backgroundBusy=()=>setupBusy() || automating || speech.busy;
  const routes=[
    {path:'/api/backend/restart',limit:16000,handler:(request,{res})=>{
      if(!restartBackend){res.statusCode=501;throw new Error('此服务尚未启用重启入口，请在任务结束后重新打开 Workbench。');}
      if(backgroundBusy() || read('work/queue.json').items.some(i=>i.status==='active' && i.actor!=='user') || agentSnapshot().active_turns.length){res.statusCode=409;throw new Error('还有助手任务或后台工作正在运行，请等它们结束后再重启；用户自己的任务不阻止重启。');}
      server.restartPending=true;server.restartError=null;
      // Finish the accepted response before starting the separate helper that can stop this process.
      res.once('finish',()=>void Promise.resolve().then(()=>restartBackend({port:server.address().port,pid:process.pid})).catch(e=>{server.restartPending=false;server.restartError=e.message;console.error(e.message);}));
      res.once('close',()=>{if(!res.writableFinished)server.restartPending=false;});
      res.statusCode=202;sendJson(res,{started_at:startedAt});return;
    }},
    {path:'/api/chat',limit:chatLimit,handler:chatReceipt},
    {path:'/api/chat/handoff',limit:chatLimit,handler:(request,context)=>{
      if(!request.handoff)throw new Error('助手交接需要发起者和来源任务');
      return chatReceipt(request,context);
    }},
    {path:'/api/chat/edit',limit:chatLimit,handler:(request,{res})=>{
      const job=editMessage(request);
      const item={...job,session:agentSnapshot().sessions.find(s=>s.id===job.session_id),task:read('work/queue.json').items.find(t=>t.id===job.task_id)};
      res.once('finish',()=>setImmediate(()=>{if(!server.restartPending)void drain().catch(e=>console.error(e.message));}));
      return item;
    }},
    {path:'/api/update/check',limit:16000,handler:()=>runGithubUpdate(false)},
    {path:'/api/update/apply',limit:16000,handler:()=>runGithubUpdate(true)},
    {path:'/api/settings',limit:16000,handler:request=>saveSettings(request.changes)},
    {path:'/api/avatars/upload',limit:9*1024*1024,handler:request=>({view:setCustomAvatar(request.who,request.image ?? null)})},
    {path:'/api/chat/read',limit:16000,handler:request=>markChatRead(request.read_at,{agent:agentSnapshot(),work:read('work/queue.json')})},
    {path:'/api/chat/answer',limit:16000,handler:request=>answerQuestion(request)},
    {path:'/api/chat/title',limit:16000,handler:request=>renameSession(request.session_id,request.title)},
    {path:'/api/chat/pin',limit:16000,handler:request=>pinSession(request.session_id,request.pinned)},
    {path:'/api/chat/session',limit:16000,handler:request=>deleteSession(request.session_id)},
    {path:'/api/prompts/preview',limit:512000,handler:request=>promptPreview(String(request.id || ''),request.body)},
    {path:'/api/prompts/save',limit:512000,handler:request=>saveFragment(String(request.id || ''),request.body)},
    {path:'/api/prompts/new',limit:512000,handler:request=>newFragment(String(request.id || ''),String(request.body ?? ''))},
    {path:'/api/prompts/mv',limit:512000,handler:request=>moveFragment(String(request.from || ''),String(request.to || ''))},
    {path:'/api/prompts/rm',limit:512000,handler:request=>removeFragment(String(request.id || ''))},
    {path:'/api/prompts/snapshot-accept',limit:512000,handler:request=>acceptSnapshot(true)},
    {path:'/api/profiles/save',limit:512000,handler:request=>saveProfile(String(request.id || ''),request)},
    {path:'/api/profiles/new',limit:512000,handler:request=>newProfile(String(request.id || ''),request)},
    {path:'/api/profiles/skill-save',limit:512000,handler:request=>savePrivateSkill(String(request.profile || ''),String(request.name || ''),request,{create:request.create===true})},
    {path:'/api/profiles/skill-rm',limit:16000,handler:request=>removePrivateSkill(String(request.profile || ''),String(request.name || ''))},
    {path:'/api/instruments/save',limit:3*1024*1024,handler:request=>saveInstrument(request)},
    {path:'/api/instruments/open',limit:16000,handler:request=>openInstrumentCode(request.id,request.index,openCode)},
    {path:'/api/instruments/run',limit:16000,handler:request=>runInstrumentCode(request.id,request.index,runCode)},
    {path:'/api/projects/related',limit:80000,handler:request=>addRelated(request)},
    {path:'/api/projects/files',limit:Math.ceil(FILE_LIMITS.total*4/3)+1024*1024,handler:request=>attachProjectFiles(request.project_id,request.node_id,request.files)},
    {path:'/api/projects/archive',limit:16000,handler:request=>setProjectArchived(String(request.project_id),request.archived!==false)},
    {path:'/api/stop',limit:16000,handler:request=>{stop(request.task_id);return {stopped:true};}},
    {path:'/api/inbox/ack',limit:16000,handler:request=>acknowledgeInbox(snapshot().inbox.find(i=>i.id===request.id))},
    {path:'/api/inbox/undo',limit:16000,handler:request=>{
      const s=snapshot();
      return undoAcknowledgment(request.id,s.mail.tasks,s.work.items,s.links);
    }},
    {path:'/api/inbox/respond',limit:16000,handler:request=>{
      const s=snapshot(),card=s.inbox.find(i=>i.id===request.id);
      if(!card || card.fingerprint!==request.fingerprint)throw new Error('事项已更新，请查看最新选项');
      const action=card.actions.find(a=>a.id===request.action_id && a.type==='reply');if(!action)throw new Error('未找到此选项');
      return respondToCard(card,action,s);
    }},
    {path:'/api/projects/edit',limit:512000,handler:request=>editProjectFramework(request)},
    {path:'/api/work/add',limit:16000,handler:request=>{const item=addStep(request);renderPlan();return item;}},
    {path:'/api/work/edit',limit:16000,handler:request=>{const item=editStep(request);renderPlan();return item;}},
    {path:'/api/work/move',limit:16000,handler:request=>{const item=moveStep(request);renderPlan();return item;}},
    {path:'/api/projects/status',limit:16000,handler:request=>setNodeStatus(request.project_id,request.id,request.status,request)},
    {path:'/api/projects/focus',limit:16000,handler:request=>focusProject(request.project_id,request.node_id)},
    {path:'/api/weekly/intent/add',limit:16000,handler:request=>addIntent(request)},
    {path:'/api/weekly/intent/update',limit:16000,handler:request=>updateIntent(request)},
    {path:'/api/weekly/intent/remove',limit:16000,handler:request=>removeIntent(request)},
    {path:'/api/weekly/review',limit:64000,handler:request=>saveReview(request)},
    {path:'/api/weekly/start',limit:16000,handler:async request=>{
      const item=await startIntent(request.id,request.week || undefined);
      if(!server.restartPending)void drain().catch(e=>console.error(e.message));
      return item;
    }},
    {path:'/api/links/resolve',limit:16000,handler:request=>{
      const [,moduleName,...rest]=String(request.id).split(':');
      return resolveLink(moduleName,rest.join(':'),request.decision);
    }},
    {path:'/api/calendar/add',limit:16000,handler:request=>Object.hasOwn(request,'events') ? addEvents(request) : addEvent(request)},
    {path:'/api/calendar/update',limit:16000,handler:request=>updateEvent(request.id,request)},
    {path:'/api/calendar/remove',limit:16000,handler:request=>removeEvent(request.id,request)},
    {path:'/api/usage/refresh',limit:16000,handler:request=>refreshQuota()},
    {path:'/api/tasks',limit:16000,handler:request=>{const item=enqueue(request);renderPlan();return item;}},
    {path:'/api/task-update',limit:16000,handler:request=>{const item=setStepStatus(request);renderPlan();return item;}}
  ];
  const postRoutes=new Map(routes.map(route=>[route.path,route]));
  const server=http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    compressWhenUseful(req,res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if(req.method==='GET' && url.pathname==='/api/setup') {
        sendJson(res,setupStatus());return;
      }
      if(req.method==='POST' && ['/api/setup/launch','/api/setup/credentials','/api/setup/connect'].includes(url.pathname)) {
        if(!localActionAllowed(req,server.address().port)){res.statusCode=403;throw new Error('接入配置仅允许本机同源页面操作');}
        if(server.restartPending){res.statusCode=503;throw new Error('后端正在重启，请稍后再配置');}
        if(!String(req.headers['content-type']).startsWith('application/json'))throw new Error('JSON required');
        const request=JSON.parse((await readBody(req,8000,'接入请求过大')).toString('utf8'));
        sendJson(res,url.pathname==='/api/setup/launch' ? await launchSetup(request,{launcher:setupLauncher})
          : url.pathname==='/api/setup/credentials' ? saveSetupCredentials(request) : await connectSetup(request,{runner:setupRunner}));return;
      }
      if(req.method==='GET' && url.pathname==='/api/literature') {
        const data=literatureList({scope:url.searchParams.get('scope') || 'candidates',q:url.searchParams.get('q') || '',page:url.searchParams.get('page') || 1,...(url.searchParams.has('date')?{date:url.searchParams.get('date')}:{})});
        sendJson(res,data);return;
      }
      if(req.method==='GET' && url.pathname==='/api/literature/paper') {
        const data=literaturePaper(url.searchParams.get('doi'),{date:url.searchParams.get('date') || undefined});if(!data){res.statusCode=404;throw new Error('未找到本地文献记录');}
        sendJson(res,data);return;
      }
      if(req.method==='GET' && url.pathname.startsWith('/api/prompts')) {
        const data=url.pathname==='/api/prompts' ? promptOverview() : url.pathname==='/api/prompts/fragment' ? promptFragment(url.searchParams.get('id') || '') : url.pathname==='/api/prompts/snapshot' ? promptSnapshot() : url.pathname==='/api/prompts/runs' ? promptRuns() : url.pathname==='/api/prompts/run' ? promptRun(url.searchParams.get('id') || '') : null;
        if(!data){res.statusCode=404;throw new Error('未知的提示词接口');}
        sendJson(res,data);return;
      }
      if(req.method==='GET' && url.pathname==='/api/instruments') {
        sendJson(res,instrumentCatalog());return;
      }
      if(req.method==='GET' && url.pathname==='/api/instruments/code') {
        const code=instrumentCode(url.searchParams.get('id'),url.searchParams.get('index'));
        if(url.searchParams.get('download')==='1') {
          res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(code.name)}`);res.end(code.text);
        }else sendJson(res,code);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/work/new') {
        sendJson(res,newStepEditor(url.searchParams.get('project'),url.searchParams.get('node')));return;
      }
      if (req.method === 'GET' && url.pathname === '/api/work/editor') {
        sendJson(res,stepEditor(url.searchParams.get('id')));return;
      }
      if (req.method === 'GET' && url.pathname === '/api/projects/editor') {
        sendJson(res,projectEditor(url.searchParams.get('project')));return;
      }
      if (req.method === 'POST' && url.pathname === '/api/powershell/run') {
        // A command-execution endpoint must never accept remote clients, DNS
        // rebinding hosts or cross-origin requests, including missing origins.
        if(!localActionAllowed(req,server.address().port))throw new Error('PowerShell 仅允许本机同源页面明确运行');
        if(!String(req.headers['content-type']).startsWith('application/json'))throw new Error('JSON required');
        const body=await readBody(req,100000,'PowerShell request too large');
        sendJson(res,await launchPowerShell(JSON.parse(body.toString('utf8'))));return;
      }
      if (req.method === 'POST' && ['/api/local-file/reveal','/api/local-file/open'].includes(url.pathname)) {
        if(!localActionAllowed(req,server.address().port)){res.statusCode=403;throw new Error('仅允许本机同源页面打开本地文件或资源管理器');}
        const body=await readBody(req,8000,'request too large');
        if(!String(req.headers['content-type']).startsWith('application/json'))throw new Error('JSON required');
        const input=JSON.parse(body.toString('utf8'));
        if((typeof input.path==='string')===(typeof input.url==='string'))throw new Error('只能指定一个文件路径或工作区链接');
        const file=input.url!==undefined ? resolveWorkspaceFile(input.url) : resolveLocalFile(input.path,{nativeEdit:url.pathname.endsWith('/open')});
        sendJson(res,url.pathname.endsWith('/reveal') ? revealInExplorer(file) : await openLocalFile(file));return;
      }
      if(req.method==='POST' && url.pathname==='/api/speech/transcribe') {
        if(!localFileRequestAllowed(req,server.address().port) || req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`){res.statusCode=403;throw new Error('语音输入仅允许办公室同源页面');}
        if(server.restartPending){res.statusCode=503;throw new Error('后端正在重启，请稍后录音');}
        if(!/^audio\/(webm|mp4|ogg|wav)(?:;|$)/.test(String(req.headers['content-type']))){res.statusCode=415;throw new Error('不支持的录音格式');}
        const language=url.searchParams.get('language') || undefined;
        if(language && !['zh','en'].includes(language))throw new Error('不支持此语音语言选项');
        if(!speech.available()){res.statusCode=503;throw new Error('本地语音模型尚未安装完整');}
        const audio=await readBody(req,SPEECH_LIMITS.maxBytes,'录音超过 8 MB，请分段输入',res,413);
        sendJson(res,await speech.transcribe(audio,{language}));return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({app:'phd-workflows',version:2,code:runtimeCodeStatus(),started_at:startedAt,backend_restart:!!restartBackend,restart_pending:!!server.restartPending,restart_error:server.restartError || null,background_busy:backgroundBusy(),memory2:true,memory_version:memoryVersion,chat_images:true,chat_files:true,chat_file_limits:FILE_LIMITS,project_files:true,chat_steering:true,chat_parallel_sessions:true,chat_markdown:true,chat_powershell:true,powershell_cwd:root,chat_speech:speech.available(),speech_limits:SPEECH_LIMITS,chat_search:true,chat_session_titles:true,chat_pins:true,chat_edit:true})); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const page=url.searchParams.get('page'),full=snapshot({page});
        const state=page===null ? full : splitState(full,{page,sessionId:url.searchParams.get('session') || '',taskQuery:url.searchParams.get('q') || ''});
        sendJson(res,{...state,backend_restart:!!restartBackend,restart_pending:!!server.restartPending,background_busy:backgroundBusy()});return;
      }
      if(req.method==='GET' && ['/api/chat/image','/api/chat/file'].includes(url.pathname)) {
        const download=url.pathname==='/api/chat/file';
        const image=agentSnapshot().sessions.flatMap(s=>s.messages).flatMap(m=>m.attachments || []).find(a=>a.id===url.searchParams.get('id') && (download ? a.kind==='file' : a.kind!=='file'));
        if(!image){res.statusCode=404;res.end('Image not found');return;}
        if(download)res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(image.name)}`);
        res.setHeader('Content-Type',image.mime);res.end(fs.readFileSync(path.join(root,image.path)));return;
      }
      // The same search the assistants use (agent search): every word in one conversation, else the closest candidates.
      if(req.method==='GET' && url.pathname==='/api/chat/search') {
        sendJson(res,findSessions(url.searchParams.get('q') || '',{includeRunning:true,limit:Math.min(100,Number(url.searchParams.get('limit')) || 10)}));return;
      }
      if(req.method==='GET' && url.pathname==='/api/projects/file') {
        const project=read('projects/catalog.json').projects.find(p=>p.id===url.searchParams.get('project'));
        const index=url.searchParams.get('index');
        const nodeId=url.searchParams.get('node'),file=resolveProjectFile(project,index!==null && /^(0|[1-9]\d*)$/.test(index) ? Number(index) : NaN,nodeId);
        if(url.searchParams.get('preview')==='1') {
          const bytes=fs.readFileSync(file),mime=sniffImageMime(bytes);
          if(!mime)throw new Error('该文件请下载后用对应软件打开');
          res.setHeader('Content-Type',mime);res.end(bytes);return;
        }
        const entry=(nodeId ? projectNode(project,nodeId) : project).files[Number(index)];
        res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(entry.name || path.basename(file))}`);
        streamFile(res,file);return;
      }
      // Paths the assistants name in chat become clickable through here (see markdown.js).
      if(req.method==='GET' && (url.pathname==='/api/local-file' || url.pathname.startsWith('/workspace/'))) {
        if(!localFileRequestAllowed(req,server.address().port)){res.statusCode=403;throw new Error('仅允许本机或 Tailscale 内的页面打开');}
        const file=url.pathname==='/api/local-file' ? resolveLocalFile(url.searchParams.get('path')) : resolveWorkspaceFile(url.pathname);
        if(fs.statSync(file).isDirectory())throw new Error('这是文件夹，请用“资源管理器”按钮打开');
        for(const [k,v] of Object.entries(localFileHeaders(file)))res.setHeader(k,v);
        streamFile(res,file);return;
      }
      if(req.method==='GET' && url.pathname==='/api/artifact') {
        const item=read('work/queue.json').items.find(i=>i.id===url.searchParams.get('task'));
        const recorded=(item?.outputs||[])[Number(url.searchParams.get('index'))],file=typeof recorded==='string' ? path.resolve(root,recorded) : '';
        if(!file || !fs.existsSync(file) || !fs.statSync(file).isFile())throw new Error('未找到已记录产出');
        res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`);
        streamFile(res,file);return;
      }
      if(req.method==='GET' && url.pathname==='/api/review') {
        sendJson(res,reviewDetails(url.searchParams.get('source'),url.searchParams.get('id')));return;
      }
      // One week's page data and exports are computed from their owners on request; nothing is stored or regenerated here.
      if (req.method === 'GET' && url.pathname === '/api/weekly/week') {
        sendJson(res,weekView(url.searchParams.get('start') || weeklySnapshot().window.start));return;
      }
      if (req.method === 'GET' && ['/api/export/plan','/api/export/review'].includes(url.pathname)) {
        const type=url.pathname.endsWith('plan') ? 'plan' : 'review',w=weeklySnapshot().window;
        // Explicit weeks win; only the default plan looks ahead on weekends.
        const start=weekOf(url.searchParams.get('week') || (type==='plan' ? planningWeek().start : w.previous_start)).start;
        res.setHeader('Content-Type','text/markdown; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${type}-${start}.md"`);
        res.end(markdown(start,type));return;
      }
      if (req.method === 'GET' && url.pathname === '/api/skills') {
        sendJson(res,await skillsView());return;
      }
      if (req.method === 'GET' && url.pathname === '/api/profiles') {
        sendJson(res,{profiles:profilesView()});return;
      }
      if (req.method === 'GET' && url.pathname === '/avatars/view.css') {
        res.setHeader('Content-Type','text/css; charset=utf-8');res.setHeader('Cache-Control','no-cache');res.end(avatarCss());return;
      }
      if (req.method === 'GET' && /^\/avatars\/custom\/(user|codex|claude|deepseek)$/.test(url.pathname)) {
        const file=customFile(url.pathname.split('/').pop());if(!file || !fs.existsSync(file)){res.statusCode=404;res.end('Not found');return;}
        serveImage(req,res,file,{png:'image/png',webp:'image/webp',jpg:'image/jpeg'}[path.extname(file).slice(1)]);return;
      }
      if (req.method === 'GET' && url.pathname === '/api/avatars') {
        sendJson(res,{view:avatarView()});return;
      }
      if (req.method === 'GET' && url.pathname === '/api/settings') {
        sendJson(res,settingsView());return;
      }
      if (req.method === 'POST') {
        const route=postRoutes.get(url.pathname);
        if(!route){res.statusCode=404;res.end('Not found');return;}
        if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('JSON required');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new Error('Origin mismatch');
        // The user chat entry takes what the user says in the interface (and the Discord relay, which sends its own Origin); an assistant opens a new conversation with `agent handoff`.
        if(url.pathname==='/api/chat' && !origin && req.headers['x-phd-client']!=='tui'){res.statusCode=403;throw new Error('用户聊天入口只接界面和 Discord 里的用户发言。助手要另开对话请用 node automation/run.mjs agent handoff <UTF-8请求JSON路径>。');}
        const request=JSON.parse((await readBody(req,route.limit,'Task request too large')).toString('utf8') || '{}');
        if(server.restartPending){res.statusCode=503;throw new Error('后端正在重启，暂不接受新操作。');}
        const item=await route.handler(request,{res,url});
        if(!res.writableEnded)sendJson(res,item);
        return;
      }
      if (req.method === 'GET' && /^\/avatars\/(codex|claude|user)\.webp$/.test(url.pathname)) {
        serveAvatar(req,res,path.join(root,'dashboard',url.pathname),'image/webp',url.pathname.slice(9,-5)); return;
      }
      if (req.method === 'GET' && url.pathname==='/avatars/deepseek.png') {
        serveAvatar(req,res,path.join(root,'dashboard/avatars/deepseek.png'),'image/png','deepseek'); return;
      }
      if (req.method === 'GET' && assets[url.pathname]) {
        const file = path.isAbsolute(assets[url.pathname]) ? assets[url.pathname] : path.join(root,'dashboard',assets[url.pathname]);
        const mime=url.pathname.endsWith('.png') ? 'image/png' : url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : /\.m?js$/.test(url.pathname) ? 'text/javascript; charset=utf-8' : /\.woff2?$/.test(url.pathname) ? (url.pathname.endsWith('.woff2') ? 'font/woff2' : 'font/woff') : url.pathname.endsWith('.ttf') ? 'font/ttf' : 'text/html; charset=utf-8';
        if(url.pathname==='/')serveContent(req,res,renderPageShell(fs.readFileSync(file,'utf8')),mime);
        else serveImage(req,res,file,mime);
        return;
      }
      res.statusCode=404; res.end('Not found');
    } catch (error) { if(res.statusCode===200)res.statusCode=400; sendJson(res,{error:error.message}); }
  });
  server.once('close',()=>speech.close());
  return server;
}
// Static assets and images are revalidated on every load: edits show on refresh, while unchanged bytes
// are not downloaded again (a 304 costs one round trip, which matters on a slow remote link).
// APIs and private attachments retain no-store.
const sendJson=(res,data)=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
// Reads a request body up to `limit` bytes; an oversized body throws `message` (after setting `status` when given).
async function readBody(req,limit,message,res,status) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit){if(status)res.statusCode=status;throw new Error(message);}chunks.push(chunk);}
  return Buffer.concat(chunks);
}
const COMPRESSIBLE=/^(application\/json|text\/|application\/javascript|image\/svg)/;
// Gzip whole in-memory text/JSON bodies for clients that accept it. Streamed downloads (pipe) and
// already-compressed formats are untouched; the browser receives identical content.
function compressWhenUseful(req,res) {
  if(!/\bgzip\b/.test(String(req.headers['accept-encoding'] || '')))return;
  const end=res.end.bind(res),write=res.write.bind(res);let wrote=false;
  res.write=(...args)=>{wrote=true;return write(...args);};
  res.end=(chunk,...rest)=>{
    const type=String(res.getHeader('Content-Type') || '');
    if(wrote || res.headersSent || res.statusCode===304 || res.getHeader('Content-Encoding') || !COMPRESSIBLE.test(type) || (typeof chunk!=='string' && !Buffer.isBuffer(chunk)) || chunk.length<1024)return end(chunk,...rest);
    res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');
    return end(gzipSync(chunk,{level:5}));
  };
}
// A file that disappears or cannot be read mid-response must end the response, not leave it hanging on an unhandled stream error.
function streamFile(res,file) {
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
}
// The published copy ships no avatar pictures (they are personal); a missing file shows a plain initial instead of a broken image.
const AVATAR_INITIAL={user:'U',codex:'X',claude:'C',deepseek:'D'};
function serveAvatar(req,res,file,mime,who) {
  if(fs.existsSync(file))return serveImage(req,res,file,mime);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#c9bfae"/><text x="32" y="43" font-size="30" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${AVATAR_INITIAL[who] || '?'}</text></svg>`;
  serveContent(req,res,Buffer.from(svg),'image/svg+xml');
}
function serveImage(req,res,file,mime) {
  serveContent(req,res,fs.readFileSync(file),mime);
}
function serveContent(req,res,bytes,mime) {
  const etag='"'+createHash('sha256').update(bytes).digest('hex')+'"';
  res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','private, no-cache');res.setHeader('ETag',etag);
  if(req.headers['if-none-match']?.split(',').some(tag=>tag.trim()==='*' || tag.trim().replace(/^W\//,'')===etag)){res.statusCode=304;res.end();}
  else res.end(bytes);
}
export async function run(action) {
  if(action==='status') {
    const url=`http://127.0.0.1:${dashboardPort()}/health`;
    const response=await fetch(url,{signal:AbortSignal.timeout(3000)}),health=await response.json();
    if(!response.ok || health.app!=='phd-workflows' || health.version!==2)throw new Error('该端口不是办公室后端');
    console.log(JSON.stringify({started_at:health.started_at,code:health.code || null,
      note:health.code ? health.code.state==='stale' ? '后端代码已更新，等助手与后台工作结束后重启再验证；用户自己的任务不阻止重启。' : health.code.state==='current' ? '运行代码与磁盘一致。' : '读取不完整，版本状态未知。' : '旧后端尚无代码指纹；等助手与后台工作结束后重启加载版本提示，用户自己的任务不阻止重启。'}));return;
  }
  if (action !== 'serve') throw new Error('dashboard serve');
  const port = dashboardPort();
  recordProcessLifecycle();
  const server = createServer({restartBackend:process.platform==='win32' ? launchBackendRestart : undefined}); server.on('error', e => { console.error(e.message); process.exitCode=1; });
  server.listen(port,'127.0.0.1',()=>{
    console.log(`PhD Workflows Agent: http://127.0.0.1:${port}`);
    try {const fresh=ensureOffice();if(fresh.length)console.log('首次启动：已建立空的 '+fresh.join('、'));ensureQueue();const split=splitQueue();if(split.split)console.log('任务队列拆分：步骤 '+split.steps+' 条留在 queue.json，对话轮 '+split.turns+' 条移入 turns.json');const moved=migrateSessionBaselines();if(moved)console.log('文件快照独立存储：'+moved);const recovered=recoverInterruptedWork();if(recovered.length)console.log('回收中断任务：'+recovered.join(', '));tick();void fireDue().catch(e=>console.error('定时触发：'+e.message));void drain().catch(e=>console.error(e.message));}
    catch(e){console.error('启动恢复失败：'+e.message);server.close();}
  });
  let beat=0;
  const clock=setInterval(()=>{if(server.restartPending || !server.listening)return;tick();void fireDue().then(f=>{if(f.length)void drain().catch(e=>console.error(e.message));}).catch(e=>console.error('定时触发：'+e.message));void drain().catch(e=>console.error(e.message));if(++beat%6===0)void automate();},10000);
  const first=setTimeout(()=>{if(!server.restartPending && server.listening)void automate();},15000);
  clock.unref();first.unref();server.on('close',()=>{clearInterval(clock);clearTimeout(first);});
}
