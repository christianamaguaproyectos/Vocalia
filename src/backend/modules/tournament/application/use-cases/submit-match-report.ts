import type { MatchReport } from '../../domain/entities/match.ts';
import type { MatchRepository } from '../../domain/repositories/index.ts';
import type { MatchId, TournamentId } from '../../domain/value-objects/identifiers.ts';

export interface SubmitMatchReportDeps {
  matchRepository: MatchRepository;
}

export interface SubmitMatchReportInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  notes: string;
  submittedBy: string;
}

export const submitMatchReportUseCase = ({ matchRepository }: SubmitMatchReportDeps) => async (
  input: SubmitMatchReportInput,
): Promise<MatchReport> => {
  const match = await matchRepository.findById(input.matchId, input.tournamentId);

  if (!match) {
    throw new Error('No se encontró el partido.');
  }

  if (match.status !== 'FINISHED') {
    throw new Error('Solo puedes registrar el informe cuando el partido ha finalizado.');
  }

  const normalizedNotes = input.notes.trim();
  if (!normalizedNotes) {
    throw new Error('El informe del árbitro no puede estar vacío.');
  }

  const report: MatchReport = {
    submittedBy: input.submittedBy,
    submittedAt: new Date(),
    notes: normalizedNotes,
  };

  await matchRepository.update(match.id, {
    tournamentId: match.tournamentId,
    report,
  });

  return report;
};
