import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const ReloadPrompt = () => {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh) return;
    // Nueva versión detectada — recargar automáticamente
    void updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);

  return null;
};
