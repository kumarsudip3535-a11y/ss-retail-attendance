# Deployment Guide — SS Retail Attendance

## How to use this guide

Each build phase gets its own section below. After a phase's code changes are
handed off, come back here, find that phase's section, and follow the steps
**in order**. Every step has a "✅ How to know it worked" line so you're never
guessing whether something succeeded before moving to the next one.

You'll need, once, before Phase T3's steps:
- Node.js and npm installed (already true — you can run `npm run dev` for this project)
- Firebase CLI installed globally. Check with:
  ```
  firebase --version
  ```
  If that fails with "command not found", install it:
  ```
  npm install -g firebase-tools
  ```
- A terminal open **in the project's root folder** — the folder that directly
  contains `package.json`, `firebase.json`, `src/`, `functions/`, etc.
  (`...\ss-retail-attendance-phaseT2\ss-retail-attendance`)

---

## Phase T3 — Live Tracking security rules + stop detection + route aggregation

### Step 1 — Log in to Firebase (one-time, skip if already logged in)

```
firebase login
```

This opens your browser to sign in with the Google account that owns the
`ss-retail-attendance` Firebase project. Approve access when prompted.

**✅ How to know it worked:** the terminal prints
`✔  Success! Logged in as <your-email>`.

### Step 2 — Confirm the CLI is pointed at the right project

```
firebase use ss-retail-attendance
```

The `.firebaserc` file already sets this as the default, so this step is a
safety check rather than strictly required.

**✅ How to know it worked:** terminal prints `Now using project ss-retail-attendance`.

### Step 3 — Deploy the updated Firestore security rules and indexes

```
firebase deploy --only firestore:rules,firestore:indexes
```

This is the most important step in this phase — it's what actually protects
the tracking data going forward.

**✅ How to know it worked:** the terminal ends with `✔  Deploy complete!`.
Then open the Firebase Console → your project → **Firestore Database → Rules**
tab, and confirm you can see `match /trackingSessions/{sessionId}` (and the
other new collections) in the currently-published rules.

Indexes take a few minutes to finish building in the background — check
**Firestore Database → Indexes** tab. New ones show "Building" then flip to
"Enabled". You do not need to wait for this before continuing to Step 4.

### Step 4 — Install the Cloud Functions dependencies

```
cd functions
npm install
cd ..
```

Only needs to be done once (or again later if a future phase adds new
Cloud Functions dependencies).

**✅ How to know it worked:** no red error text, and a new
`functions/node_modules` folder appears.

### Step 5 — Deploy the Cloud Function

```
firebase deploy --only functions
```

First-ever Functions deploy on a project can take 2–5 minutes. If this is
genuinely the first Cloud Function ever deployed here, Firebase may print a
message about enabling the Cloud Build / Artifact Registry / Eventarc APIs —
if it gives you a link, open it, click "Enable", wait a minute, then re-run
the same deploy command.

**✅ How to know it worked:** terminal ends with `✔  Deploy complete!` and
lists `functions[onTrackingSessionClosed(...)]`. In the Firebase Console →
**Functions** tab, you should see `onTrackingSessionClosed` listed with a
green "Healthy" status.

### Step 6 — End-to-end test

1. Log in to the app as an employee and **Punch In** as normal.
2. Wait at least 2 minutes so a couple of GPS points get collected (or, to
   test faster, go to the admin **Settings** page first and temporarily set
   the interval to 15 seconds).
3. **Punch Out**.
4. In the Firebase Console → **Firestore Database → Data** tab, check:
   - `stops` collection — a new document appears if you stayed in one place
     for 10+ minutes (the default stop threshold); no new document is also
     correct if you were "moving" the whole test.
   - `dailyRouteSummaries` collection — a new document appears with an ID
     like `<employeeId>_2026-08-15`, containing distance/duration numbers.
5. In the Firebase Console → **Functions → onTrackingSessionClosed → Logs**
   tab, you should see a line starting with `[tracking] Aggregating closed
   session...` and ending with `[tracking] Session ... aggregated: ...`.

**✅ How to know it worked:** everything above appears with no errors in the
Logs tab.

### Step 7 — Try the new Settings page

Log in as admin → **Settings** tab (new, next to Reports) → change the stop
duration or interval → **Save Settings**. Confirm in the Firestore Console
that `trackingConfig/default` now shows your new values.

---

## Phase T4 — Admin Live Tracking map *(filled in when this phase ships)*

---

If anything errors at any step, copy the exact error text back and it'll get
diagnosed from there — don't guess or skip ahead past an error.
