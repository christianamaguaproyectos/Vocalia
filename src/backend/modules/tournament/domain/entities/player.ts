import type { PlayerId, TeamId } from '../value-objects/identifiers.ts';

export type PlayerPosition = 'GK' | 'DF' | 'MF' | 'FW';

export interface Player {
  id: PlayerId;
  teamId: TeamId;
  fullName: string;
  displayName?: string;
  nationalId?: string;
  number?: number;
  position?: PlayerPosition;
  photoUrl?: string;
  manualSuspensionMatches?: number;
  suspensionReason?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export const createPlayer = (props: Omit<Player, 'id' | 'createdAt'> & { id?: PlayerId; createdAt?: Date }): Player => ({
  id: props.id ?? crypto.randomUUID(),
  createdAt: props.createdAt ?? new Date(),
  ...props,
});
