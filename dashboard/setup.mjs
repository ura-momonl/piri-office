import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,read,write} from '../automation/files.mjs';
import {PROVIDERS,providerStatus,codexBin,claudeBin} from '../agent/providers.mjs';
import {invokeNative} from '../agent/run.mjs';
import {leanLaunch} from '../agent/codex.mjs';
import {connectionStatus,selectConnection} from '../software/deepseek-harness/connection.mjs';
import {launchPowerShell,psLiteral as literal} from './powershell.mjs';
import {MODEL} from './settings.mjs';
import {fragment} from '../prompts/compose.mjs';

const STATE='.runtime/setup.json';
const validProvider=p=>{if(!PROVIDERS.includes(p))throw new Error('请选择 Codex、Claude 或 DeepSeek');return p;};
let testing=false;
export const setupBusy=()=>testing;

// A downloaded office has no runtime history. Existing offices adopt the setup
// marker without changing their switches; a genuinely fresh office starts local-only.
export function initializeSetup(){
  if(read(STATE,null))return;
  const sessions=read('.runtime/agent/sessions.json',{sessions:[]}).sessions;
  const usage=path.join(root,'.runtime/usage/runs.jsonl');
  const legacy=sessions.some(s=>s.messages?.some(m=>m.role==='assistant')) || fs.existsSync(usage) && fs.statSync(usage).size>0;
  if(legacy){write(STATE,{completed_at:new Date().toISOString(),legacy:true});return;}
  const cfg=read('agent/config.json');
  write('agent/config.json',{...cfg,enabled:false,automatic_mail_judgment:false,automatic_cards:false,automatic_codex_reset_credit:false,
    memory_v2:{...cfg.memory_v2,enabled:false,auto:{...cfg.memory_v2?.auto,enabled:false}}});
  write(STATE,{pending:true,created_at:new Date().toISOString()});
}

export function setupStatus(){
  const config=read('agent/config.json');
  return {state:read(STATE,{}),testing,providers:providerStatus(config),models:Object.fromEntries(PROVIDERS.map(p=>[p,config[p+'_model'] || ''])),
    deepseek_channel:connectionStatus().transport,deepseek_channels:Object.fromEntries(['official','commandcode'].map(p=>[p,connectionStatus(p).credential_configured]))};
}

// Only fixed, reviewable install/login actions reach the visible native console.
// No key is placed in shell arguments, a script, or a command history.
export function setupCommand(provider,action){
  validProvider(provider);
  if(!['install','login'].includes(action) || provider==='deepseek' && action==='login')throw new Error('不支持的接入动作');
  if(action==='login')return provider==='codex'
    ? `& ${literal(process.execPath)} ${literal(codexBin())} login`
    : `& ${literal(claudeBin())} auth login`;
  if(provider==='codex')return `$npm=Get-Command npm.cmd -ErrorAction Stop\n& $npm.Source install --global --prefix (Join-Path $env:APPDATA 'npm') @openai/codex\nif($LASTEXITCODE -ne 0){throw 'Codex 安装未完成，请查看窗口中的错误。'}`;
  if(provider==='claude')return "Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression";
  const runtime=path.join(root,'.runtime/deepseek-harness'),venv=path.join(runtime,'venv');
  return `$python=Get-Command python.exe -ErrorAction SilentlyContinue\nif(-not $python){throw '需要 Python 3.10 或以上。请先从 python.org 安装 Python，然后重新点击安装。'}\n& $python.Source -m venv ${literal(venv)}\nif($LASTEXITCODE -ne 0){throw 'Python 环境创建失败'}\n& ${literal(path.join(venv,'Scripts/python.exe'))} -m pip install deepseek-harness-sdk==0.2.1rc2\nif($LASTEXITCODE -ne 0){throw 'DeepSeek Python SDK 安装失败'}\n$npm=Get-Command npm.cmd -ErrorAction Stop\n& $npm.Source install --prefix ${literal(path.join(runtime,'npm'))} --save-exact --no-audit --no-fund @deepseek-ai/dsh@0.2.1-rc.4\nif($LASTEXITCODE -ne 0){throw 'DeepSeek npm 运行环境安装失败'}`;
}
export async function launchSetup({provider,action,confirmed},{launcher=launchPowerShell}={}){
  validProvider(provider);
  if(testing)throw new Error('连接测试正在进行，请等这一次结束');
  if(confirmed!==true)throw new Error('请先确认安装或打开官方登录窗口');
  const status=providerStatus()[provider];
  if(action==='install' && status.installed)throw new Error('运行环境已安装，无需重复安装；请继续登录或测试连接');
  if(action==='login' && !status.installed)throw new Error('请先安装所选助手');
  const code="$ErrorActionPreference='Stop'\n$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')+';'+$env:Path\n"+setupCommand(provider,action)+"\nWrite-Host '这一步已结束。请回到办公室点击重新检查，再测试连接。'";
  return {...await launcher({code,cwd:root,confirmed:true}),message:'已打开本机操作窗口；请在那里完成安装／登录，再回到本页重新检查。打开窗口不代表安装或登录成功。'};
}

