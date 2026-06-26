import { APP_CONFIG } from '../../core/config/app-config.ts';
import { useTeams, useMatches } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { PlayerStatsSection } from '../../backend/modules/tournament/presentation/components/index.ts';

export const StatsPage = () => {
    const tournamentId = APP_CONFIG.defaultTournamentId;
    const { teams } = useTeams(tournamentId);
    const { matches } = useMatches(tournamentId);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold text-gray-900">Estadísticas</h1>
                <p className="text-gray-600">Goleadores, tarjetas y rendimiento individual de los jugadores</p>
            </div>
            <PlayerStatsSection tournamentId={tournamentId} teams={teams} matches={matches} />
        </div>
    );
};
