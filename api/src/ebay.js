// eBay Browse API connector (sandbox now; production after eBay Partner Network approval, docs/EBAY-APPLICATION.md).
// eBay's Buy API rules followed here: fixed-price (Buy It Now) items only, delivered within the US, eBay's own result order
// kept (never re-sorted), eBay-hosted images, the seller's eBay username + feedback shown, shipping shown separately.
// Grok may highlight eBay items only when EBAY_RANK=1 (set only if eBay confirms it is allowed).
// Env: EBAY_ENV = sandbox | production ; secrets EBAY_CLIENT_ID, EBAY_CLIENT_SECRET ; optional EBAY_CAMPAIGN_ID (EPN).
const HOST = { sandbox: 'https://api.sandbox.ebay.com', production: 'https://api.ebay.com' };
let TOKEN = null, TOKEN_EXP = 0;
const CACHE = new Map();   // query -> { at, items } (10 minutes, per isolate)

export function ebayMode(env) { return env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && HOST[env.EBAY_ENV] ? env.EBAY_ENV : 'off'; }

async function token(env) {
  if (TOKEN && Date.now() < TOKEN_EXP - 60e3) return TOKEN;
  const r = await fetch(HOST[env.EBAY_ENV] + '/identity/v1/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + btoa(env.EBAY_CLIENT_ID + ':' + env.EBAY_CLIENT_SECRET) },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope')
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('eBay sign-in failed: ' + (j.error_description || r.status));
  TOKEN = j.access_token; TOKEN_EXP = Date.now() + (j.expires_in || 7200) * 1000;
  return TOKEN;
}
async function call(env, path) {
  const h = { authorization: 'Bearer ' + await token(env), 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' };
  if (env.EBAY_CAMPAIGN_ID) h['X-EBAY-C-ENDUSERCTX'] = 'affiliateCampaignId=' + env.EBAY_CAMPAIGN_ID;
  const r = await fetch(HOST[env.EBAY_ENV] + path, { headers: h });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('eBay answered ' + r.status + (j.errors && j.errors[0] ? ': ' + j.errors[0].message : ''));
  return j;
}

const money = (m) => m && m.value != null ? +m.value : null;
const idOut = (itemId) => 'e-' + String(itemId).replace(/\|/g, '_');
export const idIn = (id) => String(id).replace(/^e-/, '').replace(/_/g, '|');
function shipLine(opts) {
  const o = (opts || [])[0]; if (!o) return { cost: null, text: 'Shipping shown at eBay checkout' };
  const cost = o.shippingCostType === 'CALCULATED' ? null : money(o.shippingCost);
  const by = o.maxEstimatedDeliveryDate ? ', delivered by ' + new Date(o.maxEstimatedDeliveryDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  return { cost, text: (cost === 0 ? 'Free shipping' : cost != null ? 'Shipping $' + cost.toFixed(2) : 'Shipping calculated at eBay checkout') + by, maxDate: o.maxEstimatedDeliveryDate || null };
}
// one eBay item -> the catalogue's shape (only what eBay published; nothing invented)
export function normalize(it) {
  const price = money(it.price); if (price == null || (it.price.currency && it.price.currency !== 'USD')) return null;
  const was = it.marketingPrice ? money(it.marketingPrice.originalPrice) : null;
  const s = shipLine(it.shippingOptions), seller = it.seller || {};
  const imgs = [it.image && it.image.imageUrl].concat((it.additionalImages || it.thumbnailImages || []).map(x => x.imageUrl)).filter(Boolean);
  const fastDays = s.maxDate ? (new Date(s.maxDate) - Date.now()) / 86400e3 : null;
  return {
    id: idOut(it.itemId), source: 'ebay', merchant: (seller.username || 'eBay seller') + ' on eBay', brand: it.brand || '', title: it.title,
    description: it.shortDescription || it.description && String(it.description).replace(/<[^>]+>/g, ' ').slice(0, 600) || '', category: ((it.categories || [])[0] || {}).categoryName || (it.categoryPath || '').split('|').pop() || 'ebay',
    tags: (it.categories || []).map(c => String(c.categoryName).toLowerCase()), price, currency: 'USD', discountPercentage: was && was > price ? +(((was - price) / was) * 100).toFixed(2) : 0,
    rating: null, reviews: [], stock: null, availabilityStatus: 'In Stock', condition: it.condition || '',
    shippingInformation: s.text, shippingCost: s.cost, returnPolicy: it.returnTerms ? (it.returnTerms.returnsAccepted ? (it.returnTerms.returnPeriod ? it.returnTerms.returnPeriod.value + ' ' + String(it.returnTerms.returnPeriod.unit).toLowerCase() + ' return policy' : 'Returns accepted') : 'No return policy') : null,
    warrantyInformation: null, images: imgs, thumbnail: imgs[0] || '', ebay: { seller: seller.username || '', feedbackPct: seller.feedbackPercentage || null, feedbackScore: seller.feedbackScore || null, url: it.itemAffiliateWebUrl || it.itemWebUrl || '', itemId: it.itemId }
  };
}
// live search, in eBay's order
export async function searchEbay(env, q, limit = 24) {
  const k = q.toLowerCase().trim(), hit = CACHE.get(k); if (hit && Date.now() - hit.at < 10 * 60e3) return hit.items;
  const j = await call(env, '/buy/browse/v1/item_summary/search?' + new URLSearchParams({ q: q.slice(0, 200), limit: String(limit), filter: 'buyingOptions:{FIXED_PRICE},deliveryCountry:US,itemLocationCountry:US' }).toString());
  const items = (j.itemSummaries || []).map(normalize).filter(Boolean);
  CACHE.set(k, { at: Date.now(), items }); if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
  return items;
}
export async function ebayItem(env, id) { return normalize(await call(env, '/buy/browse/v1/item/' + encodeURIComponent(idIn(id)))); }
