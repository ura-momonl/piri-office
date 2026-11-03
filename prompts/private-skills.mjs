import fs from 'node:fs';
import path from 'node:path';
import { promptSource, normalizeText as strip, historyName } from './compose.mjs';
import { root } from '../automation/files.mjs';

// A profile may own skills that only it sees: prompts/profiles/<profile>/skills/<name>/SKILL.md. They are not under .agents/skills and have no
// .claude/skills link, so no assistant discovers them; the profile's prompt carries them instead. Shared skills stay in .agents/skills.
// Header (one line per key): name, description, and `inline: yes` to put the whole text into the prompt; otherwise the prompt carries only
// name + description + path and the assistant reads the file when it needs the method.
const ID = /^[a-z0-9][a-z0-9-]*$/;
const skillsDir = (profile, base) => path.join(base, 'prompts/profiles', profile, 'skills');
const fileOf = (profile, name, base) => path.join(skillsDir(profile, base), name, 'SKILL.md');
const relPath = (profile, name) => `prompts/profiles/${profile}/skills/${name}/SKILL.md`;

function parse(raw) {
  const m = strip(raw).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = Object.fromEntries(m[1].split('\n').map(l => l.match(/^([a-z_]+):\s*(.*)$/)).filter(Boolean).map(x => [x[1], x[2].trim()]));
  return { meta, body: m[2].trim() };
}

export function privateSkills(profile, base = root) {
  const dir = skillsDir(profile, base);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !ID.test(d.name)) continue;
    let raw; try { raw = fs.readFileSync(path.join(dir, d.name, 'SKILL.md'), 'utf8'); } catch { continue; }
    const p = parse(raw);
    if (!p) continue;
    out.push({ name: d.name, description: p.meta.description || '', inline: /^(yes|true)$/i.test(p.meta.inline || ''), body: p.body, path: relPath(profile, d.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Prompt parts for the profile: one index of the on-demand skills, then the text of each inline one.
export function privateSkillParts(profile, base = root) {
  const list = privateSkills(profile, base), parts = [];
  const indexed = list.filter(s => !s.inline);
  if (indexed.length) {
    parts.push(promptSource('本角色私有的 skill（只有这个角色有，不在项目 skill 目录里，别的助手发现不了；用到时读对应文件）：\n'
      + indexed.map(s => `- ${s.name}：${s.description}（${s.path}）`).join('\n'), { path: `prompts/profiles/${profile}/skills/`, label: '私有 skill 索引' }));
  }
  for (const s of list.filter(x => x.inline)) {
    parts.push(promptSource(`方法（本角色私有 skill ${s.name}，程序已放入）：\n\n${s.body}`, { path: s.path, label: s.name }));
  }
  return parts;
}

function render(name, { description, body, inline }) {
  const d = String(description ?? '').trim(), b = String(body ?? '').replace(/\r\n/g, '\n').trim();
  if (!d || /[\r\n]/.test(d)) throw new Error('说明必须是一行非空文字（它是触发条件）');
  if (!b) throw new Error('正文不能为空');
  return ['---', 'name: ' + name, 'description: ' + d, ...(inline ? ['inline: yes'] : []), '---', '', b, ''].join('\n');
}
function check(profile, name, base) {
  if (!ID.test(profile ?? '') || !fs.existsSync(path.join(base, 'prompts/profiles', profile + '.md'))) throw new Error('没有这个 profile：' + profile);
  if (!ID.test(name ?? '')) throw new Error('skill 名称只能用小写字母、数字和 -：' + name);
}
function keepOld(profile, name, base, source) {
  const dir = path.join(base, '.runtime/prompt-history', `profile__${profile}__skill__${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(source, path.join(dir, historyName(dir)), { recursive: true });
}
export function savePrivateSkill(profile, name, fields, { create = false } = {}, base = root) {
  check(profile, name, base);
  const file = fileOf(profile, name, base), exists = fs.existsSync(file);
  if (create && exists) throw new Error('这个角色已有同名私有 skill：' + name);
  if (!create && !exists) throw new Error('没有这个私有 skill：' + name);
  if (create && fs.existsSync(path.join(base, '.agents/skills', name))) throw new Error('项目共享 skill 里已有「' + name + '」，换个名字以免混淆');
  const next = render(name, fields);
  if (exists) {
    if (strip(fs.readFileSync(file, 'utf8')) === next) return { saved: name, changed: false };
    keepOld(profile, name, base, path.dirname(file));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return create ? { created: name } : { saved: name, changed: true };
}
export function removePrivateSkill(profile, name, base = root) {
  check(profile, name, base);
  const dir = path.dirname(fileOf(profile, name, base));
  if (!fs.existsSync(dir)) throw new Error('没有这个私有 skill：' + name);
  keepOld(profile, name, base, dir);
  fs.rmSync(dir, { recursive: true });
  return { removed: name };
}
