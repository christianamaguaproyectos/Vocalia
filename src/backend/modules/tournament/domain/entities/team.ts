import type { GroupId, TeamId, TournamentId } from '../value-objects/identifiers.ts';
import type { Player } from './player.ts';

export interface Team {
  id: TeamId;
  tournamentId: TournamentId;
  name: string;
  shortName?: string;
  representativeEmails?: string[];
  groupId: GroupId;
  crestUrl?: string;
  createdAt: Date;
  updatedAt?: Date;
  players?: Player[];
  penaltyPoints?: number;
}

export const createTeam = (props: Omit<Team, 'id' | 'createdAt'> & { id?: TeamId; createdAt?: Date }): Team => ({
  id: props.id ?? crypto.randomUUID(),
  createdAt: props.createdAt ?? new Date(),
  ...props,
  players: props.players ?? [],
});
