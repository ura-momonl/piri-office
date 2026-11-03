import fs from 'node:fs';
import path from 'node:path';
import {root,read,write} from '../automation/files.mjs';
import {decodeImages} from '../agent/images.mjs';

// An avatar the user uploaded (already cropped in the browser) replaces the shipped one for that person. The shipped files in
// dashboard/avatars are never touched, so "还原默认" just deletes the upload. dashboard/avatars/view.json remembers who has one.
const FILE='dashboard/avatars/view.json',CUSTOM='dashboard/avatars/custom';
export const WHO=['user','codex','claude','deepseek'];
export function avatarView() {
  const saved=read(FILE,{});
  return Object.fromEntries(WHO.map(who=>[who,saved[who]?.custom ? {custom:saved[who].custom,v:saved[who].v} : {}]));
}
export const customFile=who=>{const ext=avatarView()[who]?.custom;return ext ? path.join(root,CUSTOM,`${who}.${ext}`) : null;};
export function setCustomAvatar(who,dataUrl) {
  if(!WHO.includes(who))throw new Error('未知头像：'+who);
  const view=avatarView(),old=customFile(who);
  let image,ext;
  // Validate the upload before touching the existing avatar: a rejected image must leave the current one in place.
  if(dataUrl!==null) {
    [image]=decodeImages([{data_url:dataUrl,name:'avatar'}]);
    if(!['image/png','image/jpeg','image/webp'].includes(image.mime))throw new Error('头像请用 PNG、JPEG 或 WebP');
    ext=image.mime==='image/png' ? 'png' : image.mime==='image/webp' ? 'webp' : 'jpg';
  }
  if(old)fs.rmSync(old,{force:true});
  if(dataUrl===null)view[who]={};
  else {
    fs.mkdirSync(path.join(root,CUSTOM),{recursive:true});
    fs.writeFileSync(path.join(root,CUSTOM,`${who}.${ext}`),image.bytes);
    view[who]={custom:ext,v:Date.now()};
  }
  write(FILE,view);
  return view;
}
// Pages show an avatar through <img data-who="..."> with its shipped src; this stylesheet swaps in the upload.
export function avatarCss() {
  const view=avatarView();
  return WHO.filter(who=>view[who].custom).map(who=>`img[data-who="${who}"]{content:url(/avatars/custom/${who}?v=${view[who].v})}`).join('\n')+'\n';
}
