import { Capacitor } from '@capacitor/core'

/**
 * True only inside the Capacitor-built native Android app — not the plain
 * website, not the desktop admin panel, and not the PWABuilder-generated
 * APK (that one's a Trusted Web Activity, not a Capacitor app, so it never
 * sees this code path either).
 *
 * Shared by nativeBackgroundTracking.ts (GPS foreground service) and
 * nativePhoneAuth.ts (native phone sign-in) — pulled out to its own module
 * so both stay in sync on what "native" means instead of each keeping its
 * own copy of this check.
 */
export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}
