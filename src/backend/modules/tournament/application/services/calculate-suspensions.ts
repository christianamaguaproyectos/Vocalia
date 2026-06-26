import type { Match } from '../../domain/entities/match.ts';
import type { PlayerId, TeamId } from '../../domain/value-objects/identifiers.ts';
import type { CardEvent } from '../../domain/entities/match-event.ts';
import type { TournamentConfig } from '../../domain/entities/tournament.ts';

export interface PlayerSuspensionStatus {
    suspended: boolean;
    reason?: string;
}

/**
 * Calculates automatic suspensions for a team's players based on match history.
 * Rules are configurable from TournamentConfig:
 * - directRedSuspensionDays
 * - yellowCardsForSuspension
 * - accumulatedYellowsResetStage
 * 
 * @param teamId Team ID
 * @param playersIds Array of player IDs to check
 * @param targetMatchId Optional. If provided, returns the suspension status specifically for this match (ignoring events in this match and after).
 * @returns Map of PlayerId to their suspension status for the NEXT upcoming match
 */
export const calculatePlayerSuspensions = (
    teamId: TeamId,
    playersIds: PlayerId[],
    matches: Match[],
    targetMatchId?: string,
    config?: Pick<TournamentConfig, 'yellowCardsForSuspension' | 'directRedSuspensionDays' | 'accumulatedYellowsResetStage'>,
): Map<PlayerId, PlayerSuspensionStatus> => {
    const yellowCardsForSuspension = Math.max(1, config?.yellowCardsForSuspension ?? 3);
    const directRedSuspensionDays = Math.max(1, config?.directRedSuspensionDays ?? 1);
    const accumulatedYellowsResetStage = config?.accumulatedYellowsResetStage ?? 'NEVER';

    // Sort matches chronologically to process events in order
    const teamMatches = matches
        .filter(m => m.homeTeamId === teamId || m.awayTeamId === teamId)
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    const suspensionData = new Map<PlayerId, {
        activeSuspensions: number;
        accumulatedYellows: number;
        reasons: string[];
    }>();

    let hasResetAccumulatedYellows = false;

    playersIds.forEach(id => suspensionData.set(id, { activeSuspensions: 0, accumulatedYellows: 0, reasons: [] }));

    for (const match of teamMatches) {
        if (targetMatchId && match.id === targetMatchId) {
            // Reached target match. Current activeSuspensions apply to it.
            break;
        }

        if (
            !hasResetAccumulatedYellows &&
            accumulatedYellowsResetStage !== 'NEVER' &&
            match.stage.type === 'KNOCKOUT' &&
            match.stage.knockout === accumulatedYellowsResetStage
        ) {
            suspensionData.forEach((data) => {
                data.accumulatedYellows = 0;
            });
            hasResetAccumulatedYellows = true;
        }

        // 1. Consume suspensions if the match was played
        // A player serves 1 match of their suspension for every match their team plays
        const isMatchPlayed = match.status === 'FINISHED' || match.status === 'LIVE';

        if (isMatchPlayed) {
            suspensionData.forEach((data) => {
                if (data.activeSuspensions > 0) {
                    data.activeSuspensions -= 1;
                    if (data.activeSuspensions === 0) {
                        data.reasons = []; // Cleared after serving
                    }
                }
            });
        }

        // 2. Add new suspensions from events in this match
        const events = match.events || [];
        const teamCardEvents = events.filter(e => e.type === 'CARD' && e.teamId === teamId) as CardEvent[];

        for (const event of teamCardEvents) {
            const data = suspensionData.get(event.playerId);
            if (!data) continue;

            if (event.cardType === 'RED') {
                data.activeSuspensions += directRedSuspensionDays;
                data.reasons.push(`Roja Directa (${directRedSuspensionDays})`);
            } else if (event.cardType === 'DOUBLE_YELLOW') {
                data.activeSuspensions += 1;
                data.reasons.push('Doble Amarilla');
            } else if (event.cardType === 'YELLOW') {
                data.accumulatedYellows += 1;
                if (data.accumulatedYellows >= yellowCardsForSuspension) {
                    data.activeSuspensions += 1;
                    data.reasons.push(`Acumulación ${yellowCardsForSuspension} Amarillas`);
                    data.accumulatedYellows = 0; // Reset accumulation after suspension
                }
            }
        }
    }

    // 3. Build the final result
    const result = new Map<PlayerId, PlayerSuspensionStatus>();
    suspensionData.forEach((data, playerId) => {
        result.set(playerId, {
            suspended: data.activeSuspensions > 0,
            reason: data.activeSuspensions > 0 ? data.reasons.join(', ') : undefined
        });
    });

    return result;
};
