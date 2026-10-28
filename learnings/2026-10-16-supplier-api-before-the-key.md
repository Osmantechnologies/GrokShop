# Building a supplier API connector before the owner has a key (CJ Dropshipping, 2026-10-16)

## The problem
The owner wanted real products shipping "instantly" through CJ Dropshipping's US warehouses, but had not signed up yet,
so there was no API key to test against. The connector (`api/src/cj.js`) still had to be built and proven end to end.

## The approach
1. Read the vendor's own docs, not search snippets: `curl -sL https://developers.cjdropshipping.com/en/api/api2/api/<page>.html`
   for `auth`, `product`, `shopping`, `logistic`, plus `/en/api/start/sandbox.html` and `/en/api/start/limit.html`,
   then strip the HTML with a small Python regex script and `sed -n` the sections. That surfaced the facts that shaped
   the design: `listV2` takes `countryCode=US` (US stock only), product details take `countryCode=US` (US-stock
   variants), `createOrderV2` needs `logisticName` (so call `freightCalculate` first), `isSandbox=1` creates fake
   orders with no money, free accounts get **1 call a second**, and **one IP may serve at most 3 CJ accounts**.
2. Wrote the connector with every call going through one queue spaced 1.1 s apart, and the token cached in memory
   and in KV (`cj:token`), because CJ tokens last 180 days and sign-in is rate-limited too.
3. Unit test `api/test/cj.test.mjs`: replace `globalThis.fetch` with responses copied from the documented examples,
   then assert on what was SENT (US filters, sandbox flag, payType, shipping method choice), not only on parsing.
4. Added `CJ_API_BASE`, honoured only when it is an `http://127.0.0.1:` or `http://localhost:` address, so production
   can never be pointed elsewhere by a stray variable.
5. End to end without touching the normal dev data: a stand-in server (`node cj-mock.cjs` on :8899, same JSON shapes)
   plus a SECOND `npx wrangler dev --port 8807 --persist-to <scratch>/wr-e2e --var CJ_API_KEY:LOCALKEY --var CJ_ON:1
   --var CJ_API_BASE:http://127.0.0.1:8899/api2.0/v1`. API flow with curl first (refresh shelf -> /catalogue ->
   /orders/checkout -> /admin/queue -> /cj/sync -> /orders), then the real pages in Playwright with
   `ctx.route('http://127.0.0.1:8806/**', ...)` rewriting the site's helper calls to :8807.
6. Dead end: the visual check first "failed" because it looked for words the page does not render; the screenshot
   showed the page was right. Read the screenshot before changing code.
7. Dead end: cleaning up with "stop every node.exe whose command line matches 8807|cj-mock" also killed the main
   preview helper (:8806). It had to be restarted with preview_stop + preview_start.

## The judgment calls
- One catalogue listing per US-stock variant ("Yoga Mat - Purple"), not a size/colour picker: the cart is id-based and
  a picker would touch cart, quote, checkout and Grok's picks. Max 3 variants per product.
- Price ranges like "1.20-3.40" are read as the HIGHER number: never under-price a real order.
- Test orders become CJ sandbox orders; live orders are created UNPAID unless `CJ_AUTOPAY=1`. Spending the owner's
  CJ balance is opt-in.
- A live order without a full street address is refused before any CJ call, and the error is written on the order
  (admin "Warehouse orders"), never thrown at the buyer.
- Buyers never see CJ's name or cost (`forBuyer` strips `cj` and `fulfil`).
- Cron work is budgeted (25 shelf calls + 10 tracking calls a run) because a free Cloudflare Worker gets 50
  outgoing requests per invocation; the first shelf shows while it fills.
- Not deployed, no zip: the owner's rule for this project is "ship behind" until they say ship.

## The reusable rule
When an integration's key does not exist yet, build it against the vendor's documented response shapes, add a
localhost-only base-URL override, and prove the whole flow through a stand-in server on a separate dev instance;
stop test processes by the port they listen on, never by a command-line pattern.
