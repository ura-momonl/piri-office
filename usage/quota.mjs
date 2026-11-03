// Account quota windows read the same way everywhere: the TUI status line and the
// dashboard header/page both show these numbers, so the rule lives here once.
// A window whose reset time has passed has started over: the percentage it still
// carries belongs to the previous window and must not be shown as current.
export const windowLive = (w, now = Date.now()) => !!w && !(w.resets_at && Date.parse(w.resets_at) <= now);
// A passed window counts as full until the next reading arrives.
export const remainingPercent = (w, now = Date.now()) => windowLive(w, now) ? w.remaining_percent : 100;
// Windows whose reset time has passed describe usage that no longer counts; drop them
// (the Claude quota has no "full" value to fall back to, unlike the rolling CC windows).
export const liveWindows = (windows = [], now = Date.now()) => windows.filter(w => windowLive(w, now));
// Codex reports used percent inside rate-limit buckets; what the UI shows is what is left.
export const remainingFromUsed = used => Math.max(0, 100 - used);
