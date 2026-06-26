import type { Match } from '../../domain/entities/match.ts';
import type { Player } from '../../domain/entities/player.ts';
import type { GroupId, KnockoutStage, TournamentId } from '../../domain/value-objects/index.ts';
import type { MatchRepository, TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';
import type { RecordableEvent } from './record-match-event.ts';
import { recordMatchEventUseCase } from './record-match-event.ts';
import { progressKnockoutStageUseCase } from './progress-knockout-stage.ts';

interface SimulateKnockoutStageDeps {
  matchRepository: MatchRepository;
  teamRepository: TeamRepository;
  tournamentRepository: TournamentRepository;
}

interface SimulateKnockoutStageInput {
  tournamentId: TournamentId;
  stages?: KnockoutStage[];
  concurrency?: number;
  triggeredBy?: string;
  triggeredRole?: string;
  triggerSource?: string;
}

interface SimulationResult {
  matchesSimulated: number;
  matchesSkipped: number;
}

const GROUP_IDS: GroupId[] = ['A', 'B'];
type BracketStage = 'ROUND_OF_16' | 'QUARTER_FINAL' | 'SEMI_FINAL' | 'FINAL';
const BRACKET_STAGE_ORDER: BracketStage[] = ['ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'];

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const pickRandom = <T>(items: T[]): T | undefined => {
  if (items.length === 0) {
    return undefined;
  }
  const index = randomInt(0, items.length - 1);
  return items[index];
};

const buildSimulatedGoalEvent = (
  teamPlayers: Player[],
  teamId: string,
  minute: number,
): RecordableEvent => {
  const scorer = pickRandom(teamPlayers)?.id;
  const goalType = Math.random() < 0.2 ? 'PENALTY_GOAL' : 'GOAL';

  return {
    type: goalType,
    teamId,
    scorerId: scorer,
    timeMinute: minute,
  };
};

const buildSimulatedCardEvent = (
  teamPlayers: Player[],
  teamId: string,
  minute: number,
): RecordableEvent | null => {
  const targetPlayer = pickRandom(teamPlayers);
  if (!targetPlayer) {
    return null;
  }

  const cardPool: Array<'YELLOW' | 'DOUBLE_YELLOW' | 'RED'> = ['YELLOW', 'YELLOW', 'DOUBLE_YELLOW', 'RED'];
  const cardType = pickRandom(cardPool) ?? 'YELLOW';

  return {
    type: 'CARD',
    teamId,
    playerId: targetPlayer.id,
    cardType,
    timeMinute: minute,
  };
};

const prepareRosters = async (teamRepository: TeamRepository, tournamentId: TournamentId): Promise<Map<string, Player[]>> => {
  const roster = new Map<string, Player[]>();
  const teamsByGroup = await Promise.all(GROUP_IDS.map((groupId) => teamRepository.listByGroup(tournamentId, groupId)));

  teamsByGroup.forEach((groupTeams) => {
    groupTeams.forEach((team) => {
      roster.set(team.id, team.players ?? []);
    });
  });

  return roster;
};

const addAdditionalTimeOffsets = (events: Array<{ minute: number; event: RecordableEvent }>) => {
  events
    .sort((a, b) => a.minute - b.minute)
    .forEach((item, index) => {
      if (index > 0 && item.minute === events[index - 1].minute) {
        item.event.timeAdditional = (item.event.timeAdditional ?? 0) + 1;
      }
    });
};

const isBracketStage = (stage?: KnockoutStage): stage is BracketStage => {
  return stage === 'ROUND_OF_16' || stage === 'QUARTER_FINAL' || stage === 'SEMI_FINAL' || stage === 'FINAL';
};

const resolveStagesToSimulate = (stages?: KnockoutStage[]): BracketStage[] => {
  if (!stages || stages.length === 0) {
    return BRACKET_STAGE_ORDER;
  }

  const requested = new Set(stages.filter(isBracketStage));
  return BRACKET_STAGE_ORDER.filter((stage) => requested.has(stage));
};

export const simulateKnockoutStageUseCase = ({
  matchRepository,
  teamRepository,
  tournamentRepository,
}: SimulateKnockoutStageDeps) => async ({
  tournamentId,
  stages,
  concurrency = 12,
  triggeredBy,
  triggeredRole,
  triggerSource,
}: SimulateKnockoutStageInput): Promise<SimulationResult> => {
  const targetStages = resolveStagesToSimulate(stages);
  if (targetStages.length === 0) {
    throw new Error('No se indicaron rondas válidas para simular.');
  }

  const tournament = await tournamentRepository.findById(tournamentId);
  const regularDuration = Math.max(20, tournament?.config.matchDuration ?? 60);
  const allowExtraTime = tournament?.config.allowExtraTime ?? true;
  const extraTimeDuration = Math.max(1, tournament?.config.extraTimeDuration ?? 15);
  const extraTimeLimitMinute = regularDuration + extraTimeDuration * 2;

  const matches = await matchRepository.listByTournament(tournamentId);
  const knockoutMatches = matches.filter(
    (match) => match.stage.type === 'KNOCKOUT' && isBracketStage(match.stage.knockout) && targetStages.includes(match.stage.knockout),
  );

  if (knockoutMatches.length === 0) {
    throw new Error('No se encontraron partidos eliminatorios para simular.');
  }

  const pendingMatches = knockoutMatches.filter(
    (match) => match.status !== 'FINISHED' && Boolean(match.homeTeamId) && Boolean(match.awayTeamId),
  );

  if (pendingMatches.length === 0) {
    throw new Error('Todos los partidos eliminatorios ya fueron simulados.');
  }

  const rosterByTeam = await prepareRosters(teamRepository, tournamentId);
  const recordEvent = recordMatchEventUseCase({ matchRepository, tournamentRepository, teamRepository });
  const progressKnockout = progressKnockoutStageUseCase({ matchRepository });

  const runMatchSimulation = async (match: Match): Promise<boolean> => {
    if (match.status === 'FINISHED' || !match.homeTeamId || !match.awayTeamId) {
      return false;
    }

    const homeRoster = rosterByTeam.get(match.homeTeamId) ?? [];
    const awayRoster = rosterByTeam.get(match.awayTeamId) ?? [];

    const events: Array<{ minute: number; event: RecordableEvent }> = [
      { minute: 0, event: { type: 'MATCH_STARTED', timeMinute: 0 } },
    ];

    let homeGoals = randomInt(0, 4);
    let awayGoals = randomInt(0, 4);

    const goalMinutes = new Set<number>();
    const generateMinute = (start: number, end: number) => {
      let minute = randomInt(start, end);
      while (goalMinutes.has(minute)) {
        minute = randomInt(start, end);
      }
      goalMinutes.add(minute);
      return minute;
    };

    for (let i = 0; i < homeGoals; i++) {
      const minute = generateMinute(1, regularDuration);
      events.push({ minute, event: buildSimulatedGoalEvent(homeRoster, match.homeTeamId, minute) });
    }

    for (let i = 0; i < awayGoals; i++) {
      const minute = generateMinute(1, regularDuration);
      events.push({ minute, event: buildSimulatedGoalEvent(awayRoster, match.awayTeamId, minute) });
    }

    const cardEvents = randomInt(0, 4);
    for (let i = 0; i < cardEvents; i++) {
      const minute = generateMinute(5, Math.max(5, regularDuration - 2));
      const teamId = Math.random() < 0.5 ? match.homeTeamId : match.awayTeamId;
      const roster = teamId === match.homeTeamId ? homeRoster : awayRoster;
      const cardEvent = buildSimulatedCardEvent(roster, teamId, minute);

      if (cardEvent) {
        events.push({ minute, event: cardEvent });
      }
    }

    let shootoutResolved = false;
    if (homeGoals === awayGoals) {
      if (allowExtraTime) {
        const winnerTeamId = Math.random() < 0.5 ? match.homeTeamId : match.awayTeamId;
        const winnerRoster = winnerTeamId === match.homeTeamId ? homeRoster : awayRoster;
        const extraMinute = generateMinute(regularDuration + 1, extraTimeLimitMinute);
        const extraGoal = buildSimulatedGoalEvent(winnerRoster, winnerTeamId, extraMinute);
        extraGoal.period = 'EXTRA_TIME';
        events.push({ minute: extraMinute, event: extraGoal });

        if (winnerTeamId === match.homeTeamId) {
          homeGoals += 1;
        } else {
          awayGoals += 1;
        }
      } else {
        shootoutResolved = true;
        const shootoutStartMinute = regularDuration + 1;
        const winnerTeamId = Math.random() < 0.5 ? match.homeTeamId : match.awayTeamId;
        const loserTeamId = winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
        const winnerRoster = winnerTeamId === match.homeTeamId ? homeRoster : awayRoster;
        const loserRoster = loserTeamId === match.homeTeamId ? homeRoster : awayRoster;
        const winnerShooterId = pickRandom(winnerRoster)?.id;
        const loserShooterId = pickRandom(loserRoster)?.id;

        events.push({
          minute: shootoutStartMinute,
          event: {
            type: 'PENALTY_SHOOTOUT_STARTED',
            timeMinute: shootoutStartMinute,
            period: 'PENALTY_SHOOTOUT',
          },
        });
        events.push({
          minute: shootoutStartMinute + 1,
          event: {
            type: 'PENALTY_GOAL',
            teamId: winnerTeamId,
            scorerId: winnerShooterId,
            timeMinute: shootoutStartMinute + 1,
            period: 'PENALTY_SHOOTOUT',
          },
        });
        events.push({
          minute: shootoutStartMinute + 2,
          event: {
            type: 'PENALTY_MISSED',
            teamId: loserTeamId,
            scorerId: loserShooterId,
            timeMinute: shootoutStartMinute + 2,
            period: 'PENALTY_SHOOTOUT',
          },
        });
      }
    }

    const latestMinute = events.reduce((max, current) => Math.max(max, current.minute), 0);
    const finalMinute = latestMinute + 1;
    const finalPeriod = shootoutResolved ? 'PENALTY_SHOOTOUT' : latestMinute > regularDuration ? 'EXTRA_TIME' : 'REGULAR';
    events.push({ minute: finalMinute, event: { type: 'MATCH_ENDED', timeMinute: finalMinute, period: finalPeriod } });

    addAdditionalTimeOffsets(events);

    for (const simulated of events) {
      await recordEvent({
        matchId: match.id,
        recordedBy: 'knockout-simulation',
        skipNotifications: true,
        event: {
          ...simulated.event,
          timeMinute: simulated.minute,
        },
      });
    }

    return true;
  };

  let simulatedMatches = 0;

  for (const stage of targetStages) {
    const refreshedMatches = await matchRepository.listByTournament(tournamentId);
    const stagePendingMatches = refreshedMatches.filter(
      (match) =>
        match.stage.type === 'KNOCKOUT' &&
        match.stage.knockout === stage &&
        Boolean(match.homeTeamId) &&
        Boolean(match.awayTeamId) &&
        match.status !== 'FINISHED',
    );

    for (let i = 0; i < stagePendingMatches.length; i += concurrency) {
      const batch = stagePendingMatches.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((match) => runMatchSimulation(match)));
      simulatedMatches += results.filter(Boolean).length;
    }

    if (stage !== 'FINAL') {
      try {
        await progressKnockout({
          tournamentId,
          currentStage: stage,
          triggeredBy: (triggeredBy ?? '').trim() || 'knockout-simulation',
          triggeredRole: (triggeredRole ?? '').trim() || 'system',
          triggerSource: (triggerSource ?? '').trim() || 'knockout-simulation',
        });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('ya está en curso')) {
          throw error;
        }
      }
    }
  }

  if (simulatedMatches === 0) {
    throw new Error('No se pudieron simular partidos con equipos definidos en las rondas seleccionadas.');
  }

  const finalStateMatches = await matchRepository.listByTournament(tournamentId);
  const finalKnockoutMatches = finalStateMatches.filter(
    (match) => match.stage.type === 'KNOCKOUT' && isBracketStage(match.stage.knockout) && targetStages.includes(match.stage.knockout),
  );

  return {
    matchesSimulated: simulatedMatches,
    matchesSkipped: finalKnockoutMatches.filter((match) => match.status !== 'FINISHED').length,
  };
};
