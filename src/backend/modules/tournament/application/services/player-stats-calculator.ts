import type { MatchEvent } from '../../domain/entities/match-event.ts';
import type { Player } from '../../domain/entities/player.ts';
import type { Team } from '../../domain/entities/team.ts';
import type { PlayerId, TeamId } from '../../domain/value-objects/identifiers.ts';
import type { PlayerPosition } from '../../domain/entities/player.ts';

export interface PlayerStatsSummary {
  playerId: PlayerId;
  teamId: TeamId;
  playerName: string;
  displayName?: string;
  shirtNumber?: number;
  position?: PlayerPosition;
  teamName: string;
  goals: number;
  penaltyGoals: number;
  ownGoals: number;
  yellowCards: number;
  doubleYellowCards: number;
  redCards: number;
  totalCards: number;
}

interface CalculatePlayerStatsInput {
  teams: Team[];
  events: MatchEvent[];
}

type PlayerLookup = Map<PlayerId, { player: Player; team: Team }>;

type PlayerStatsAccumulator = Omit<PlayerStatsSummary, 'playerName' | 'displayName' | 'shirtNumber' | 'position' | 'teamName'> & {
  playerName?: string;
  displayName?: string;
  shirtNumber?: number;
  position?: PlayerPosition;
  teamName?: string;
};

interface PlayerCardStatsPerMatch {
  playerId: PlayerId;
  teamId?: TeamId;
  yellowCount: number;
  hasDoubleYellow: boolean;
  directRedCount: number;
}

const buildCardAggregationKey = (playerId: PlayerId, matchId: string): string => `${playerId}:${matchId}`;

const createPlayerLookup = (teams: Team[]): PlayerLookup => {
  const lookup: PlayerLookup = new Map();

  teams.forEach((team) => {
    (team.players ?? []).forEach((player) => {
      lookup.set(player.id, { player, team });
    });
  });

  return lookup;
};

const ensureAccumulator = (
  map: Map<PlayerId, PlayerStatsAccumulator>,
  playerId: PlayerId,
  fallbackTeamId?: TeamId,
  lookup?: PlayerLookup,
): PlayerStatsAccumulator => {
  if (map.has(playerId)) {
    return map.get(playerId)!;
  }

  const fromLookup = lookup?.get(playerId);
  const accumulator: PlayerStatsAccumulator = {
    playerId,
    teamId: fromLookup?.team.id ?? fallbackTeamId ?? 'unknown-team' as TeamId,
    goals: 0,
    penaltyGoals: 0,
    ownGoals: 0,
    yellowCards: 0,
    doubleYellowCards: 0,
    redCards: 0,
    totalCards: 0,
  };

  if (fromLookup) {
    accumulator.playerName = fromLookup.player.fullName;
    accumulator.displayName = fromLookup.player.displayName;
    accumulator.shirtNumber = fromLookup.player.number;
    accumulator.position = fromLookup.player.position;
    accumulator.teamName = fromLookup.team.name;
  }

  map.set(playerId, accumulator);
  return accumulator;
};

export const calculatePlayerStats = ({ teams, events }: CalculatePlayerStatsInput): PlayerStatsSummary[] => {
  const lookup = createPlayerLookup(teams);
  const statsMap = new Map<PlayerId, PlayerStatsAccumulator>();
  const cardStatsPerMatch = new Map<string, PlayerCardStatsPerMatch>();

  events.forEach((event) => {
    switch (event.type) {
      case 'GOAL':
      case 'PENALTY_GOAL': {
        if (event.scorerId) {
          const scorerStats = ensureAccumulator(statsMap, event.scorerId, event.teamId, lookup);
          scorerStats.goals += 1;
          if (event.type === 'PENALTY_GOAL') {
            scorerStats.penaltyGoals += 1;
          }
        }
        break;
      }
      case 'OWN_GOAL': {
        if (event.scorerId) {
          const scorerStats = ensureAccumulator(statsMap, event.scorerId, event.teamId, lookup);
          scorerStats.ownGoals += 1;
        }
        break;
      }
      case 'CARD': {
        const key = buildCardAggregationKey(event.playerId, event.matchId);
        const current = cardStatsPerMatch.get(key) ?? {
          playerId: event.playerId,
          teamId: event.teamId,
          yellowCount: 0,
          hasDoubleYellow: false,
          directRedCount: 0,
        };

        if (event.cardType === 'YELLOW') {
          current.yellowCount += 1;
        } else if (event.cardType === 'DOUBLE_YELLOW') {
          current.hasDoubleYellow = true;
        } else if (event.cardType === 'RED') {
          current.directRedCount += 1;
        }

        cardStatsPerMatch.set(key, current);
        break;
      }
      default:
        break;
    }
  });

  cardStatsPerMatch.forEach((value) => {
    const cardStats = ensureAccumulator(statsMap, value.playerId, value.teamId, lookup);

    // A DOUBLE_YELLOW means the player reached two cautions in that match and got sent off.
    // We keep match yellows capped at 2 to avoid phantom "third yellow" totals.
    const effectiveYellowCards = value.hasDoubleYellow
      ? 2
      : Math.min(2, value.yellowCount);
    const effectiveDoubleYellowCards = value.hasDoubleYellow ? 1 : 0;
    const effectiveRedCards = value.directRedCount + (value.hasDoubleYellow ? 1 : 0);

    cardStats.yellowCards += effectiveYellowCards;
    cardStats.doubleYellowCards += effectiveDoubleYellowCards;
    cardStats.redCards += effectiveRedCards;
    cardStats.totalCards += effectiveYellowCards + effectiveRedCards;
  });

  const stats: PlayerStatsSummary[] = [];

  statsMap.forEach((value) => {
    const source = lookup.get(value.playerId);
    if (source && !value.playerName) {
      value.playerName = source.player.fullName;
      value.displayName = source.player.displayName;
      value.shirtNumber = source.player.number;
      value.position = source.player.position;
      value.teamId = source.team.id;
      value.teamName = source.team.name;
    }

    stats.push({
      playerId: value.playerId,
      teamId: value.teamId,
      playerName: value.playerName ?? 'Jugador sin registrar',
      displayName: value.displayName,
      shirtNumber: value.shirtNumber,
      position: value.position,
      teamName: value.teamName ?? 'Equipo desconocido',
      goals: value.goals,
      penaltyGoals: value.penaltyGoals,
      ownGoals: value.ownGoals,
      yellowCards: value.yellowCards,
      doubleYellowCards: value.doubleYellowCards,
      redCards: value.redCards,
      totalCards: value.totalCards,
    });
  });

  return stats.sort((a, b) => {
    if (b.goals !== a.goals) {
      return b.goals - a.goals;
    }
    if (b.yellowCards !== a.yellowCards) {
      return b.yellowCards - a.yellowCards;
    }
    return a.playerName.localeCompare(b.playerName, 'es');
  });
};