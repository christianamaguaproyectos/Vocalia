import type { TeamMatchLineup, MatchLineups } from '../../domain/entities/match.ts';
import type { MatchRepository, TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';
import type { MatchId, PlayerId, TournamentId } from '../../domain/value-objects/identifiers.ts';

export interface UpdateMatchLineupDeps {
  matchRepository: MatchRepository;
  teamRepository: TeamRepository;
  tournamentRepository: TournamentRepository;
}

export interface UpdateMatchLineupInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  side: 'home' | 'away';
  starters: PlayerId[];
  substitutes: PlayerId[];
  unavailable: PlayerId[];
  confirmedBy: string;
}

const ensureUniqueList = (values: PlayerId[]): PlayerId[] => Array.from(new Set(values));

const ensureNoOverlap = (lists: PlayerId[][]): void => {
  const seen = new Set<PlayerId>();

  lists.forEach((list) => {
    list.forEach((playerId) => {
      if (seen.has(playerId)) {
        throw new Error('Un jugador no puede estar en dos categorías diferentes para el mismo partido.');
      }
      seen.add(playerId);
    });
  });
};

export const updateMatchLineupUseCase = ({ matchRepository, teamRepository, tournamentRepository }: UpdateMatchLineupDeps) => async (
  input: UpdateMatchLineupInput,
): Promise<MatchLineups> => {
  // Forzamos lectura desde el servidor (no caché) para asegurar que las lineups ya
  // guardadas (home o away) estén presentes al hacer el merge. Sin esto, guardar
  // una alineación inmediatamente después de otra devuelve la versión cacheada sin
  // la primera y el merge la sobrescribe, borrando la alineación anterior.
  const match = await matchRepository.findById(input.matchId, input.tournamentId, { forceServer: true });

  if (!match) {
    throw new Error('No se encontró el partido.');
  }

  const teamId = input.side === 'home' ? match.homeTeamId : match.awayTeamId;
  const team = await teamRepository.findById({ tournamentId: match.tournamentId, teamId });

  if (!team) {
    throw new Error('No se encontró el equipo para esta alineación.');
  }

  const tournament = await tournamentRepository.findById(match.tournamentId);
  const minStarters = Math.max(1, tournament?.config.minPlayersToStart ?? 5);
  const maxStarters = Math.max(minStarters, tournament?.config.playersOnField ?? 7);

  const roster = new Map(team.players?.map((player) => [player.id, player]));
  if (roster.size === 0) {
    throw new Error('El equipo no tiene jugadores registrados.');
  }

  const starters = ensureUniqueList(input.starters.filter(Boolean));
  const substitutes = ensureUniqueList(input.substitutes.filter(Boolean));
  const unavailable = ensureUniqueList(input.unavailable.filter(Boolean));

  if (starters.length < minStarters) {
    throw new Error(`Debes seleccionar al menos ${minStarters} titulares.`);
  }

  if (starters.length > maxStarters) {
    throw new Error(`No puedes alinear más de ${maxStarters} titulares.`);
  }

  ensureNoOverlap([starters, substitutes, unavailable]);

  starters.forEach((playerId) => {
    if (!roster.has(playerId)) {
      throw new Error('Uno de los titulares no pertenece al equipo.');
    }
  });

  [...substitutes, ...unavailable].forEach((playerId) => {
    if (!roster.has(playerId)) {
      throw new Error('Uno de los jugadores seleccionados no pertenece al equipo.');
    }
  });

  const lineup: TeamMatchLineup = {
    starters,
    substitutes,
    unavailable,
    confirmedBy: input.confirmedBy,
    confirmedAt: new Date(),
  };

  const nextLineups: MatchLineups = {
    ...(match.lineups ?? {}),
    [input.side]: lineup,
  };

  await matchRepository.update(match.id, {
    tournamentId: match.tournamentId,
    lineups: nextLineups,
  });

  return nextLineups;
};
