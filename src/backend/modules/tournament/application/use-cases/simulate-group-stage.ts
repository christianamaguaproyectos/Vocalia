import type { Match } from '../../domain/entities/match.ts';
import type { Player } from '../../domain/entities/player.ts';
import type { GroupId, TournamentId } from '../../domain/value-objects/index.ts';
import type { MatchRepository, TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';
import type { RecordableEvent } from './record-match-event.ts';
import { generateGroupMatchesUseCase } from './generate-group-matches.ts';
import { recordMatchEventUseCase } from './record-match-event.ts';

interface SimulateGroupStageDeps {
  teamRepository: TeamRepository;
  matchRepository: MatchRepository;
  tournamentRepository: TournamentRepository;
}

interface SimulateGroupStageInput {
  tournamentId: TournamentId;
}

interface CreateTestTeamsInput {
  tournamentId: TournamentId;
}

const GROUP_IDS: GroupId[] = ['A', 'B'];

const randomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const pickRandom = <T>(items: T[]): T | undefined => {
  if (items.length === 0) {
    return undefined;
  }
  const index = randomInt(0, items.length - 1);
  return items[index];
};

const buildPlayers = (teamId: string, label: string, createdAt: Date, playersPerTeam: number): Player[] => {
  return Array.from({ length: playersPerTeam }).map((_, idx) => ({
    id: crypto.randomUUID(),
    teamId,
    fullName: `${label} Jugador ${idx + 1}`,
    displayName: `${label.split(' ')[0]} ${idx + 1}`,
    number: idx + 1,
    createdAt,
  }));
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

// ─── Create test teams only (dev-only) ──────────────────────────────
export const createTestTeamsUseCase = ({
  teamRepository,
  tournamentRepository,
}: Pick<SimulateGroupStageDeps, 'teamRepository' | 'tournamentRepository'>) => async ({ tournamentId }: CreateTestTeamsInput) => {
  const tournament = await tournamentRepository.findById(tournamentId);
  const now = new Date();
  const teamCreationPromises: Array<Promise<void>> = [];
  const configuredGroups = tournament?.groups
    .map((group) => group.id)
    .filter((groupId): groupId is GroupId => groupId === 'A' || groupId === 'B');
  const groupIds = configuredGroups && configuredGroups.length > 0
    ? Array.from(new Set(configuredGroups))
    : GROUP_IDS;
  const playersPerTeam = Math.max(1, tournament?.config.playerRegistrationLimit ?? 23);
  const defaultTeamsPerGroup = Math.max(1, Math.floor((tournament?.config.teamsCount ?? 32) / groupIds.length));
  let teamsCreated = 0;

  for (const groupId of groupIds) {
    const groupConfig = tournament?.groups.find((group) => group.id === groupId);
    const teamsPerGroup = Math.max(1, groupConfig?.maxTeams ?? defaultTeamsPerGroup);

    for (let index = 1; index <= teamsPerGroup; index++) {
      const teamLabel = `Grupo ${groupId} Equipo ${index.toString().padStart(2, '0')}`;
      const shortName = `${groupId}${index.toString().padStart(2, '0')}`;
      teamsCreated += 1;

      teamCreationPromises.push((async () => {
        const createdTeam = await teamRepository.create({
          tournamentId,
          name: teamLabel,
          shortName,
          groupId,
          crestUrl: undefined,
          createdAt: now,
          updatedAt: now,
          players: [],
        });

        const players = buildPlayers(createdTeam.id, `${groupId}${index.toString().padStart(2, '0')}`, now, playersPerTeam);
        await teamRepository.update({
          tournamentId,
          teamId: createdTeam.id,
          updates: { players },
        });
      })());
    }
  }

  await Promise.all(teamCreationPromises);

  return { teamsCreated };
};

// ─── Simulate group stage (dev-only) ────────────────────────────────
// Uses existing teams + creates & simulates matches.
// No longer requires the tournament to be empty.
export const simulateGroupStageUseCase = ({
  teamRepository,
  matchRepository,
  tournamentRepository,
}: SimulateGroupStageDeps) => async ({ tournamentId }: SimulateGroupStageInput) => {
  const tournament = await tournamentRepository.findById(tournamentId);
  const configuredGroups = tournament?.groups
    .map((group) => group.id)
    .filter((groupId): groupId is GroupId => groupId === 'A' || groupId === 'B');
  const groupIds = configuredGroups && configuredGroups.length > 0
    ? Array.from(new Set(configuredGroups))
    : GROUP_IDS;
  const matchDurationMinutes = Math.max(20, tournament?.config.matchDuration ?? 60);

  // Build roster lookup from existing teams
  const teamsByGroup = await Promise.all(groupIds.map((groupId) => teamRepository.listByGroup(tournamentId, groupId)));
  const allTeams = teamsByGroup.flat();
  if (allTeams.length === 0) {
    throw new Error('No hay equipos registrados. Primero crea los equipos de prueba.');
  }

  const rosterByTeamId = new Map<string, Player[]>();
  allTeams.forEach((team) => rosterByTeamId.set(team.id, team.players ?? []));

  // Check if matches already exist — if so, simulate on those; otherwise generate new ones
  const existingMatches = await matchRepository.listByTournament(tournamentId);
  let simulatedMatches: Match[];

  if (existingMatches.length > 0) {
    // Only simulate unfinished matches
    simulatedMatches = existingMatches.filter(
      (m) => m.stage.type === 'GROUP' && m.status !== 'FINISHED',
    );
  } else {
    // Generate new group matches
    const now = new Date();
    const generateMatches = generateGroupMatchesUseCase({ matchRepository, teamRepository, tournamentRepository });
    const generatedByGroup = await Promise.all(
      groupIds.map((groupId, index) =>
        generateMatches({
          tournamentId,
          groupId,
          startDate: new Date(now.getTime() + index * 24 * 60 * 60 * 1000),
        }),
      ),
    );
    simulatedMatches = generatedByGroup.flat();
  }

  if (simulatedMatches.length === 0) {
    return { teamsCreated: 0, matchesSimulated: 0 };
  }

  const recordEvent = recordMatchEventUseCase({ matchRepository, tournamentRepository, teamRepository });

  const CONCURRENCY = 20;

  const runMatchSimulation = async (match: Match) => {
    const homeRoster = rosterByTeamId.get(match.homeTeamId) ?? [];
    const awayRoster = rosterByTeamId.get(match.awayTeamId) ?? [];

    const eventsToRecord: Array<{ minute: number; event: RecordableEvent }> = [
      { minute: 0, event: { type: 'MATCH_STARTED', timeMinute: 0 } },
    ];

    const homeGoals = randomInt(0, 5);
    const awayGoals = randomInt(0, 5);

    const goalMinutes = new Set<number>();
    const generateMinute = () => {
      let minute = randomInt(1, matchDurationMinutes);
      while (goalMinutes.has(minute)) {
        minute = randomInt(1, matchDurationMinutes);
      }
      goalMinutes.add(minute);
      return minute;
    };

    for (let i = 0; i < homeGoals; i++) {
      const minute = generateMinute();
      eventsToRecord.push({
        minute,
        event: buildSimulatedGoalEvent(homeRoster, match.homeTeamId, minute),
      });
    }

    for (let i = 0; i < awayGoals; i++) {
      const minute = generateMinute();
      eventsToRecord.push({
        minute,
        event: buildSimulatedGoalEvent(awayRoster, match.awayTeamId, minute),
      });
    }

    const cardEvents = randomInt(0, 3);
    for (let i = 0; i < cardEvents; i++) {
      const minute = randomInt(5, Math.max(5, matchDurationMinutes - 2));
      const teamId = Math.random() < 0.5 ? match.homeTeamId : match.awayTeamId;
      const roster = teamId === match.homeTeamId ? homeRoster : awayRoster;
      const cardEvent = buildSimulatedCardEvent(roster, teamId, minute);

      if (cardEvent) {
        eventsToRecord.push({ minute, event: cardEvent });
      }
    }

    eventsToRecord.push({
      minute: matchDurationMinutes,
      event: { type: 'MATCH_ENDED', timeMinute: matchDurationMinutes },
    });

    eventsToRecord
      .sort((a, b) => a.minute - b.minute)
      .forEach((item, index) => {
        if (index > 0 && item.minute === eventsToRecord[index - 1].minute) {
          item.event.timeAdditional = (item.event.timeAdditional ?? 0) + 1;
        }
      });

    for (const simulated of eventsToRecord) {
      await recordEvent({
        matchId: match.id,
        recordedBy: 'simulation-system',
        skipNotifications: true,
        event: {
          ...simulated.event,
          timeMinute: simulated.minute,
        },
      });
    }
  };

  for (let i = 0; i < simulatedMatches.length; i += CONCURRENCY) {
    const batch = simulatedMatches.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((m) => runMatchSimulation(m)));
  }

  return {
    teamsCreated: 0,
    matchesSimulated: simulatedMatches.length,
  };
};
