// Jot push reminders: a Supabase Edge Function.
//
// pg_cron calls it every minute (see push-setup.sql). It reads each signed-up user's Jot backup, works out what is
// due in their time zone (scheduled items in the day's flow, the morning Daily 3 nudge and the evening check-in)
// and sends a Web Push to every device they turned notifications on for. Each reminder is recorded in
// jot_push_sent first, so it goes out once even if a run overlaps or repeats.
//
// The app also calls it with { "test": true } and the user's sign-in token to send a test notification.
//
// Deploy it as a function named jot-push with "Verify JWT" turned off: the scheduled call proves itself with the
// secret in jot_push_cron, and test calls are checked against Supabase Auth below.

const WINDOW = 20; // minutes after the due time that a missed reminder still goes out
const DEFAULTS = { items: true, lead: 10, amOn: true, am: '07:00', pmOn: true, pm: '19:30', tz: 'UTC' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-jot-cron',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/* ---------- base64url ---------- */
const enc = new TextEncoder();
export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Uint8Array {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, c => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

/* ---------- Web Push (RFC 8291 message encryption, RFC 8292 VAPID) ---------- */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
// encrypt a payload for one subscription (aes128gcm content coding)
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}
// the VAPID token that tells the push service the message is from the owner of these keys
export async function vapidToken(endpoint: string, privateJwk: JsonWebKey, subject: string) {
  const key = await crypto.subtle.importKey('jwk', { ...privateJwk, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };
type Keys = { user_id: string; vapid_public: string; vapid_private: JsonWebKey };
async function sendPush(sub: Sub, keys: Keys, message: object, subject: string) {
  const body = await encrypt(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST', body,
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high',
      Authorization: `vapid t=${await vapidToken(sub.endpoint, keys.vapid_private, subject)}, k=${keys.vapid_public}`
    }
  });
  await res.body?.cancel();
  return res.status;
}

/* ---------- what is due (mirrors the app's day logic in index.html) ---------- */
const WEEKDAY = [['am', 'Morning'], ['pmBig', 'Evening, big one'], ['pmSmall', 'Evening, small one']];
const WEEKEND = [['am', 'Morning'], ['wkBig', 'Daytime, big one'], ['pmBig', 'Evening, big two'], ['pmSmall', 'Evening, small one']];
const dayNum = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const diffDays = (a: string, b: string) => dayNum(b) - dayNum(a);
const mins = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const isWeekend = (k: string) => [0, 6].includes(new Date(dayNum(k) * 864e5).getUTCDay());
const shiftYears = (k: string, n: number) => `${+k.slice(0, 4) + n}${k.slice(4)}`;
// deno-lint-ignore no-explicit-any
type Jot = any;
function slotsFor(S: Jot, k: string) {
  const d = S.days?.[k] || {}, hide = d._hide || [];
  return (isWeekend(k) ? WEEKEND : WEEKDAY).filter(([key]) => !hide.includes(key)).map(([key]) => key).concat(d._extra || []);
}
function slotTask(S: Jot, k: string, key: string) {
  const e = S.days?.[k]?.[key];
  if (e) return { task: e.task || '', done: !!(e.task && e.done) };
  const r = (S.repeats || []).find((r: Jot) => r.slot === key && k >= r.start && (!r.end || k <= r.end) && diffDays(r.start, k) % r.every === 0);
  return { task: r ? r.task : '', done: false };
}
function onEvent(ev: Jot, k: string) {
  if (!ev.yearly) return ev.start <= k && k <= ev.end;
  const y = +k.slice(0, 4) - +ev.start.slice(0, 4);
  return [y, y - 1].some(n => n >= 0 && shiftYears(ev.start, n) <= k && k <= shiftYears(ev.end, n));
}
export function localNow(tz: string, now = new Date()) {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value]));
  } catch { return localNow('UTC', now); }
  return { k: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}
const fmtTime = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const list = (a: string[]) => a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;

