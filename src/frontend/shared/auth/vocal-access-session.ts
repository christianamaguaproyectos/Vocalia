const SESSION_PREFIX = 'vocal-access-session:';

export interface VocalAccessSession {
  matchId: string;
  assignedEmail: string;
  verifiedAt: string;
  expiresAt: string;
}

const getStorageKey = (matchId: string) => `${SESSION_PREFIX}${matchId}`;

export const saveVocalAccessSession = (session: VocalAccessSession) => {
  localStorage.setItem(getStorageKey(session.matchId), JSON.stringify(session));
};

export const getVocalAccessSession = (matchId: string): VocalAccessSession | null => {
  const raw = localStorage.getItem(getStorageKey(matchId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as VocalAccessSession;
    const expiresAtMs = new Date(parsed.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      localStorage.removeItem(getStorageKey(matchId));
      return null;
    }

    return parsed;
  } catch {
    localStorage.removeItem(getStorageKey(matchId));
    return null;
  }
};

export const clearVocalAccessSession = (matchId: string) => {
  localStorage.removeItem(getStorageKey(matchId));
};

/** Devuelve true si hay al menos una sesión vocal vigente en cualquier partido. */
export const hasAnyVocalAccessSession = (): boolean => {
  const now = Date.now();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(SESSION_PREFIX)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '') as VocalAccessSession;
      if (new Date(parsed.expiresAt).getTime() > now) return true;
    } catch {
      // entrada corrupta, ignorar
    }
  }
  return false;
};
