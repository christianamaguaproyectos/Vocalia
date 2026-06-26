import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  type DocumentReference,
  type Query,
} from "firebase/firestore";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.warn('[firebase] Firebase configuration is incomplete. Check your environment variables.');
}

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Inicializar los servicios
const auth = getAuth(app);

// Inicializar Firestore con persistencia offline y soporte multi-tab
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Exportar los servicios para usarlos en la app
export { app, auth, db };

/**
 * Races a Firestore write against a short timeout.
 * Offline, Firestore queues writes in IndexedDB but the returned
 * Promise never resolves until the server confirms.  This helper
 * ensures the UI is never blocked: if the server doesn't respond
 * within the timeout the write is still queued locally.
 */
const WRITE_TIMEOUT_MS = 1500;

export const firestoreWriteWithTimeout = <T>(
  writePromise: Promise<T>,
): Promise<T | void> => {
  writePromise.catch((err) =>
    console.warn('[Firestore] Write queued, will sync on reconnect:', err),
  );
  return Promise.race([
    writePromise,
    new Promise<void>((resolve) => setTimeout(resolve, WRITE_TIMEOUT_MS)),
  ]);
};

/**
 * Reads a document trying the local cache first (instant offline),
 * falling back to the server on cache miss.
 */
export const getDocPreferCache = async (ref: DocumentReference) => {
  try {
    return await getDocFromCache(ref);
  } catch {
    return await getDoc(ref);
  }
};

/**
 * Reads a collection/query trying the local cache first,
 * falling back to the server on cache miss.
 */
export const getDocsPreferCache = async (ref: Query) => {
  try {
    return await getDocsFromCache(ref);
  } catch {
    return await getDocs(ref);
  }
};