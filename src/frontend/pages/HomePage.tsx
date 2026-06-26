import { Link } from 'react-router-dom';

import { useTournament } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { APP_CONFIG } from '../../core/config/app-config.ts';
import { useTeams } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { useMatches } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { calculateGroupStandings } from '../../backend/modules/tournament/application/services/index.ts';
import { KnockoutBracket } from '../components/KnockoutBracket.tsx';
import { StandingsTable } from '../components/StandingsTable.tsx';

export const HomePage = () => {
  const tournamentId = APP_CONFIG.defaultTournamentId;
  const { tournament, isLoading: tournamentLoading } = useTournament(tournamentId);
  const { teams } = useTeams(tournamentId);
  const { matches } = useMatches(tournamentId);
  const qualifiedCount = tournament?.config.qualifiedCount ?? 8;
  const tournamentPrimaryColor = tournament?.config.tournamentPrimaryColor ?? '#4f46e5';

  const liveMatches = matches.filter((m) => m.status === 'LIVE');
  const upcomingMatches = matches
    .filter((m) => m.status === 'SCHEDULED' && m.stage.type !== 'KNOCKOUT')
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, 3);
  const suspendedMatches = matches.filter((m) => m.status === 'SUSPENDED');
  const knockoutMatches = matches.filter((m) => m.stage.type === 'KNOCKOUT');

  const getTeamName = (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    return team?.name ?? teamId;
  };

  const standingsGroupA = tournament ? calculateGroupStandings({
    teams: teams.filter((t) => t.groupId === 'A'),
    matches,
    config: tournament.config
  }) : [];

  const standingsGroupB = tournament ? calculateGroupStandings({
    teams: teams.filter((t) => t.groupId === 'B'),
    matches,
    config: tournament.config
  }) : [];

  if (tournamentLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div
        className="rounded-lg p-5 text-white shadow-lg sm:p-8"
        style={{ background: `linear-gradient(135deg, ${tournamentPrimaryColor}, #1f2937)` }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-4xl">{tournament?.name || 'Vocalía Fútbol'}</h1>
        </div>
        <p className="mt-1 text-sm opacity-90 sm:mt-2 sm:text-lg">Temporada {tournament?.season}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:gap-4">
          <div className="rounded-md bg-white/20 px-3 py-2 backdrop-blur-sm sm:px-4">
            <div className="text-xl font-bold sm:text-2xl">{teams.length}</div>
            <div className="text-xs opacity-90 sm:text-sm">Equipos</div>
          </div>
          <div className="rounded-md bg-white/20 px-3 py-2 backdrop-blur-sm sm:px-4">
            <div className="text-xl font-bold sm:text-2xl">{matches.length}</div>
            <div className="text-xs opacity-90 sm:text-sm">Partidos</div>
          </div>
          <div className="rounded-md bg-white/20 px-3 py-2 backdrop-blur-sm sm:px-4">
            <div className="text-xl font-bold sm:text-2xl">{liveMatches.length}</div>
            <div className="text-xs opacity-90 sm:text-sm">En vivo</div>
          </div>
          <div className="rounded-md bg-white/20 px-3 py-2 backdrop-blur-sm sm:px-4">
            <div className="text-xl font-bold sm:text-2xl">{suspendedMatches.length}</div>
            <div className="text-xs opacity-90 sm:text-sm">Suspendidos</div>
          </div>
        </div>
      </div>

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">Partidos en vivo</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {liveMatches.map((match) => (
              <Link
                key={match.id}
                to={`/match/${match.id}`}
                className="block rounded-lg border-2 border-red-500 bg-white p-4 shadow-md transition active:shadow-lg active:border-red-600"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white">EN VIVO</span>
                  <span className="text-xs text-gray-500">
                    {match.scheduledAt.toLocaleDateString('es-ES', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">{getTeamName(match.homeTeamId)}</span>
                    <span className="text-2xl font-bold text-gray-900">{match.score.home}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">{getTeamName(match.awayTeamId)}</span>
                    <span className="text-2xl font-bold text-gray-900">{match.score.away}</span>
                  </div>
                </div>
                <div className="mt-2 text-center text-xs font-semibold" style={{ color: tournamentPrimaryColor }}>
                  Ver detalles →
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Matches */}
      {upcomingMatches.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">Próximos partidos</h2>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            {upcomingMatches.map((match) => (
              <div key={match.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-xs text-gray-500">
                  {match.scheduledAt.toLocaleDateString('es-ES', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  <br />
                  {match.scheduledAt.toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-gray-900">{getTeamName(match.homeTeamId)}</div>
                  <div className="text-center text-xs text-gray-400">vs</div>
                  <div className="text-sm font-semibold text-gray-900">{getTeamName(match.awayTeamId)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mutually Exclusive Layout: Knockout Bracket OR Group Standings */}
      {knockoutMatches.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">Fase de Eliminatorias</h2>
          <KnockoutBracket matches={knockoutMatches} teams={Object.fromEntries(teams.map(t => [t.id, { id: t.id, name: t.name }]))} />
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">Fase de Grupos</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <StandingsTable standings={standingsGroupA} groupName="Grupo A" teams={teams} qualifiedCount={qualifiedCount} />
            <StandingsTable standings={standingsGroupB} groupName="Grupo B" teams={teams} qualifiedCount={qualifiedCount} />
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="mb-3 text-base font-semibold text-gray-900 sm:mb-4 sm:text-lg">Estado del torneo</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Estado:</span>
              <span className="font-semibold text-gray-900">{tournament?.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Partidos jugados:</span>
              <span className="font-semibold text-gray-900">
                {matches.filter((m) => m.status === 'FINISHED').length}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Partidos pendientes:</span>
              <span className="font-semibold text-gray-900">
                {matches.filter((m) => m.status === 'SCHEDULED').length}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Partidos suspendidos:</span>
              <span className="font-semibold text-gray-900">{suspendedMatches.length}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="mb-3 text-base font-semibold text-gray-900 sm:mb-4 sm:text-lg">Equipos por grupo</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Grupo A:</span>
              <span className="font-semibold text-gray-900">
                {teams.filter((t) => t.groupId === 'A').length} equipos
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Grupo B:</span>
              <span className="font-semibold text-gray-900">
                {teams.filter((t) => t.groupId === 'B').length} equipos
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
