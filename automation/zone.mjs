// The office's time zone: the `timezone` of weekly/config.json (an IANA name), America/Chicago when it is missing or unknown.
// Calendar days, "today", the Monday plan and daily jobs all follow it, whatever zone the machine or the browser is in.
// A change takes effect after the backend restarts.
import { read } from './files.mjs';

export const DEFAULT_ZONE = 'America/Chicago';
export function officeZone() {
  const zone = read('weekly/config.json', {}).timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone; } catch { return DEFAULT_ZONE; }
}
// Windows time zone name for Microsoft Graph's `outlook.timezone` preference; UTC for zones not listed.
const WINDOWS = { 'America/Chicago': 'Central Standard Time', 'America/New_York': 'Eastern Standard Time', 'America/Denver': 'Mountain Standard Time',
  'America/Los_Angeles': 'Pacific Standard Time', 'Europe/London': 'GMT Standard Time', 'Europe/Berlin': 'W. Europe Standard Time', 'Europe/Paris': 'Romance Standard Time',
  'Asia/Shanghai': 'China Standard Time', 'Asia/Tokyo': 'Tokyo Standard Time', 'Asia/Kolkata': 'India Standard Time', UTC: 'UTC' };
export const graphZone = () => WINDOWS[officeZone()] ?? 'UTC';
