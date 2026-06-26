import type { GroupConfig } from '../value-objects/group.ts';
import type { TournamentId } from '../value-objects/identifiers.ts';
import type { KnockoutStage } from '../value-objects/match-stage.ts';

export type TiebreakerCriterion =
  | 'GOAL_DIFFERENCE'
  | 'GOALS_FOR'
  | 'HEAD_TO_HEAD'
  | 'WINS'
  | 'GOALS_AGAINST'
  | 'ALPHABETICAL';

export type AccumulatedYellowsResetStage = KnockoutStage | 'NEVER';

export interface TournamentConfig {
  teamsCount: number;
  qualifiedCount: number;
  maxSubstitutions: number;
  maxSubstitutionWindows: number;
  allowReentry: boolean;
  matchDuration: number;
  allowExtraTime: boolean;
  extraTimeDuration: number;
  playerRegistrationLimit: number;
  /** Titulares en cancha en condiciones normales (p. ej. 7). Es el máximo que se puede alinear. */
  playersOnField: number;
  /** Mínimo de jugadores para que un equipo pueda iniciar el partido (piso, p. ej. 5). */
  minPlayersToStart: number;
  pointsPerWin: number;
  pointsPerDraw: number;
  pointsPerLoss: number;
  tiebreakerOrder: TiebreakerCriterion[];
  yellowCardsForSuspension: number;
  directRedSuspensionDays: number;
  accumulatedYellowsResetStage: AccumulatedYellowsResetStage;
  tournamentLogoUrl: string;
  tournamentPrimaryColor: string;
  allowDrawsInKnockout?: boolean;
  // Backward compatibility with previous schema.
  pointsRule?: {
    win: number;
    draw: number;
    loss: number;
  };
  // Backward compatibility with older seeds/documents.
  totalTeams?: number;
  groupSize?: number;
}

export type TournamentStatus = 'DRAFT' | 'READY' | 'LIVE' | 'FINISHED';

const asPositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
};

const asNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return value;
};

const asAtLeast = (value: unknown, fallback: number, min: number): number => {
  const normalized = asNumber(value, fallback);
  return Math.max(min, Math.floor(normalized));
};

const asNonEmptyString = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized ? normalized : fallback;
};

const asColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  const hexRegex = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
  return hexRegex.test(normalized) ? normalized : fallback;
};

const normalizeUnlimitedNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  if (normalized === -1) {
    return -1;
  }

  return normalized >= 0 ? normalized : fallback;
};

const VALID_TIEBREAKER_ORDER: TiebreakerCriterion[] = [
  'GOAL_DIFFERENCE',
  'GOALS_FOR',
  'HEAD_TO_HEAD',
  'WINS',
  'GOALS_AGAINST',
  'ALPHABETICAL',
];

const VALID_YELLOW_RESET_STAGES: AccumulatedYellowsResetStage[] = [
  'NEVER',
  'ROUND_OF_16',
  'QUARTER_FINAL',
  'SEMI_FINAL',
  'FINAL',
  'THIRD_PLACE',
];

const normalizeTiebreakerOrder = (value: unknown): TiebreakerCriterion[] => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_TOURNAMENT_CONFIG.tiebreakerOrder];
  }

  const unique = Array.from(
    new Set(value.filter((criterion): criterion is TiebreakerCriterion => VALID_TIEBREAKER_ORDER.includes(criterion as TiebreakerCriterion))),
  );

  if (unique.length === 0) {
    return [...DEFAULT_TOURNAMENT_CONFIG.tiebreakerOrder];
  }

  return unique;
};

const normalizeResetStage = (value: unknown): AccumulatedYellowsResetStage => {
  if (typeof value !== 'string') {
    return DEFAULT_TOURNAMENT_CONFIG.accumulatedYellowsResetStage;
  }

  if (VALID_YELLOW_RESET_STAGES.includes(value as AccumulatedYellowsResetStage)) {
    return value as AccumulatedYellowsResetStage;
  }

  return DEFAULT_TOURNAMENT_CONFIG.accumulatedYellowsResetStage;
};

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  teamsCount: 32,
  qualifiedCount: 8,
  maxSubstitutions: -1,
  maxSubstitutionWindows: -1,
  allowReentry: false,
  matchDuration: 70,
  allowExtraTime: true,
  extraTimeDuration: 15,
  playerRegistrationLimit: 16,
  playersOnField: 7,
  minPlayersToStart: 5,
  pointsPerWin: 3,
  pointsPerDraw: 1,
  pointsPerLoss: 0,
  tiebreakerOrder: ['GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD', 'ALPHABETICAL'],
  yellowCardsForSuspension: 4,
  directRedSuspensionDays: 1,
  accumulatedYellowsResetStage: 'NEVER',
  tournamentLogoUrl: '',
  tournamentPrimaryColor: '#4f46e5',
  allowDrawsInKnockout: false,
  pointsRule: {
    win: 3,
    draw: 1,
    loss: 0,
  },
  totalTeams: 32,
  groupSize: 16,
};

