// Sign in with a Solana wallet (Phantom, Solflare, Backpack: anything that signs messages). The wallet signs ONE
// plain-text message holding a one-time nonce; nothing is sent on-chain, no fee, no token approval. The signature is
// checked here (Ed25519, WebCrypto) and the browser gets the same kind of 30-day Grokshop session id as an X sign-in.
//   POST /auth/wallet/nonce  {address}                      -> {message}   (the exact text the wallet must sign)
//   POST /auth/wallet/verify {address, signature, message}  -> {sid, me}   (signature: base64 of the 64 raw bytes)
import { kv } from './missions.js';
import { bump } from './stats.js';

const SESSION_DAYS = 30, NONCE_MIN = 10;
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58decode(s) {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s || '')) return null;
  const bytes = [];   // little-endian while we multiply up, reversed at the end
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== '1') break; bytes.push(0); }   // each leading '1' is a leading zero byte
  return Uint8Array.from(bytes.reverse());
}
const b64decode = (s) => { try { return Uint8Array.from(atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); } catch (e) { return null; } };
export const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
const validAddress = (a) => { const b = b58decode(a); return !!b && b.length === 32; };

export async function nonce(env, body) {
  const address = String(body.address || '').trim();
  if (!validAddress(address)) return { status: 400, body: { error: 'That does not look like a Solana address.' } };
  const n = hex(16), issued = new Date().toISOString();
  await kv(env).put('wnonce:' + address, JSON.stringify({ n, issued }), { expirationTtl: NONCE_MIN * 60 });
  const message = 'Sign in to Grokshop\n\nThis signature only proves you hold this wallet. It is not a transaction and costs nothing.\n\nWallet: ' + address + '\nNonce: ' + n + '\nIssued: ' + issued;
  return { status: 200, body: { message } };
}
export async function verify(env, body) {
  const address = String(body.address || '').trim(), message = String(body.message || '');
  if (!validAddress(address)) return { status: 400, body: { error: 'That does not look like a Solana address.' } };
  const rec = JSON.parse((await kv(env).get('wnonce:' + address)) || 'null');
  if (!rec) return { status: 400, body: { error: 'That sign-in request expired. Try again.' } };
  const m = message.match(/\nNonce: ([a-f0-9]{32})\n/);
  if (!m || m[1] !== rec.n || message.indexOf('Wallet: ' + address + '\n') < 0 || !message.startsWith('Sign in to Grokshop')) return { status: 400, body: { error: 'The signed message does not match.' } };
  let sig = b64decode(body.signature);   // base64 of the 64 bytes; a base58 string (Solflare/Backpack style) also reads as base64 text, so check the length
  if (!sig || sig.length !== 64) sig = b58decode(String(body.signature || ''));
  if (!sig || sig.length !== 64) return { status: 400, body: { error: 'Bad signature.' } };
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('raw', b58decode(address), { name: 'Ed25519' }, false, ['verify']);
    ok = await crypto.subtle.verify('Ed25519', key, sig, new TextEncoder().encode(message));
  } catch (e) { return { status: 500, body: { error: 'Signature check is not available here.' } }; }
  if (!ok) return { status: 401, body: { error: 'The wallet signature did not verify.' } };
  if (kv(env).delete) await kv(env).delete('wnonce:' + address);
  const sid = hex(24);
  const me = { wallet: address, username: short(address), name: 'Wallet account', avatar: '', plan: 'None', planName: 'No X subscription', fast: false, at: Date.now() };
  await kv(env).put('sess:' + sid, JSON.stringify(me), { expirationTtl: SESSION_DAYS * 86400 });
  bump('signins');
  return { status: 200, body: { sid, me } };
}
