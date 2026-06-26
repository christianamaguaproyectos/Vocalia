import type { MatchId, PlayerId, TeamId, TournamentId } from '../value-objects/identifiers.ts';
import type { MatchStage } from '../value-objects/match-stage.ts';
import type { MatchStatus } from '../value-objects/match-status.ts';
import type { Score } from '../value-objects/score.ts';
import type { MatchEvent } from './match-event.ts';

export interface TeamMatchLineup {
  starters: PlayerId[];
  substitutes: PlayerId[];
  unavailable: PlayerId[];
  confirmedBy?: string;
  confirmedAt?: Date;
}

export interface MatchLineups {
  home?: TeamMatchLineup;
  away?: TeamMatchLineup;
  penaltyShootersHome?: PlayerId[];
  penaltyShootersAway?: PlayerId[];
}

export interface RefereeInfo {
  fullName: string;
  documentId?: string;
  phoneNumber?: string;
  notes?: string;
}

export interface MatchOfficials {
  referee?: RefereeInfo;
}

export interface MatchReport {
  submittedBy: string;
  submittedAt: Date;
  notes: string;
}

export interface VocalReport {
  submittedBy: string;
  submittedAt: Date;
  notes: string;
}

export interface VocalAccess {
  assignedEmail: string;
  otpHash: string;
  assignedBy: string;
  assignedAt: Date;
  expiresAt: Date;
  lastOtpSentAt?: Date;
}

export interface Match {
  id: MatchId;
  tournamentId: TournamentId;
  stage: MatchStage;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  scheduledAt: Date;
  status: MatchStatus;
  score: Score;
  venue?: string;
  bracketNodeId?: string;
  events?: MatchEvent[];
  lineups?: MatchLineups | null;
  officials?: MatchOfficials | null;
  report?: MatchReport | null;
  vocalReport?: VocalReport | null;
  vocalAccess?: VocalAccess | null;
  createdAt: Date;
  updatedAt?: Date;
}
