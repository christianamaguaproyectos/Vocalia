import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { MatchRepository, TeamRepository, TournamentRepository } from '../../../backend/modules/tournament/domain/repositories/index.ts';
import { FirestoreMatchRepository, FirestoreTeamRepository, FirestoreTournamentRepository } from '../../../backend/modules/tournament/infrastructure/repositories/index.ts';

export interface AppDependencies {
  teamRepository: TeamRepository;
  tournamentRepository: TournamentRepository;
  matchRepository: MatchRepository;
}

const AppDependenciesContext = createContext<AppDependencies | undefined>(undefined);

export const AppDependenciesProvider = ({ children }: { children: ReactNode }) => {
  const dependencies = useMemo<AppDependencies>(() => ({
    teamRepository: new FirestoreTeamRepository(),
    tournamentRepository: new FirestoreTournamentRepository(),
    matchRepository: new FirestoreMatchRepository(),
  }), []);

  return <AppDependenciesContext.Provider value={dependencies}>{children}</AppDependenciesContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAppDependencies = (): AppDependencies => {
  const context = useContext(AppDependenciesContext);

  if (!context) {
    throw new Error('useAppDependencies must be used within AppDependenciesProvider');
  }

  return context;
};
