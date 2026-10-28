// node grokazon/api/test/cj.test.mjs : the CJ connector against responses shaped like CJ's documented API 2.0 examples
// (no key, no network). Checks sign-in, the US-only search, variant -> listing, pricing, sandbox orders, tracking.
import { cjMode, retail, refreshShelf, shelf, placeCjOrder, syncCjOrders } from '../src/cj.js';
import { kv } from '../src/missions.js';

const calls = [];
const ok200 = (data) => new Response(JSON.stringify({ code: 200, result: true, message: 'Success', data, success: true }), { status: 200 });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path: u.pathname.replace('/api2.0/v1', ''), q: u.searchParams, body, headers: init.headers || {} });
  const p = u.pathname;
  if (p.endsWith('/authentication/getAccessToken')) return ok200({ accessToken: 'TOK', accessTokenExpiryDate: new Date(Date.now() + 180 * 86400e3).toISOString() });
  if (p.endsWith('/product/listV2')) return ok200({ content: [{ productList: [
    { id: 'P-MAT', nameEn: 'Non-slip Yoga Mat', deliveryCycle: '2-5', threeCategoryName: 'Yoga Mats', description: '<p>TPE mat, 6mm</p>' },
    { id: 'P-NOUS', nameEn: 'China-only lamp', deliveryCycle: '7-12' }
  ] }] });
  if (p.endsWith('/product/query')) {
    if (u.searchParams.get('pid') === 'P-MAT') return ok200({ pid: 'P-MAT', productNameEn: 'Non-slip Yoga Mat', productImageSet: ['https://cf.cjdropshipping.com/a.jpg', 'https://cf.cjdropshipping.com/b.jpg'], description: 'TPE mat, 6mm thick',
      variants: [
        { vid: 'V-PUR', variantKey: 'Purple', variantSellPrice: 9.2, variantSku: 'CJ-MAT-PUR', inventories: [{ countryCode: 'US', totalInventory: 140 }, { countryCode: 'CN', totalInventory: 9000 }] },
        { vid: 'V-BLK', variantKey: 'Black', variantSellPrice: 8.4, variantImage: 'https://cf.cjdropshipping.com/blk.jpg', inventories: [{ countryCode: 'US', totalInventory: 60 }] },
        { vid: 'V-CN', variantKey: 'Pink', variantSellPrice: 8.4, inventories: [{ countryCode: 'CN', totalInventory: 500 }] }
      ] });
    return ok200({ pid: 'P-NOUS', productNameEn: 'China-only lamp', variants: [{ vid: 'V-X', variantSellPrice: 3, inventories: [{ countryCode: 'CN', totalInventory: 50 }] }] });
  }
  if (p.endsWith('/logistic/freightCalculate')) return ok200([{ logisticName: 'CJPacket Slow', logisticPrice: 2.1, logisticAging: '10-20' }, { logisticName: 'USPS+', logisticPrice: 4.71, logisticAging: '2-5' }, { logisticName: 'UPS Ground', logisticPrice: 7.9, logisticAging: '2-4' }]);
  if (p.endsWith('/shopping/order/createOrderV2')) return ok200({ orderId: 'CJ-777', orderStatus: 'CREATED', postageAmount: '4.71', orderAmount: '21.51' });
  if (p.endsWith('/shopping/order/getOrderDetail')) return ok200({ orderId: 'CJ-777', orderStatus: 'SHIPPED', trackNumber: '9400111899223', logisticName: 'USPS+' });
  return new Response(JSON.stringify({ code: 1600100, result: false, message: 'Param error' }), { status: 200 });
};
const env = { CJ_API_KEY: 'CJ123@api@abc', CJ_ON: '1' };
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '  ' + extra : '')); if (!cond) process.exitCode = 1; };

ok('mode: off without key, ready with key, on with CJ_ON=1', cjMode({}) === 'off' && cjMode({ CJ_API_KEY: 'k' }) === 'ready' && cjMode(env) === 'on');
ok('price: cost x 1.5 + $3, rounded up to .99', retail(env, 9.2) === 16.99 && retail(env, 8.4) === 15.99 && retail(env, 0) === null, retail(env, 9.2));
ok('price knobs: CJ_MARKUP / CJ_ADD', retail({ CJ_MARKUP: '2', CJ_ADD: '0' }, 10) === 19.99);

