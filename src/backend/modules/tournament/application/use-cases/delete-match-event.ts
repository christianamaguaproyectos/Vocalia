import type { MatchRepository } from '../../domain/repositories/index.ts';
import type { MatchId, TournamentId } from '../../domain/value-objects/index.ts';
import type { MatchEvent } from '../../domain/entities/match-event.ts';
import { revertGoalFromScore } from '../../domain/value-objects/score.ts';

export interface DeleteMatchEventDeps {
  matchRepository: MatchRepository;
}

export interface DeleteMatchEventInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  eventId: string;
  deletedBy: string;
}

const shouldAffectScore = (type: MatchEvent['type']): boolean => {
  return type === 'GOAL' || type === 'OWN_GOAL' || type === 'PENALTY_GOAL';
};

export const deleteMatchEventUseCase = ({ matchRepository }: DeleteMatchEventDeps) => async (
  input: DeleteMatchEventInput,
): Promise<void> => {
  const match = await matchRepository.findById(input.matchId, input.tournamentId);

  if (!match) {
    throw new Error('Match not found');
  }

  const events = await matchRepository.listEvents(match.id, match.tournamentId);
  const eventToDelete = events.find(e => e.id === input.eventId);

  if (!eventToDelete) {
    throw new Error('Event not found');
  }

  // Restrict deletion to non-system events as per safety rules
  const allowedTypes = ['GOAL', 'PENALTY_GOAL', 'OWN_GOAL', 'CARD', 'SUBSTITUTION'];
  if (!allowedTypes.includes(eventToDelete.type)) {
    throw new Error('No está permitido eliminar este tipo de evento.');
  }

  let nextScore = match.score;
  if (shouldAffectScore(eventToDelete.type) && 'teamId' in eventToDelete && eventToDelete.teamId) {
    const period = eventToDelete.period ?? 'REGULAR';
    const scoringSide =
      eventToDelete.type === 'OWN_GOAL'
        ? match.homeTeamId === eventToDelete.teamId
          ? 'away'
          : 'home'
        : match.homeTeamId === eventToDelete.teamId
          ? 'home'
          : 'away';

    if (eventToDelete.type === 'PENALTY_GOAL' && period === 'PENALTY_SHOOTOUT') {
      nextScore = revertGoalFromScore(match.score, scoringSide, period);
    } else if (period !== 'PENALTY_SHOOTOUT' || eventToDelete.type !== 'PENALTY_GOAL') {
      nextScore = revertGoalFromScore(match.score, scoringSide, period);
    }
  }

  await matchRepository.removeEvent(match.id, input.eventId, match.tournamentId);

  if (shouldAffectScore(eventToDelete.type)) {
    await matchRepository.update(match.id, {
      tournamentId: match.tournamentId,
      score: nextScore,
      updatedAt: new Date(),
    });
  }
};
