import type { Match } from '../entities/match.ts';
import type { MatchEvent } from '../entities/match-event.ts';
import type { KnockoutStage } from '../value-objects/match-stage.ts';
import type { MatchEventId, MatchId, TournamentId } from '../value-objects/index.ts';
import type { RealtimeListener, UnsubscribeFn } from './types.ts';

export interface KnockoutProgressAuditLog {
  tournamentId: TournamentId;
  currentStage: KnockoutStage;
  nextStage?: KnockoutStage;
  action: 'LOCK_ACQUIRED' | 'LOCK_REJECTED' | 'MATCH_CREATED' | 'TEAM_ADVANCED' | 'PROGRESSION_COMPLETED' | 'SANITIZE';
  message: string;
  triggeredBy: string;
  triggeredRole?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MatchRepository {
  create(match: Omit<Match, 'id'>): Promise<Match>;
  delete(matchId: MatchId, tournamentId: TournamentId): Promise<void>;
  update(matchId: MatchId, updates: Partial<Omit<Match, 'id'>>): Promise<void>;
  findById(matchId: MatchId, tournamentId?: TournamentId, options?: { forceServer?: boolean }): Promise<Match | null>;
  listByTournament(tournamentId: TournamentId): Promise<Match[]>;
  listenByTournament(tournamentId: TournamentId, listener: RealtimeListener<Match[]>): UnsubscribeFn;
  tryAcquireKnockoutProgressLock(input: {
    tournamentId: TournamentId;
    currentStage: KnockoutStage;
    ttlMs?: number;
  }): Promise<boolean>;
  releaseKnockoutProgressLock(input: {
    tournamentId: TournamentId;
    currentStage: KnockoutStage;
  }): Promise<void>;
  appendKnockoutProgressAuditLog(input: KnockoutProgressAuditLog): Promise<void>;

  appendEvent(matchId: MatchId, event: Omit<MatchEvent, 'id'>, tournamentId?: TournamentId): Promise<MatchEvent>;
  listEvents(matchId: MatchId, tournamentId?: TournamentId, options?: { forceServer?: boolean }): Promise<MatchEvent[]>;
  updateEvent(matchId: MatchId, eventId: MatchEventId, updates: Partial<Omit<MatchEvent, 'id'>>, tournamentId?: TournamentId): Promise<void>;
  removeEvent(matchId: MatchId, eventId: MatchEventId, tournamentId?: TournamentId): Promise<void>;
  listenEvents(matchId: MatchId, listener: RealtimeListener<MatchEvent[]>, tournamentId?: TournamentId): UnsubscribeFn;
}
