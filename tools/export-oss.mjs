// Build the public GrokShop repo from this working tree: node grokazon/tools/export-oss.mjs
// Copies the allow-listed files into grokazon/oss/ (its own git repo), swaps the owner's Cloudflare/X/KV identifiers for
// placeholders, then scans the result for the owner's name and every key in the vault. Refuses to finish on any hit.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'oss');
const INCLUDE = ['index.html', 'search.html', 'product.html', 'cart.html', 'checkout.html', 'order.html', 'orders.html', 'seller.html', 'admin.html', 'about.html', 'results.html', 'missions.html', 'sell.html', 'privacy.html', 'terms.html',
  'config.js', 'common.js', 'app.js', 'store.js', 'store.css', 'site.css', 'tokens.css', '_redirects', 'version.txt',
  'assets', 'data', 'docs', 'learnings', 'qa/shots.cjs', 'deploy/build_zip.py', 'tools/export-oss.mjs',
  'video/record.cjs', 'video/make-cards.cjs', 'video/assemble.py', 'video/make-og.cjs', 'video/make-tutorial.cjs', 'video/make-concept.cjs', 'video/make-soon.cjs', 'video/make-real.cjs',
  'social/real.jpg', 'social/tutorial.jpg', 'social/concept.jpg', 'social/real-soon.jpg', 'social/grokazon-demo.mp4',
  'api/package.json', 'api/wrangler.toml', 'api/src', 'api/test', 'api/fixtures', 'api/data'];
// account-specific values -> placeholders (the live deployment keeps its own in the private tree)
const SWAPS = [
  [/grokazon-api\.[a-z0-9]+\.workers\.dev/g, 'grokshop-api.YOUR-ACCOUNT.workers.dev'],
  [/YOUR_KV_NAMESPACE_ID/g, 'YOUR_KV_NAMESPACE_ID'],
  [/YOUR_X_CLIENT_ID/g, 'YOUR_X_CLIENT_ID'],
  [/X app "ShopWithX" \(id \d+\), set up [0-9-]+/g, 'your X app'],
  [/require\('(?:\.\.\/)+world-of-hoodcraft\/node_modules\/playwright'\)/g, "require('playwright')"],   // the private tree borrows another project's Playwright
  [/require\('C:\/Users\/[^']*\/node_modules\/playwright'\)/g, "require('playwright')"],
];
const TEXT = /\.(html|js|mjs|cjs|css|toml|py|md|json|txt|_redirects)$/i;
const vault = [];
for (const d of ['grokazon', 'xai']) { const dir = path.join(os.homedir(), 'keys', d); if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.txt$/.test(f)) { const v = fs.readFileSync(path.join(dir, f), 'utf8').trim(); if (v.length > 12) vault.push([d + '/' + f, v]); } }
try { const dv = fs.readFileSync(path.join(ROOT, 'api', '.dev.vars'), 'utf8'); for (const line of dv.split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.{12,})$/); if (m) vault.push(['.dev.vars ' + m[1], m[2].trim()]); } } catch (e) { }
// the owner's name (spelt in two parts so this file does not match itself) and real-looking key values; bare prefixes in
// validation code ("sk_live_", "shpat_") are fine
const BAD = [new RegExp('eug' + 'ene', 'i'), /sk_(test|live)_[A-Za-z0-9]{24,}/, /xai-[A-Za-z0-9]{24,}/, /sk-ant-[A-Za-z0-9_-]{24,}/, /shpat_[a-f0-9]{24,}/, /CJ\d+@api@[a-f0-9]{24,}/];

if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (f !== '.git') fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let files = 0; const hits = [];
function copy(rel) {
  const src = path.join(ROOT, rel), dst = path.join(OUT, rel);
  if (!fs.existsSync(src)) { console.log('missing', rel); return; }
  if (fs.statSync(src).isDirectory()) { for (const f of fs.readdirSync(src)) if (!/^(\.wrangler|node_modules|out|shots|\.dev\.vars)$/.test(f)) copy(path.join(rel, f)); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (TEXT.test(rel) || /_redirects$/.test(rel)) {
    let t = fs.readFileSync(src, 'utf8');
    for (const [re, to] of SWAPS) t = t.replace(re, to);
    for (const re of BAD) if (re.test(t)) hits.push(rel + ' matches ' + re);
    for (const [name, v] of vault) if (t.includes(v) || t.includes(v.slice(0, 24))) hits.push(rel + ' contains the value of ' + name);
    fs.writeFileSync(dst, t);
  } else fs.copyFileSync(src, dst);
  files++;
}
INCLUDE.forEach(copy);
// repo-only files
fs.writeFileSync(path.join(OUT, '.gitignore'), 'node_modules/\napi/.dev.vars\napi/.wrangler/\ndeploy/site/\ndeploy/*.zip\nqa/shots/\nvideo/out/\n.DS_Store\n');
for (const f of ['README.md', 'LICENSE']) { const p = path.join(ROOT, 'oss-meta', f); if (fs.existsSync(p)) { let t = fs.readFileSync(p, 'utf8'); for (const [re, to] of SWAPS) t = t.replace(re, to); for (const re of BAD) if (re.test(t)) hits.push(f + ' matches ' + re); fs.writeFileSync(path.join(OUT, f), t); files++; } }
console.log('exported', files, 'files to', OUT);
if (hits.length) { console.log('REFUSED, scrub these first:'); hits.forEach(h => console.log('  ' + h)); process.exit(1); }
console.log('scan clean: no owner name, no vault values');
