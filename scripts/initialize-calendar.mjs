// One-time publication of the availability explicitly provided by the owner.
// Load only ignored local configuration, and never print credentials.
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const origin = process.env.MOONCRAB_ORIGIN || 'https://mooncrab.vercel.app';
const token = process.env.BOOKING_ADMIN_TOKEN;
if (!token) throw new Error('BOOKING_ADMIN_TOKEN must be configured before publishing the calendar.');
const endpoint = new URL('/api/admin/availability', origin);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const current = await fetch(endpoint, { headers });
if (!current.ok) throw new Error(`Cannot read owner calendar: HTTP ${current.status}`);
const calendar = await current.json();
if (calendar.initialized) throw new Error('Calendar already published. Use the owner dashboard to manage later changes.');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const blockedDates = [];
for (let day = new Date(`${today}T00:00:00Z`); day.toISOString().slice(0, 10) < '2026-12-17'; day.setUTCDate(day.getUTCDate() + 1)) {
  blockedDates.push(day.toISOString().slice(0, 10));
}
const response = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ add: blockedDates, remove: [], initialize: true }) });
if (!response.ok) throw new Error(`Calendar publication failed: HTTP ${response.status}`);
console.log(`Calendar published with ${blockedDates.length} blocked dates through December 16, 2026; availability resumes December 17. Minimum stay: two nights.`);
