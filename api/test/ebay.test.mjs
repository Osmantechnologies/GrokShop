// node grokazon/api/test/ebay.test.mjs : the eBay connector against a response shaped like eBay's documented
// item_summary/search output (no keys, no network). Checks sign-in call, the required search filters, and normalisation.
import { searchEbay, normalize, idIn, ebayMode } from '../src/ebay.js';

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).includes('/identity/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 7200 }), { status: 200 });
  return new Response(JSON.stringify({ total: 2, itemSummaries: [
    { itemId: 'v1|110551991234|0', title: 'Sony WH-CH720N Wireless Noise Cancelling Headphones, Black', price: { value: '98.00', currency: 'USD' },
      marketingPrice: { originalPrice: { value: '149.99', currency: 'USD' }, discountPercentage: '35' }, image: { imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l500.jpg' },
      thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l225.jpg' }], seller: { username: 'audio_outlet', feedbackPercentage: '99.4', feedbackScore: 15230 },
      condition: 'New', shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '0.00', currency: 'USD' }, maxEstimatedDeliveryDate: new Date(Date.now() + 4 * 86400e3).toISOString() }],
      buyingOptions: ['FIXED_PRICE'], itemWebUrl: 'https://www.ebay.com/itm/110551991234', categories: [{ categoryName: 'Headphones' }] },
    { itemId: 'v1|2|0', title: 'Priced in GBP', price: { value: '10', currency: 'GBP' } }
  ] }), { status: 200 });
};
const env = { EBAY_ENV: 'sandbox', EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'secret' };
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) process.exitCode = 1; };

ok('mode is sandbox with keys', ebayMode(env) === 'sandbox');
ok('mode is off without keys', ebayMode({ EBAY_ENV: 'sandbox' }) === 'off');
const items = await searchEbay(env, 'wireless headphones');
const tok = calls[0], srch = calls[1], u = new URL(srch.url);
ok('signs in with client credentials (Basic auth, api_scope)', tok.url === 'https://api.sandbox.ebay.com/identity/v1/oauth2/token' && /^Basic /.test(tok.init.headers.authorization) && /grant_type=client_credentials/.test(tok.init.body));
ok('search asks only fixed-price, US-delivered, US-located items', /buyingOptions:\{FIXED_PRICE\}/.test(u.searchParams.get('filter')) && /deliveryCountry:US/.test(u.searchParams.get('filter')));
ok('search keeps eBay order (no sort parameter sent)', !u.searchParams.has('sort'));
ok('marketplace header EBAY_US', srch.init.headers['X-EBAY-C-MARKETPLACE-ID'] === 'EBAY_US');
ok('non-USD items are dropped', items.length === 1);
const p = items[0];
ok('id round-trips (e-… <-> eBay itemId)', p.id === 'e-v1_110551991234_0' && idIn(p.id) === 'v1|110551991234|0');
ok('price, real discount from eBay\'s own original price', p.price === 98 && p.discountPercentage === 34.66, p.discountPercentage);
ok('seller username + feedback kept for display', p.ebay.seller === 'audio_outlet' && p.ebay.feedbackPct === '99.4' && p.ebay.feedbackScore === 15230);
ok('shipping shown separately (Free shipping + delivery date)', /^Free shipping, delivered by /.test(p.shippingInformation) && p.shippingCost === 0, p.shippingInformation);
ok('eBay-hosted image used', /i\.ebayimg\.com/.test(p.thumbnail));
ok('no invented rating or stock', p.rating === null && p.stock === null);
const again = await searchEbay(env, 'Wireless Headphones');
ok('same search within 10 min is served from cache', calls.length === 2 && again.length === 1);
