import type { Match } from '../../domain/entities/index.ts';
import type { GroupId, TournamentId } from '../../domain/value-objects/index.ts';
import type { MatchRepository, TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';
import { initialScore } from '../../domain/value-objects/score.ts';

export interface GenerateGroupMatchesUseCaseDeps {
  matchRepository: MatchRepository;
  teamRepository: TeamRepository;
  tournamentRepository: TournamentRepository;
}

export interface GenerateGroupMatchesInput {
  tournamentId: TournamentId;
  groupId: GroupId;
  startDate?: Date;
  /** Delete existing SCHEDULED matches for this group and regenerate. Blocked if any match has started. */
  forceRegenerate?: boolean;
  /** If the group has an odd number of teams, this team will receive the bye in the first jornada. */
  byeTeamIdInFirstRound?: string;
}

const COURTS = ['Cancha A', 'Cancha B', 'Cancha C', 'Cancha D'] as const;
const SATURDAY_SLOTS = [8, 9, 10, 11, 12]; // hours in 24h

/**
 * Two courts per group, alternating each week so courts rotate between groups.
 * Even weeks: Group A → A,B | Group B → C,D
 * Odd weeks:  Group A → C,D | Group B → A,B
 */
const getCourtsForGroupWeek = (groupId: GroupId, weekIndex: number): [string, string] => {
  const isEvenWeek = weekIndex % 2 === 0;
  if (groupId === 'A') {
    return isEvenWeek ? [COURTS[0], COURTS[1]] : [COURTS[2], COURTS[3]];
  }
  return isEvenWeek ? [COURTS[2], COURTS[3]] : [COURTS[0], COURTS[1]];
};

const getNextSaturday = (from: Date): Date => {
  const d = new Date(from);
  d.setHours(8, 0, 0, 0);
  const day = d.getDay();
  const daysUntilSat = day === 6 ? 0 : (6 - day + 7) % 7;
  d.setDate(d.getDate() + daysUntilSat);
  return d;
};

/**
 * Generates round-robin rounds. Each element is one jornada (one Saturday).
 * Teams in an odd-sized group get a BYE once — never two consecutive byes.
 *
 * Standard Berger/circle rotation: fix position 0, rotate the rest clockwise.
 */
const generateRoundRobinRounds = <T extends { id: string }>(teams: T[]): Array<Array<[T, T]>> => {
  const rounds: Array<Array<[T, T]>> = [];
  const n = teams.length;

  if (n < 2) {
    return [];
  }

  const teamsCopy = [...teams];
  if (n % 2 !== 0) {
    teamsCopy.push({ id: 'BYE' } as T);
  }

  const totalRounds = teamsCopy.length - 1;
  const matchesPerRound = teamsCopy.length / 2;

  for (let round = 0; round < totalRounds; round++) {
    const roundMatches: Array<[T, T]> = [];

    for (let match = 0; match < matchesPerRound; match++) {
      const home = teamsCopy[match];
      const away = teamsCopy[teamsCopy.length - 1 - match];

      if (home.id !== 'BYE' && away.id !== 'BYE') {
        roundMatches.push([home, away]);
      }
    }

    rounds.push(roundMatches);

    // Rotate: keep position 0 fixed, shift the rest
    const lastTeam = teamsCopy.pop()!;
    teamsCopy.splice(1, 0, lastTeam);
  }

  return rounds;
};

export const generateGroupMatchesUseCase = ({
  matchRepository,
  teamRepository,
  tournamentRepository,
}: GenerateGroupMatchesUseCaseDeps) => async ({ tournamentId, groupId, startDate = new Date(), forceRegenerate = false, byeTeamIdInFirstRound }: GenerateGroupMatchesInput) => {
  const tournament = await tournamentRepository.findById(tournamentId);
  if (!tournament) {
    throw new Error('No se encontro el torneo');
  }

  const teams = await teamRepository.listByGroup(tournamentId, groupId);
  if (teams.length < 2) {
    throw new Error('Se requieren al menos 2 equipos para generar el calendario');
  }

  const existingMatches = await matchRepository.listByTournament(tournamentId);
  const groupMatches = existingMatches.filter(
    (match) => match.stage.type === 'GROUP' && match.stage.group === `GROUP_${groupId}`,
  );

  if (groupMatches.length > 0) {
    if (!forceRegenerate) {
      throw new Error(`Ya existe un calendario generado para el Grupo ${groupId}`);
    }

    const hasStarted = groupMatches.some((m) => m.status !== 'SCHEDULED');
    if (hasStarted) {
      throw new Error(`No se puede regenerar el Grupo ${groupId}: hay partidos que ya iniciaron o finalizaron.`);
    }

    await Promise.all(groupMatches.map((m) => matchRepository.delete(m.id, tournamentId)));
  }

  // If a specific team must rest in the first jornada, move it to index 0.
  // In Berger rotation the team at position 0 always gets the BYE in round 0.
  if (byeTeamIdInFirstRound && teams.length % 2 !== 0) {
    const idx = teams.findIndex((t) => t.id === byeTeamIdInFirstRound);
    if (idx > 0) {
      const [byeTeam] = teams.splice(idx, 1);
      teams.unshift(byeTeam);
    }
  }

  const rounds = generateRoundRobinRounds(teams);
  const createdMatches: Match[] = [];
  const now = new Date();

  let saturday = getNextSaturday(startDate);

  for (let weekIndex = 0; weekIndex < rounds.length; weekIndex++) {
    const roundMatches = rounds[weekIndex];
    const courts = getCourtsForGroupWeek(groupId, weekIndex);

    // Within a jornada: interleave matches across the 2 courts.
    // Base hour rotates +1 each week so teams don't always play at the same time.
    // match 0 → court[0] @ baseHour
    // match 1 → court[1] @ baseHour
    // match 2 → court[0] @ baseHour+1
    // match 3 → court[1] @ baseHour+1  ...etc.
    for (let matchIndex = 0; matchIndex < roundMatches.length; matchIndex++) {
      const [home, away] = roundMatches[matchIndex];

      const courtIndex = matchIndex % courts.length;
      const slotOffset = Math.floor(matchIndex / courts.length);
      const hourIndex = (weekIndex + slotOffset) % SATURDAY_SLOTS.length;
      const slotHour = SATURDAY_SLOTS[hourIndex];
      const venue = courts[courtIndex];

      const scheduledAt = new Date(saturday);
      scheduledAt.setHours(slotHour, 0, 0, 0);

      const match = await matchRepository.create({
        tournamentId,
        stage: {
          type: 'GROUP',
          group: `GROUP_${groupId}` as 'GROUP_A' | 'GROUP_B',
        },
        homeTeamId: home.id,
        awayTeamId: away.id,
        scheduledAt,
        venue,
        status: 'SCHEDULED',
        score: initialScore(),
        createdAt: now,
      });

      createdMatches.push(match);
    }

    // Each jornada occupies its own Saturday
    const next = new Date(saturday);
    next.setDate(next.getDate() + 7);
    saturday = next;
  }

  return createdMatches;
};
