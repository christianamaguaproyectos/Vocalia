import type { MatchOfficials, RefereeInfo } from '../../domain/entities/match.ts';
import type { MatchRepository } from '../../domain/repositories/index.ts';
import type { MatchId, TournamentId } from '../../domain/value-objects/identifiers.ts';

export interface UpdateMatchOfficialsDeps {
  matchRepository: MatchRepository;
}

export interface UpdateMatchOfficialsInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  referee: RefereeInfo | null;
}

const sanitizeReferee = (referee: RefereeInfo): RefereeInfo => ({
  fullName: referee.fullName.trim(),
  documentId: referee.documentId?.trim() || '',
  phoneNumber: referee.phoneNumber?.trim() || '',
  notes: referee.notes?.trim() || '',
});

export const updateMatchOfficialsUseCase = ({ matchRepository }: UpdateMatchOfficialsDeps) => async (
  input: UpdateMatchOfficialsInput,
): Promise<MatchOfficials | null> => {
  const match = await matchRepository.findById(input.matchId, input.tournamentId);

  if (!match) {
    throw new Error('No se encontró el partido.');
  }

  let nextOfficials: MatchOfficials | null = null;

  if (input.referee) {
    const normalized = sanitizeReferee(input.referee);
    if (!normalized.fullName) {
      throw new Error('El nombre del árbitro es obligatorio.');
    }

    nextOfficials = {
      ...(match.officials ?? {}),
      referee: normalized,
    };
  }

  await matchRepository.update(match.id, {
    tournamentId: match.tournamentId,
    officials: nextOfficials,
  });

  return nextOfficials;
};
