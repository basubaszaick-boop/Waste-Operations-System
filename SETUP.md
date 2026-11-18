# Setup & Deployment (Firebase)

The app is a static Angular site (Firebase Hosting) using Firebase Authentication and Cloud Firestore.
All data (users, schedules) lives in Firestore. There is no local API server anymore.

## One-time setup
1. Install **Node 24** (Node 22 also builds the site), then: `npm install` and `npm install -g firebase-tools`.
2. `firebase login` then `firebase use villanueva-waste-operations`.
3. Firebase console > Build > **Authentication** > Sign-in method > enable **Email/Password**.
4. Firebase console > Build > **Firestore Database** > Create database (production mode).
5. Publish the security rules (this is what protects the data):
   `firebase deploy --only firestore:rules`
6. **First admin** (console, one time):
   - Authentication > Users > Add user (email + password).
   - Firestore > collection `users`, document ID = that user's UID, fields:
     `name` (string), `role` = `admin`, `barangay` = (empty).
   - Barangay heads: `role` = `barangay_head`, `barangay` = their barangay (e.g. `Poblacion`). Drivers: `role` = `driver`.

## Deploy the website
```
npm run build
firebase deploy --only hosting
```
Live at https://villanueva-waste-operations.web.app (or your custom domain; add it under
Authentication > Settings > Authorized domains).

Do both rules and site in one go: `npm run build && firebase deploy --only firestore:rules,hosting`

## What each role gets
- **Everyone**: **My Profile** (photo, contact details, change password, notification preferences, own activity), live notifications with a bell badge.
- **admin**: dashboard with "Needs attention", team workload and recent activity; **Personnel** (real accounts: change role, barangay, team, activate/deactivate); **Activity Log**; reports with CSV export; schedules management.
- **driver**: dashboard with **Today's Route** (Start / Complete buttons) for their team; Collection Records filtered to their team. The admin assigns the team under Personnel > Manage.
- **barangay_head**: dashboard with the next collection for their barangay, open concerns (Review / Resolve), and **Report Concern**.

After updating, publish the new rules (profiles, concerns and the activity log need them):
`firebase deploy --only firestore:rules,hosting`
Resident concerns are a Barangay Head-only feature, stored in Firestore (collection `concerns`). Admins and drivers cannot see them.

## Roles and schedules
- **admin**: add, edit, delete schedules; sees everything.
- **driver**: sees schedules, can change a schedule's status (Collection Records page).
- **barangay_head**: sees schedules (own barangay) in view-only mode.
Schedules start empty: log in as admin > Collection Schedules > Add Schedule.

## SMS advisories (optional; needs Firebase Blaze plan + a Semaphore account)
1. The function trigger must run in the **same region as your Firestore database**
   (Firestore console shows it). If it is not `us-central1`, add `region: '<your-region>'`
   to the options in `functions/index.js` (next to `document:`).
2. Then:
```
cd functions && npm install && cd ..
firebase functions:secrets:set SEMAPHORE_API_KEY
firebase deploy --only functions
```
Without this step, advisories are saved with status `queued` and no SMS is sent.

## Local development
`npm start` -> http://localhost:4200 (uses the real Firebase project).
