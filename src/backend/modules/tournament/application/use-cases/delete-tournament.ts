import type { TournamentId } from '../../domain/value-objects/index.ts';
import type { TournamentRepository } from '../../domain/repositories/index.ts';

export interface DeleteTournamentUseCaseDeps {
  tournamentRepository: TournamentRepository;
}

export const deleteTournamentUseCase = ({ tournamentRepository }: DeleteTournamentUseCaseDeps) => async (
  tournamentId: TournamentId,
): Promise<void> => {
  await tournamentRepository.delete(tournamentId);
};
