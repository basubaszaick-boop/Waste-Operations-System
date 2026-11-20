'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const lib = require('../lib');

const KEY = 'test-signing-key';
const NOW = Date.UTC(2026, 10, 18, 2, 0, 0);
const log = { warn() {}, info() {}, error() {} };

function sign(body, ts, key = KEY) {
  return crypto.createHmac('sha256', key).update(body + ts).digest('hex');
}
function envelope(over = {}, payloadOver = {}) {
  return JSON.stringify({
    deviceId: 'dev-poblacion', event: 'sms:received', id: 'evt-1', webhookId: 'w1',
    payload: { messageId: 'm1', message: 'Hindi po nakolekta ang basura sa Purok 3', sender: '+639171234567',
      recipient: '+639180000000', simNumber: 1, receivedAt: '2026-11-18T10:00:00.000+08:00', ...payloadOver },
    ...over
  });
}

/** In-memory stand-in for Firestore. */
function fakeStore({ heads = [{ deviceId: 'dev-poblacion', barangay: 'Poblacion' }], residents = [], existing = [] } = {}) {
  const concerns = new Map(); existing.forEach((c, i) => concerns.set('old' + i, c));
  return {
    concerns,
    async findHeadByDevice(id) { const h = heads.find((x) => x.deviceId === id); return h ? { uid: 'u1', barangay: h.barangay } : null; },
    async findHeadByNumber(n) { const h = heads.find((x) => x.smsNumber && x.smsNumber === n); return h ? { uid: 'u1', barangay: h.barangay } : null; },
    async findResident(b, m) { const r = residents.find((x) => x.barangay === b && x.mobile === m); return r ? { id: 'r1', name: r.name, consent: !!r.consent } : null; },
    async countRecentFromSender(phone, b, since) { return [...concerns.values()].filter((c) => c.senderPhone === phone && c.area === b && Date.parse(c.createdAt) >= since).length; },
    async createConcernOnce(id, data) { if (concerns.has(id)) return false; concerns.set(id, data); return true; },
    unrouted: [],
    async recordUnrouted(id) { this.unrouted.push(id); },
    async setAckStatus(id, s) { concerns.get(id).ackStatus = s; }
  };
}
function run(body, { store = fakeStore(), headers, method = 'POST', now = NOW, sent = [] , sendOk = true } = {}) {
  const ts = String(Math.floor(now / 1000));
  const deps = { keys: [KEY], now: () => now, store, log, sendSms: async (n, t) => { sent.push({ n, t }); return sendOk; } };
  const req = { method, rawBody: body, headers: headers || { 'x-timestamp': ts, 'x-signature': sign(body, ts) } };
  return lib.processIncoming(deps, req).then((r) => ({ ...r, sent, store }));
}

test('normalizePH handles every common format', () => {
  assert.equal(lib.normalizePH('+63 917 123 4567'), '09171234567');
  assert.equal(lib.normalizePH('639171234567'), '09171234567');
  assert.equal(lib.normalizePH('09171234567'), '09171234567');
  assert.equal(lib.normalizePH('9171234567'), '09171234567');
  assert.equal(lib.normalizePH('GLOBE'), '');
  assert.equal(lib.normalizePH('2929'), '');
  assert.equal(lib.normalizePH(undefined), '');
});

test('verifySignature: accepts correct, rejects wrong key / tampered body / garbage', () => {
  const body = '{"a":1}', ts = '1700000000';
  assert.equal(lib.verifySignature([KEY], body, ts, sign(body, ts)), true);
  assert.equal(lib.verifySignature([KEY], body, ts, sign(body, ts, 'other')), false);
  assert.equal(lib.verifySignature([KEY], body + ' ', ts, sign(body, ts)), false);
  assert.equal(lib.verifySignature([KEY], body, ts, 'nothex'), false);
  assert.equal(lib.verifySignature([KEY], body, ts, ''), false);
  assert.equal(lib.verifySignature(['a', KEY], body, ts, sign(body, ts)), true);   // several keys allowed
  assert.equal(lib.verifySignature([''], body, ts, sign(body, ts, '')), false);   // empty key never valid
});

test('happy path: saves a Pending SMS concern for the right barangay and sends the confirmation', async () => {
  const r = await run(envelope());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.store.concerns.size, 1);
  const c = [...r.store.concerns.values()][0];
  assert.equal(c.status, 'Pending');
  assert.equal(c.area, 'Poblacion');
  assert.equal(c.source, 'sms');
  assert.equal(c.senderPhone, '09171234567');
  assert.equal(c.verified, false);
  assert.equal(c.resident, 'Unverified sender');
  assert.equal(c.details, 'Hindi po nakolekta ang basura sa Purok 3');
  assert.equal(c.receivedAt, '2026-11-18T02:00:00.000Z');
  assert.equal(c.ackStatus, 'sent');
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].n, '09171234567');
  assert.match(r.sent[0].t, /successfully received and forwarded to your Barangay Head/);
});

