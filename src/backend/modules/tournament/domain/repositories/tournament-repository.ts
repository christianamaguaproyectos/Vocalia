import type { Tournament } from '../entities/tournament.ts';
import type { TournamentId } from '../value-objects/index.ts';
import type { RealtimeListener, UnsubscribeFn } from './types.ts';

export interface CreateTournamentOptions {
  tournamentId?: TournamentId;
}

export interface TournamentRepository {
  create(tournament: Omit<Tournament, 'id'>, options?: CreateTournamentOptions): Promise<Tournament>;
  update(tournamentId: TournamentId, updates: Partial<Omit<Tournament, 'id'>>): Promise<void>;
  findById(tournamentId: TournamentId): Promise<Tournament | null>;
  listen(tournamentId: TournamentId, listener: RealtimeListener<Tournament | null>): UnsubscribeFn;
  delete(tournamentId: TournamentId): Promise<void>;
}
