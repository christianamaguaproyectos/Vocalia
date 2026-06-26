import type { TeamId } from './identifiers.ts';

export interface GroupConfig {
  id: 'A' | 'B';
  name: string;
  maxTeams?: number;
}

export interface GroupSnapshot {
  id: 'A' | 'B';
  name: string;
  teamOrder: TeamId[];
}
