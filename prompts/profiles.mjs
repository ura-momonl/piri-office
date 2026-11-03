import fs from 'node:fs';
import path from 'node:path';
import { promptSource, joinPrompt, normalizeText as strip, historyName } from './compose.mjs';
import { root } from '../automation/files.mjs';
import { privateSkills, privateSkillParts } from './private-skills.mjs';

// A profile is the one kind of role an operation can take (prompts/profiles/<id>.md): what she does, what she judges, her stance and method.
// It is assigned by code or by `work add {profile}`, never discovered. Header keys (one line each):
//   description        shown in lists
//   skill              shared project skills (.agents/skills), comma separated; the prompt names each one and its path, the assistant reads it
//   actor, model, effort, require_outputs
//                      creation-time defaults for an operation with this profile; the operation keeps its own copy and an explicit request wins
// Skills that only this profile has live in prompts/profiles/<id>/skills (prompts/private-skills.mjs). Reviewers are the profiles named
// *-reviewer; the result-review mechanism assigns them.
const dir = new URL('./profiles/', import.meta.url);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const ACTORS = ['user', 'codex', 'claude', 'deepseek'];
const list = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);

function load(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('profile 名称不合法：' + id);
  let raw;
  try { raw = strip(fs.readFileSync(new URL(id + '.md', dir), 'utf8')); } catch { throw new Error('没有这个 profile：' + id); }
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('profile 缺少头部：' + id);
  const meta = Object.fromEntries(m[1].split('\n').map(l => l.match(/^([a-z_]+):\s*(.*)$/)).filter(Boolean).map(x => [x[1], x[2].trim()]));
  return { id, meta, body: m[2].trim() };
}
export const profileIds = () => fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
export const checkProfile = id => { load(id); };

// Creation-time defaults an operation takes from its profile.
export function profileDefaults(id) {
  if (!id) return {};
  const { meta } = load(id);
  return {
    ...(ACTORS.includes(meta.actor) ? { actor: meta.actor } : {}),
    ...(meta.model ? { model: meta.model } : {}),
    ...(meta.effort ? { effort: meta.effort } : {}),
    ...(/^(yes|true)$/i.test(meta.require_outputs || '') ? { require_outputs: true } : {}),
  };
}

export function profileText(id) {
  const p = load(id);
  const parts = [promptSource(p.body, { path: `prompts/profiles/${p.id}.md`, label: 'profile ' + p.id })];
  // 共用 skill 只给名字和路径，由助手自己读：正文几千字，放进每个任务会话的每一轮既重复又让缓存失效（2026-11-02 用户指出）。
  for (const name of list(p.meta.skill)) {
    const file = `.agents/skills/${name}/SKILL.md`;
    if (!fs.existsSync(new URL('../' + file, import.meta.url))) throw new Error(`profile ${id} 的 skill 不存在：${file}`);
    parts.push(promptSource(`方法（skill ${name}）：开工前读 ${file}；本轮输入或当前上下文已读过且未变就不再读。`, { path: file, label: name }));
  }
  parts.push(...privateSkillParts(p.id));
  return joinPrompt(parts, '\n\n');
}
export const profileSection = id => joinPrompt(['你在本操作中的角色（profile ' + id + '，程序已放入）：', profileText(id)], '\n\n');

// Editing from the dashboard (skills page). The header parser reads one line per key, so every value stays single-line.
// The old file is kept in .runtime/prompt-history/profile__<id>/ before any overwrite.
const skillExists = (name, base = root) => fs.existsSync(path.join(base, '.agents/skills', name, 'SKILL.md'));
export function profilesView() {
  return profileIds().map(id => {
    const p = load(id), skills = list(p.meta.skill);
    return { id, description: p.meta.description || '', skills, body: p.body, skills_missing: skills.filter(s => !skillExists(s)),
      actor: p.meta.actor || '', model: p.meta.model || '', effort: p.meta.effort || '', require_outputs: !!profileDefaults(id).require_outputs,
      private_skills: privateSkills(id) };
  });
}
function profileFile(id, base = root) { if (!ID.test(id ?? '')) throw new Error('profile 名称只能用小写字母、数字和 -：' + id); return path.join(base, 'prompts/profiles', id + '.md'); }
const oneLine = (name, v) => { const s = String(v ?? '').trim(); if (/[\r\n]/.test(s)) throw new Error(name + '必须是一行'); return s; };
function render(id, { description, skills, actor, model, effort, require_outputs, body }, base) {
  const d = oneLine('说明', description), b = String(body ?? '').replace(/\r\n/g, '\n').trim();
  const s = Array.isArray(skills) ? skills.map(x => String(x).trim()).filter(Boolean) : list(skills);
  const a = oneLine('默认执行者', actor), m = oneLine('默认模型', model), e = oneLine('默认推理强度', effort);
  if (!d) throw new Error('说明必须是一行非空文字');
  for (const name of s) if (!ID.test(name) || !skillExists(name, base)) throw new Error('没有这个项目 skill：' + name);
  if (a && !ACTORS.includes(a)) throw new Error('默认执行者只能是 ' + ACTORS.join('、'));
  if (m && !/^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,59}$/.test(m)) throw new Error('默认模型名格式不正确');
  if (e && !/^[a-z]+$/.test(e)) throw new Error('默认推理强度格式不正确');
  if (!b) throw new Error('正文不能为空');
  return ['---', 'name: ' + id, 'description: ' + d, ...(s.length ? ['skill: ' + s.join(', ')] : []), ...(a ? ['actor: ' + a] : []), ...(m ? ['model: ' + m] : []),
    ...(e ? ['effort: ' + e] : []), ...(require_outputs ? ['require_outputs: yes'] : []), '---', '', b, ''].join('\n');
}
function keepOldProfile(id, file, base) {
  const dir = path.join(base, '.runtime/prompt-history', 'profile__' + id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, historyName(dir, '.md')));
}
export function saveProfile(id, fields, base = root) {
  const file = profileFile(id, base);
  if (!fs.existsSync(file)) throw new Error('没有这个 profile：' + id);
  const next = render(id, fields, base);
  if (strip(fs.readFileSync(file, 'utf8')) === next) return { saved: id, changed: false };
  keepOldProfile(id, file, base);
  fs.writeFileSync(file, next);
  return { saved: id, changed: true };
}
export function newProfile(id, fields, base = root) {
  const file = profileFile(id, base);
  if (fs.existsSync(file)) throw new Error('已有同名 profile：' + id);
  fs.writeFileSync(file, render(id, fields, base), { flag: 'wx' });
  return { created: id };
}
// The settings page edits the default executor / model / effort of a profile; everything else in the file stays as it is.
export function setProfileDefaults(id, { actor, model, effort }) {
  const p = profilesView().find(x => x.id === id);
  if (!p) throw new Error('没有这个 profile：' + id);
  return saveProfile(id, { ...p, actor: actor ?? p.actor, model: model ?? p.model, effort: effort ?? p.effort });
}
