# Wallet sign-in, built and tested without a real wallet (2026-10-16)

## The problem
The owner wanted "an individual account with connect wallet" next to Sign in with X, on a static site + Cloudflare
Worker, with no wallet installed on the build machine and no chain involved.

## The approach
1. Sign-in = one signed message, not a transaction. `api/src/wallet.js`: `/auth/wallet/nonce` stores a 10-minute
   nonce in KV and returns the exact text to sign; `/auth/wallet/verify` checks the nonce is in the text, verifies the
   Ed25519 signature with WebCrypto (`importKey('raw', pubkey, {name:'Ed25519'})` + `subtle.verify`), deletes the
   nonce (no replay) and issues the same session record X sign-in uses, plus a `wallet` field.
2. Base58 decoded by hand (no library): multiply-up loop, start from an EMPTY byte array, then add one zero byte per
   leading `1`. Starting from `[0]` leaves a spare leading zero and a 32-byte address comes out as 33 (the all-`1`
   system address is the test that catches it).
3. A base58 signature is also valid base64 text, so decode base64 first and fall back to base58 only when the length
   is not 64.
4. Client discovery: dispatch `wallet-standard:app-ready` and listen for `wallet-standard:register-wallet`, keep
   wallets with `solana:*` chains + `standard:connect` + `solana:signMessage`; then legacy `window.phantom.solana`,
   `window.solflare`, `window.backpack`, `window.solana`. Phones with no extension get Phantom/Solflare "browse"
   deep links.
5. Unit test with a REAL key pair made in node (`webcrypto.subtle.generateKey({name:'Ed25519'})`): good signature,
   replay, other key, tampered text, base58 signature.
6. Browser test with a mock Phantom: `context.addInitScript` installs a Phantom-shaped `window.phantom.solana`
   whose `signMessage` calls `context.exposeFunction('qaSign', ...)`, which signs in node with the same key pair.
   The page code is exercised unchanged, and the Worker verifies a genuine signature.

## The judgment calls
- Did not add a wallet library (web3.js, wallet-adapter): the site is no-build vanilla JS and only needs connect +
  signMessage.
- Did not make the wallet a payment method. It is identity only; the sheet says "no transaction, no fee".
- Wallet accounts get no X fast delivery: the plan comes from X, and the two are not linked yet.
- The sign-in button now opens a chooser (X first) rather than going straight to X: one extra tap for X users, but
  the wallet option is visible instead of buried.

## The reusable rule
For "connect wallet" as a login on a static site, sign a nonce message and verify Ed25519 in the Worker; test it with
a node-made key pair, a mock injected provider via `addInitScript`, and `exposeFunction` for the signing, so no real
wallet or chain is ever needed.
