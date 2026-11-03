import fs from 'node:fs';

// Journals are append-only; a hard kill can leave a torn (unparseable) line. Skip such lines
// instead of making the whole resume fail: the affected DOI is simply attempted again.
export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* torn line */ }
  }
  return rows;
}

// One running batch per directory. A RUNNING file left by a dead process is moved aside.
export function takeBatchLock(lock, busyMessage) {
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    if (alive) throw Object.assign(Error(busyMessage), { code: 'EEXIST' });
    fs.renameSync(lock, lock + '.stale-' + Date.now());
  }
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
}
