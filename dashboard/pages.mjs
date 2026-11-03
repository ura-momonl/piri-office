// Page identity, navigation, rendering, entry reset and public assets have one owner.
// index.html supplies content only; the server derives its section shells and navs here.
export const pageGroups={
  chat:{tabs:'chat-tabs',sidebar:{id:'chat',label:'对话',icon:'chat',order:0,count:'active-count',title:'数字为正在执行的助手任务数，不含用户实验；已在对话模块时再次点击，依次切换正在运行的会话'}},
  library:{tabs:'library-tabs',sidebar:{id:'projects',label:'资料库',icon:'projects',order:2}},
  more:{tabs:'more-tabs',sidebar:{id:'more',label:'更多',icon:'connections',order:4}}
};
export const pageRegistry=[
  {id:'chat',title:'对话',tab:'当前对话',group:'chat',liveOnly:true,sectionClass:'chat-page',render:c=>c.renderChat()},
  {id:'history',title:'历史对话',group:'chat',liveOnly:true,render:c=>c.renderSessionList('history')},
  {id:'tasks',title:'任务会话',group:'chat',liveOnly:true,count:'task-count',countTitle:'正在运行的任务会话',render:c=>c.renderSessionList('tasks')},
  {id:'inbox',title:'收件箱',sidebar:{id:'inbox',label:'收件箱',icon:'inbox',order:1,count:'inbox-count'},render:c=>c.renderInbox()},
  {id:'projects',title:'项目',group:'library',assets:['project-editor.js','project-drag.js','framework-ui.js'],render:c=>c.renderProjects()},
  {id:'literature',title:'文献',group:'library',liveOnly:true,assets:['literature.js'],render:c=>c.renderLiterature()},
  {id:'weekly',title:'周计划与复盘',sidebar:{id:'weekly',label:'周计划与复盘',icon:'weekly',order:3},liveOnly:true,render:c=>{void c.loadWeek();c.renderCalendar();}},
  {id:'board',title:'工作看板',group:'more',liveOnly:true,render:c=>c.renderBoard()},
  {id:'mail',title:'邮件',group:'more',liveOnly:true,render:c=>c.renderMail()},
  {id:'procurement',title:'采购',group:'more',liveOnly:true,render:c=>c.renderProcurement()},
  {id:'instruments',title:'仪器图鉴',group:'more',liveOnly:true,assets:['instruments.js','instruments.css'],render:c=>c.renderInstruments(c.state)},
  {id:'skills',title:'技能',group:'more',liveOnly:true,assets:['skills-view.js'],render:c=>c.skills.ensure(),reset:c=>c.skills.reset()},
  {id:'prompts',title:'提示词',group:'more',liveOnly:true,assets:['prompts-view.js','prompts-view.css'],render:c=>c.renderPrompts()},
  {id:'usage',title:'额度与消耗',group:'more',assets:['usage-view.js'],render:c=>c.renderUsage()},
  {id:'connections',title:'设置',group:'more',liveOnly:true,assets:['settings-view.js','avatar-tuner.js','setup-view.js','setup.css'],render:c=>c.renderConnections(),reset:c=>c.settings.reset()}
];
export const pageById=Object.fromEntries(pageRegistry.map(p=>[p.id,p]));
export const pageAssets=Object.fromEntries([...new Set(pageRegistry.flatMap(p=>p.assets || []))].map(file=>['/'+file,file]));

const count=({count,countTitle})=>count ? ` <i id="${count}"${countTitle ? ` title="${countTitle}"` : ''}></i>` : '';
export function renderPageShell(html) {
  const sidebar=[...Object.values(pageGroups).map(g=>g.sidebar),...pageRegistry.flatMap(p=>p.sidebar ? [p.sidebar] : [])].sort((a,b)=>a.order-b.order);
  const nav=sidebar.map(p=>`<button data-page="${p.id}" class="nav${p.id==='chat' ? ' active' : ''}"${p.title ? ` title="${p.title}"` : ''}><span data-ico="${p.icon}"></span> ${p.label}${count(p)}</button>`).join('');
  html=html.replace('<!-- page-sidebar -->',nav);
  for(const [group,{tabs}] of Object.entries(pageGroups)) {
    const buttons=pageRegistry.filter(p=>p.group===group).map(p=>`<button type="button" data-page="${p.id}" class="chat-tab${group==='more' ? ' more-tab' : ''}${p.id==='chat' ? ' active' : ''}"${p.id==='chat' ? ' aria-current="page"' : ''}>${p.tab || p.title}${count(p)}</button>`).join('');
    html=html.replace(`<!-- ${tabs} -->`,buttons);
  }
  return html.replace(/<section data-page-content="([\w-]+)">/g,(_,id)=>{
    const p=pageById[id];
    return `<section id="page-${p.id}" class="page ${p.sectionClass || 'content-page'}"${p.id==='chat' ? '' : ' hidden'}>`;
  });
}
