import type { GroupStanding, Match, Team } from '../../domain/entities/index.ts';
import type { TiebreakerCriterion, TournamentConfig } from '../../domain/entities/tournament.ts';
import type { GroupId } from '../../domain/value-objects/index.ts';

interface CalculateGroupStandingsInput {
  teams: Team[];
  matches: Match[];
  config: TournamentConfig;
}

const createInitialStanding = (team: Team): GroupStanding => ({
  teamId: team.id,
  groupId: team.groupId as GroupId,
  matchesPlayed: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
  lastFive: [],
});

const applyResultToStanding = (
  standing: GroupStanding,
  goalsFor: number,
  goalsAgainst: number,
  result: 'WIN' | 'DRAW' | 'LOSS',
  pointsByResult: Pick<TournamentConfig, 'pointsPerWin' | 'pointsPerDraw' | 'pointsPerLoss'>,
): GroupStanding => {
  const next: GroupStanding = {
    ...standing,
    matchesPlayed: standing.matchesPlayed + 1,
    goalsFor: standing.goalsFor + goalsFor,
    goalsAgainst: standing.goalsAgainst + goalsAgainst,
    goalDifference: standing.goalDifference + goalsFor - goalsAgainst,
    wins: standing.wins + (result === 'WIN' ? 1 : 0),
    draws: standing.draws + (result === 'DRAW' ? 1 : 0),
    losses: standing.losses + (result === 'LOSS' ? 1 : 0),
    points:
      standing.points +
      (result === 'WIN'
        ? pointsByResult.pointsPerWin
        : result === 'DRAW'
          ? pointsByResult.pointsPerDraw
          : pointsByResult.pointsPerLoss),
    lastFive: [...(standing.lastFive ?? []).slice(-4), result === 'WIN' ? 'W' : result === 'DRAW' ? 'D' : 'L'],
  };

  return next;
};

const calculateHeadToHeadComparison = ({
  teamA,
  teamB,
  matches,
  pointsPerWin,
  pointsPerDraw,
  pointsPerLoss,
}: {
  teamA: string;
  teamB: string;
  matches: Match[];
  pointsPerWin: number;
  pointsPerDraw: number;
  pointsPerLoss: number;
}): number => {
  const directMatches = matches.filter(
    (match) =>
      match.stage.type === 'GROUP' &&
      match.status === 'FINISHED' &&
      ((match.homeTeamId === teamA && match.awayTeamId === teamB) ||
        (match.homeTeamId === teamB && match.awayTeamId === teamA)),
  );

  if (directMatches.length === 0) {
    return 0;
  }

  let pointsA = 0;
  let pointsB = 0;
  let goalsA = 0;
  let goalsB = 0;

  directMatches.forEach((match) => {
    const isAHome = match.homeTeamId === teamA;
    const scoreA = isAHome ? match.score.home : match.score.away;
    const scoreB = isAHome ? match.score.away : match.score.home;

    goalsA += scoreA;
    goalsB += scoreB;

    if (scoreA > scoreB) {
      pointsA += pointsPerWin;
      pointsB += pointsPerLoss;
      return;
    }

    if (scoreB > scoreA) {
      pointsB += pointsPerWin;
      pointsA += pointsPerLoss;
      return;
    }

    pointsA += pointsPerDraw;
    pointsB += pointsPerDraw;
  });

  if (pointsA !== pointsB) {
    return pointsB - pointsA;
  }

  const goalDiffA = goalsA - goalsB;
  const goalDiffB = goalsB - goalsA;
  if (goalDiffA !== goalDiffB) {
    return goalDiffB - goalDiffA;
  }

  if (goalsA !== goalsB) {
    return goalsB - goalsA;
  }

  return 0;
};

