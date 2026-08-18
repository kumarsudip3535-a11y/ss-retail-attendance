/**
 * Mirrors src/types/tracking.ts's TrackingConfig shape and
 * src/services/trackingConfigService.ts's DEFAULT_TRACKING_CONFIG.
 * Duplicated here for the same reason as geo.ts — Cloud Functions is a
 * separate package with no shared build step against the frontend.
 */
export interface TrackingConfigDoc {
  collectionIntervalSeconds: number
  lowBatteryIntervalSeconds: number
  lowBatteryThresholdPercent: number
  lowAccuracyThresholdMeters: number
  stopMinDurationMinutes: number
  stopRadiusMeters: number
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfigDoc = {
  collectionIntervalSeconds: 60,
  lowBatteryIntervalSeconds: 300,
  lowBatteryThresholdPercent: 20,
  lowAccuracyThresholdMeters: 100,
  stopMinDurationMinutes: 10,
  stopRadiusMeters: 200,
}
