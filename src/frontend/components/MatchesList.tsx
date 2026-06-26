import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Match } from '../../backend/modules/tournament/domain/entities/index.ts';
import { useAppDependencies } from '../app/providers/AppDependenciesProvider.tsx';

const PAGE_SIZE = 5;

interface MatchesListProps {
  matches: Match[];
  teams: Array<{ id: string; name: string; shortName?: string }>;
  onMatchUpdated?: () => void;
  collapsed?: boolean;
}

export const MatchesList = ({ matches, teams, onMatchUpdated, collapsed: initialCollapsed = false }: MatchesListProps) => {
  const { matchRepository } = useAppDependencies();
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  const getTeamName = (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    return team?.name || teamId;
  };

  const getTeamShortName = (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    return team?.shortName || team?.name?.substring(0, 3).toUpperCase() || 'TBD';
  };

  const handleEditClick = (match: Match) => {
    setEditingMatchId(match.id);
    const date = match.scheduledAt.toISOString().split('T')[0];
    const time = match.scheduledAt.toTimeString().substring(0, 5);
    setEditDate(date);
    setEditTime(time);
    setEditVenue(match.venue || '');
  };

  const handleSave = async (match: Match) => {
    setIsUpdating(true);
    try {
      const newScheduledAt = new Date(`${editDate}T${editTime}`);
      await matchRepository.update(match.id, {
        tournamentId: match.tournamentId,
        scheduledAt: newScheduledAt,
        venue: editVenue || undefined,
      });
      setEditingMatchId(null);
      onMatchUpdated?.();
    } catch (error) {
      console.error('Error updating match:', error);
      alert('Error al actualizar el partido');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancel = () => {
    setEditingMatchId(null);
    setEditDate('');
    setEditTime('');
    setEditVenue('');
  };

  const handleDelete = async (match: Match) => {
    if (!confirm(`¿Eliminar el partido ${getTeamShortName(match.homeTeamId)} vs ${getTeamShortName(match.awayTeamId)}?`)) {
      return;
    }

    try {
      // Note: Need to implement delete in repository
      alert('Función de eliminar pendiente de implementar en el repositorio');
      onMatchUpdated?.();
    } catch (error) {
      console.error('Error deleting match:', error);
      alert('Error al eliminar el partido');
    }
  };

  const totalPages = Math.ceil(matches.length / PAGE_SIZE);
  const paginatedMatches = useMemo(
    () => matches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [matches, currentPage],
  );

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-500">
        No hay partidos generados aún
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm text-gray-600 active:bg-gray-100"
      >
        Mostrar {matches.length} partidos ▼
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {matches.length > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-2">
          <span className="text-xs text-gray-500">
            Mostrando {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, matches.length)} de {matches.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 active:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              ← Anterior
            </button>
            <span className="px-2 text-xs font-medium text-gray-600">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 active:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              Siguiente →
            </button>
          </div>
          <button
            onClick={() => setIsCollapsed(true)}
            className="text-xs font-medium text-gray-500 active:text-gray-700"
          >
            Colapsar ▲
          </button>
        </div>
      )}
      {paginatedMatches.map((match) => {
        const isEditing = editingMatchId === match.id;
        const canStart = match.status === 'SCHEDULED';
        const isSuspended = match.status === 'SUSPENDED';

        return (
          <div
            key={match.id}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition active:shadow-md"
          >
            {isEditing ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">Fecha</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">Hora</label>
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Sede/Cancha (opcional)</label>
                  <input
                    type="text"
                    value={editVenue}
                    onChange={(e) => setEditVenue(e.target.value)}
                    placeholder="Ej. Cancha Principal"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSave(match)}
                    disabled={isUpdating}
                    className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:bg-indigo-700 disabled:bg-gray-400"
                  >
                    {isUpdating ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={isUpdating}
                    className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 active:bg-gray-50 disabled:bg-gray-100"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                      <span>
                        {match.scheduledAt.toLocaleDateString('es-ES', {
                          weekday: 'long',
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                      <span>•</span>
                      <span>{match.scheduledAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {match.venue && (
                      <div className="mb-2 text-xs text-gray-500">📍 {match.venue}</div>
                    )}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-xs font-bold text-gray-400">{getTeamShortName(match.homeTeamId)}</span>
                          <span className="font-semibold text-gray-900">{getTeamName(match.homeTeamId)}</span>
                        </div>
                        {match.status !== 'SCHEDULED' && (
                          <span className="text-lg font-bold text-gray-900">{match.score.home}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-12 text-xs font-bold text-gray-400">{getTeamShortName(match.awayTeamId)}</span>
                          <span className="font-semibold text-gray-900">{getTeamName(match.awayTeamId)}</span>
                        </div>
                        {match.status !== 'SCHEDULED' && (
                          <span className="text-lg font-bold text-gray-900">{match.score.away}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="ml-4">
                    {match.status === 'LIVE' && (
                      <span className="rounded-full bg-red-500 px-2 py-1 text-xs font-semibold text-white">EN VIVO</span>
                    )}
                    {isSuspended && (
                      <span className="rounded-full bg-yellow-400 px-2 py-1 text-xs font-semibold text-yellow-900">
                        SUSPENDIDO
                      </span>
                    )}
                    {match.status === 'FINISHED' && (
                      <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-700">FINAL</span>
                    )}
                    {match.status === 'CANCELLED' && (
                      <span className="rounded-full bg-gray-400 px-2 py-1 text-xs font-semibold text-white">
                        CANCELADO
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 border-t border-gray-100 pt-3">
                  {canStart && (
                    <Link
                      to={`/admin/match/${match.id}`}
                      className="flex-1 rounded-md bg-green-600 px-3 py-2 text-center text-xs font-semibold text-white active:bg-green-700"
                    >
                      Iniciar Partido
                    </Link>
                  )}
                  {match.status === 'LIVE' && (
                    <Link
                      to={`/admin/match/${match.id}`}
                      className="flex-1 rounded-md bg-red-600 px-3 py-2 text-center text-xs font-semibold text-white active:bg-red-700"
                    >
                      Continuar Registro
                    </Link>
                  )}
                  {isSuspended && (
                    <Link
                      to={`/admin/match/${match.id}`}
                      className="flex-1 rounded-md bg-yellow-500 px-3 py-2 text-center text-xs font-semibold text-yellow-900 active:bg-yellow-400"
                    >
                      Reanudar Partido
                    </Link>
                  )}
                  {match.status === 'FINISHED' && (
                    <Link
                      to={`/admin/match/${match.id}`}
                      className="flex-1 rounded-md bg-indigo-600 px-3 py-2 text-center text-xs font-semibold text-white active:bg-indigo-700"
                    >
                      Ver Detalles
                    </Link>
                  )}
                  {match.status === 'CANCELLED' && (
                    <Link
                      to={`/admin/match/${match.id}`}
                      className="flex-1 rounded-md bg-gray-500 px-3 py-2 text-center text-xs font-semibold text-white active:bg-gray-600"
                    >
                      Ver Detalles
                    </Link>
                  )}
                  {(canStart || isSuspended) && (
                    <>
                      <button
                        onClick={() => handleEditClick(match)}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(match)}
                        className="rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-600 active:bg-red-50"
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {matches.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-1 pt-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 active:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
          >
            ← Anterior
          </button>
          <span className="px-2 text-xs font-medium text-gray-600">{currentPage} / {totalPages}</span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 active:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
};