const compareByTiebreaker = ({
  criterion,
  a,
  b,
  groupMatches,
  teamNameById,
  pointsPerWin,
  pointsPerDraw,
  pointsPerLoss,
}: {
  criterion: TiebreakerCriterion;
  a: GroupStanding;
  b: GroupStanding;
  groupMatches: Match[];
  teamNameById: Map<string, string>;
  pointsPerWin: number;
  pointsPerDraw: number;
  pointsPerLoss: number;
}): number => {
  switch (criterion) {
    case 'GOAL_DIFFERENCE':
      return b.goalDifference - a.goalDifference;
    case 'GOALS_FOR':
      return b.goalsFor - a.goalsFor;
    case 'WINS':
      return b.wins - a.wins;
    case 'GOALS_AGAINST':
      return a.goalsAgainst - b.goalsAgainst;
    case 'HEAD_TO_HEAD':
      return calculateHeadToHeadComparison({
        teamA: a.teamId,
        teamB: b.teamId,
        matches: groupMatches,
        pointsPerWin,
        pointsPerDraw,
        pointsPerLoss,
      });
    case 'ALPHABETICAL': {
      const nameA = teamNameById.get(a.teamId) ?? a.teamId;
      const nameB = teamNameById.get(b.teamId) ?? b.teamId;
      return nameA.localeCompare(nameB, 'es');
    }
    default:
      return 0;
  }
};

export const calculateGroupStandings = ({ teams, matches, config }: CalculateGroupStandingsInput): GroupStanding[] => {
  const standingsMap = new Map<string, GroupStanding>();
  const teamNameById = new Map<string, string>();
  teams.forEach((team) => teamNameById.set(team.id, team.name));
  const groupMatches = matches.filter((match) => match.stage.type === 'GROUP' && match.status === 'FINISHED');

  teams.forEach((team) => {
    standingsMap.set(team.id, createInitialStanding(team));
  });

  groupMatches.forEach((match) => {
      const homeStanding = standingsMap.get(match.homeTeamId);
      const awayStanding = standingsMap.get(match.awayTeamId);

      if (!homeStanding || !awayStanding) {
        return;
      }

      const homeGoals = match.score.home;
      const awayGoals = match.score.away;

      if (homeGoals === awayGoals) {
        standingsMap.set(
          match.homeTeamId,
          applyResultToStanding(homeStanding, homeGoals, awayGoals, 'DRAW', config),
        );
        standingsMap.set(
          match.awayTeamId,
          applyResultToStanding(awayStanding, awayGoals, homeGoals, 'DRAW', config),
        );
        return;
      }

      const homeResult = homeGoals > awayGoals ? 'WIN' : 'LOSS';
      const awayResult = homeGoals > awayGoals ? 'LOSS' : 'WIN';

      standingsMap.set(match.homeTeamId, applyResultToStanding(homeStanding, homeGoals, awayGoals, homeResult, config));
      standingsMap.set(match.awayTeamId, applyResultToStanding(awayStanding, awayGoals, homeGoals, awayResult, config));
    });

  // Apply manual penalty points
  standingsMap.forEach((standing, teamId) => {
    const team = teams.find((t) => t.id === teamId);
    if (team && typeof team.penaltyPoints === 'number' && team.penaltyPoints > 0) {
      standing.penaltyPoints = team.penaltyPoints;
      standing.points = standing.points - team.penaltyPoints;
    }
  });

  const tiebreakerOrder = config.tiebreakerOrder ?? ['GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD', 'ALPHABETICAL'];

  return Array.from(standingsMap.values()).sort((a, b) => {
    // Points remain the primary ranking rule.
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    for (const criterion of tiebreakerOrder) {
      const criterionResult = compareByTiebreaker({
        criterion,
        a,
        b,
        groupMatches,
        teamNameById,
        pointsPerWin: config.pointsPerWin,
        pointsPerDraw: config.pointsPerDraw,
        pointsPerLoss: config.pointsPerLoss,
      });

      if (criterionResult !== 0) {
        return criterionResult;
      }
    }

    const nameA = teamNameById.get(a.teamId) ?? a.teamId;
    const nameB = teamNameById.get(b.teamId) ?? b.teamId;
    return nameA.localeCompare(nameB, 'es');
  });
};