export const normalizeTournamentConfig = (config?: Partial<TournamentConfig> | null): TournamentConfig => {
  const teamsCount = asPositiveInteger(config?.teamsCount ?? config?.totalTeams, DEFAULT_TOURNAMENT_CONFIG.teamsCount);
  const derivedGroupSize = Math.max(1, Math.ceil(teamsCount / 2));
  const groupSize = asPositiveInteger(config?.groupSize, derivedGroupSize);
  const maxQualified = Math.max(1, Math.min(8, Math.floor(teamsCount / 2)));
  const requestedQualifiedCount = Math.min(
    asPositiveInteger(config?.qualifiedCount, DEFAULT_TOURNAMENT_CONFIG.qualifiedCount),
    maxQualified,
  );
  const qualifiedCount = [8, 4, 2, 1].find((value) => value <= requestedQualifiedCount) ?? 1;
  const requestedMatchDuration = Math.max(
    20,
    asPositiveInteger(config?.matchDuration, DEFAULT_TOURNAMENT_CONFIG.matchDuration),
  );
  const matchDuration = requestedMatchDuration % 2 === 0
    ? requestedMatchDuration
    : requestedMatchDuration + 1;
  const pointsPerWin = asNumber(config?.pointsPerWin ?? config?.pointsRule?.win, DEFAULT_TOURNAMENT_CONFIG.pointsPerWin);
  const pointsPerDraw = asNumber(config?.pointsPerDraw ?? config?.pointsRule?.draw, DEFAULT_TOURNAMENT_CONFIG.pointsPerDraw);
  const pointsPerLoss = asNumber(config?.pointsPerLoss ?? config?.pointsRule?.loss, DEFAULT_TOURNAMENT_CONFIG.pointsPerLoss);
  const playerRegistrationLimit = asAtLeast(
    config?.playerRegistrationLimit,
    DEFAULT_TOURNAMENT_CONFIG.playerRegistrationLimit,
    1,
  );
  // Titulares en cancha (máximo a alinear), nunca mayor a la nómina registrada.
  const playersOnField = Math.min(
    asAtLeast(config?.playersOnField, DEFAULT_TOURNAMENT_CONFIG.playersOnField, 1),
    playerRegistrationLimit,
  );
  // Mínimo para iniciar: piso, nunca mayor que los titulares en cancha.
  const minPlayersToStart = Math.min(
    asAtLeast(config?.minPlayersToStart, DEFAULT_TOURNAMENT_CONFIG.minPlayersToStart, 1),
    playersOnField,
  );
  const maxSubstitutions = normalizeUnlimitedNumber(
    config?.maxSubstitutions,
    DEFAULT_TOURNAMENT_CONFIG.maxSubstitutions,
  );
  const maxSubstitutionWindows = normalizeUnlimitedNumber(
    config?.maxSubstitutionWindows,
    DEFAULT_TOURNAMENT_CONFIG.maxSubstitutionWindows,
  );

  return {
    teamsCount,
    qualifiedCount,
    maxSubstitutions,
    maxSubstitutionWindows,
    allowReentry:
      typeof config?.allowReentry === 'boolean'
        ? config.allowReentry
        : DEFAULT_TOURNAMENT_CONFIG.allowReentry,
    matchDuration,
    allowExtraTime:
      typeof config?.allowExtraTime === 'boolean'
        ? config.allowExtraTime
        : DEFAULT_TOURNAMENT_CONFIG.allowExtraTime,
    extraTimeDuration: asAtLeast(config?.extraTimeDuration, DEFAULT_TOURNAMENT_CONFIG.extraTimeDuration, 1),
    playerRegistrationLimit,
    playersOnField,
    minPlayersToStart,
    pointsPerWin,
    pointsPerDraw,
    pointsPerLoss,
    tiebreakerOrder: normalizeTiebreakerOrder(config?.tiebreakerOrder),
    yellowCardsForSuspension: asAtLeast(
      config?.yellowCardsForSuspension,
      DEFAULT_TOURNAMENT_CONFIG.yellowCardsForSuspension,
      1,
    ),
    directRedSuspensionDays: asAtLeast(
      config?.directRedSuspensionDays,
      DEFAULT_TOURNAMENT_CONFIG.directRedSuspensionDays,
      1,
    ),
    accumulatedYellowsResetStage: normalizeResetStage(config?.accumulatedYellowsResetStage),
    tournamentLogoUrl: asNonEmptyString(config?.tournamentLogoUrl, DEFAULT_TOURNAMENT_CONFIG.tournamentLogoUrl),
    tournamentPrimaryColor: asColor(config?.tournamentPrimaryColor, DEFAULT_TOURNAMENT_CONFIG.tournamentPrimaryColor),
    allowDrawsInKnockout:
      typeof config?.allowDrawsInKnockout === 'boolean'
        ? config.allowDrawsInKnockout
        : DEFAULT_TOURNAMENT_CONFIG.allowDrawsInKnockout,
    pointsRule: {
      win: pointsPerWin,
      draw: pointsPerDraw,
      loss: pointsPerLoss,
    },
    totalTeams: teamsCount,
    groupSize,
  };
};

export interface Tournament {
  id: TournamentId;
  name: string;
  season: string;
  status: TournamentStatus;
  config: TournamentConfig;
  groups: GroupConfig[];
  createdAt: Date;
  updatedAt?: Date;
}
