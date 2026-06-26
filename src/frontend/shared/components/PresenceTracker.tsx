import { usePresence } from '../../hooks/usePresence.ts';

/** Registra la sesión del visitante en RTDB para el contador de presencia. Renderiza nada. */
export const PresenceTracker = () => {
  usePresence();
  return null;
};
