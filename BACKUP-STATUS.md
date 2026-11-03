# PIRI Office — v0.2.0 (2026-11-03)

Source release v0.2.0 of PIRI Office, MIT licensed (see `LICENSE`). This is a de-personalised public build of a local research office: it needs local state and configuration for mail, literature and the assistants. The first start writes empty project, calendar, procurement and literature stores, and the setup wizard connects an assistant. The checks run for each release are listed in its GitHub release notes.

Included: source code, tests, necessary configuration and documentation, UI assets, and the literature module source. Every file's SHA-256 is listed in `BACKUP-MANIFEST.json`.

Excluded: credentials and runtime directories, mail/account state, personal calendar, project and procurement catalogs, task/conversation records, dated assistant logs, research workspace, literature records/PDFs/indexes, dependencies and vendor downloads. It needs local state/configuration to run.

## Getting it and updating it

First download: `git clone https://github.com/ura-momonl/piri-office` (or download the ZIP).

Incremental update without git (works for ZIP downloads and for copies you have edited):

```
node scripts/github-update.mjs            # preview what changed on GitHub
node scripts/github-update.mjs --apply    # apply it
```

It compares each file with `BACKUP-MANIFEST.json`, downloads only changed files and verifies their SHA-256. Files you have not touched are overwritten; files you changed locally are never overwritten — the GitHub version is put in `.runtime/github-update/incoming/` for merging. If it reports `package.json` changed, run `npm install`; restart the backend after code changes. Node 18+ only, no dependencies.
