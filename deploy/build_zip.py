# Build the Netlify deploy zip: python grokazon/deploy/build_zip.py
# Writes grokazon/deploy/site/ and grokazon/deploy/grokazon-netlify-latest.zip (one file, overwritten each build).
# Explicit manifest, forward-slash paths, no dotfiles, every local file a page references must be inside,
# versions must agree. Builds only: nothing is deployed.
import os, re, shutil, zipfile, filecmp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'deploy', 'site')
OUT_ZIP = os.path.join(ROOT, 'deploy', 'grokazon-netlify-latest.zip')
FILES = [
    'index.html', 'search.html', 'product.html', 'cart.html', 'checkout.html', 'order.html', 'orders.html', 'seller.html', 'admin.html',
    'about.html', 'results.html', 'missions.html', 'sell.html', 'privacy.html', 'terms.html',
    'tokens.css', 'site.css', 'store.css', 'config.js', 'common.js', 'app.js', 'store.js',
    'data/fixture-headphones.json', 'version.txt', '_redirects',
]
# generated art, once the owner has made it (art-src/PROMPTS.md)
if os.path.isdir(os.path.join(ROOT, 'assets')):
    FILES += ['assets/' + f for f in sorted(os.listdir(os.path.join(ROOT, 'assets'))) if not f.startswith('.')]

for f in FILES:
    assert os.path.isfile(os.path.join(ROOT, f)), 'missing ' + f
    assert not any(p.startswith('.') for p in f.split('/')), 'dotfile ' + f

# the site's saved answer must be the helper's fixture
assert filecmp.cmp(os.path.join(ROOT, 'data', 'fixture-headphones.json'), os.path.join(ROOT, 'api', 'fixtures', 'headphones.json'), shallow=False), \
    'data/fixture-headphones.json differs from api/fixtures/headphones.json'

refs = set()
for f in FILES:
    if f.endswith(('.html', '.js', '.css')):
        txt = open(os.path.join(ROOT, f), encoding='utf8').read()
        for m in re.finditer(r'''(?:src|href)=["']([^"'#?:]+\.(?:js|css|webp|png|html|json))''', txt):
            refs.add(m.group(1))
        for m in re.finditer(r'''['"]((?:data|assets)/[^'"?]+)''', txt):
            refs.add(m.group(1))
missing = sorted(r for r in refs if r not in FILES and not r.startswith('http'))
assert not missing, 'referenced but not shipped: ' + ', '.join(missing)

cfg = open(os.path.join(ROOT, 'config.js'), encoding='utf8').read()
ver = open(os.path.join(ROOT, 'version.txt')).read().strip()
assert "VERSION: '" + ver + "'" in cfg, 'config.js VERSION does not match version.txt ' + ver
for f in FILES:
    if f.endswith('.html'):
        txt = open(os.path.join(ROOT, f), encoding='utf8').read()
        tags = re.findall(r'\?v=([0-9.]+)', txt)
        assert tags and all(t == ver for t in tags), f + ' has a stale ?v= (' + ', '.join(sorted(set(tags))) + ')'

# (the footer concept line was removed by the owner on 2026-10-16, so it is no longer checked here)

if os.path.isdir(OUT_DIR): shutil.rmtree(OUT_DIR)
for f in FILES:
    dst = os.path.join(OUT_DIR, *f.split('/'))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(os.path.join(ROOT, f), dst)
if os.path.exists(OUT_ZIP): os.remove(OUT_ZIP)
with zipfile.ZipFile(OUT_ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        z.write(os.path.join(ROOT, f), f)
names = zipfile.ZipFile(OUT_ZIP).namelist()
assert all('\\' not in n for n in names)
print('v' + ver, len(names), 'files,', os.path.getsize(OUT_ZIP) // 1024, 'KB ->', OUT_ZIP)
