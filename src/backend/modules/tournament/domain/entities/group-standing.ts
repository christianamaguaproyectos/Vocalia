import type { GroupId, TeamId } from '../value-objects/identifiers.ts';

export interface GroupStanding {
  teamId: TeamId;
  groupId: GroupId;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlayPoints?: number;
  lastFive?: Array<'W' | 'D' | 'L'>;
  penaltyPoints?: number;
}