const t0 = Date.now();
const r = await refreshShelf({ ...env, CJ_SHELF: '[{"q":"yoga","dept":"sports"}]' }, 10);
const secs = (Date.now() - t0) / 1000;
ok('signs in once with the API key', calls.filter(c => c.path === '/authentication/getAccessToken').length === 1 && calls[0].body.apiKey === env.CJ_API_KEY);
const s = calls.find(c => c.path === '/product/listV2');
ok('search asks US stock only, verified inventory', s.q.get('countryCode') === 'US' && s.q.get('verifiedWarehouse') === '1' && s.q.get('keyWord') === 'yoga');
ok('every call carries the access token', calls.filter(c => c.path !== '/authentication/getAccessToken').every(c => c.headers['CJ-Access-Token'] === 'TOK'));
ok('details asked for US variants', calls.filter(c => c.path === '/product/query').every(c => c.q.get('countryCode') === 'US'));
ok('calls are spaced about a second apart (free CJ accounts: 1 a second)', secs >= 3, secs.toFixed(1) + 's for ' + calls.length + ' calls');
const items = await shelf(env);
ok('one listing per US-stock variant; China-only stock dropped', items.length === 2 && r.items === 2, items.map(i => i.title).join(' | '));
const blk = items[0], pur = items[1];
ok('cheapest variant first, its own photo first', blk.id === 'c-V-BLK' && blk.thumbnail === 'https://cf.cjdropshipping.com/blk.jpg' && blk.images.length === 3);
ok('title names the option', blk.title === 'Non-slip Yoga Mat - Black' && pur.title === 'Non-slip Yoga Mat - Purple');
ok('sold by Grokshop, from a US warehouse, with CJ\'s delivery estimate', blk.merchant === 'Grokshop' && blk.shippingInformation === 'Delivered in 2-5 days from a US warehouse', blk.shippingInformation);
ok('real US stock, no invented rating, CJ sub-category for the breadcrumb', blk.stock === 60 && blk.rating === null && blk.dept === 'sports' && blk.category === 'Yoga Mats');
ok('shelf hidden while CJ_ON is not 1', (await shelf({ CJ_API_KEY: 'k' })).length === 0);

// a test order (no Stripe): goes to CJ as a SANDBOX order
calls.length = 0;
const o = { id: 'GZ-TEST1', mode: 'test', status: 'placed', shipTo: { city: 'Austin', zip: '78701', cc: 'US' }, lines: [{ n: 0, id: 'c-V-BLK', qty: 2, status: 'ordered' }, { n: 1, id: 101, qty: 1, status: 'ordered' }] };
await placeCjOrder(env, o);
const fr = calls.find(c => c.path === '/logistic/freightCalculate'), cr = calls.find(c => c.path === '/shopping/order/createOrderV2');
ok('shipping quoted from the US warehouse', fr.body.startCountryCode === 'US' && fr.body.endCountryCode === 'US' && fr.body.products[0].vid === 'V-BLK' && fr.body.products[0].quantity === 2);
ok('cheapest method that arrives within a week (not the 10-20 day one)', cr.body.logisticName === 'USPS+', cr.body.logisticName);
ok('test order -> CJ sandbox, created unpaid', cr.body.isSandbox === 1 && cr.body.payType === 3 && cr.body.fromCountryCode === 'US');
ok('only CJ lines are sent, with the Grokshop order number', cr.body.products.length === 1 && cr.body.orderNumber === 'GZ-TEST1' && cr.body.products[0].storeLineItemId === 'GZ-TEST1-0');
ok('CJ order id + cost kept on the order', o.cj.orderId === 'CJ-777' && o.cj.postage === 4.71 && o.cj.cost === 21.51 && o.lines[0].fulfil === 'cj' && !o.lines[1].fulfil);
await placeCjOrder(env, o);
ok('placing twice does nothing', calls.filter(c => c.path === '/shopping/order/createOrderV2').length === 1);

// a live order without an address is refused before anything reaches CJ
calls.length = 0;
const live = { id: 'GZ-LIVE1', mode: 'live', shipTo: { cc: 'US', city: 'Austin' }, lines: [{ n: 0, id: 'c-V-PUR', qty: 1, status: 'ordered' }] };
await placeCjOrder(env, live);
ok('live order with no street address: nothing sent to CJ, error written on the order', !calls.some(c => c.path !== '/authentication/getAccessToken') && /address/.test(live.cj.error), live.cj.error);
const live2 = { id: 'GZ-LIVE2', mode: 'live', shipTo: { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', cc: 'US' }, lines: [{ n: 0, id: 'c-V-PUR', qty: 1, status: 'ordered' }] };
calls.length = 0; await placeCjOrder({ ...env, CJ_AUTOPAY: '1' }, live2);
const cr2 = calls.find(c => c.path === '/shopping/order/createOrderV2');
ok('live order with CJ_AUTOPAY=1 -> real order paid from the CJ balance', cr2.body.isSandbox === 0 && cr2.body.payType === 2 && live2.cj.paid === true);

// tracking: the cron copies CJ's tracking number onto the order
await kv(env).put('order:' + o.id, JSON.stringify(o));
const sy = await syncCjOrders(env);
const o2 = JSON.parse(await kv(env).get('order:' + o.id));
ok('tracking copied, line marked shipped, non-CJ line untouched', o2.lines[0].status === 'shipped' && o2.lines[0].tracking === '9400111899223' && o2.lines[1].status === 'ordered' && o2.cj.status === 'SHIPPED');
ok('order stays open until delivered', sy.open >= 1, JSON.stringify(sy));
