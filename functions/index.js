// Sends the SMS when the admin creates an advisory. The SMS key stays secret on the server.
// Setup: firebase functions:secrets:set SEMAPHORE_API_KEY   then   firebase deploy --only functions
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp();
const KEY = defineSecret('SEMAPHORE_API_KEY');

exports.sendAdvisory = onDocumentCreated({ document: 'advisories/{id}', secrets: [KEY] }, async (event) => {
  const a = event.data.data();
  let q = getFirestore().collection('residents').where('consent', '==', true);
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
