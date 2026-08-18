// Firebase app initialization. All other services import auth/db/storage
// from here rather than calling initializeApp() themselves.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredKeys: (keyof typeof firebaseConfig)[] = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]

export const isFirebaseConfigured = requiredKeys.every(
  (key) => !!firebaseConfig[key]
)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let storage: FirebaseStorage | null = null

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  storage = getStorage(app)
} else {
  // Expected until .env is filled in with real project values (Phase 0).
  console.warn(
    '[firebase] Missing config values in .env — Firebase has not been initialized.'
  )
}

/**
 * Throws a clear error instead of a confusing "Cannot read property of null"
 * if a service function is called before Firebase config is in place.
 */
function requireInitialized<T>(instance: T | null, name: string): T {
  if (!instance) {
    throw new Error(
      `[firebase] ${name} is not available — check your .env configuration.`
    )
  }
  return instance
}

export function getFirebaseAuth(): Auth {
  return requireInitialized(auth, 'Auth')
}

export function getFirebaseDb(): Firestore {
  return requireInitialized(db, 'Firestore')
}

export function getFirebaseStorage(): FirebaseStorage {
  return requireInitialized(storage, 'Storage')
}

export { app }
