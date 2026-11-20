'use strict';
// Pure logic for the incoming-SMS feature. No Firebase imports here, so it can be unit-tested.
// Gateway: "SMS Gateway for Android" (sms-gate.app). Webhook format and signing are described at
// https://docs.sms-gate.app/features/webhooks/  (event "sms:received", headers X-Signature / X-Timestamp,
// signature = HMAC-SHA256(key, rawBody + timestamp), hex encoded).
const crypto = require('node:crypto');

const MAX_BODY_BYTES = 20000;
const MAX_CLOCK_SKEW_SECONDS = 300;      // reject requests older / newer than 5 minutes
const RATE_LIMIT_PER_HOUR = 5;           // concerns per sender per hour that still get an automatic reply

const ACK_TEXT =
  'Thank you for contacting the Villanueva Municipal Waste Operations System. ' +
  'Your waste-related concern has been successfully received and forwarded to your Barangay Head.';

/** Any Philippine mobile number format -> 09XXXXXXXXX. Returns '' when it is not a mobile number. */
function normalizePH(input) {
  const d = String(input == null ? '' : input).replace(/\D/g, '');
  if (/^639\d{9}$/.test(d)) return '0' + d.slice(2);
  if (/^09\d{9}$/.test(d)) return d;
  if (/^9\d{9}$/.test(d)) return '0' + d;
  return '';
}

/** Checks X-Signature against every configured signing key (comma separated). Constant-time compare. */
function verifySignature(keys, rawBody, timestamp, signature) {
  const sig = String(signature || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const given = Buffer.from(sig, 'hex');
  let ok = false;
  for (const key of keys) {
    if (!key) continue;
    const expected = crypto.createHmac('sha256', key).update(String(rawBody) + String(timestamp)).digest();
    if (crypto.timingSafeEqual(expected, given)) ok = true;   // no early exit: keeps timing uniform
  }
  return ok;
}

function timestampFresh(timestamp, nowMs) {
  const t = Number(timestamp);
  if (!Number.isFinite(t) || t <= 0) return false;
  return Math.abs(nowMs / 1000 - t) <= MAX_CLOCK_SKEW_SECONDS;
}

/** Same document id for the same webhook delivery, so a retried delivery can never create a second concern. */
function dedupeId(deviceId, envelopeId, payload) {
  const base = envelopeId
    ? `${deviceId}|${envelopeId}`
    : `${deviceId}|${payload.sender}|${payload.message}|${payload.receivedAt}`;
  return 'sms_' + crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
}

function makeSubject(message) {
  const one = String(message).replace(/\s+/g, ' ').trim();
  return one.length <= 80 ? one : one.slice(0, 77) + '...';
}

function validIso(v, fallback) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

function refOf(id) {
  return String(id).slice(-5).toUpperCase();
}

function statusText(status, id) {
  const ref = `Ref #${refOf(id)}`;
  if (status === 'In Review') return `Villanueva Waste Operations: Your concern (${ref}) is now being reviewed by your Barangay Head.`;
  if (status === 'Resolved') return `Villanueva Waste Operations: Your concern (${ref}) has been marked resolved. Thank you for helping keep Villanueva clean.`;
  return `Villanueva Waste Operations: Your concern (${ref}) is pending. We will update you on any progress.`;
}

/**
 * Handles one webhook delivery.
 * deps = { keys: string[], now(): ms, store: {...}, sendSms(number, text): Promise<boolean>, log }
 * req  = { method, rawBody: string, headers: {lowercase names} }
 * Returns { status, body }. Throws on database errors (the gateway then retries; dedupe makes that safe).
 */
async function processIncoming(deps, req) {
  const { keys, store, sendSms, log } = deps;
  const nowMs = deps.now();

  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } };
  const raw = typeof req.rawBody === 'string' ? req.rawBody : String(req.rawBody || '');
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { status: 413, body: { error: 'too large' } };

  // 1. Authenticate: fresh timestamp + valid HMAC. Same answer for every failure.
  const ts = req.headers['x-timestamp'];
  const sig = req.headers['x-signature'];
  if (!timestampFresh(ts, nowMs) || !verifySignature(keys, raw, ts, sig)) {
    log.warn('SMS webhook rejected: bad signature or timestamp');
    return { status: 401, body: { error: 'unauthorized' } };
  }

  // 2. Parse
  let env;
  try { env = JSON.parse(raw); } catch { return { status: 400, body: { error: 'invalid json' } }; }
  if (!env || env.event !== 'sms:received') return { status: 200, body: { ignored: 'event' } };
  const p = env.payload || {};
  const message = typeof p.message === 'string' ? p.message.trim() : '';
  const deviceId = typeof env.deviceId === 'string' ? env.deviceId : '';
  if (!message || !deviceId) return { status: 200, body: { ignored: 'empty' } };

  // 3. Only real mobile numbers become concerns (ignores network promos from names such as "GLOBE").
  const senderPhone = normalizePH(p.sender);
  if (!senderPhone) { log.info('SMS ignored: sender is not a mobile number'); return { status: 200, body: { ignored: 'sender' } }; }

  // 4. Which Barangay Head owns this phone?
  let head = await store.findHeadByDevice(deviceId);
  if (!head && p.recipient) head = await store.findHeadByNumber(normalizePH(p.recipient));
  if (!head) {
    log.warn(`SMS not routed: no Barangay Head is linked to device ${deviceId}`);
    if (store.recordUnrouted) await store.recordUnrouted(deviceId);   // lets the admin link it from the Personnel page (stores the device id only)
    return { status: 200, body: { ignored: 'unrouted' } }; }

  // 5. Registered resident? (only for that barangay; never invented)
  const resident = await store.findResident(head.barangay, senderPhone);

  // 6. Flood control: too many texts from one number in an hour are still saved, but not answered.
  const recent = await store.countRecentFromSender(senderPhone, head.barangay, nowMs - 3600 * 1000);

  // 7. Save once
  const id = dedupeId(deviceId, env.id, p);
  const nowIso = new Date(nowMs).toISOString();
  const concern = {
    resident: resident ? resident.name : 'Unverified sender',
    area: head.barangay,
    subject: makeSubject(message),
    details: message.slice(0, 500),
    status: 'Pending',
    createdBy: 'sms-gateway',
    createdAt: nowIso,
    source: 'sms',
    senderPhone,
    verified: !!resident,
    receivedAt: validIso(p.receivedAt, nowIso),
    gatewayDeviceId: deviceId,
    ackStatus: 'pending'
  };
  const created = await store.createConcernOnce(id, concern);
  if (!created) return { status: 200, body: { duplicate: true } };

  // 8. Automatic confirmation SMS (the resident started the conversation, so this is a direct reply)
  let ack = 'skipped';
  if (recent >= RATE_LIMIT_PER_HOUR) {
    ack = 'skipped-rate-limit';
  } else {
    try { ack = (await sendSms(senderPhone, `${ACK_TEXT} Ref #${refOf(id)}.`)) ? 'sent' : 'failed'; }
    catch (e) { log.error('Confirmation SMS error', e); ack = 'failed'; }
  }
  await store.setAckStatus(id, ack);
  return { status: 200, body: { ok: true, id, ack } };
}

module.exports = {
  ACK_TEXT, RATE_LIMIT_PER_HOUR, MAX_CLOCK_SKEW_SECONDS,
  normalizePH, verifySignature, timestampFresh, dedupeId, makeSubject, statusText, refOf, processIncoming
};
