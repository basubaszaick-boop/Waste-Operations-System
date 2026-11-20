# SMS Concern Reporting - Setup Guide

Residents report a concern by sending a normal text message. No login, no app, no website.

```
Resident's phone
   | SMS
   v
Barangay Head's registered number  = an Android phone (with that SIM) running the free "SMS Gateway for Android" app
   | HTTPS webhook (signed)
   v
Cloud Function  smsInbound   -> checks the signature, finds the barangay, saves the concern in Firestore
   |                                   |
   |                                   +--> Resident Concerns page updates LIVE (no refresh)
   v
Semaphore (your existing account) -> automatic confirmation SMS to the resident
```

## 1. What was verified (and what that means)

| Question | Finding |
|---|---|
| Does **Semaphore** receive SMS? | **No.** Semaphore's API documentation (api.semaphore.co/docs) lists only sending (`/messages`, `/priority`, `/otp`), reading *outgoing* messages, and account endpoints. It documents **no** inbound SMS, webhook, callback, keyword or two-way feature. So Semaphore is still used for **outgoing** texts only (confirmations, status updates, advisories). If you want to double-check, ask Semaphore support whether they offer an inbound number. |
| How can a text sent to a person's own number reach the system? | Only by letting that phone forward it. The open-source **SMS Gateway for Android** (sms-gate.app, Apache-2.0) runs on the phone, and its documentation describes a `sms:received` **webhook** that is signed with HMAC-SHA256 (headers `X-Signature`, `X-Timestamp`). This is what the code uses. |
| Other option | Twilio lists *two-way SMS* and *domestic long codes* as supported for the Philippines, which would be a separate Twilio number instead of a personal SIM. Not implemented here. |

