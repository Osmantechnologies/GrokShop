# Real products that can ship now (researched 2026-10-16)

Goal: real items, real photos, real prices, shipped to the buyer, with no marketplace approval
(eBay needs EPN approval, so it is parked). Owner picked **CJ Dropshipping, US warehouse** first.

## Status: built locally (v0.7.0), waiting for the CJ key
`api/src/cj.js`. Off until the key exists (`CJ_ON = "0"`). Tested against CJ's documented response shapes
(`api/test/cj.test.mjs`) and end to end against a local stand-in of CJ's API. Not yet run against real CJ.

## How it works
- **Shelf:** each hour the Worker searches CJ for the shelf lines (`CJ_SHELF`, default 8: earbuds, chargers,
  smart watches, kitchen gadgets, LED lights, skin care, yoga, pet toys), US stock only, verified inventory, then
  reads each product's US-stock variants. One Grokazon listing per variant (up to 3 per product).
  A full round is about 100 calls; CJ free accounts get one call a second, so the shelf fills over a few hours and
  then refreshes once a day.
- **Price:** CJ cost x 1.5 + $3, rounded up to .99 (`CJ_MARKUP`, `CJ_ADD`). Example: a $11.40 item sells at $20.99.
  Grokazon's own shipping rule applies on top ($4.99 per seller, free over $35 or with X fast).
  CJ's US postage (USPS-type, about $4-5) comes out of that margin, plus Stripe's fee.
- **Seller shown:** "Sold by Grokazon", tag "Ships from US", CJ's own delivery estimate. CJ's name and cost are
  never shown to buyers.
- **Orders:** when an order is placed, the CJ items go to CJ as one order, cheapest shipping that arrives within a week.
  - Test orders (no Stripe, or Stripe test keys) -> CJ **sandbox** order: no money, nothing ships.
  - Live orders -> real CJ order, created **unpaid** (you pay it in CJ) unless `CJ_AUTOPAY = "1"` (paid from your
    CJ balance automatically).
- **Tracking:** the hourly job copies CJ's tracking number onto the buyer's order ("shipped · USPS+ · 9400...").
- **Admin page:** "Warehouse orders" shows each CJ order, CJ's cost vs what the buyer paid, tracking, and problems.

## Owner steps
1. Sign up free at cjdropshipping.com.
2. Apps > Install App > Others > **API** (install), then My CJ > Authorization > API > **Add API**, type "API Key",
   copy the key.
3. Save it in `C:\Users\User\keys\grokazon\cj-api-key.txt` (one line). Then I load the real US shelf locally so
   you can see the actual products before anything goes live.
4. Going live later (needs your "ship"): key as a Worker secret, `CJ_ON = "1"`, deploy. Real money also needs the
   Stripe live key and a CJ balance (or paying each order in CJ).

## Decisions left to you (defaults in brackets)
- Return policy shown on these items [30 days]. You handle those returns; CJ only takes back defective items.
- Markup [x1.5 + $3]. Which shelf lines to stock [the 8 above].

## Risk to check on the first real run
CJ's docs say one IP address can serve at most 3 CJ accounts. Cloudflare Workers share outgoing addresses, so CJ
may refuse calls from the deployed Worker. If that happens, the fix is a small sync run from your PC that fills the
shelf, while orders go out from there too. We'll know on the first deployed call.

## 2. Printful (Grokazon's own merch), not built
- Free; "Manual order platform / API" store; private token at once (developers.printful.com).
- Tees, hoodies, mugs, caps printed per order and shipped from US facilities. Needs designs (generated art).

## Not instant
- eBay: Partner Network approval + eBay's own checkout.
- Amazon / Walmart: no open product + ordering API for a third-party store.
