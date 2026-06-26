import { useState, useEffect } from 'react';
import { getDatabase, ref, onValue, set, get } from 'firebase/database';
import { app } from '../../backend/lib/firebase.ts';

interface PeakRecord {
  count: number;
  timestamp: string;
}

interface UseOnlineCountResult {
  count: number | null;
  peak: PeakRecord | null;
  isConfigured: boolean;
}

export const useOnlineCount = (): UseOnlineCountResult => {
  const [count, setCount] = useState<number | null>(null);
  const [peak, setPeak] = useState<PeakRecord | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    const dbUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined;
    if (!dbUrl) {
      setIsConfigured(false);
      return;
    }
    setIsConfigured(true);

    const db = getDatabase(app, dbUrl);
    const presenceRef = ref(db, 'presence');
    const peakRef = ref(db, 'stats/peakOnline');

    // Cargar pico guardado al montar
    void get(peakRef).then((snap) => {
      if (snap.exists()) setPeak(snap.val() as PeakRecord);
    });

    const unsubscribe = onValue(presenceRef, (snapshot) => {
      const val = snapshot.val();
      const current = val ? Object.keys(val).length : 0;
      setCount(current);

      // Actualizar pico si el conteo actual supera el récord
      setPeak((prev) => {
        if (current > (prev?.count ?? 0)) {
          const newPeak: PeakRecord = {
            count: current,
            timestamp: new Date().toISOString(),
          };
          void set(peakRef, newPeak);
          return newPeak;
        }
        return prev;
      });
    });

    return () => unsubscribe();
  }, []);

  return { count, peak, isConfigured };
};
