// Shopify connector: reads a store's catalogue through Shopify's Storefront API (the read-only API a store opens on
// purpose for apps like this; never scraping) and hands the shopper to the store's own checkout with a real cart.
//
// A shop is { key, name?, endpoint, token?, test?, shipsIn?, returns? }
//   endpoint  https://<store>.myshopify.com/api/2025-01/graphql.json   (a real store)
//             https://<name>.mock.shop/api                             (Shopify's own test stores, no token)
//   token     the store's PUBLIC Storefront access token (made for browsers, not a secret, read-only)
//   shipsIn   the store's own delivery promise, e.g. "Ships in 1-2 business days" (Shopify does not publish one)
//   returns   the store's own return line, e.g. "30 days return policy"
// Shops come from env.SHOPS (JSON array, the test stores) plus KV keys `shop:<key>` (real stores, added by the owner).
import { kv } from './missions.js';

const QUERY = `query Catalogue($after: String) @inContext(country: US) {
  shop { name }
  products(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title description vendor productType tags availableForSale
      priceRange { minVariantPrice { amount currencyCode } }
      compareAtPriceRange { minVariantPrice { amount } }
      images(first: 4) { edges { node { url } } }
      variants(first: 10) { edges { node { id availableForSale quantityAvailable price { amount } } } }
    } }
  }
}`;

async function gql(shop, query, variables) {
  const headers = { 'content-type': 'application/json' };
  if (shop.token) headers['X-Shopify-Storefront-Access-Token'] = shop.token;
  const r = await fetch(shop.endpoint, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error(shop.key + ': ' + (j.errors ? JSON.stringify(j.errors).slice(0, 160) : 'HTTP ' + r.status));
  return j.data;
}

// the product type: these stores put the collection in productType and the real type in a tag ("over-ear headphones")
function categoryOf(n) {
  const pt = String(n.productType || '').toLowerCase(), tags = (n.tags || []).map(t => String(t).toLowerCase());
  return tags.find(t => t !== pt) || pt || 'shop';
}

export async function listShops(env) {
  let shops = [];
  try { shops = JSON.parse(env.SHOPS || '[]'); } catch (e) { shops = []; }
  const store = kv(env);
  if (store.list) {   // real stores the owner added (KV): shop:<key>
    const l = await store.list({ prefix: 'shop:' }).catch(() => ({ keys: [] }));
    for (const k of l.keys || []) { try { const s = JSON.parse(await store.get(k.name)); if (s && s.endpoint) shops.push(s); } catch (e) { } }
  }
  return shops.filter(s => /^https:\/\//.test(s.endpoint || '') && /^[a-z0-9-]{2,40}$/.test(s.key || ''));
}

// one shop -> products in the catalogue's own shape (real fields only; what Shopify does not publish stays empty)
export async function shopProducts(shop, max = 250) {
  const out = []; let after = null, name = shop.name || shop.key;
  do {
    const d = await gql(shop, QUERY, { after });
    name = shop.name || d.shop.name;
    for (const { node: n } of d.products.edges) {
      const vars = n.variants.edges.map(e => e.node), v = vars.find(x => x.availableForSale) || vars[0];
      if (!v) continue;
      const price = +n.priceRange.minVariantPrice.amount, was = +((n.compareAtPriceRange.minVariantPrice || {}).amount || 0);
      const qty = vars.reduce((s, x) => (x.quantityAvailable == null || s == null ? null : s + Math.max(0, x.quantityAvailable)), 0);
      const imgs = n.images.edges.map(e => e.node.url);
      out.push({
        id: 's-' + shop.key + '-' + n.id.split('/').pop(), source: 'shopify', test: !!shop.test, shop: shop.key, merchant: name,
        title: n.title, description: String(n.description || '').slice(0, 600), category: categoryOf(n),
        brand: n.vendor || name, tags: (n.tags || []).map(t => String(t).toLowerCase()).slice(0, 12),
        price, currency: n.priceRange.minVariantPrice.currencyCode, discountPercentage: was > price ? +(((was - price) / was) * 100).toFixed(2) : 0,
        rating: null, reviews: [], stock: qty, availabilityStatus: n.availableForSale ? 'In Stock' : 'Out of Stock',
        shippingInformation: shop.shipsIn || null, returnPolicy: shop.returns || null, warrantyInformation: null,
        images: imgs, thumbnail: imgs[0] || '', variantId: v.id
      });
    }
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after && out.length < max);
  return out.filter(p => p.thumbnail && p.price > 0 && p.currency === 'USD');
}

// a real cart at the store -> its own checkout URL (Grokazon never sees payment)
export async function createCheckout(shop, lines) {
  const d = await gql(shop, `mutation C($lines: [CartLineInput!]!) { cartCreate(input: { lines: $lines }) { cart { checkoutUrl } userErrors { message } } }`,
    { lines: lines.map(l => ({ merchandiseId: l.variantId, quantity: Math.max(1, Math.min(9, l.qty | 0)) })) });
  const c = d.cartCreate;
  if (!c || (c.userErrors || []).length || !c.cart) throw new Error((c && c.userErrors[0] && c.userErrors[0].message) || 'the store did not create a cart');
  return c.cart.checkoutUrl;
}
