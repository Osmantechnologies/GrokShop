// node grokazon/api/test/wallet.test.mjs : wallet sign-in against a real Ed25519 key pair made here (no wallet, no
// network). Checks the nonce message, a good signature, a forged one, a replayed one, and base58 decoding.
import { nonce, verify, b58decode, short } from '../src/wallet.js';
import { kv } from '../src/missions.js';
import { webcrypto } from 'node:crypto';

const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '  ' + extra : '')); if (!cond) process.exitCode = 1; };
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b) break; s = '1' + s; } return s; }
const b64 = (u8) => Buffer.from(u8).toString('base64');
const env = {};

ok('base58: a known Solana address decodes to 32 bytes', (b58decode('11111111111111111111111111111111') || []).length === 32);
ok('base58: rejects 0, O, I, l', b58decode('0OIl') === null);
ok('short address for display', short('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU') === '7xKX…gAsU');

const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey)), address = b58encode(pub);
ok('a fresh key pair gives a 32-byte address', pub.length === 32 && b58decode(address).length === 32, address);

const n1 = await nonce(env, { address });
ok('nonce: returns the message to sign, with the wallet and a 32-hex nonce', n1.status === 200 && n1.body.message.startsWith('Sign in to Grokazon') && n1.body.message.includes('Wallet: ' + address) && /Nonce: [a-f0-9]{32}/.test(n1.body.message));
ok('nonce: says it is not a transaction', /not a transaction/.test(n1.body.message));
ok('nonce: refuses a bad address', (await nonce(env, { address: 'nope' })).status === 400);

const sign = async (msg, key) => new Uint8Array(await webcrypto.subtle.sign('Ed25519', key || kp.privateKey, new TextEncoder().encode(msg)));
const good = await verify(env, { address, signature: b64(await sign(n1.body.message)), message: n1.body.message });
ok('verify: a real signature signs in (session id + wallet profile)', good.status === 200 && /^[a-f0-9]{48}$/.test(good.body.sid) && good.body.me.wallet === address && good.body.me.username === short(address) && good.body.me.fast === false, JSON.stringify(good.body).slice(0, 120));
ok('session stored under sess:<sid>', JSON.parse(await kv(env).get('sess:' + good.body.sid)).wallet === address);
const replay = await verify(env, { address, signature: b64(await sign(n1.body.message)), message: n1.body.message });
ok('verify: the same message cannot be replayed (nonce used up)', replay.status === 400, replay.body.error);

const n2 = await nonce(env, { address });
const other = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const forged = await verify(env, { address, signature: b64(await sign(n2.body.message, other.privateKey)), message: n2.body.message });
ok('verify: a signature from another key is refused', forged.status === 401, forged.body.error);
const tampered = await verify(env, { address, signature: b64(await sign(n2.body.message)), message: n2.body.message.replace('Sign in to Grokazon', 'Send all my SOL') });
ok('verify: a changed message is refused', tampered.status === 400 || tampered.status === 401, tampered.body.error);
const n3 = await nonce(env, { address });
const sig58 = b58encode(await sign(n3.body.message));
ok('verify: base58 signatures accepted too', (await verify(env, { address, signature: sig58, message: n3.body.message })).status === 200);
