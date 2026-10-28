/* GROKAZON site settings. Edit here, nowhere else. */
window.GZ_CONFIG = {
  VERSION: '0.8.2',
  API: '/api',               // the helper Worker (grokazon/api), reached through grokazon.app/api (Netlify _redirects), so its workers.dev address never shows
  CATALOGUE: 'https://dummyjson.com/products?limit=0',   // demo catalogue (real photos, prices, ratings, stock) until real merchants join
  ARTICLE: 'https://www.businessinsider.com/paul-graham-amazon-ai-agent-ban-rival-2026-10',  // Business Insider, Ben Shimkus, 2026-10-09 (link from the owner)
  X_PREMIUM: 'https://x.com/i/premium_sign_up',
  X_URL: 'https://x.com/grokazonapp',   // Grokazon's own X account (owner, 2026-10-16)
  /* Generated art in the Grok Bot agent style (ChatGPT from the owner's reference, 2026-10-15; prompts in art-src/PROMPTS.md, cut by art-src/cutout.py). Empty = plain wordmark + initials avatars. */
  ART: { glyph: 'assets/glyph.webp', faces: ['assets/face-6.webp', 'assets/face-1.webp', 'assets/face-3.webp', 'assets/face-4.webp', 'assets/face-2.webp', 'assets/face-5.webp'] },
  X_PRICES: null             // { basic: '$x', premium: '$y', plus: '$z' } only once verified on x.com/premium; null = "see x.com/premium"
};
// On this computer the site talks to the local helper (`wrangler dev --port 8806` in grokazon/api), never a live one.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.GZ_CONFIG.API = 'http://127.0.0.1:8806';
