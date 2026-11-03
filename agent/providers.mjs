import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {root,read,readJsonFile} from '../automation/files.mjs';
import {connectionStatus} from '../software/deepseek-harness/connection.mjs';
import {sdkPython} from '../software/deepseek-harness/python.mjs';

export const PROVIDERS=['codex','claude','deepseek'];
export const providerNames={codex:'Codex',claude:'Claude',deepseek:'DeepSeek'};
export const codexBin=(env=process.env)=>env.MAIL_FLOW_CODEX_BIN || path.join(env.APPDATA || '', 'npm/node_modules/@openai/codex/bin/codex.js');
export const claudeBin=(env=process.env)=>env.WORKFLOW_CLAUDE_BIN || path.join(env.USERPROFILE || os.homedir(),'.local/bin/claude.exe');
const exists=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};
const json=file=>{try{return readJsonFile(file);}catch{return {};}};

// Local configuration evidence only: no paid probe and no claim that a subscription
// is still valid. Explicit "on" also supports CLI-managed/custom authentication.
export function providerStatus(config=read('agent/config.json'),env=process.env) {
  const home=env.USERPROFILE || os.homedir();
  const auth=json(path.join(env.CODEX_HOME || path.join(home,'.codex'),'auth.json'));
  const claudeAuth=json(path.join(env.CLAUDE_CONFIG_DIR || path.join(home,'.claude'),'.credentials.json'));
  let deepseekInstalled=false;
  try {
    const runtime=path.join(root,'.runtime/deepseek-harness');
    deepseekInstalled=exists(sdkPython(path.join(runtime,'venv')).executable) &&
      exists(path.join(runtime,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')) &&
      exists(path.join(runtime,'npm/node_modules/.bin',process.platform==='win32'?'dsh.cmd':'dsh'));
  }catch{}
  const detected={
    codex:{installed:exists(codexBin(env)),configured:!!(auth.tokens?.access_token || auth.OPENAI_API_KEY || env.OPENAI_API_KEY)},
    claude:{installed:exists(claudeBin(env)),configured:!!(claudeAuth.claudeAiOauth?.accessToken || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)},
    deepseek:{installed:deepseekInstalled,configured:connectionStatus().credential_configured}
  };
  return Object.fromEntries(PROVIDERS.map(provider=>{
    const mode=config.provider_modes?.[provider] || 'auto',d=detected[provider];
    const available=mode==='on' || mode!=='off' && d.installed && d.configured;
    const reason=mode==='off' ? '已停用' : mode==='on' ? '已手动启用' : !d.installed ? '尚未安装运行环境' : !d.configured ? '尚未检测到本地登录／凭据' : '已检测到本地配置';
    return [provider,{mode,...d,available,reason}];
  }));
}
export const availableProviders=(config=read('agent/config.json'))=>{const status=providerStatus(config);return PROVIDERS.filter(p=>status[p].available);};
export function requireProvider(provider,config=read('agent/config.json')) {
  const status=providerStatus(config)[provider];
  if(!status?.available)throw new Error(`${providerNames[provider] || provider} 当前不可用：${status?.reason || '未知助手'}。请在设置 → 接入助手完成接入，或在模型与推理中启用已配置助手。`);
  return provider;
}
export function defaultProvider(preferred,config=read('agent/config.json')) {
  const available=availableProviders(config);
  const picked=[preferred,config.default_provider,...PROVIDERS].find(p=>available.includes(p));
  if(!picked)throw new Error('尚无可用助手。点击首页“开始配置”，或到设置 → 接入助手连接任意一家；无需集齐订阅。');
  return picked;
}

// Parsing mentions stays in route(); availability is decided at admission, before
// attachments, sessions or work items are written. Explicit people are never replaced.
export function availableRoute(job,text,config=read('agent/config.json')) {
  if(job.provider==='program')return job;
  const explicit=[...text.matchAll(/@(codex|claude(?: code)?|deepseek)\b/gi)].map(m=>/^claude/i.test(m[1]) ? 'claude' : m[1].toLowerCase());
  for(const provider of explicit)requireProvider(provider,config);
  const group=/@(all|两位|双方|大家)/i.test(text),available=availableProviders(config);
  const speakers=explicit.length || group ? job.speakers.filter(p=>available.includes(p)) : [defaultProvider(job.provider,config)];
  if(!speakers.length)throw new Error('点名的助手组中暂无可用助手；请到设置 → 接入助手配置任意一家，或点名其他可用助手。');
  return {...job,provider:speakers[0],speakers};
}
