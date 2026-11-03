// A published copy ships code, not this machine's data: the project list, calendar, procurement records and literature
// catalog are personal and stay out of the snapshot. Readers assume these files exist, so the first start writes empty ones.
// Only missing files are created; nothing that exists is touched.
import fs from 'node:fs';
import path from 'node:path';
import { root, write } from './files.mjs';

const EMPTY = {
  'projects/catalog.json': { version: '1', source: '', projects: [], links: [], dependencies: [] },
  'calendar/events.json': { events: [] },
  'procurement/catalog.json': { version: '1', requests: [] },
  'literature/catalog.json': { version: '1', papers: [] },
};

export function ensureOffice() {
  const created = [];
  for (const [file, value] of Object.entries(EMPTY)) {
    if (fs.existsSync(path.join(root, file))) continue;
    write(file, value);
    created.push(file);
  }
  fs.mkdirSync(path.join(root, 'workspace/projects'), { recursive: true });
  return created;
}
