import {esc,num} from './format.js';
// Skills page: a read-only view of the project's own skills (.agents/skills), plus the role profiles (prompts/profiles/*.md) which can be edited here.
// It is fetched once per visit. Skills are never written from this page; a profile is saved through /api/profiles/save|new, and its private skills (prompts/profiles/<id>/skills/<name>/SKILL.md, seen only by that profile) through /api/profiles/skill-save|skill-rm; the old text is kept in .runtime/prompt-history.
const CLAUDE={ok:['Claude 链接有效',''],missing:['Claude 未链接','bad'],broken:['Claude 链接失效','bad'],unknown:['无法核对','bad']};
function card(s,view) {
  const bad=s.issues.length>0 || s.claude!=='ok' || !s.content;
  return `<article class="skill-card${bad ? ' attention' : ''}"><div class="skill-head"><strong>${esc(s.name)}</strong><span class="badge">Codex 本体${s.content ? '在位' : '待修正'}</span><span class="badge ${CLAUDE[s.claude][1]}">${CLAUDE[s.claude][0]}</span></div>`
    +`<p class="skill-desc">${esc(s.description || '（没有 description）')}</p>`
    +s.issues.map(i=>`<p class="settings-error">${esc(i)}</p>`).join('')+(s.notes || []).map(n=>`<p class="skill-note">提示：${esc(n)}</p>`).join('')
    +`<div class="skill-meta"><span title="可发现索引中名称和 description 的文本估算；不是实际账单">常驻 ≈${num(s.always_tokens)} token</span><span title="按需读取的正文文本估算">正文估算 ≈${num(s.body_tokens)} token</span></div>`
    +`<code>${esc(view.location+'/'+s.dir+'/SKILL.md')}</code>`
    +(s.content ? `<details class="skill-content"><summary>查看正文与依据（只读）</summary><pre>${esc(s.content)}</pre></details>` : '')+`</article>`;
}
let profiles=[],skillNames=[];
// Re-read the role list after a write; a failed read is reported instead of leaving `profiles` undefined.
async function fetchProfiles() {
  const r=await fetch('/api/profiles'),v=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(v.error || '角色列表读取失败');
  return v.profiles;
}
const editing=new Map(); // open forms: profile id, '' (new profile), '<profile>/<skill>' (private skill) or '<profile>/+' (new private skill)
function profileForm(p,isNew) {
  const all=[...new Set([...skillNames,...(p.skills || [])])];
  const checks=all.length ? all.map(n=>`<label class="check"><input type="checkbox" name="skills" value="${esc(n)}"${(p.skills || []).includes(n) ? ' checked' : ''}> ${esc(n)}${skillNames.includes(n) ? '' : '（项目里没有）'}</label>`).join('') : '<span class="muted">项目里没有共享 skill</span>';
  const actors=['','user','codex','claude','deepseek'].map(a=>`<option value="${a}"${a===(p.actor || '') ? ' selected' : ''}>${a || '不指定（用办公室默认助手）'}</option>`).join('');
  return `<form class="profile-form" data-profile-form="${esc(p.id)}" data-new="${isNew ? 1 : ''}">`
    +(isNew ? `<label>名称<input name="id" spellcheck="false" maxlength="60" placeholder="例如 mail-reviewer（小写字母、数字、-）"></label>` : '')
    +`<label>说明（一行，列表里显示）<input name="description" maxlength="400" value="${esc(p.description)}"></label>`
    +`<div class="profile-field"><span>引用的共享 skill</span><div class="check-list">${checks}</div><small class="muted">勾选的 skill 正文会随角色一起放进提示词；只属于这个角色的 skill 在下面的“私有 skill”里</small></div>`
    +`<div class="profile-field"><span>创建操作时的默认值（操作自己写的永远优先，之后不随角色联动）</span><div class="profile-defaults"><select name="actor" aria-label="默认执行者">${actors}</select><input name="model" maxlength="60" placeholder="默认模型" aria-label="默认模型" value="${esc(p.model || '')}"><input name="effort" maxlength="20" placeholder="默认推理强度" aria-label="默认推理强度" value="${esc(p.effort || '')}"><label class="check"><input type="checkbox" name="require_outputs"${p.require_outputs ? ' checked' : ''}> 默认要求交出文件</label></div></div>`
    +`<label>角色正文<textarea name="body" rows="14" spellcheck="false">${esc(p.body)}</textarea></label>`
    +`<div class="settings-actions"><span class="settings-status muted" role="status"></span><button type="button" class="secondary" data-profile-cancel>取消</button><button type="submit" class="secondary primary">保存</button></div></form>`;
}
function pskillForm(pid,sk) {
  const isNew=!sk;sk=sk || {name:'',description:'',body:'',inline:false};
  return `<form class="profile-form pskill-form" data-pskill-form="${esc(pid+'/'+(isNew ? '+' : sk.name))}" data-profile-id="${esc(pid)}" data-name="${esc(sk.name)}" data-new="${isNew ? 1 : ''}">`
    +(isNew ? `<label>名称<input name="name" spellcheck="false" maxlength="60" placeholder="小写字母、数字、-"></label>` : '')
    +`<label>说明（一行，写清什么时候该用它）<input name="description" maxlength="400" value="${esc(sk.description)}"></label>`
    +`<label class="check"><input type="checkbox" name="inline"${sk.inline ? ' checked' : ''}> 整篇放进提示词（不勾选时只放名称、说明和文件路径，角色需要时自己去读）</label>`
    +`<label>正文<textarea name="body" rows="12" spellcheck="false">${esc(sk.body)}</textarea></label>`
    +`<div class="settings-actions"><span class="settings-status muted" role="status"></span><button type="button" class="secondary" data-pskill-cancel>取消</button><button type="submit" class="secondary primary">保存</button></div></form>`;
}
function pskillItem(pid,sk) {
  const key=pid+'/'+sk.name;
  if(editing.has(key))return `<div class="pskill" data-pskill="${esc(key)}">${pskillForm(pid,sk)}</div>`;
  return `<div class="pskill" data-pskill="${esc(key)}"><div class="skill-head"><strong>${esc(sk.name)}</strong><span class="badge">${sk.inline ? '整篇放入' : '按需读取'}</span><button type="button" class="secondary small" data-pskill-edit="${esc(key)}">编辑</button><button type="button" class="secondary small" data-pskill-rm="${esc(key)}">删除</button></div><p class="skill-desc">${esc(sk.description)}</p><details class="skill-content"><summary>查看正文</summary><pre>${esc(sk.body)}</pre></details><code>${esc(sk.path)}</code></div>`;
}
function pskillBlock(p) {
  const list=p.private_skills || [],adding=editing.has(p.id+'/+');
  return `<div class="private-skills"><div class="skill-head"><strong>私有 skill</strong><small class="muted">只有「${esc(p.id)}」这个角色带着，别的助手发现不了</small>${adding ? '' : `<button type="button" class="secondary small" data-pskill-new="${esc(p.id)}">新建</button>`}</div>`
    +(adding ? `<div class="pskill">${pskillForm(p.id,null)}</div>` : '')
    +(list.length ? list.map(sk=>pskillItem(p.id,sk)).join('') : adding ? '' : '<p class="muted">还没有。</p>')+`</div>`;
}
function profileCard(p) {
  const open=editing.has(p.id);
  return `<article class="skill-card profile-card${(p.skills_missing || []).length ? ' attention' : ''}" data-profile="${esc(p.id)}"><div class="skill-head"><strong>${esc(p.id)}</strong>${(p.skills || []).map(n=>`<span class="badge ${(p.skills_missing || []).includes(n) ? 'bad' : ''}">skill：${esc(n)}${(p.skills_missing || []).includes(n) ? '（找不到）' : ''}</span>`).join('')}${p.actor ? `<span class="badge">默认 ${esc([p.actor,p.model,p.effort].filter(Boolean).join(' · '))}</span>` : ''}${p.require_outputs ? '<span class="badge">要求交文件</span>' : ''}${open ? '' : `<button type="button" class="secondary small" data-profile-edit="${esc(p.id)}">编辑</button>`}</div>`
    +(open ? profileForm(p,false) : `<p class="skill-desc">${esc(p.description || '（没有说明）')}</p><details class="skill-content"><summary>查看正文</summary><pre>${esc(p.body)}</pre></details>`)+`<code>prompts/profiles/${esc(p.id)}.md</code>`+pskillBlock(p)+`</article>`;
}
function paintProfiles() {
  const box=document.getElementById('profile-box');if(!box)return;
  box.innerHTML=`<div class="panel-heading"><h2>角色 profile</h2>${editing.has('') ? '' : '<button type="button" class="secondary small" data-profile-new>新建 profile</button>'}</div>`
    +`<p class="muted">profile 是任务里的一个角色（谁来做、站什么立场），由代码或 work add 的 profile 字段指派；这里改的是 prompts/profiles/ 下的文件，下一次用到该角色的任务起生效。每次保存前，旧版自动留在 .runtime/prompt-history/profile__&lt;名称&gt;/。提示词页的“快照”会因此显示有变化，确认无误后在那里接受。</p>`
    +(editing.has('') ? `<article class="skill-card profile-card">${profileForm({id:'',description:'',skills:[],body:''},true)}</article>` : '')
    +`<div class="skill-grid">${profiles.map(profileCard).join('')}</div>`;
}
function paint(box,view) {
  const list=view.skills,attention=list.filter(s=>s.issues.length || s.claude!=='ok' || !s.content).length,always=list.reduce((a,s)=>a+(s.always_tokens || 0),0);
  const stats=`<div class="stat-grid skill-stats"><div class="stat"><span>自建技能</span><strong>${list.length}</strong></div><div class="stat"><span>需要处理</span><strong>${attention}</strong></div><div class="stat"><span>常驻开销估算</span><strong>≈${num(always)}</strong><small class="muted">名称与描述合计 token</small></div></div>`;
  box.className='';
  box.innerHTML=stats+(list.length ? `<div class="skill-grid">${list.map(s=>card(s,view)).join('')}</div>` : '<p class="muted">项目里目前没有自建 skill。</p>')
    +view.problems.map(p=>`<p class="settings-error">${esc(p)}</p>`).join('')
    +`<section id="profile-box" class="panel profile-section"></section>`
    +`<details class="panel skill-convention"><summary>新建约定与核对范围</summary><p class="muted">这里只核对目录、头部字段和链接，不代表当前助手会话已发现或加载，也不执行技能。新建后需通过原生入口核验。</p><p class="muted">新建约定：本体放 ${esc(view.location)}/&lt;名&gt;/SKILL.md（头部 name 与目录名一致，description 写清触发条件），正文开头写依据、适用条件和验证范围；在 ${esc(view.claude_location)}/ 建同名链接指向它。助手可自主创建和修订，覆盖前留旧版；约定见 prompts/README.md 的“自建 skill 与 profile”。</p></details>`;
}
export function bindSkills({root,body}) {
  let loaded=false,loading=false;
  async function load() {
    loading=true;
    try {
      const [r,pr]=await Promise.all([fetch('/api/skills'),fetch('/api/profiles')]),view=await r.json(),pv=await pr.json().catch(()=>({}));if(!r.ok)throw new Error(view.error || '技能读取失败');
      profiles=pr.ok ? pv.profiles : [];editing.clear();
      skillNames=view.skills.map(x=>x.dir);paint(body,view);paintProfiles();loaded=true;
    } catch(e) {body.className='settings-error';body.textContent=e.message;} finally {loading=false;}
  }
  async function savePskill(form) {
    const status=form.querySelector('.settings-status'),btn=form.querySelector('[type=submit]'),isNew=form.dataset.new==='1',pid=form.dataset.profileId,fd=new FormData(form),name=isNew ? String(fd.get('name')).trim() : form.dataset.name;
    btn.disabled=true;status.classList.remove('settings-error');status.textContent='保存中…';
    try {
      const r=await fetch('/api/profiles/skill-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:pid,name,create:isNew,description:fd.get('description'),body:fd.get('body'),inline:fd.get('inline')==='on'})});
      const v=await r.json().catch(()=>({error:'后端需要重启后才有这个功能'}));if(!r.ok)throw new Error(v.error || '保存失败');
      profiles=await fetchProfiles();editing.delete(pid+'/'+(isNew ? '+' : name));paintProfiles();
    } catch(e) {status.textContent=e.message;status.classList.add('settings-error');btn.disabled=false;}
  }
  async function removePskill(key) {
    const [pid,name]=key.split('/');
    if(!confirm(`删除「${pid}」的私有 skill「${name}」？旧版会留在 .runtime/prompt-history 里。`))return;
    try {
      const r=await fetch('/api/profiles/skill-rm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:pid,name})});
      const v=await r.json().catch(()=>({error:'后端需要重启后才有这个功能'}));if(!r.ok)throw new Error(v.error || '删除失败');
      profiles=await fetchProfiles();paintProfiles();
    } catch(e) {alert(e.message);}
  }
  async function save(form) {
    const status=form.querySelector('.settings-status'),btn=form.querySelector('[type=submit]'),isNew=form.dataset.new==='1',fd=new FormData(form),f={...Object.fromEntries(fd),skills:fd.getAll('skills'),require_outputs:fd.get('require_outputs')==='on'};
    btn.disabled=true;status.classList.remove('settings-error');status.textContent='保存中…';
    try {
      const r=await fetch(isNew ? '/api/profiles/new' : '/api/profiles/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...f,id:isNew ? String(f.id).trim() : form.dataset.profileForm})});
      const v=await r.json().catch(()=>({error:'后端需要重启后才有这个功能'}));if(!r.ok)throw new Error(v.error || '保存失败');
      profiles=await fetchProfiles();editing.delete(isNew ? '' : form.dataset.profileForm);paintProfiles();
      const card=document.querySelector(`[data-profile="${CSS.escape(isNew ? String(f.id).trim() : form.dataset.profileForm)}"] .skill-head`);
      if(card){const t=document.createElement('span');t.className='muted';t.textContent=v.changed===false ? '没有变化' : '已保存';card.append(t);}
    } catch(e) {status.textContent=e.message;status.classList.add('settings-error');btn.disabled=false;}
  }
  body.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.profileEdit){editing.set(b.dataset.profileEdit,true);paintProfiles();}
    else if(b.dataset.profileNew!==undefined){editing.set('',true);paintProfiles();}
    else if(b.dataset.profileCancel!==undefined){editing.delete(b.closest('form').dataset.profileForm);paintProfiles();}
    else if(b.dataset.pskillEdit){editing.set(b.dataset.pskillEdit,true);paintProfiles();}
    else if(b.dataset.pskillNew){editing.set(b.dataset.pskillNew+'/+',true);paintProfiles();}
    else if(b.dataset.pskillCancel!==undefined){editing.delete(b.closest('form').dataset.pskillForm);paintProfiles();}
    else if(b.dataset.pskillRm)void removePskill(b.dataset.pskillRm);
  });
  body.addEventListener('submit',e=>{if(e.target.matches('.profile-form')){e.preventDefault();void (e.target.matches('.pskill-form') ? savePskill(e.target) : save(e.target));}});
  return {
    // Called by the page render: read on the first view of a visit.
    ensure() {if(!loaded && !loading)void load();},
    // Called when the page is entered, so a visit always starts from disk.
    reset() {loaded=false;}
  };
}
