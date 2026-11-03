import {esc} from './format.js';
if(typeof document!=='undefined' && !document.querySelector('link[href="/setup.css"]')){
  const css=document.createElement('link');css.rel='stylesheet';css.href='/setup.css';document.head.append(css);
}
const names={codex:'Codex · ChatGPT 账号',claude:'Claude Code · Claude 账号',deepseek:'DeepSeek · API / Command Code'};
const docs={codex:'https://learn.chatgpt.com/docs/codex/cli',claude:'https://code.claude.com/docs/en/setup',deepseek:'https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md'};

export function mountSetup(root,{post,onConnected=()=>{}}){
  let data,provider='codex',connected=false,busy=false;
  root.innerHTML=`<div class="panel-heading"><h2>连接第一位助手</h2></div><p class="muted">整个向导不需要 AI。任选一家就能开始，也可以先使用项目、日历等本地功能。</p>
    <label>1 · 选择已有的账号<select data-setup-provider>${Object.entries(names).map(([p,n])=>`<option value="${p}">${esc(n)}</option>`).join('')}</select></label>
    <section class="setup-step"><h3>2 · 安装与登录</h3><p data-setup-status role="status">正在检查本地配置…</p><div class="setup-actions"><button type="button" class="secondary" data-setup-action="install">安装运行环境</button><button type="button" class="secondary" data-setup-action="login">打开官方登录</button><button type="button" class="text-button" data-setup-action="refresh">重新检查</button><a data-setup-doc target="_blank" rel="noreferrer">官方安装说明 ↗</a></div><small class="muted">安装／登录会打开本机窗口，由你完成官方交互；不索取账号密码，不自动提权。</small>
    <div data-setup-api hidden><label>DeepSeek 计费通道<select data-setup-channel><option value="official">官方 DeepSeek API（按余额计费）</option><option value="commandcode">Command Code（套餐额度）</option></select></label><label>API Key<input type="password" data-setup-key autocomplete="new-password" spellcheck="false" maxlength="4096" placeholder="仅保存到本机，不写进聊天或浏览器存储"></label><p class="muted" data-setup-key-note></p><button type="button" class="secondary" data-setup-action="save">保存密钥并使用此通道</button><small class="muted">保存不会发送请求；另一通道的密钥不变，失败也不自动改换通道。</small></div>
    <p data-setup-python hidden>DeepSeek 需要 Python 3.10 或以上。如未安装，先从 <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">Python 官网</a>安装，再点“安装运行环境”。</p></section>
    <section class="setup-step"><h3>3 · 测试连接并开始</h3><label>模型名称<input data-setup-model maxlength="60" spellcheck="false"></label><p class="muted">发送通用连接测试，不带项目资料；可能消耗所选账号额度。失败后由你决定是否再测，办公室不会重复发起测试。</p><div class="setup-actions"><button type="button" data-setup-action="connect">发送一次短测试并设为默认</button><button type="button" class="secondary" data-setup-action="chat" hidden>开始聊天 →</button></div></section><p class="setup-message" role="status" aria-live="polite" data-setup-message></p>`;
  const q=selector=>root.querySelector(selector),message=(text,error=false)=>{q('[data-setup-message]').textContent=text;q('[data-setup-message]').classList.toggle('settings-error',error);};
  function refreshView(resetModel=false){
    if(!data)return;
    const info=data.providers[provider],api=provider==='deepseek';
    q('[data-setup-status]').textContent=`运行环境：${info.installed?'已安装':'尚未安装'} · 本地凭据：${info.configured?'已检测到':'尚未检测到'}${!api?'（系统凭据库登录也可直接进行短测试）':''}`;
    q('[data-setup-action="install"]').disabled=busy || info.installed;
    q('[data-setup-action="login"]').hidden=api;q('[data-setup-action="login"]').disabled=busy || !info.installed;
    q('[data-setup-api]').hidden=!api;q('[data-setup-python]').hidden=!api;
    q('[data-setup-doc]').href=docs[provider];
    if(resetModel)q('[data-setup-model]').value=data.models[provider] || '';
    const channel=q('[data-setup-channel]').value;
    q('[data-setup-key-note]').textContent=data.deepseek_channels[channel] ? '此通道已有本地密钥。留空即可沿用；输入新密钥并保存会覆盖该通道原凭据。' : '请粘贴所选通道的密钥。它不会显示在返回结果中。';
    q('[data-setup-action="connect"]').disabled=busy || !info.installed;
    q('[data-setup-action="chat"]').hidden=!connected;
  }
  async function load(first=false){
    const response=await fetch('/api/setup'),result=await response.json();if(!response.ok)throw new Error(result.error || '本地配置读取失败');
    data=result;if(first){q('[data-setup-channel]').value=data.deepseek_channel;refreshView(true);}else refreshView();
  }
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-setup-provider]')){provider=event.target.value;connected=false;q('[data-setup-key]').value='';message('');refreshView(true);}
    if(event.target.matches('[data-setup-channel]')){connected=false;q('[data-setup-key]').value='';refreshView();}
    if(event.target.matches('[data-setup-model]')){connected=false;refreshView();}
  });
  root.addEventListener('click',async event=>{
    const action=event.target.closest('[data-setup-action]')?.dataset.setupAction;if(!action || busy)return;
    if(action==='chat'){onConnected();return;}
    if(['install','login'].includes(action) && !window.confirm(action==='install' ? `将打开本机窗口，从官方来源下载并安装 ${names[provider]} 的运行环境。是否继续？` : '将打开所选助手的官方登录窗口。请在官方页面完成登录，办公室不会收集密码。是否继续？'))return;
    busy=true;root.querySelectorAll('button,select,input').forEach(el=>el.disabled=true);message(action==='connect'?'正在发送这一次短测试，请等待…':'正在处理…');
    try {
      if(action==='refresh'){await load();message('已重新检查。安装和登录完成后，可以发送短测试。');}
      else if(action==='save'){
        const key=q('[data-setup-key]');
        data=await post('/api/setup/credentials',{provider,channel:q('[data-setup-channel]').value,api_key:key.value,confirmed:true});
        key.value='';connected=false;message(data.reused?'已使用所选通道的本机密钥，尚未发送模型请求。':'密钥已保存到本机，尚未发送模型请求。');
      }else if(action==='connect'){
        data=await post('/api/setup/connect',{provider,model:q('[data-setup-model]').value.trim(),confirmed:true});
        connected=true;message('连接成功，已设为默认助手。可直接开始聊天；新装办公室的后台邮件判断、记忆整理保持关闭，可稍后在设置中选择开启。');
      }else {
        const result=await post('/api/setup/launch',{provider,action,confirmed:true});message(result.message);
      }
    }catch(error){connected=false;message(error.message,true);}
    finally{busy=false;root.querySelectorAll('button,select,input').forEach(el=>el.disabled=false);refreshView();}
  });
  void load(true).catch(error=>message(error.message,true));
}
