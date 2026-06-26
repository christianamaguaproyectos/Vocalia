import { useEffect, useState } from 'react';

import type { Tournament } from '../../domain/entities/index.ts';
import { buildDefaultTournamentSeed } from '../../application/services/index.ts';
import { APP_CONFIG } from '../../../../../core/config/app-config.ts';
import { useAppDependencies } from '../../../../../frontend/app/providers/AppDependenciesProvider.tsx';

export interface UseTournamentState {
  tournament: Tournament | null;
  isLoading: boolean;
  error: string | null;
}

export const useTournament = (tournamentId: string = APP_CONFIG.defaultTournamentId): UseTournamentState => {
  const { tournamentRepository } = useAppDependencies();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const ensureTournamentExists = async () => {
      try {
        const existing = await tournamentRepository.findById(tournamentId);
        if (!existing) {
          await tournamentRepository.create(buildDefaultTournamentSeed(), { tournamentId });
        }
      } catch (err) {
        console.warn('[useTournament] Could not ensure tournament exists (offline?)', err);
      }
    };

    ensureTournamentExists();
    setIsLoading(true);

    const unsubscribe = tournamentRepository.listen(tournamentId, {
      onData: (data) => {
        if (!isMounted) {
          return;
        }

        setTournament(data);
        setIsLoading(false);

        if (data) {
          setError(null);
        }
      },
      onError: (err) => {
        console.error('[useTournament] Failed to load tournament', err);
        if (!isMounted) {
          return;
        }

        setError('No se pudo cargar la informacion del torneo');
        setIsLoading(false);
      },
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [tournamentId, tournamentRepository]);

  return { tournament, isLoading, error };
};