export type Note = { key: string; title: string; body: string; tag: string; url: string };
export function dueNotes(S: Jot, at: { k: string; hm: string }): Note[] {
  const p = { ...DEFAULTS, ...(S.notify || {}) }, now = mins(at.hm), k = at.k, out: Note[] = [];
  const due = (hm: string) => now >= mins(hm) && now < mins(hm) + WINDOW;
  const url = './?today';
  // scheduled items in today's flow
  if (p.items) for (const it of S.days?.[k]?._items || []) {
    if (!it.time || it.done) continue;
    const at = Math.max(0, mins(it.time) - (+p.lead || 0));
    if (now >= at && now < at + WINDOW && now <= mins(it.time) + WINDOW)
      out.push({ key: `item:${k}:${it.id}:${it.time}`, tag: `item-${it.id}`, url, title: it.text,
        body: +p.lead && now < mins(it.time) ? `${fmtTime(it.time)}, in ${mins(it.time) - now} min` : `Now, ${fmtTime(it.time)}` });
  }
  // the Daily 3 nudges skip a paused event day with nothing planned, as the streak does
  const slots = slotsFor(S, k).map(key => slotTask(S, k, key));
  const off = (S.events || []).some((ev: Jot) => ev.pause && onEvent(ev, k)) && !slots.some(s => s.task);
  const goal = S.days?.[k]?._goal;
  if (!off && p.amOn && due(p.am)) {
    const picked = slots.filter(s => s.task);
    const body = picked.length === slots.length ? picked.map(s => s.task).join(' · ')
      : picked.length ? `${picked.length} of ${slots.length} picked. Tap to pick the rest.` : 'Tap to pick today’s tasks.';
    out.push({ key: `am:${k}`, tag: 'daily3', url, title: picked.length === slots.length ? 'Today’s Daily 3' : 'Plan your Daily 3',
      body: goal ? `Goal: ${goal}\n${body}` : body });
  }
  if (!off && p.pmOn && due(p.pm)) {
    const done = slots.filter(s => s.done).length, left = slots.filter(s => s.task && !s.done).map(s => s.task);
    if (done < slots.length) out.push({ key: `pm:${k}`, tag: 'daily3', url, title: `Daily 3: ${done} of ${slots.length} done`,
      body: left.length ? `Still to go: ${list(left)}` : 'Pick something small and finish the day strong.' });
  }
  return out;
}

/* ---------- Supabase ---------- */
function env() {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from the function environment');
  return { url, key };
}
async function db(path: string, { method = 'GET', body, prefer }: { method?: string; body?: unknown; prefer?: string } = {}) {
  const { url, key } = env();
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
async function deliver(subs: Sub[], keys: Keys, note: object) {
  const subject = env().url;
  let sent = 0;
  for (const sub of subs) {
    try {
      const status = await sendPush(sub, keys, note, subject);
      if (status === 404 || status === 410) await db(`jot_push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
      else if (status < 300) sent++;
      else console.error('push refused', status, new URL(sub.endpoint).host);
    } catch (e) { console.error('push failed', String(e)); }
  }
  return sent;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function runSchedule() {
  // remember the run, so the app's test button can tell whether the schedule is working
  await db('jot_push_cron?id=eq.1', { method: 'PATCH', body: { last_run: new Date().toISOString() } });
  const subs: Sub[] = await db('jot_push_subs?select=endpoint,user_id,p256dh,auth');
  const users = [...new Set(subs.map(s => s.user_id))];
  if (!users.length) return { users: 0, sent: 0 };
  const inList = `in.(${users.join(',')})`;
  const keys: Keys[] = await db(`jot_push_keys?select=user_id,vapid_public,vapid_private&user_id=${inList}`);
  const backups = await db(`jot_backups?select=user_id,data&user_id=${inList}`);
  let sent = 0;
  for (const { user_id, data } of backups) {
    const k = keys.find(x => x.user_id === user_id);
    if (!k || !data) continue;
    for (const note of dueNotes(data, localNow(data.notify?.tz || DEFAULTS.tz))) {
      // claim it first: a duplicate key means another run already sent it
      const claimed = await db('jot_push_sent', { method: 'POST', body: { user_id, key: note.key }, prefer: 'resolution=ignore-duplicates,return=representation' });
      if (!claimed?.length) continue;
      sent += await deliver(subs.filter(s => s.user_id === user_id), k, note);
    }
  }
  return { users: users.length, sent };
}
async function runTest(req: Request) {
  const { url, key } = env();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const who = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: 'Sign in again to send a test.' }, 401);
  const user_id = (await who.json()).id;
  const [k] = await db(`jot_push_keys?select=user_id,vapid_public,vapid_private&user_id=eq.${user_id}`);
  const subs: Sub[] = await db(`jot_push_subs?select=endpoint,user_id,p256dh,auth&user_id=eq.${user_id}`);
  const [cron] = await db('jot_push_cron?select=last_run&id=eq.1');
  const lastRun = cron?.last_run || null;
  if (!k || !subs.length) return json({ sent: 0, devices: 0, lastRun });
  const sent = await deliver(subs, k, { title: 'Jot notifications are on', body: 'Reminders will show up like this.', tag: 'test', url: './?today' });
  return json({ sent, devices: subs.length, lastRun });
}

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.test) return await runTest(req);
    const [row] = await db('jot_push_cron?select=secret&id=eq.1');
    if (!row || req.headers.get('x-jot-cron') !== row.secret) return json({ error: 'Not allowed' }, 401);
    return json(await runSchedule());
  } catch (e) {
    console.error(String(e));
    return json({ error: String(e) }, 500);
  }
}
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) D.serve(handler);
