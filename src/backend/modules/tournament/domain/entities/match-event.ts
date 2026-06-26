import type { MatchEventId, MatchId, PlayerId, TeamId } from '../value-objects/identifiers.ts';
import type { CardType } from '../value-objects/card-type.ts';
import type { EventTime } from '../value-objects/event-time.ts';
import type { Score } from '../value-objects/score.ts';

export type MatchEventType =
  | 'MATCH_STARTED'
  | 'FIRST_HALF_ENDED'
  | 'SECOND_HALF_STARTED'
  | 'SECOND_HALF_ENDED'
  | 'MATCH_SUSPENDED'
  | 'MATCH_RESUMED'
  | 'MATCH_ENDED'
  | 'GOAL'
  | 'OWN_GOAL'
  | 'PENALTY_GOAL'
  | 'PENALTY_MISSED'
  | 'CARD'
  | 'SUBSTITUTION'
  | 'COMMENT'
  | 'VAR_REVIEW'
  | 'PENALTY_SHOOTOUT_STARTED';

export interface BaseMatchEvent {
  id: MatchEventId;
  matchId: MatchId;
  teamId?: TeamId;
  createdAt: Date;
  recordedBy: string; // uid del admin
  time: EventTime;
  period?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
  notes?: string;
}

export interface GoalEvent extends BaseMatchEvent {
  type: 'GOAL' | 'OWN_GOAL' | 'PENALTY_GOAL' | 'PENALTY_MISSED';
  scorerId?: PlayerId;
  updatedScore: Score;
}

export interface CardEvent extends BaseMatchEvent {
  type: 'CARD';
  cardType: CardType;
  playerId: PlayerId;
}

export interface SubstitutionEvent extends BaseMatchEvent {
  type: 'SUBSTITUTION';
  playerInId: PlayerId;
  playerOutId: PlayerId;
}

export interface TimelineEvent extends BaseMatchEvent {
  type:
  | 'MATCH_STARTED'
  | 'FIRST_HALF_ENDED'
  | 'SECOND_HALF_STARTED'
  | 'SECOND_HALF_ENDED'
  | 'MATCH_SUSPENDED'
  | 'MATCH_RESUMED'
  | 'MATCH_ENDED'
  | 'COMMENT'
  | 'VAR_REVIEW'
  | 'PENALTY_SHOOTOUT_STARTED';
}

export type MatchEvent = GoalEvent | CardEvent | SubstitutionEvent | TimelineEvent;
