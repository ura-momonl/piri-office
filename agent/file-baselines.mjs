// Immutable file-state baselines live outside the frequently rewritten chat store.
// Persist the object before publishing its reference. Because the name is the content digest, "does any
// session still point here" is exact: housekeeping removes the ones nobody references (unreferencedBaselines).
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root,read,write} from '../automation/files.mjs';

const directory='.runtime/agent/file-baselines';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const location=ref=>{
  if(!/^[a-f0-9]{64}$/.test(ref?.sha256 || ''))throw new Error('Invalid file baseline reference');
  return `${directory}/${ref.sha256}.json`;
};
export function loadBaseline(value) {
  if(!value || value.files)return value; // Existing inline baselines remain readable.
  const file=location(value),baseline=read(file);
  if(!baseline || digest(baseline)!==value.sha256)throw new Error('File baseline missing or changed: '+file);
  return baseline;
}
// The baselines the session store still points at, as file names. Both places are counted: each
// provider's file_snapshots and the legacy codex continuation snapshot.
export function referencedBaselines() {
  const state=read('.runtime/agent/sessions.json',{sessions:[]}),names=new Set();
  const add=value=>{ if(/^[a-f0-9]{64}$/.test(value?.sha256 || ''))names.add(value.sha256+'.json'); };
  for(const session of state.sessions || []) {
    for(const value of Object.values(session.file_snapshots || {}))add(value);
    add(session.codex_continuation?.fileSnapshot);
  }
  return names;
}
// Candidates for housekeeping: every baseline no session references, with its age and size. Nothing is
// removed here. Only unreferenced files are offered, so a stored reference can never point at a deleted file.
// A session store that cannot be read means the references are unknown, so nothing is offered that day.
export function unreferencedBaselines() {
  const folder=path.join(root,directory),found=[];
  let referenced;
  // No session store at all (moved away) would read as an empty reference set and offer every baseline.
  if(!fs.existsSync(path.join(root,'.runtime/agent/sessions.json')))return found;
  try{referenced=referencedBaselines();}catch{return found;}
  if(!fs.existsSync(folder))return found;
  for(const name of fs.readdirSync(folder)) {
    if(referenced.has(name))continue;
    const file=path.join(folder,name),stat=fs.statSync(file);
    if(stat.isFile())found.push({path:file,mtime:stat.mtimeMs,bytes:stat.size});
  }
  return found;
}
export function saveBaseline(baseline) {
  const ref={sha256:digest(baseline)},file=location(ref);
  // Reusing an existing file refreshes its mtime, so housekeeping's grace period covers the moment before the reference is stored.
  if(fs.existsSync(path.join(root,file))){loadBaseline(ref);const now=new Date();fs.utimesSync(path.join(root,file),now,now);}
  else write(file,baseline);
  return ref;
}
// Run only at backend startup, before task recovery/dispatch. All child objects
// are committed first, so a failed write leaves the original session store usable.
export function migrateSessionBaselines() {
  const file='.runtime/agent/sessions.json',state=read(file,{sessions:[]});let moved=0;
  for(const session of state.sessions) {
    for(const [provider,value] of Object.entries(session.file_snapshots || {}))if(value?.files){
      session.file_snapshots[provider]=saveBaseline(value);moved++;
    }
    const legacy=session.codex_continuation?.fileSnapshot;
    if(legacy?.files){session.codex_continuation.fileSnapshot=saveBaseline(legacy);moved++;}
  }
  if(moved)write(file,state);
  return moved;
}
