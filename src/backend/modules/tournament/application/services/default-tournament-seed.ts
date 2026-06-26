import type { Tournament } from '../../domain/entities/index.ts';
import { DEFAULT_TOURNAMENT_CONFIG } from '../../domain/entities/tournament.ts';

// Builds a default tournament document when Firestore has no data yet.
export const buildDefaultTournamentSeed = (): Omit<Tournament, 'id'> => ({
  name: 'Mazorca de Oro',
  season: '2025',
  status: 'DRAFT',
  config: { ...DEFAULT_TOURNAMENT_CONFIG },
  groups: [
    { id: 'A', name: 'Grupo A', maxTeams: Math.floor(DEFAULT_TOURNAMENT_CONFIG.teamsCount / 2) },
    { id: 'B', name: 'Grupo B', maxTeams: Math.floor(DEFAULT_TOURNAMENT_CONFIG.teamsCount / 2) },
  ],
  createdAt: new Date(),
});
