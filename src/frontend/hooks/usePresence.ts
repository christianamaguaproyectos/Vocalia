import { useEffect } from 'react';
import { getDatabase, ref, onDisconnect, set, remove, serverTimestamp } from 'firebase/database';
import { app } from '../../backend/lib/firebase.ts';

const getSessionId = (): string => {
  let id = sessionStorage.getItem('_vsid');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('_vsid', id);
  }
  return id;
};

/**
 * Registra la presencia del visitante en Firebase Realtime Database.
 * Se elimina automáticamente cuando cierra la pestaña/navegador (onDisconnect).
 * Si VITE_FIREBASE_DATABASE_URL no está configurado, no hace nada.
 */
export const usePresence = () => {
  useEffect(() => {
    const dbUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined;
    if (!dbUrl) return;

    const db = getDatabase(app, dbUrl);
    const sessionId = getSessionId();
    const presenceRef = ref(db, `presence/${sessionId}`);

    set(presenceRef, { connectedAt: serverTimestamp() }).catch(() => {/* silencio */});
    onDisconnect(presenceRef).remove().catch(() => {/* silencio */});

    return () => {
      remove(presenceRef).catch(() => {/* silencio */});
    };
  }, []);
};
