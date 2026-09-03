import { BackgroundGeolocation } from '@capgo/background-geolocation'
import type { Location as NativeLocation, CallbackError } from '@capgo/background-geolocation'
import { isNativeAndroid } from './platform'

/**
 * Phase T14 follow-up (native tracking fix): the root cause behind "20km
 * driven, only ~10km recorded" (and sometimes 0km) is that the web-only
 * tracking loop in useLiveTracking.ts uses a JS `setTimeout` chain, which
 * Android/Chrome suspend once the screen turns off or the app is
 * backgrounded — nothing web code can do about that; a plain website has
 * no access to Android's foreground-service APIs. This module wraps
 * `@capgo/background-geolocation`, a Capacitor plugin that CAN start a
 * real Android foreground service (a persistent notification, per Android
 * policy, is the trade-off for that) so location updates keep arriving
 * with the screen off or the app swiped away.
 *
 * Deliberately isolated in its own module rather than folded directly
 * into useLiveTracking.ts: everything here is a no-op / returns false when
 * NOT running inside the native Android shell (Capacitor.isNativePlatform()
 * is false for the plain website, the desktop admin panel, and even the
 * PWABuilder-generated APK — that one's a Trusted Web Activity, not a
 * Capacitor app, so it never sees this code path either). That keeps the
 * existing, already-tested web GPS logic completely untouched for every
 * context except this specific native Android build.
 */

export { isNativeAndroid }

export interface NativePoint {
  lat: number
  lng: number
  /** Meters. */
  accuracy: number | null
  /** Converted to km/h to match the web path's PendingPoint.speed unit — see useLiveTracking.ts. */
  speedKmh: number | null
  /** Degrees from true north — maps to PendingPoint.direction. */
  bearing: number | null
  /** Epoch ms this fix was produced. */
  timeMs: number | null
}

let watcherActive = false

/**
 * Starts the native foreground-service watcher. `onPoint` is called for
 * every location update (potentially with the screen off / app
 * backgrounded — that's the entire point); `onError` for delivery errors
 * (permission denial, provider disabled, etc.) which the caller should log
 * but not treat as fatal — the plugin keeps retrying on its own.
 *
 * `minIntervalMs` mirrors useLiveTracking.ts's BASE_INTERVAL_MS/
 * LOW_BATTERY_INTERVAL_MS split, read once at start (battery-adaptive
 * *mid-session* interval switching isn't implemented here — a smaller
 * scope than the web path's dynamic re-schedule, acceptable since the
 * primary bug this fixes is "no points at all while backgrounded," not
 * fine-tuning cadence).
 */
export async function startNativeBackgroundTracking(
  minIntervalMs: number,
  onPoint: (point: NativePoint) => void,
  onError: (error: CallbackError) => void
): Promise<void> {
  await BackgroundGeolocation.start(
    {
      // Non-empty backgroundMessage is what tells the plugin to keep
      // delivering updates while backgrounded, not just foregrounded —
      // see StartOptions.backgroundMessage's doc comment in the plugin's
      // own type definitions. The persistent notification this produces
      // is mandatory Android policy for any app using a location
      // foreground service, not something this plugin can hide.
      backgroundMessage: 'Recording your route for today\'s shift. Tap to return to the app.',
      backgroundTitle: 'SS Retail Services — Live Tracking',
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
      minIntervalMs,
    },
    (location?: NativeLocation, error?: CallbackError) => {
      if (error) {
        onError(error)
        return
      }
      if (!location) return
      onPoint({
        lat: location.latitude,
        lng: location.longitude,
        accuracy: location.accuracy ?? null,
        speedKmh: location.speed != null ? Math.round(location.speed * 3.6 * 10) / 10 : null,
        bearing: location.bearing ?? null,
        timeMs: location.time ?? null,
      })
    }
  )
  watcherActive = true
}

export async function stopNativeBackgroundTracking(): Promise<void> {
  if (!watcherActive) return
  watcherActive = false
  await BackgroundGeolocation.stop()
}
