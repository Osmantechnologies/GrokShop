// Sign in with X (OAuth 2.0 Authorization Code + PKCE, confidential "Web App" client).
// Grokshop asks X for read-only scopes (users.read tweet.read), reads the profile ONCE (name, @handle, avatar and the
// X plan: subscription_type = Basic | Premium | PremiumPlus | None) and then forgets X's token. It never posts, never
// reads posts or DMs, never sees a password. The browser keeps a random Grokshop session id (30 days) and sends it as
// "Authorization: Bearer <id>"; nothing is a cross-site cookie, so Safari works.
// Needs: var X_CLIENT_ID, secret X_CLIENT_SECRET, and this callback registered in the X app:
//   https://grokshop-api.YOUR-ACCOUNT.workers.dev/auth/x/callback   (and http://127.0.0.1:8806/auth/x/callback locally)
import { kv, originOk } from './missions.js';
import { bump } from './stats.js';

const AUTHORIZE = 'https://x.com/i/oauth2/authorize', TOKEN = 'https://api.x.com/2/oauth2/token', ME = 'https://api.x.com/2/users/me';
const SESSION_DAYS = 30;
const PLANS = { Basic: 'X Basic', Premium: 'X Premium', PremiumPlus: 'X Premium+' };

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

export function xReady(env) { return !!(env.X_CLIENT_ID && env.X_CLIENT_SECRET); }
// the public address of this helper: https://grokazon.app/api (Netlify passes /api/* through), so visitors never see
// the workers.dev address; local dev leaves PUBLIC_API empty (.dev.vars) and uses its own origin
function callbackUrl(req, env) { return (env.PUBLIC_API || new URL(req.url).origin) + '/auth/x/callback'; }
function allowedReturn(env, ret) {
  try {
    const u = new URL(ret);
    return originOk(env, u.origin) ? u.origin + u.pathname + u.search : null;
  } catch (e) { return null; }
}
function back(ret, frag) { return Response.redirect(ret + '#' + frag, 302); }

// GET /auth/x/start?return=<page>  -> X's consent screen
export async function start(req, env, url) {
  const ret = allowedReturn(env, url.searchParams.get('return') || '');
  if (!ret) return new Response('Unknown return address.', { status: 400 });
  if (!xReady(env)) return back(ret, 'gzx=notready');
  const state = rand(24), verifier = rand(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  await kv(env).put('oauth:' + state, JSON.stringify({ verifier, ret }), { expirationTtl: 600 });
  const q = new URLSearchParams({ response_type: 'code', client_id: env.X_CLIENT_ID, redirect_uri: callbackUrl(req, env), scope: 'users.read tweet.read', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return Response.redirect(AUTHORIZE + '?' + q.toString(), 302);
}

// GET /auth/x/callback?code&state  -> profile once -> Grokshop session -> back to the page
export async function callback(req, env, url) {
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const saved = state && JSON.parse((await kv(env).get('oauth:' + state)) || 'null');
  if (!saved) return new Response('This sign-in link expired. Go back to Grokshop and try again.', { status: 400 });
  if (kv(env).delete) await kv(env).delete('oauth:' + state);
  if (url.searchParams.get('error') || !code) return back(saved.ret, 'gzx=cancelled');
  try {
    const t = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + btoa(env.X_CLIENT_ID + ':' + env.X_CLIENT_SECRET) },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(req, env), code_verifier: saved.verifier }).toString()
    });
    const tj = await t.json().catch(() => ({}));
    if (!t.ok || !tj.access_token) throw new Error('token ' + t.status + ' ' + JSON.stringify(tj).slice(0, 120));
    const m = await fetch(ME + '?user.fields=profile_image_url,subscription_type,verified_type', { headers: { authorization: 'Bearer ' + tj.access_token } });
    const mj = await m.json().catch(() => ({}));
    if (!m.ok || !mj.data) throw new Error('me ' + m.status + ' ' + JSON.stringify(mj).slice(0, 160));
    const sid = hex(24);
    await saveSession(env, sid, profile(mj.data)); bump('signins');
    return back(saved.ret, 'gzs=' + sid);
  } catch (e) {
    console.log('x sign-in failed', String(e.message || e).slice(0, 300));
    return back(saved.ret, 'gzx=failed');
  }
}

function profile(d) {
  const plan = PLANS[d.subscription_type] ? d.subscription_type : 'None';
  return { xId: String(d.id), username: d.username, name: d.name, avatar: (d.profile_image_url || '').replace('_normal.', '_bigger.'), plan, planName: PLANS[plan] || 'No X subscription', fast: plan !== 'None', at: Date.now() };
}
async function saveSession(env, sid, p) { await kv(env).put('sess:' + sid, JSON.stringify(p), { expirationTtl: SESSION_DAYS * 86400 }); }

export async function sessionOf(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{48})$/);
  if (!m) return null;
  const s = JSON.parse((await kv(env).get('sess:' + m[1])) || 'null');
  return s ? { ...s, sid: m[1] } : null;
}
export async function logout(req, env) {
  const s = await sessionOf(req, env);
  if (s && kv(env).delete) await kv(env).delete('sess:' + s.sid);
  return !!s;
}
// local dev only (the route refuses anything coming through Cloudflare): a signed-in session for QA, no X involved
export async function testSession(env, plan) {
  const sid = hex(24);
  await saveSession(env, sid, profile({ id: '1000000000000000001', username: 'grokazon_qa', name: 'QA Shopper', profile_image_url: '', subscription_type: plan || 'Premium' }));
  return sid;
}
