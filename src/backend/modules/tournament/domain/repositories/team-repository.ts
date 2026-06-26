import type { Team } from '../entities/team.ts';
import type { GroupId, TeamId, TournamentId } from '../value-objects/index.ts';
import type { RealtimeListener, UnsubscribeFn } from './types.ts';

export interface TeamRepository {
  create(team: Omit<Team, 'id'>): Promise<Team>;
  update(params: {
    tournamentId: TournamentId;
    teamId: TeamId;
    updates: Partial<Omit<Team, 'id' | 'tournamentId'>>;
  }): Promise<void>;
  remove(params: { tournamentId: TournamentId; teamId: TeamId }): Promise<void>;
  findById(params: { tournamentId: TournamentId; teamId: TeamId }): Promise<Team | null>;
  listByGroup(tournamentId: TournamentId, groupId: GroupId): Promise<Team[]>;
  listenAll(tournamentId: TournamentId, listener: RealtimeListener<Team[]>): UnsubscribeFn;
}
