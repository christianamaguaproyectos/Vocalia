import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMatches, useTeams, useTournament } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { APP_CONFIG } from '../../core/config/app-config.ts';
import type { Match } from '../../backend/modules/tournament/domain/entities/index.ts';

type StatusFilter = 'ALL' | 'SCHEDULED' | 'LIVE' | 'SUSPENDED' | 'FINISHED';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'SCHEDULED', label: 'Programados' },
  { value: 'LIVE', label: 'En vivo' },
  { value: 'SUSPENDED', label: 'Suspendidos' },
  { value: 'FINISHED', label: 'Finalizados' },
];

export const VocaliaPage = () => {
  const tournamentId = APP_CONFIG.defaultTournamentId;
  const { matches, isLoading } = useMatches(tournamentId);
  const { teams } = useTeams(tournamentId);
  const { tournament } = useTournament(tournamentId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const filteredMatches = useMemo(() => {
    const sorted = [...matches].sort((a, b) => {
      const statusOrder: Record<string, number> = { LIVE: 0, SCHEDULED: 1, SUSPENDED: 2, FINISHED: 3, CANCELLED: 4 };
      const diff = (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5);
      if (diff !== 0) return diff;
      return a.scheduledAt.getTime() - b.scheduledAt.getTime();
    });
    if (statusFilter === 'ALL') return sorted;
    return sorted.filter((m) => m.status === statusFilter);
  }, [matches, statusFilter]);

  const getTeamName = (teamId: string) => teams.find((t) => t.id === teamId)?.name || teamId;

  const getStatusBadge = (match: Match) => {
    switch (match.status) {
      case 'LIVE':
        return <span className="animate-pulse rounded-full bg-red-500 px-2 py-1 text-xs font-semibold text-white">EN VIVO</span>;
      case 'SCHEDULED':
        return <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">PROGRAMADO</span>;
      case 'SUSPENDED':
        return <span className="rounded-full bg-yellow-400 px-2 py-1 text-xs font-semibold text-yellow-900">SUSPENDIDO</span>;
      case 'FINISHED':
        return <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-700">FINALIZADO</span>;
      default:
        return <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-600">{match.status}</span>;
    }
  };

  const getActionLabel = (match: Match) => {
    switch (match.status) {
      case 'SCHEDULED': return 'Iniciar Vocalía';
      case 'LIVE': return 'Continuar Vocalía';
      case 'SUSPENDED': return 'Reanudar Partido';
      case 'FINISHED': return 'Ver Detalles';
      default: return 'Ver Partido';
    }
  };

  const getActionClass = (match: Match) => {
    switch (match.status) {
      case 'SCHEDULED': return 'bg-green-600 text-white hover:bg-green-700';
      case 'LIVE': return 'bg-red-600 text-white hover:bg-red-700';
      case 'SUSPENDED': return 'bg-yellow-500 text-yellow-900 hover:bg-yellow-400';
      case 'FINISHED': return 'bg-indigo-600 text-white hover:bg-indigo-700';
      default: return 'bg-gray-500 text-white hover:bg-gray-600';
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Cargando partidos...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Panel de Vocalía</h1>
        <p className="text-gray-600">
          {tournament?.name} — Selecciona un partido para iniciar o continuar la vocalía.
        </p>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => setStatusFilter(option.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              statusFilter === option.value
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {option.label}
            {option.value !== 'ALL' && (
              <span className="ml-1 text-xs opacity-70">
                ({matches.filter((m) => m.status === option.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-gray-50 p-4">
          <div className="text-2xl font-bold text-gray-900">{matches.length}</div>
          <div className="text-sm text-gray-600">Total</div>
        </div>
        <div className="rounded-lg bg-blue-50 p-4">
          <div className="text-2xl font-bold text-blue-600">{matches.filter((m) => m.status === 'SCHEDULED').length}</div>
          <div className="text-sm text-gray-600">Pendientes</div>
        </div>
        <div className="rounded-lg bg-red-50 p-4">
          <div className="text-2xl font-bold text-red-600">{matches.filter((m) => m.status === 'LIVE').length}</div>
          <div className="text-sm text-gray-600">En vivo</div>
        </div>
        <div className="rounded-lg bg-green-50 p-4">
          <div className="text-2xl font-bold text-green-600">{matches.filter((m) => m.status === 'FINISHED').length}</div>
          <div className="text-sm text-gray-600">Finalizados</div>
        </div>
      </div>

      {/* Match list */}
      {filteredMatches.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No hay partidos {statusFilter !== 'ALL' ? 'con este estado' : 'programados aún'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMatches.map((match) => {
            const showScore = match.status === 'LIVE' || match.status === 'FINISHED' || match.status === 'SUSPENDED';
            const isLive = match.status === 'LIVE';
            const borderClass = isLive
              ? 'border-red-300 bg-red-50/30'
              : match.status === 'SUSPENDED'
                ? 'border-yellow-300 bg-yellow-50/30'
                : 'border-gray-200 bg-white';

            return (
              <div key={match.id} className={`rounded-lg border ${borderClass} p-4 shadow-sm transition hover:shadow-md`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                      <span>
                        {match.scheduledAt.toLocaleDateString('es-ES', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                      <span>•</span>
                      <span>{match.scheduledAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                      {match.venue && (
                        <>
                          <span>•</span>
                          <span>📍 {match.venue}</span>
                        </>
                      )}
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                        {match.stage.type === 'GROUP'
                          ? match.stage.group === 'GROUP_A' ? 'Grupo A' : 'Grupo B'
                          : 'Eliminatoria'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-900">{getTeamName(match.homeTeamId)}</span>
                        <span className={`text-xl font-bold ${isLive ? 'text-red-600' : 'text-gray-900'}`}>
                          {showScore ? match.score.home : '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-900">{getTeamName(match.awayTeamId)}</span>
                        <span className={`text-xl font-bold ${isLive ? 'text-red-600' : 'text-gray-900'}`}>
                          {showScore ? match.score.away : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="ml-4">{getStatusBadge(match)}</div>
                </div>
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <Link
                    to={`/admin/match/${match.id}`}
                    className={`inline-block rounded-md px-4 py-2 text-sm font-semibold ${getActionClass(match)}`}
                  >
                    {getActionLabel(match)}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
