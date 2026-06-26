import type { MatchRepository } from '../../domain/repositories/index.ts';
import type { MatchId, TournamentId } from '../../domain/value-objects/identifiers.ts';
import type { VocalReport } from '../../domain/entities/match.ts';

export interface SubmitVocalReportDeps {
  matchRepository: MatchRepository;
}

export interface SubmitVocalReportInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  notes: string;
  submittedBy: string;
}

export const submitVocalReportUseCase = ({ matchRepository }: SubmitVocalReportDeps) => async (
  input: SubmitVocalReportInput,
): Promise<VocalReport> => {
  const match = await matchRepository.findById(input.matchId, input.tournamentId);

  if (!match) {
    throw new Error('No se encontró el partido.');
  }

  if (match.status !== 'FINISHED') {
    throw new Error('El reporte del vocal solo puede registrarse cuando el partido ha finalizado.');
  }

  const normalizedNotes = input.notes.trim();
  if (!normalizedNotes) {
    throw new Error('El reporte del vocal no puede estar vacío.');
  }

  const report: VocalReport = {
    submittedBy: input.submittedBy,
    submittedAt: new Date(),
    notes: normalizedNotes,
  };

  await matchRepository.update(match.id, {
    tournamentId: match.tournamentId,
    vocalReport: report,
  });

  return report;
};
