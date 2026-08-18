import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'
import type { TrackingConfig, TrackingConfigFormInput } from '@/types'

const COLLECTION_NAME = 'trackingConfig'
const CONFIG_DOC_ID = 'default'

/**
 * Sensible out-of-the-box values — used only when no admin has saved a
 * config doc yet, so the tracking pipeline never has to special-case
 * "config missing" beyond this one fallback.
 */
export const DEFAULT_TRACKING_CONFIG: TrackingConfigFormInput = {
  collectionIntervalSeconds: 60,
  lowBatteryIntervalSeconds: 300,
  lowBatteryThresholdPercent: 20,
  lowAccuracyThresholdMeters: 100,
  stopMinDurationMinutes: 10,
  stopRadiusMeters: 200,
  personalKmPolicy: 'auto_exclude',
  odometerToleranceKm: 2,
  defaultPerKmRate: 5,
}

/**
 * Reads the single shared tracking config doc, falling back to
 * DEFAULT_TRACKING_CONFIG (with placeholder metadata) if an admin hasn't
 * saved one yet.
 */
export async function getTrackingConfig(): Promise<TrackingConfig> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, COLLECTION_NAME, CONFIG_DOC_ID))

  if (!snap.exists()) {
    return {
      ...DEFAULT_TRACKING_CONFIG,
      updatedAt: null as unknown as TrackingConfig['updatedAt'],
      updatedBy: 'system-default',
    }
  }

  // Merge over defaults so a doc saved before Phase T7 (missing the two
  // new fields) still resolves to something valid rather than undefined.
  return { ...DEFAULT_TRACKING_CONFIG, ...(snap.data() as Partial<TrackingConfig>) } as TrackingConfig
}

/** Admin-only write — enforced by Firestore rules, not just this function. */
export async function updateTrackingConfig(
  input: TrackingConfigFormInput,
  adminEmployeeId: string
): Promise<void> {
  const db = getFirebaseDb()
  await setDoc(doc(db, COLLECTION_NAME, CONFIG_DOC_ID), {
    ...input,
    updatedAt: serverTimestamp(),
    updatedBy: adminEmployeeId,
  })
}
