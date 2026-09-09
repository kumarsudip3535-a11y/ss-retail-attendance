import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Phase T14 follow-up: this file exists purely to produce a native Android
 * shell around the exact same web app already deployed at
 * ssretailattandance.netlify.app — it does NOT fork the app into a
 * separate codebase. webDir: 'dist' means `npx cap sync` copies whatever
 * `npm run build` just produced into the native project as-is.
 *
 * Why this exists at all, given the PWABuilder-generated APK already
 * works: that APK is a Trusted Web Activity (a thin wrapper that opens the
 * live site in a Chrome tab) — fine for install/branding/offline-shell
 * purposes, but it has no access to Android's foreground-service APIs, so
 * GPS collection stops the moment the screen turns off or the app is
 * backgrounded (the root cause behind the "9km recorded as 5km" bug — see
 * useLiveTracking.ts / nativeBackgroundTracking.ts). A Capacitor build is
 * a genuinely native Android app that CAN start a foreground service, via
 * @capacitor-community/background-geolocation — that's the only reason
 * this second Android build pipeline exists alongside the PWABuilder one.
 */
const config: CapacitorConfig = {
  appId: 'in.ssretailservices.attendance',
  appName: 'SS Retail Attendance',
  webDir: 'dist',
  server: {
    // Firebase Phone Auth's reCAPTCHA check only trusts domains listed as
    // "Authorized domains" in the Firebase console, and validates that
    // trust via an iframe-based challenge that native WebViews sandbox
    // heavily (storage-access denial, CSP frame-ancestors). Left at
    // Capacitor's default 'localhost' origin, every reCAPTCHA attempt
    // fails with `auth/invalid-app-credential` before an OTP is ever
    // sent — the app never even reaches real SMS delivery. Pointing the
    // WebView's *reported* origin at the already-deployed, already-
    // authorized production domain fixes this with zero Firebase-console
    // changes: the app still runs entirely from the locally bundled
    // `dist/` files (webDir above), this only changes what
    // `location.origin` the page reports itself as.
    hostname: 'ssretailattandance.netlify.app',
    androidScheme: 'https',
  },
  android: {
    // Required by @capgo/background-geolocation (and its predecessor,
    // @capacitor-community/background-geolocation, which had the same
    // requirement) — without this, Capacitor's newer WebView bridge
    // silently stops delivering location callbacks to JS after 5 minutes
    // in the background, which would just reintroduce the same "GPS
    // stops working when backgrounded" bug this whole native rebuild
    // exists to fix. See https://github.com/capacitor-community/background-geolocation/issues/89.
    useLegacyBridge: true,
  },
}

export default config
