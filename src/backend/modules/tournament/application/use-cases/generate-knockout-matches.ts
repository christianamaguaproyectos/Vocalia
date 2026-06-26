import type { GroupId, TournamentId } from '../../domain/value-objects/index.ts';
import type { MatchRepository, TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';
import { initialScore } from '../../domain/value-objects/score.ts';
import { calculateGroupStandings } from '../services/index.ts';

export interface GenerateKnockoutMatchesDeps {
  matchRepository: MatchRepository;
  teamRepository: TeamRepository;
  tournamentRepository: TournamentRepository;
}

export interface GenerateKnockoutMatchesInput {
  tournamentId: TournamentId;
  startDate?: Date;
}

const MATCH_SPACING_HOURS = 3;
const GROUPS: GroupId[] = ['A', 'B'];

type StartingKnockoutStage = 'ROUND_OF_16' | 'QUARTER_FINAL' | 'SEMI_FINAL' | 'FINAL';

const STAGE_NODE_IDS: Record<StartingKnockoutStage, string[]> = {
  ROUND_OF_16: ['R16_1', 'R16_2', 'R16_3', 'R16_4', 'R16_5', 'R16_6', 'R16_7', 'R16_8'],
  QUARTER_FINAL: ['QF_1', 'QF_2', 'QF_3', 'QF_4'],
  SEMI_FINAL: ['SF_1', 'SF_2'],
  FINAL: ['FINAL_1'],
};

const resolveStartingStage = (qualifiedPerGroup: number): StartingKnockoutStage => {
  if (qualifiedPerGroup === 8) {
    return 'ROUND_OF_16';
  }

  if (qualifiedPerGroup === 4) {
    return 'QUARTER_FINAL';
  }

  if (qualifiedPerGroup === 2) {
    return 'SEMI_FINAL';
  }

  if (qualifiedPerGroup === 1) {
    return 'FINAL';
  }

  throw new Error('El campo qualifiedCount debe ser 1, 2, 4 u 8 para generar una llave válida.');
};

export const generateKnockoutMatchesUseCase = ({
  matchRepository,
  teamRepository,
  tournamentRepository,
}: GenerateKnockoutMatchesDeps) => async ({ tournamentId, startDate }: GenerateKnockoutMatchesInput) => {
  const tournament = await tournamentRepository.findById(tournamentId);
  if (!tournament) {
    throw new Error('No se encontró el torneo.');
  }

  const qualifiedPerGroup = tournament.config.qualifiedCount;
  const maxQualifiedPerGroupByTeams = Math.floor(tournament.config.teamsCount / GROUPS.length);
  if (qualifiedPerGroup > maxQualifiedPerGroupByTeams) {
    throw new Error(
      `La configuración es inválida: qualifiedCount (${qualifiedPerGroup}) supera el máximo posible por grupo (${maxQualifiedPerGroupByTeams}) según teamsCount.`,
    );
  }

  const startingStage = resolveStartingStage(qualifiedPerGroup);
  const stageNodeIds = STAGE_NODE_IDS[startingStage];

  const now = new Date();
  const [groupATeams, groupBTeams, existingMatches] = await Promise.all([
    teamRepository.listByGroup(tournamentId, 'A'),
    teamRepository.listByGroup(tournamentId, 'B'),
    matchRepository.listByTournament(tournamentId),
  ]);

  const existingKnockout = existingMatches.filter((match) => match.stage.type === 'KNOCKOUT');

  if (existingKnockout.length > 0) {
    throw new Error('La fase eliminatoria ya fue generada.');
  }

  const groupStageMatches = existingMatches.filter((match) => match.stage.type === 'GROUP');
  if (groupStageMatches.length === 0) {
    throw new Error('No se puede generar octavos sin partidos de fase de grupos.');
  }

  for (const groupId of GROUPS) {
    const expectedGroup = `GROUP_${groupId}`;
    const hasGroupMatches = groupStageMatches.some((match) => match.stage.group === expectedGroup);
    if (!hasGroupMatches) {
      throw new Error(`No se puede cerrar la fase: faltan partidos del Grupo ${groupId}.`);
    }
  }

  const pendingGroupMatches = groupStageMatches.filter((match) => match.status !== 'FINISHED');
  if (pendingGroupMatches.length > 0) {
    throw new Error(
      `No se puede generar octavos: hay ${pendingGroupMatches.length} partido(s) de fase de grupos sin cerrar (MATCH_ENDED).`,
    );
  }

  const standingsByGroup: Record<GroupId, ReturnType<typeof calculateGroupStandings>> = {
    A: calculateGroupStandings({ teams: groupATeams, matches: existingMatches, config: tournament.config }),
    B: calculateGroupStandings({ teams: groupBTeams, matches: existingMatches, config: tournament.config }),
  };

  for (const groupId of GROUPS) {
    if (standingsByGroup[groupId].length < qualifiedPerGroup) {
      throw new Error(`Se requieren al menos ${qualifiedPerGroup} equipos clasificados en el Grupo ${groupId}.`);
    }
  }

  const topA = standingsByGroup.A.slice(0, qualifiedPerGroup);
  const topB = standingsByGroup.B.slice(0, qualifiedPerGroup);

  // Pairings follow the seeding rule: 1A vs N_B, 2A vs (N-1)_B, etc.
  const bottomB = topB.slice(0, qualifiedPerGroup).reverse();

  const createdMatches = [];
  // If no startDate provided, continue from the last group match
  const lastGroupMatchDate = groupStageMatches
    .reduce((latest, m) => (m.scheduledAt > latest ? m.scheduledAt : latest), new Date(0));
  const resolvedStart = startDate ?? new Date(lastGroupMatchDate.getTime() + MATCH_SPACING_HOURS * 60 * 60 * 1000);
  let currentDate = new Date(resolvedStart);

  for (let index = 0; index < qualifiedPerGroup; index++) {
    const homeTeamId = topA[index].teamId;
    const awayTeamId = bottomB[index].teamId;
    const bracketNodeId = stageNodeIds[index];

    if (!bracketNodeId) {
      throw new Error('No se encontró un nodo de bracket para la configuración actual de clasificados.');
    }

    const match = await matchRepository.create({
      tournamentId,
      stage: {
        type: 'KNOCKOUT',
        knockout: startingStage,
      },
      homeTeamId,
      awayTeamId,
      bracketNodeId,
      scheduledAt: new Date(currentDate),
      status: 'SCHEDULED',
      score: initialScore(),
      createdAt: now,
    });

    createdMatches.push(match);
    currentDate = new Date(currentDate.getTime() + MATCH_SPACING_HOURS * 60 * 60 * 1000);
  }

  return createdMatches;
};
