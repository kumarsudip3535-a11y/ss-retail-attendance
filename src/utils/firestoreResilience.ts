import { disableNetwork, enableNetwork } from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'

/**
 * Live-tested finding (Phase T13): after this app has gone through several
 * forced offline/online cycles in one tab (e.g. testing with DevTools'
 * Network throttling, or in the field — a train tunnel, a lift, dropping
 * in and out of signal repeatedly), Firestore's underlying realtime
 * connection can end up in a state where writes are rejected with
 * `permission-denied` ("Missing or insufficient permissions") even though
 * the user is genuinely online, correctly authenticated, and the write is
 * one the security rules should allow. This isn't an auth-token problem —
 * a token refresh doesn't fix it, and it isn't a rules bug either; it's
 * the SDK's own WebChannel connection wedged in a bad state (visible in
 * the console as "WebChannelConnection RPC 'Write' stream ... transport
 * errored" during the flakier stretches of testing this phase). The one
 * thing that reliably clears it is a full page reload, which throws away
 * and rebuilds that connection from scratch — this module gets the same
 * effect without one, by explicitly tearing the connection down and
 * bringing it back up via disableNetwork()/enableNetwork().
 *
 * This is deliberately narrow: it only intervenes for the specific
 * "denied while genuinely online" case, retries exactly once, and lets
 * every other error (a real permission denial, a genuinely offline write)
 * pass through unchanged to whatever queuing/error-handling the caller
 * already has — see useLiveTracking.ts and attendanceService.ts for how
 * the retry result then flows into the existing durable-queue fallback if
 * it still fails.
 *
 * Related but distinct failure mode found afterward (also Phase T13): a
 * queued GPS point can legitimately, permanently fail with
 * `permission-denied` for a reason this module's retry can never fix —
 * firestore.rules only allows writing a locationPoint into a still-*active*
 * tracking session, so a point that's been sitting offline long enough for
 * its session to get closed in the meantime will be denied forever, no
 * matter how many times the connection is reset. See
 * useLiveTracking.ts's flushSessionQueue for how that case is told apart
 * from a genuinely wedged connection (using isPermissionDenied below) and
 * dropped instead of retried indefinitely.
 */

let resetInFlight: Promise<void> | null = null

/**
 * Tears down and rebuilds Firestore's connection. Concurrent callers
 * share one in-flight reset rather than each tearing the connection down
 * again mid-rebuild — several writes can hit `permission-denied` around
 * the same moment (e.g. a GPS point and a punch-out flush both mid-flight
 * when the connection wedges), and resetting once for all of them is both
 * correct and cheaper than resetting per-caller.
 */
function resetFirestoreConnection(): Promise<void> {
  if (!resetInFlight) {
    const db = getFirebaseDb()
    resetInFlight = disableNetwork(db)
      .then(() => enableNetwork(db))
      .finally(() => {
        resetInFlight = null
      })
  }
  return resetInFlight
}

/**
 * Exported (not just used internally by withConnectionRetry below) so
 * other callers can distinguish "this failed because of a permission
 * denial" from any other failure without duplicating the check — see
 * useLiveTracking.ts's flushSessionQueue for a case where that
 * distinction decides whether to keep retrying a queued write or give up
 * on it for good.
 */
export function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'permission-denied'
  )
}

/**
 * Runs a Firestore write; if it fails with `permission-denied` while
 * `navigator.onLine` is true, resets the Firestore connection and retries
 * exactly once before giving up. Any other failure (genuinely offline, a
 * real permission denial that a fresh connection won't change, or a
 * second failure after the retry) is rethrown unchanged for the caller to
 * handle as before — this only ever adds one extra chance to succeed, it
 * never masks or swallows a real error.
 */
export async function withConnectionRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (!isPermissionDenied(error) || !navigator.onLine) {
      throw error
    }
    console.warn(
      '[firestoreResilience] Write denied while online — resetting the Firestore connection and retrying once.',
      error
    )
    await resetFirestoreConnection()
    return await fn()
  }
}
