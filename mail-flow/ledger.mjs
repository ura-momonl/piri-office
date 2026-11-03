import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { root } from '../automation/files.mjs';

// Where the mail ledger lives and how readers open it. Every module that only reads mail goes through openLedger, so moving the ledger or adding an
// option (busy_timeout, a different journal mode) is one edit here instead of one per module. Writing stays in mail-flow/flow.mjs.
export const ledgerRelative = '.runtime/mail-flow/mail.sqlite';
export const ledgerDirectory = path.join(root, '.runtime/mail-flow');
export const ledgerFile = path.join(root, ledgerRelative);

// Read-only view of a ledger file: the office ledger by default, or a copy a test or a sandbox handed in. The caller closes it.
export function openLedger(file = ledgerFile) {
  return new DatabaseSync(file, { readOnly: true });
}
