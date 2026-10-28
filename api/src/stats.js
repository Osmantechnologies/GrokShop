// Real counts for the owner's review page: page views, Grok searches, orders, new listings, X sign-ins, reviews.
// Each event is counted once in this isolate's memory and added to the day's KV record at most every 5 minutes (and by
// the hourly cron), so the free KV write budget is never at risk. Nothing about the visitor is stored.
import { kv } from './missions.js';

const PENDING = {};   // { 'YYYY-MM-DD': { views: n, searches: n, ... } }
let lastFlush = 0;
const day = () => new Date().toISOString().slice(0, 10);

export function bump(name, n = 1) {
  const d = day(); PENDING[d] = PENDING[d] || {}; PENDING[d][name] = (PENDING[d][name] || 0) + n;
}
export async function flush(env, force) {
  if (!force && Date.now() - lastFlush < 5 * 60e3) return;
  lastFlush = Date.now();
  for (const d of Object.keys(PENDING)) {
    const add = PENDING[d]; delete PENDING[d];
    if (!Object.keys(add).length) continue;
    const k = 'stats:' + d, cur = JSON.parse((await kv(env).get(k)) || '{}');
    for (const [name, n] of Object.entries(add)) cur[name] = (cur[name] || 0) + n;
    await kv(env).put(k, JSON.stringify(cur), { expirationTtl: 400 * 86400 });
  }
}
export async function recent(env, days = 14) {
  await flush(env, true);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
    out.push({ day: d, ...JSON.parse((await kv(env).get('stats:' + d)) || '{}') });
  }
  return out;
}
