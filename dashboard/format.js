// Values that reach the page go through one escaping function and one set of number/date formats,
// so a rule changed here changes every dashboard module at once.
export const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num=n=>Number(n || 0).toLocaleString('zh-CN');
// The usage page reports whole call counts; other pages print the stored number.
export const int=n=>Math.round(Number(n || 0)).toLocaleString('zh-CN');
// List timestamps drop the year; the answer-record dialog shows it. Both keep an explicit fallback
// for a value that is missing, so the caller decides what an absent date looks like.
export const when=(t,fallback='—')=>t ? new Date(t).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : fallback;
export const whenFull=(t,fallback='')=>t ? new Date(t).toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : fallback;
// The office keeps its calendar in its own zone (weekly/config.json, sent with every state poll) whatever zone the browser is in.
let officeZone='America/Chicago';
export const setOfficeZone=z=>{if(typeof z==='string'&&z)officeZone=z;};
export const officeZoneName=()=>officeZone;
export const chicagoTime=(t,{hour12}={})=>new Date(t).toLocaleString('zh-CN',{timeZone:officeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',...(hour12===undefined ? {} : {hour12})});
// Reads a File/Blob as a data URL.
export const readDataUrl=file=>new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onerror=()=>reject(new Error('文件读取失败，请重新选择'));
  reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);
});