test('registered resident is identified by phone number, in that barangay only', async () => {
  const residents = [{ barangay: 'Poblacion', mobile: '09171234567', name: 'Juan Dela Cruz', consent: true },
                     { barangay: 'Looc', mobile: '09171234567', name: 'Wrong Barangay', consent: true }];
  const r = await run(envelope(), { store: fakeStore({ residents }) });
  const c = [...r.store.concerns.values()][0];
  assert.equal(c.resident, 'Juan Dela Cruz');
  assert.equal(c.verified, true);
});

test('duplicate delivery (gateway retry) creates ONE concern and ONE confirmation SMS', async () => {
  const store = fakeStore(); const sent = [];
  const a = await run(envelope(), { store, sent });
  const b = await run(envelope(), { store, sent });
  assert.equal(a.body.ok, true);
  assert.equal(b.body.duplicate, true);
  assert.equal(store.concerns.size, 1);
  assert.equal(sent.length, 1);
});

test('same text sent twice as two separate messages makes two concerns', async () => {
  const store = fakeStore();
  await run(envelope({ id: 'evt-1' }), { store });
  await run(envelope({ id: 'evt-2' }), { store });
  assert.equal(store.concerns.size, 2);
});

test('security: bad signature, wrong key, stale or missing timestamp are rejected and save nothing', async () => {
  const body = envelope(); const ts = String(Math.floor(NOW / 1000));
  const cases = [
    { 'x-timestamp': ts, 'x-signature': 'f'.repeat(64) },
    { 'x-timestamp': ts, 'x-signature': sign(body, ts, 'attacker-key') },
    { 'x-timestamp': String(Math.floor(NOW / 1000) - 3600), 'x-signature': sign(body, String(Math.floor(NOW / 1000) - 3600)) },
    { 'x-signature': sign(body, ts) },
    {}
  ];
  for (const headers of cases) {
    const store = fakeStore(); const sent = [];
    const r = await run(body, { headers, store, sent });
    assert.equal(r.status, 401);
    assert.equal(store.concerns.size, 0);
    assert.equal(sent.length, 0);
  }
});

test('only POST is accepted', async () => {
  const r = await run(envelope(), { method: 'GET' });
  assert.equal(r.status, 405);
});

test('non-SMS events (ping, delivered...) are acknowledged and ignored', async () => {
  const r = await run(envelope({ event: 'system:ping' }));
  assert.equal(r.status, 200);
  assert.equal(r.store.concerns.size, 0);
});

test('network promos from alphanumeric / short-code senders are ignored', async () => {
  for (const sender of ['GLOBE', '2929', 'SMART']) {
    const r = await run(envelope({}, { sender }));
    assert.equal(r.body.ignored, 'sender');
    assert.equal(r.store.concerns.size, 0);
  }
});

test('unknown gateway device is not routed and nothing is saved', async () => {
  const r = await run(envelope({ deviceId: 'stranger' }, { recipient: null }));
  assert.equal(r.body.ignored, 'unrouted');
  assert.equal(r.store.concerns.size, 0);
  assert.deepEqual(r.store.unrouted, ['stranger']);   // remembered so the admin can link it
});

test('falls back to the receiving number when the device id is not linked', async () => {
  const store = fakeStore({ heads: [{ deviceId: 'other', smsNumber: '09180000000', barangay: 'Looc' }] });
  const r = await run(envelope({ deviceId: 'unlinked' }), { store });
  assert.equal([...store.concerns.values()][0].area, 'Looc');
  assert.equal(r.body.ok, true);
});

test('empty message is ignored', async () => {
  const r = await run(envelope({}, { message: '   ' }));
  assert.equal(r.body.ignored, 'empty');
});

test('flood control: after 5 texts in an hour the concern is saved but no more replies are sent', async () => {
  const recent = Array.from({ length: 5 }, () => ({ senderPhone: '09171234567', area: 'Poblacion', createdAt: new Date(NOW - 600000).toISOString() }));
  const store = fakeStore({ existing: recent }); const sent = [];
  const r = await run(envelope({ id: 'evt-flood' }), { store, sent });
  assert.equal(r.body.ack, 'skipped-rate-limit');
  assert.equal(sent.length, 0);
  assert.equal(store.concerns.size, 6);
});

test('confirmation SMS failure is recorded but the concern is still saved', async () => {
  const r = await run(envelope(), { sendOk: false });
  assert.equal([...r.store.concerns.values()][0].ackStatus, 'failed');
  assert.equal(r.status, 200);
});

test('very long messages are trimmed; subject is a short one-liner', async () => {
  const long = 'basura '.repeat(200);
  const r = await run(envelope({}, { message: long }));
  const c = [...r.store.concerns.values()][0];
  assert.equal(c.details.length, 500);
  assert.ok(c.subject.length <= 80);
});

test('oversized body is rejected', async () => {
  const r = await run('x'.repeat(30000));
  assert.equal(r.status, 413);
});

test('status texts include the reference number', () => {
  assert.match(lib.statusText('In Review', 'sms_abcdef12345'), /Ref #12345/);
  assert.match(lib.statusText('Resolved', 'sms_abcdef12345'), /resolved/);
});
