import { useEffect, useMemo, useState } from 'react';

import type { Match, Team } from '../../domain/entities/index.ts';
import { calculatePlayerStats, type PlayerStatsSummary } from '../../application/services/index.ts';
import { useAppDependencies } from '../../../../../frontend/app/providers/AppDependenciesProvider.tsx';

interface PlayerStatsSectionProps {
  tournamentId: string;
  teams: Team[];
  matches: Match[];
}

export const PlayerStatsSection = ({ tournamentId, teams, matches }: PlayerStatsSectionProps) => {
  const { matchRepository } = useAppDependencies();
  const [stats, setStats] = useState<PlayerStatsSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamLookup = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((team) => map.set(team.id, team));
    return map;
  }, [teams]);

  useEffect(() => {
    let isActive = true;

    const loadStats = async () => {
      if (matches.length === 0) {
        setStats([]);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const eventsPerMatch = await Promise.all(matches.map((match) => matchRepository.listEvents(match.id, match.tournamentId)));
        if (!isActive) {
          return;
        }

        const allEvents = eventsPerMatch.flat();
        const calculated = calculatePlayerStats({ teams, events: allEvents });
        if (!isActive) {
          return;
        }

        setStats(calculated);
      } catch (err) {
        console.error('[PlayerStatsSection] Failed to load player statistics', err);
        if (!isActive) {
          return;
        }
        setError('No se pudieron calcular las estadísticas de jugadores');
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadStats();

    return () => {
      isActive = false;
    };
  }, [matches, matchRepository, teams, tournamentId]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Estadísticas de jugadores</h2>
        <p className="text-sm text-gray-600">
          Resumen acumulado de goles y tarjetas registradas a lo largo del torneo. Se actualiza automáticamente con
          cada evento.
        </p>
      </div>

      {isLoading && (
        <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Calculando estadísticas...
        </div>
      )}

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {!isLoading && !error && stats.length === 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Aún no hay estadísticas disponibles. Registra eventos de partido para comenzar a ver datos.
        </div>
      )}

      {!isLoading && !error && stats.length > 0 && (
        <div className="overflow-x-auto scrollbar-hide rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-xs sm:text-sm">
            <thead className="bg-gray-50">
              <tr className="font-semibold uppercase tracking-wide text-gray-600">
                <th className="px-2 py-2 text-left sm:px-4 sm:py-3">Jugador</th>
                <th className="hidden px-2 py-2 text-left sm:table-cell sm:px-4 sm:py-3">Equipo</th>
                <th className="px-2 py-2 text-center sm:px-4 sm:py-3">Goles</th>
                <th className="px-2 py-2 text-center sm:px-4 sm:py-3">🟡</th>
                <th className="hidden px-2 py-2 text-center sm:table-cell sm:px-4 sm:py-3">Doble 🟡</th>
                <th className="px-2 py-2 text-center sm:px-4 sm:py-3">🔴</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.map((stat) => {
                const team = teamLookup.get(stat.teamId);
                const playerLabel = stat.displayName || stat.playerName;
                const shirtNumber = stat.shirtNumber ? `#${stat.shirtNumber}` : '';

                return (
                  <tr key={`${stat.teamId}-${stat.playerId}`} className="text-gray-700">
                    <td className="whitespace-nowrap px-2 py-2 font-semibold text-gray-900 sm:px-4 sm:py-3">
                      <div>
                        {playerLabel}
                        {shirtNumber ? <span className="ml-1 text-xs font-normal text-gray-500">{shirtNumber}</span> : null}
                      </div>
                      <div className="text-[10px] text-gray-500 sm:hidden">{team?.name ?? stat.teamName}</div>
                    </td>
                    <td className="hidden whitespace-nowrap px-2 py-2 text-gray-700 sm:table-cell sm:px-4 sm:py-3">
                      <div className="font-medium text-gray-900">{team?.name ?? stat.teamName}</div>
                    </td>
                    <td className="px-2 py-2 text-center font-semibold text-gray-900 sm:px-4 sm:py-3">{stat.goals}</td>
                    <td className="px-2 py-2 text-center text-yellow-600 sm:px-4 sm:py-3">{stat.yellowCards}</td>
                    <td className="hidden px-2 py-2 text-center text-yellow-700 sm:table-cell sm:px-4 sm:py-3">{stat.doubleYellowCards}</td>
                    <td className="px-2 py-2 text-center text-red-600 sm:px-4 sm:py-3">{stat.redCards}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
