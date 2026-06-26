import { useMemo } from 'react';
import { useTeams, useMatches, useTournament } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { calculateGroupStandings } from '../../backend/modules/tournament/application/services/index.ts';
import { APP_CONFIG } from '../../core/config/app-config.ts';

import { StandingsTable } from '../components/StandingsTable.tsx';

export const StandingsPage = () => {
  const tournamentId = APP_CONFIG.defaultTournamentId;
  const { tournament } = useTournament(tournamentId);
  const { teams } = useTeams(tournamentId);
  const { matches, isLoading } = useMatches(tournamentId);
  const qualifiedCount = tournament?.config.qualifiedCount ?? 8;

  const standingsGroupA = useMemo(() => {
    if (!tournament) {
      return [];
    }
    const groupATeams = teams.filter((t) => t.groupId === 'A');
    return calculateGroupStandings({ teams: groupATeams, matches, config: tournament.config });
  }, [teams, matches, tournament]);

  const standingsGroupB = useMemo(() => {
    if (!tournament) {
      return [];
    }
    const groupBTeams = teams.filter((t) => t.groupId === 'B');
    return calculateGroupStandings({ teams: groupBTeams, matches, config: tournament.config });
  }, [teams, matches, tournament]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Cargando tabla de posiciones...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Tabla de posiciones</h1>
        <p className="text-gray-600">
          Clasifican los primeros {qualifiedCount} equipos de cada grupo según la configuración del torneo
        </p>
      </div>

      <div className="space-y-6">
        <StandingsTable standings={standingsGroupA} groupName="Grupo A" teams={teams} qualifiedCount={qualifiedCount} />
        <StandingsTable standings={standingsGroupB} groupName="Grupo B" teams={teams} qualifiedCount={qualifiedCount} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Leyenda</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-green-50"></div>
              <span className="text-gray-600">Posiciones de clasificación (1-{qualifiedCount})</span>
            </div>
          </div>
          <div className="space-y-1 text-xs text-gray-500">
            <div>PJ = Partidos Jugados</div>
            <div>G = Ganados, E = Empatados, P = Perdidos</div>
            <div>GF = Goles a Favor, GC = Goles en Contra</div>
            <div>DG = Diferencia de Goles, PTS = Puntos</div>
          </div>
        </div>
      </div>
    </div>
  );
};
