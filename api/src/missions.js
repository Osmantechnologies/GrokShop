// Missions that keep watching while the visitor is away.
// The browser keeps its missions (localStorage) and syncs them here under a random device id (no account, no personal
// data). An hourly Cron Trigger re-checks every due mission against the catalogue with the code filter only (no model
// call, no spend) and writes a report; the Missions page reads the reports and shows what changed since the last visit.
// Storage: KV binding DATA when present, else Worker memory (local dev / not yet bound).
import { matchCatalogue, strictFit } from './match.js';

const MEM = new Map();
// a site address the helper serves: one listed in ALLOW_ORIGINS, or a Netlify per-deploy link of a listed Netlify site
// (https://<deploy-id>--<site>.netlify.app), which Netlify shows after every upload
export function originOk(env, origin) {
  const allow = String(env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.includes('*') || allow.includes(origin)) return true;
  const m = /^https:\/\/[a-z0-9]+--([a-z0-9-]+)\.netlify\.app$/.exec(origin || '');
  return !!m && allow.includes('https://' + m[1] + '.netlify.app');
}
export const kv = (env) => env.DATA || { get: async (k) => MEM.get(k) ?? null, put: async (k, v) => { MEM.set(k, v); }, delete: async (k) => { MEM.delete(k); } };
const DEV_RE = /^[a-z0-9]{16,40}$/;
const EVERY_H = { hourly: 1, daily: 24, weekly: 24 * 7, 'every 3 weeks': 24 * 21, once: 24 };
const MAX_MISSIONS = 20, MAX_DEVICES = 5000;

function clean(m) {
  return {
    id: String(m.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24), name: String(m.name || '').slice(0, 60), what: String(m.what || '').slice(0, 200),
    budget: Math.max(0, Math.min(100000, +m.budget || 0)), every: EVERY_H[m.every] ? m.every : 'daily', status: m.status === 'done' ? 'done' : undefined
  };
}

// one mission against the catalogue: real prices only; "changed" = first find, or a lower best price than last time
export function checkOne(m, products, now) {
  const q = m.what + (m.budget && !/\$\d/.test(m.what) ? ' under $' + m.budget : '');
  const r = matchCatalogue(products, q);
  const fits = strictFit(products, r.ask);
  const ps = r.inBudget.filter(p => (!m.budget || p.price <= m.budget) && fits(p)).sort((a, b) => a.price - b.price);
  const best = ps[0], prev = m.bestPrice;
  const out = { ...m, checkedAt: now };
  if (best) {
    out.status = m.status === 'done' ? 'done' : 'found'; out.bestId = best.id; out.bestPrice = best.price;
    out.report = 'found ' + ps.length + (m.budget ? ' under $' + m.budget : '') + ', best so far $' + best.price.toFixed(2) + ' (' + best.title.toLowerCase() + ')';
    if (prev == null) { out.changedAt = now; out.change = 'found'; }
    else if (best.price < prev - 0.001) { out.changedAt = now; out.change = 'price drop: $' + prev.toFixed(2) + ' → $' + best.price.toFixed(2); }
  } else {
    out.status = m.status === 'done' ? 'done' : 'watching';
    out.report = 'still watching, nothing' + (m.budget ? ' under $' + m.budget : '') + ' yet';
  }
  return out;
}

function due(m, now) { return m.status !== 'done' && !(m.every === 'once' && m.status === 'found') && (!m.checkedAt || now - m.checkedAt >= (EVERY_H[m.every] || 24) * 3600e3 - 60e3); }

async function load(env, device) { try { return JSON.parse((await kv(env).get('dev:' + device)) || 'null'); } catch (e) { return null; } }
async function save(env, device, rec) { await kv(env).put('dev:' + device, JSON.stringify(rec)); }

// POST /missions {device, missions:[…]} : the browser's list wins for what/budget/every; server keeps its reports
export async function syncMissions(env, body, products) {
  const device = String(body.device || '');
  if (!DEV_RE.test(device)) return { status: 400, body: { error: 'bad device id' } };
  const now = Date.now(), old = (await load(env, device)) || { missions: [] };
  const byId = new Map(old.missions.map(m => [m.id, m]));
  let list = (Array.isArray(body.missions) ? body.missions : []).slice(0, MAX_MISSIONS).map(clean).filter(m => m.id && m.what.length >= 3);
  list = list.map(m => {
    const o = byId.get(m.id);
    const same = o && o.what === m.what && o.budget === m.budget;
    const merged = same ? { ...o, name: m.name, every: m.every, status: m.status || (o.status === 'done' ? 'watching' : o.status) } : { ...m };
    return !same || !merged.checkedAt ? checkOne(merged, products, now) : merged;   // new or edited missions are checked at once
  });
  await save(env, device, { missions: list, updated: now });
  if (!old.updated) {   // first time this device syncs: add it to the list the hourly check walks
    const idx = JSON.parse((await kv(env).get('devices')) || '[]');
    if (!idx.includes(device)) { idx.push(device); await kv(env).put('devices', JSON.stringify(idx.slice(-MAX_DEVICES))); }
  }
  return { status: 200, body: { missions: list } };
}

// GET /missions?device= : the reports (and any check that is due, so a stale list is never shown)
export async function getMissions(env, device, products) {
  if (!DEV_RE.test(device)) return { status: 400, body: { error: 'bad device id' } };
  const rec = await load(env, device); if (!rec) return { status: 200, body: { missions: [] } };
  const now = Date.now(); let touched = false;
  rec.missions = rec.missions.map(m => { if (due(m, now)) { touched = true; return checkOne(m, products, now); } return m; });
  if (touched) await save(env, device, rec);
  return { status: 200, body: { missions: rec.missions, updated: rec.updated } };
}

// the hourly Cron Trigger: every due mission on every device
export async function runAll(env, products) {
  const idx = JSON.parse((await kv(env).get('devices')) || '[]'), now = Date.now();
  let checked = 0, changed = 0;
  for (const device of idx) {
    const rec = await load(env, device); if (!rec) continue;
    let touched = false;
    rec.missions = rec.missions.map(m => {
      if (!due(m, now)) return m;
      const n = checkOne(m, products, now); touched = true; checked++; if (n.changedAt === now) changed++; return n;
    });
    if (touched) await save(env, device, rec);
  }
  return { devices: idx.length, checked, changed };
}
