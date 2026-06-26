import { useEffect, useState } from 'react';

import type { Match } from '../../domain/entities/index.ts';
import { APP_CONFIG } from '../../../../../core/config/app-config.ts';
import { useAppDependencies } from '../../../../../frontend/app/providers/AppDependenciesProvider.tsx';

export interface UseMatchesState {
  matches: Match[];
  isLoading: boolean;
  error: string | null;
}

export const useMatches = (tournamentId: string = APP_CONFIG.defaultTournamentId): UseMatchesState => {
  const { matchRepository } = useAppDependencies();
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) {
      setMatches([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const unsubscribe = matchRepository.listenByTournament(tournamentId, {
      onData: (data) => {
        setMatches(data);
        setIsLoading(false);
      },
      onError: (err) => {
        console.error('[useMatches] Failed to load matches', err);
        setError('No se pudieron cargar los partidos');
        setIsLoading(false);
      },
    });

    return unsubscribe;
  }, [matchRepository, tournamentId]);

  return { matches, isLoading, error };
};
