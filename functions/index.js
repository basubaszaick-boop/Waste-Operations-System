// Cloud Functions for the Villanueva Waste Operations system.
//
// 1) sendAdvisory          - sends an SMS advisory when the admin creates one (Semaphore, outgoing).
// 2) smsInbound            - webhook that receives residents' texts from the Android SMS gateway and saves them
//                            as concerns, then sends an automatic confirmation SMS.
// 3) notifyConcernStatus   - texts the resident when the Barangay Head changes a concern's status
//                            (only residents who are registered AND gave consent).
//
// Secrets stay on the server (never in Angular code):
//   firebase functions:secrets:set SEMAPHORE_API_KEY
//   firebase functions:secrets:set SMSGATE_SIGNING_KEY
const { setGlobalOptions } = require('firebase-functions/v2');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { processIncoming, normalizePH, statusText } = require('./lib');

// IMPORTANT: Firestore triggers must run in the SAME region as your Firestore database
// (Firestore console shows it). Change this one line if your database is not in us-central1.
const REGION = 'us-central1';
setGlobalOptions({ region: REGION, maxInstances: 10 });

initializeApp();
const db = getFirestore();

const KEY = defineSecret('SEMAPHORE_API_KEY');
const SIGNING_KEY = defineSecret('SMSGATE_SIGNING_KEY');   // one key, or several separated by commas
const SENDER_NAME = defineString('SEMAPHORE_SENDER_NAME', { default: '' });   // optional approved sender name

// ---------------------------------------------------------------------------------------------
// 1) SMS advisories (unchanged behaviour)
// ---------------------------------------------------------------------------------------------
exports.sendAdvisory = onDocumentCreated({ document: 'advisories/{id}', secrets: [KEY] }, async (event) => {
  const a = event.data.data();
  let q = db.collection('residents').where('consent', '==', true);
  if (a.barangay !== 'ALL') q = q.where('barangay', '==', a.barangay);
  const numbers = (await q.get()).docs.map((d) => d.data().mobile);
  let status = 'no recipients';
  if (numbers.length) {
    try {
      const r = await fetch('https://api.semaphore.co/api/v4/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ apikey: KEY.value(), number: numbers.join(','), message: a.message }) });
      status = r.ok ? 'sent' : 'failed';
    } catch { status = 'failed'; }
  }
  await event.data.ref.update({ status, recipients: numbers.length });
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
/** Sends one SMS through Semaphore. Returns true when Semaphore accepted it. */
async function sendSemaphore(number, message) {
  const params = { apikey: KEY.value(), number, message };
  if (SENDER_NAME.value()) params.sendername = SENDER_NAME.value();
  const r = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  if (!r.ok) logger.error('Semaphore rejected the SMS', r.status);
  return r.ok;
}

/** Firestore access used by the webhook logic (kept thin so lib.js can be tested with a fake). */
const store = {
  async findHeadByDevice(deviceId) {
    const snap = await db.collection('users')
      .where('role', '==', 'barangay_head').where('smsDeviceId', '==', deviceId).get();
    const d = snap.docs.find((x) => x.data().active !== false && x.data().barangay);
    return d ? { uid: d.id, barangay: d.data().barangay, name: d.data().name || '' } : null;
  },
  async findHeadByNumber(number) {
    if (!number) return null;
    const snap = await db.collection('users')
      .where('role', '==', 'barangay_head').where('smsNumber', '==', number).get();
    const d = snap.docs.find((x) => x.data().active !== false && x.data().barangay);
    return d ? { uid: d.id, barangay: d.data().barangay, name: d.data().name || '' } : null;
  },
  async findResident(barangay, mobile) {
    const snap = await db.collection('residents')
      .where('mobile', '==', mobile).where('barangay', '==', barangay).limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, name: snap.docs[0].data().name, consent: snap.docs[0].data().consent === true };
  },
  async countRecentFromSender(phone, barangay, sinceMs) {
    const snap = await db.collection('concerns').where('senderPhone', '==', phone).limit(30).get();
    return snap.docs.filter((d) => d.data().area === barangay && Date.parse(d.data().createdAt) >= sinceMs).length;
  },
  async createConcernOnce(id, data) {
    try { await db.collection('concerns').doc(id).create(data); return true; }
    catch (e) { if (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message))) return false; throw e; }
  },
  /** Remembers a gateway phone that is not linked to any Barangay Head yet (device id only, no message content). */
  async recordUnrouted(deviceId) {
    const key = String(deviceId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
    await db.collection('smsUnrouted').doc(key).set(
      { deviceId, lastSeen: new Date().toISOString(), count: FieldValue.increment(1) }, { merge: true });
  },
  async setAckStatus(id, ackStatus) {
    await db.collection('concerns').doc(id).update({ ackStatus });
  }
};

// ---------------------------------------------------------------------------------------------
// 2) Incoming SMS webhook   ->   https://<region>-<project>.cloudfunctions.net/smsInbound
// ---------------------------------------------------------------------------------------------
exports.smsInbound = onRequest({ secrets: [SIGNING_KEY, KEY], invoker: 'public', cors: false }, async (req, res) => {
  try {
    const result = await processIncoming(
      {
        keys: SIGNING_KEY.value().split(',').map((k) => k.trim()).filter(Boolean),
        now: () => Date.now(),
        store,
        sendSms: sendSemaphore,
        log: logger
      },
      {
        method: req.method,
        rawBody: req.rawBody ? req.rawBody.toString('utf8') : '',
        headers: { 'x-signature': req.get('x-signature'), 'x-timestamp': req.get('x-timestamp') }
      }
    );
    res.status(result.status).json(result.body);
  } catch (e) {
    logger.error('smsInbound failed', e);
    res.status(500).json({ error: 'server error' });   // the gateway retries; duplicates are impossible (dedupe id)
  }
});

// ---------------------------------------------------------------------------------------------
// 3) Status updates to the resident (consent required)
// ---------------------------------------------------------------------------------------------
exports.notifyConcernStatus = onDocumentUpdated({ document: 'concerns/{id}', secrets: [KEY] }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after || before.status === after.status) return;

  const phone = normalizePH(after.senderPhone);
  if (!phone) return;                                    // manual concern without a phone number

  const resident = await store.findResident(after.area, phone);
  if (!resident || !resident.consent) {                  // no consent -> no status SMS
    logger.info('Status SMS skipped: sender is not a registered, consenting resident');
    return;
  }
  try {
    await sendSemaphore(phone, statusText(after.status, event.params.id));
  } catch (e) {
    logger.error('Status SMS failed', e);
  }
});
