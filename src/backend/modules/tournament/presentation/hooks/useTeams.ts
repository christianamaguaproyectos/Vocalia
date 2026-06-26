import { useEffect, useState } from 'react';

import type { Team } from '../../domain/entities/index.ts';
import { APP_CONFIG } from '../../../../../core/config/app-config.ts';
import { useAppDependencies } from '../../../../../frontend/app/providers/AppDependenciesProvider.tsx';

export interface UseTeamsState {
  teams: Team[];
  isLoading: boolean;
  error: string | null;
}

export const useTeams = (tournamentId: string = APP_CONFIG.defaultTournamentId): UseTeamsState => {
  const { teamRepository } = useAppDependencies();
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) {
      setTeams([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const unsubscribe = teamRepository.listenAll(tournamentId, {
      onData: (data) => {
        setTeams(data);
        setIsLoading(false);
      },
      onError: (err) => {
        console.error('[useTeams] Failed to load teams', err);
        setError('No se pudieron cargar los equipos');
        setIsLoading(false);
      },
    });

    return unsubscribe;
  }, [teamRepository, tournamentId]);

  return { teams, isLoading, error };
};
