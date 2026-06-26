import type { TournamentStatus } from '../../domain/entities/index.ts';
import type { TournamentId } from '../../domain/value-objects/index.ts';
import type { TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';

export interface StartTournamentUseCaseDeps {
  teamRepository: TeamRepository;
  tournamentRepository: TournamentRepository;
}

export interface StartTournamentInput {
  tournamentId: TournamentId;
  minimumTeamsPerGroup?: number;
  nextStatus?: TournamentStatus;
}

export const startTournamentUseCase = ({
  teamRepository,
  tournamentRepository,
}: StartTournamentUseCaseDeps) => async ({
  tournamentId,
  minimumTeamsPerGroup = 1,
  nextStatus = 'READY',
}: StartTournamentInput) => {
  const tournament = await tournamentRepository.findById(tournamentId);
  if (!tournament) {
    throw new Error('No se encontro el torneo');
  }

  if (tournament.status !== 'DRAFT') {
    throw new Error('El torneo ya se encuentra en estado activo');
  }

  if (tournament.groups.length === 0) {
    throw new Error('El torneo no tiene grupos configurados');
  }

  const groupsWithTeams = await Promise.all(
    tournament.groups.map(async (group) => {
      const teams = await teamRepository.listByGroup(tournamentId, group.id);
      return {
        groupName: group.name,
        teamCount: teams.length,
      };
    }),
  );

  const missingGroups = groupsWithTeams.filter(({ teamCount }) => teamCount < minimumTeamsPerGroup);
  if (missingGroups.length > 0) {
    const groupNames = missingGroups.map(({ groupName }) => groupName).join(', ');
    throw new Error(`Faltan equipos registrados en: ${groupNames}`);
  }

  await tournamentRepository.update(tournamentId, { status: nextStatus });

  return { tournamentId, status: nextStatus };
};