**Honest limits of this design**
- It needs an **Android** phone (Android 5.0+ per the app's documentation) for each barangay's SMS number. iPhones cannot run the gateway app.
- The phone must be **switched on, have signal, and have internet** (mobile data or Wi-Fi), with battery optimisation turned off for the app. If the phone is off, texts are received later or not forwarded.
- **Use a dedicated SIM/phone per barangay if you can.** Every text from a real mobile number sent to that phone becomes a concern (texts from names like "GLOBE" or short codes are ignored automatically). A head's personal chats would be mixed in.
- I could not run a live end-to-end test from here (no phone, no Firebase login). The webhook logic is covered by 18 automated tests (`cd functions && npm test`) and the screens were click-tested with sample data, but **please do the real-phone test in section 6** before announcing the number to residents.

## 2. What you need (accounts, hardware, cost)

1. **Firebase Blaze plan** (pay-as-you-go; needed for Cloud Functions - you probably already have it for advisories).
2. **Semaphore account with credits** (already used for advisories). The automatic confirmation is 181 characters, i.e. **2 SMS segments**. Please check Semaphore's current price per segment.
3. **One Android phone + SIM per barangay** that residents will text, and the free **SMS Gateway for Android** app (https://sms-gate.app).
4. Receiving an SMS on the SIM is normally free; check your prepaid plan for the phone's mobile data use (small).

## 3. Deploy the backend

In the project folder:

```
cd functions
npm install
cd ..
firebase login
firebase use villanueva-waste-operations

firebase functions:secrets:set SEMAPHORE_API_KEY
firebase functions:secrets:set SMSGATE_SIGNING_KEY

firebase deploy --only functions,firestore:rules
```

- `SEMAPHORE_API_KEY`: your Semaphore key (already set if advisories work; skip if so).
- `SMSGATE_SIGNING_KEY`: the webhook signing key from the gateway app (section 4, step 4). If you don't have it yet, set any temporary value now and set it again later, then run the deploy again. **If different phones have different keys, put them all in one secret separated by commas.**
- Optional: your approved Semaphore sender name: `firebase functions:config` is not used; instead create `functions/.env` containing `SEMAPHORE_SENDER_NAME=YourSenderName`.
- **Region:** Firestore triggers must run in the same region as your Firestore database. Default is `us-central1`; change `REGION` at the top of `functions/index.js` if yours differs.
- When the deploy finishes it prints the function URL for **smsInbound**, e.g. `https://smsinbound-xxxxx-uc.a.run.app` or `https://us-central1-<project>.cloudfunctions.net/smsInbound`. **Copy it.**

The keys exist only on the server (Firebase secrets). Nothing secret is in the Angular code.

## 4. Set up the gateway phone

Official docs: https://docs.sms-gate.app/ (Getting started, Webhooks).

1. Insert the barangay's SIM in the Android phone. Install **SMS Gateway for Android** and allow the SMS permissions.
2. Choose a mode in the app:
   - **Cloud server** (simplest): the phone connects to the public server at `api.sms-gate.app`. Your username/password are on the app's **Home** tab. Messages pass through that third-party server.
   - **Local server** (most private): the phone itself sends the webhook straight to your Cloud Function, no third party. You register the webhook on the phone's local address while on the same Wi-Fi.
   - **Private server**: you host the gateway backend yourself.
3. Register the webhook (Cloud mode shown; the docs show Local/Private variants). `device_id` is optional - leave it out and the webhook applies to **all** phones on the account:

```
curl -u "USERNAME:PASSWORD" -X POST https://api.sms-gate.app/3rdparty/v1/webhooks \
  -H "Content-Type: application/json" \
  -d '{"url":"PASTE-YOUR-smsInbound-URL-HERE","event":"sms:received"}'
```

4. Get the **signing key** in the app: **Settings -> Webhooks -> Signing Key**. Put it in the secret from section 3 (`firebase functions:secrets:set SMSGATE_SIGNING_KEY`) and redeploy: `firebase deploy --only functions`.
5. Turn the app's service **on**, and in Android settings set the app's battery usage to **Unrestricted** so it keeps running.

## 5. Link the phone to the Barangay Head (in the system)

1. Sign in as **admin -> Personnel -> Manage** the Barangay Head (or **Add Account** for a new one). Fill in:
   - **Official cellphone number** (the head's own number),
   - **SMS receiving number** (the SIM number residents text),
   - **Assigned barangay** (must be spelled exactly like the barangay in your schedules).
2. From **any other phone**, send a text to the gateway phone. The system does not know the phone yet, so it lists it on the Personnel page under **"Gateway phones waiting to be linked"** (it only stores the phone's ID, not the message).
3. **Manage** the head again, click that device ID chip, **Save changes**. The phone is now linked: texts it receives become that barangay's concerns.
   (You can also find IDs with `curl -u USER:PASS https://api.sms-gate.app/3rdparty/v1/devices`.)

A phone can be linked to only one head, and a number to only one head - the form refuses duplicates.

## 6. Test with a real phone

1. Link the phone as above. Open the **Barangay Head's** account in a browser on **Resident Concerns**.
2. From a resident phone, text: `Hindi po nakolekta ang basura sa Purok 3`.
3. Within a few seconds you should see: a green banner **"New SMS concern received from 09XXXXXXXXX"**, the bell count going up, and a new row with **SMS**, **Unverified**, **Pending**. The resident should receive the confirmation text with a reference like `Ref #A1B2C`.
4. Click the row -> read the message -> **Verify this sender** (name, purok, tick the consent box) -> **Confirm sender**. Now the sender shows **Verified** and is saved in the residents list.
5. Change the status to **In Review**, then **Resolved**. A registered resident who gave consent receives a status text each time.
6. Text again from the same number: it is now recognised by name.
7. Not working? Open Firebase console -> Functions -> `smsInbound` -> Logs:
   - `rejected: bad signature or timestamp` -> wrong signing key, or the phone's clock is more than 5 minutes off.
   - `not routed: no Barangay Head is linked to device ...` -> link the device (section 5).
   - `Semaphore rejected the SMS` -> check credits / sender name; the concern is still saved and shows "confirmation could not be sent".

## 7. Security and privacy (what the code enforces)

- The webhook only accepts `POST`, a body under 20 KB, a timestamp within 5 minutes, and a valid HMAC-SHA256 signature (constant-time comparison, `X-Signature`). Anything else gets `401` and saves nothing.
- **No duplicates:** the concern's ID is a hash of the gateway's own event ID, so the gateway's automatic retries cannot create a second concern or a second confirmation SMS.
- **Flood control:** one number can get at most 5 automatic replies per hour (extra texts are still saved) - protects your Semaphore credits.
- **Sender identity is never invented.** A number found in the residents list of *that barangay* is "Verified"; otherwise the concern is "Unverified sender" with the number kept, until the head verifies it.
- **Consent:** the confirmation is a direct reply to a text the resident started. **Status updates are sent only to registered residents who gave consent** (the "agreed to receive SMS updates" box).
- **Firestore rules:** only the Barangay Head of that barangay can read its concerns (admins and drivers cannot, as you requested). Browsers can only record *manual* concerns, change a status, or verify a sender; the phone number, message, time and source of an SMS concern can **not** be edited. SMS concerns are written only by the Cloud Function. Nobody can delete concerns.
- Phone numbers are shown only to that barangay's head and are not included in notifications.
- Philippine Data Privacy Act (RA 10173): residents' numbers are personal data. Tell residents why you collect them (a short notice in your announcement) and keep the list limited to people who agreed. This is general information, not legal advice.

### Checking the rules yourself
I could not run the Firestore emulator here, so the rules were reviewed but **not executed**. After `firebase deploy --only firestore:rules`, open Firebase console -> Firestore -> Rules -> **Rules Playground** and try, signed in as a head of Poblacion: read a Looc concern (should be **denied**), update a concern's `senderPhone` (**denied**), update only `status` (**allowed**), create a concern with `source: 'sms'` (**denied**); as an admin: read any concern (**denied**).

## 8. Suggested announcement to residents

> Para i-report ang problema sa basura / To report a waste concern: text your **barangay, name and concern** to **09XX XXX XXXX** (Barangay Poblacion). You will get a confirmation text. No app or internet needed. Your number is used only to follow up your report.

## 9. Files added or changed

| File | Change |
|---|---|
| `functions/index.js` | New `smsInbound` webhook and `notifyConcernStatus`; `sendAdvisory` unchanged |
| `functions/lib.js` (new) | Signature check, phone normalising, de-duplication, concern building |
| `functions/test/lib.test.js` (new) | 18 automated tests (`cd functions && npm test`) |
| `functions/package.json` | `npm test` script |
| `firestore.rules` | Concerns rules for SMS fields, `smsUnrouted` collection |
| `src/app/core/models.ts`, `auth.service.ts`, `phone.ts` (new), `waste.store.ts` | New fields, live concerns, verify sender |
| `src/app/services/waste-api.service.ts` | Live listener and partial update |
| `src/app/pages/resident-concerns/*` | Sender number, SMS/Manual, verification, filters, details |
| `src/app/pages/personnel/*` | Barangay Head phone / SMS number / gateway link, detected phones |
| `src/app/pages/dashboard/*`, `profile/*` | SMS badge, SMS number and link status |
| `src/styles.scss` | Styles for the new parts |
