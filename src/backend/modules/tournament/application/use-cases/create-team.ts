import type { Player } from '../../domain/entities/index.ts';
import type { GroupId, TournamentId } from '../../domain/value-objects/index.ts';
import type { TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';

export interface CreateTeamInput {
  tournamentId: TournamentId;
  name: string;
  shortName?: string;
  representativeEmails?: string[];
  groupId: GroupId;
  crestUrl?: string;
  players?: Array<Omit<Player, 'id' | 'teamId' | 'createdAt'>>;
}

export interface CreateTeamUseCaseDeps {
  teamRepository: TeamRepository;
  tournamentRepository: TournamentRepository;
}

export const createTeamUseCase = ({ teamRepository, tournamentRepository }: CreateTeamUseCaseDeps) => async (
  input: CreateTeamInput,
) => {
  const normalizedName = input.name.trim();
  if (!normalizedName) {
    throw new Error('El nombre del equipo es obligatorio');
  }

  const shortName = input.shortName?.trim().toUpperCase();
  const representativeEmails = (input.representativeEmails ?? [])
    .map((email) => email.trim().toLowerCase())
    .filter((email, index, source) => email.length > 0 && source.indexOf(email) === index);

  const tournament = await tournamentRepository.findById(input.tournamentId);
  if (!tournament) {
    throw new Error('No se encontro el torneo');
  }

  const groupConfig = tournament.groups.find((group) => group.id === input.groupId);
  if (!groupConfig) {
    throw new Error('El grupo seleccionado no esta configurado para este torneo');
  }

  const teamsByGroup = await Promise.all(
    tournament.groups.map((group) => teamRepository.listByGroup(input.tournamentId, group.id)),
  );
  const totalTeamsRegistered = teamsByGroup.reduce((sum, teamsInGroup) => sum + teamsInGroup.length, 0);

  if (totalTeamsRegistered >= tournament.config.teamsCount) {
    throw new Error(`El torneo ya alcanzó el límite de ${tournament.config.teamsCount} equipos.`);
  }

  const existingTeams = await teamRepository.listByGroup(input.tournamentId, input.groupId);
  if (typeof groupConfig.maxTeams === 'number' && existingTeams.length >= groupConfig.maxTeams) {
    throw new Error(`El grupo ${groupConfig.name} ya esta completo`);
  }

  const duplicatedName = existingTeams.some((team) => team.name.toLowerCase() === normalizedName.toLowerCase());
  if (duplicatedName) {
    throw new Error(`Ya existe un equipo llamado ${normalizedName} en este grupo`);
  }

  const now = new Date();

  const createdTeam = await teamRepository.create({
    tournamentId: input.tournamentId,
    name: normalizedName,
    shortName,
    representativeEmails,
    groupId: input.groupId,
    crestUrl: input.crestUrl,
    createdAt: now,
    players: [],
  });

  return createdTeam;
};