export function saveSetupCredentials({provider,channel='official',api_key,confirmed}){
  if(testing)throw new Error('连接测试正在进行，请等这一次结束');
  if(provider!=='deepseek' || !['official','commandcode'].includes(channel))throw new Error('此入口仅保存 DeepSeek 所选通道的凭据');
  if(confirmed!==true)throw new Error('请确认将凭据保存到本机');
  if(api_key==='' && connectionStatus(channel).credential_configured){selectConnection(channel);return {saved:false,reused:true,...setupStatus()};}
  if(typeof api_key!=='string' || !api_key.trim() || api_key.length>4096 || /[\s\x00-\x1f]/.test(api_key))throw new Error('密钥不能为空，且不能含空白或控制字符');
  const file=connectionStatus(channel).credential_file;
  write(file,{api_key,base_url:channel==='official'?'https://api.deepseek.com/anthropic':'https://api.commandcode.ai/provider/v1'});
  selectConnection(channel);
  return {saved:true,...setupStatus()};
}

export async function connectSetup({provider,model,confirmed},{runner=invokeNative}={}){
  validProvider(provider);
  if(confirmed!==true)throw new Error('请确认发送一次短测试；它可能消耗所选账号的额度');
  if(testing)throw new Error('连接测试正在进行，请等这一次结束');
  if(typeof model!=='string' || !MODEL.test(model))throw new Error('请填写有效的模型名称');
  const cfg=read('agent/config.json'),local=providerStatus(cfg)[provider];
  if(!local.installed)throw new Error('运行环境尚未安装完成，请先安装并重新检查');
  if(provider==='deepseek' && !local.configured)throw new Error('请先保存所选 DeepSeek 通道的密钥');
  testing=true;
  const oldMode=cfg.provider_modes?.[provider];
  try {
    write('agent/config.json',{...cfg,provider_modes:{...cfg.provider_modes,[provider]:'on'}});
    const directory=path.join(root,'.runtime/agent/runs','setup-'+randomUUID());
    const options={mode:'ask',purpose:'setup-test',model,effort:provider==='deepseek'?'off':'low',directory,signal:AbortSignal.timeout(90000),
      systemPrompt:'',...(provider==='codex'?leanLaunch():{})};
    const result=await runner(provider,fragment('task/connection-test'),options);
    if(typeof result.result!=='string' || !result.result.trim())throw new Error('Empty connection test');
    const current=read('agent/config.json');
    write('agent/config.json',{...current,enabled:true,default_provider:provider,[provider+'_model']:model});
    write(STATE,{completed_at:new Date().toISOString(),provider,model});
    testing=false; // setupStatus() below reports it, and finally runs only after the return value is built.
    return {connected:true,provider,model,...setupStatus()};
  }catch{
    const current=read('agent/config.json'),modes={...current.provider_modes};
    if(oldMode===undefined)delete modes[provider];else modes[provider]=oldMode;
    write('agent/config.json',{...current,provider_modes:modes});
    throw new Error('短测试未完成。请检查登录状态、模型权限、余额或网络，再点击测试；办公室未重复发起测试，后台设置未作改变。');
  }finally{testing=false;}
}
