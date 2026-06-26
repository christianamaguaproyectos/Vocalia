import { Link } from 'react-router-dom';
import { useMatches, useTeams, useTournament } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { APP_CONFIG } from '../../core/config/app-config.ts';
import type { Match } from '../../backend/modules/tournament/domain/entities/index.ts';
import { useAuth } from '../app/providers/AuthProvider.tsx';
import { useAppDependencies } from '../app/providers/AppDependenciesProvider.tsx';
import { progressKnockoutStageUseCase } from '../../backend/modules/tournament/application/use-cases/index.ts';
import { suggestVocalForMatch } from '../../backend/modules/tournament/application/services/suggest-vocal-rotation.ts';
import { useEffect, useMemo, useState, useRef } from 'react';
import { KnockoutBracket } from '../components/KnockoutBracket.tsx';
type StatusGroup = 'LIVE' | 'SCHEDULED' | 'SUSPENDED' | 'FINISHED' | 'CANCELLED';

const STATUS_ORDER: StatusGroup[] = ['LIVE', 'SCHEDULED', 'SUSPENDED', 'FINISHED', 'CANCELLED'];

const STATUS_LABELS: Record<StatusGroup, string> = {
  LIVE: 'En vivo',
  SCHEDULED: 'Próximos partidos',
  SUSPENDED: 'Suspendidos',
  FINISHED: 'Finalizados',
  CANCELLED: 'Cancelados',
};

const GROUP_SECTIONS: Array<{ id: 'GROUP_A' | 'GROUP_B' | 'KNOCKOUT'; label: string }> = [
  { id: 'GROUP_A', label: 'Grupo A' },
  { id: 'GROUP_B', label: 'Grupo B' },
  { id: 'KNOCKOUT', label: 'Eliminatorias' },
];

export const MatchesPage = () => {
  const tournamentId = APP_CONFIG.defaultTournamentId;
  const { matches, isLoading } = useMatches(tournamentId);
  const { teams } = useTeams(tournamentId);
  const { tournament } = useTournament(tournamentId);
  const { role, user } = useAuth();
  const { matchRepository } = useAppDependencies();
  const isVocaliaOrAdmin = role === 'vocalia' || role === 'admin' || role === 'superadmin';
  const [isHealing, setIsHealing] = useState(false);
  const [activeTab, setActiveTab] = useState<'ALL' | 'GROUP_A' | 'GROUP_B' | 'KNOCKOUT'>('ALL');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [selectedJornada, setSelectedJornada] = useState<string | null>(null);

  const handleToggleExpand = (sectionKey: string) => {
    setExpandedSections(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  // Unique Saturdays (jornadas) derived from group matches, sorted chronologically.
  const jornadaKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const m of matches) {
      if (m.stage.type !== 'GROUP') continue;
      const d = m.scheduledAt;
      if (d) seen.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return Array.from(seen).sort();
  }, [matches]);

  // Matches filtered by the selected jornada (null = all).
  const visibleMatches = useMemo(() => {
    if (!selectedJornada) return matches;
    return matches.filter((m) => {
      const d = m.scheduledAt;
      if (!d) return m.stage.type === 'KNOCKOUT'; // always show knockout
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return key === selectedJornada || m.stage.type === 'KNOCKOUT';
    });
  }, [matches, selectedJornada]);

  const matchesByGroup = useMemo(() => {
    const createEmptyBuckets = () => ({
      LIVE: [] as Match[],
      SCHEDULED: [] as Match[],
      SUSPENDED: [] as Match[],
      FINISHED: [] as Match[],
      CANCELLED: [] as Match[],
    });

    const buckets = new Map<string, { label: string; matches: ReturnType<typeof createEmptyBuckets> }>();

    GROUP_SECTIONS.forEach((section) => {
      buckets.set(section.id, { label: section.label, matches: createEmptyBuckets() });
    });

    const getSectionId = (match: Match): 'GROUP_A' | 'GROUP_B' | 'KNOCKOUT' => {
      if (match.stage.type === 'GROUP') {
        if (match.stage.group === 'GROUP_A') {
          return 'GROUP_A';
        }
        if (match.stage.group === 'GROUP_B') {
          return 'GROUP_B';
        }
      }
      return 'KNOCKOUT';
    };

    visibleMatches.forEach((match) => {
      const sectionId = getSectionId(match);
      if (!buckets.has(sectionId)) {
        buckets.set(sectionId, { label: sectionId, matches: createEmptyBuckets() });
      }

      const section = buckets.get(sectionId);
      if (!section) {
        return;
      }

      section.matches[match.status].push(match);
    });

    const sortAsc = (a: Match, b: Match) => a.scheduledAt.getTime() - b.scheduledAt.getTime();
    const sortDesc = (a: Match, b: Match) => b.scheduledAt.getTime() - a.scheduledAt.getTime();

    buckets.forEach((section) => {
      section.matches.LIVE.sort(sortAsc);
      section.matches.SCHEDULED.sort(sortAsc);
      section.matches.SUSPENDED.sort(sortAsc);
      section.matches.FINISHED.sort(sortDesc);
      section.matches.CANCELLED.sort(sortDesc);
    });

    return GROUP_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      matches: buckets.get(section.id)?.matches ?? createEmptyBuckets(),
    }));
  }, [visibleMatches]);

  // Self-healing bracket logic:
  // If the user's browser crashed or deployed exactly during the transition from Round of 16 to Quarter Finals,
  // we check if all matches for a round are FINISHED and the next round matches don't exist yet.
  const hasHealedRef = useRef(false);

  useEffect(() => {
    if (!isVocaliaOrAdmin || isHealing || matches.length === 0 || hasHealedRef.current) return;

    const knockoutMatches = matches.filter((m) => m.stage.type === 'KNOCKOUT');
    if (knockoutMatches.length === 0) return;

    const stagesToCheck = ['ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL'] as const;

    const autoHeal = async () => {
      hasHealedRef.current = true;
      for (const stage of stagesToCheck) {
        const stageMatches = knockoutMatches.filter((m) => m.stage.knockout === stage);
        if (stageMatches.length === 0) continue;

        // The progressKnockoutStageUseCase is now idempotent and promotes individual matches.
        // We can just call it to ensure any misses due to network errors are caught up.
        try {
          setIsHealing(true);
          const progressUseCase = progressKnockoutStageUseCase({ matchRepository });
          await progressUseCase({
            tournamentId,
            currentStage: stage,
            triggeredBy: user?.email ?? user?.uid ?? 'unknown-user',
            triggeredRole: role ?? 'unknown-role',
            triggerSource: 'matches-auto-heal',
          });
        } catch (error) {
          console.error('Failed to auto-heal bracket:', error);
        } finally {
          setIsHealing(false);
        }
      }
    };

    autoHeal();
  }, [matches, isVocaliaOrAdmin, isHealing, tournamentId, matchRepository]);

  const getTeamName = (teamId: string) => {
    if (!teamId) return 'Por definir';
    const team = teams.find((t) => t.id === teamId);
    return team?.name || teamId;
  };

  const getAssignedVocalTeamName = (match: Match): string | null => {
    if (!match.vocalAccess?.assignedEmail) return null;
    const email = match.vocalAccess.assignedEmail.toLowerCase();
    const team = teams.find((t) =>
      t.representativeEmails?.some((e) => e.toLowerCase() === email),
    );
    return team?.name ?? match.vocalAccess.assignedEmail;
  };

  const getTeamShortName = (teamId: string) => {
    if (!teamId) return 'TBD';
    const team = teams.find((t) => t.id === teamId);
    return team?.shortName || team?.name?.substring(0, 3).toUpperCase() || teamId.substring(0, 3).toUpperCase();
  };

  const renderMatch = (match: Match, showDate = true) => {
    const isLive = match.status === 'LIVE';
    const isFinished = match.status === 'FINISHED';
    const isSuspended = match.status === 'SUSPENDED';
    const isCancelled = match.status === 'CANCELLED';
    const groupLabel = match.stage.type === 'GROUP'
      ? match.stage.group === 'GROUP_A'
        ? 'Grupo A'
        : match.stage.group === 'GROUP_B'
          ? 'Grupo B'
          : 'Grupo'
      : 'Eliminatoria';

    const borderClass = isLive
      ? 'border-red-500 bg-red-50'
      : isSuspended
        ? 'border-yellow-400 bg-yellow-50'
        : isCancelled
          ? 'border-gray-300 bg-gray-100'
          : 'border-gray-200 bg-white';

    const showScore = isLive || isFinished || isSuspended;

    return (
      <Link
        to={isVocaliaOrAdmin ? `/admin/match/${match.id}` : `/match/${match.id}`}
        key={match.id}
        className={`block rounded-lg border ${borderClass} p-4 shadow-sm transition hover:shadow-md`}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex flex-col gap-1 text-xs text-gray-500">
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white/70 px-2 py-1 font-semibold text-gray-700">
              {groupLabel}
            </span>
            {showDate && (
              <>
                {match.scheduledAt.toLocaleDateString('es-ES', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                })}
                {' - '}
              </>
            )}
            {match.scheduledAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
          {isLive && (
            <span className="animate-pulse rounded-full bg-red-500 px-2 py-1 text-xs font-semibold text-white">
              EN VIVO
            </span>
          )}
          {isSuspended && (
            <span className="rounded-full bg-yellow-400 px-2 py-1 text-xs font-semibold text-yellow-900">
              SUSPENDIDO
            </span>
          )}
          {isFinished && (
            <span className="rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-700">FINAL</span>
          )}
          {isCancelled && (
            <span className="rounded-full bg-gray-400 px-2 py-1 text-xs font-semibold text-white">CANCELADO</span>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-8 text-right text-xs font-bold text-gray-400">
                {getTeamShortName(match.homeTeamId)}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">
                {getTeamName(match.homeTeamId)}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              {(match.score.penaltiesHome !== undefined || match.score.penaltiesAway !== undefined) &&
                (match.score.penaltiesHome! > 0 || match.score.penaltiesAway! > 0) && (
                  <span className="text-sm font-semibold text-gray-400">
                    ({match.score.penaltiesHome || 0})
                  </span>
                )}
              <span className={`text-2xl font-bold ${isLive ? 'text-red-600' : 'text-gray-900'}`}>
                {showScore ? match.score.home : '-'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-8 text-right text-xs font-bold text-gray-400">
                {getTeamShortName(match.awayTeamId)}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">
                {getTeamName(match.awayTeamId)}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              {(match.score.penaltiesHome !== undefined || match.score.penaltiesAway !== undefined) &&
                (match.score.penaltiesHome! > 0 || match.score.penaltiesAway! > 0) && (
                  <span className="text-sm font-semibold text-gray-400">
                    ({match.score.penaltiesAway || 0})
                  </span>
                )}
              <span className={`text-2xl font-bold ${isLive ? 'text-red-600' : 'text-gray-900'}`}>
                {showScore ? match.score.away : '-'}
              </span>
            </div>
          </div>
        </div>

        {match.venue && <div className="mt-3 text-xs text-gray-500">📍 {match.venue}</div>}

        {(() => {
          const isAssigned = !!match.vocalAccess?.assignedEmail;
          if (isAssigned) {
            const vocalTeam = getAssignedVocalTeamName(match);
            if (!vocalTeam) return null;
            return (
              <div className="mt-2 flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                <span>🎙</span>
                <span className="font-medium">Vocal:</span>
                <span className="truncate">{vocalTeam}</span>
              </div>
            );
          }
          const suggestion = suggestVocalForMatch(match, matches, teams);
          if (!suggestion) return null;
          return (
            <div className="mt-2 flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-500">
              <span>🎙</span>
              <span className="font-medium">Vocal:</span>
              <span className="truncate">{suggestion.teamName}</span>
            </div>
          );
        })()}
      </Link>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Cargando partidos...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">Partidos</h1>
          <p className="text-gray-600">{tournament?.name} - Temporada {tournament?.season}</p>
        </div>
      </div>

      <div className="flex space-x-2 overflow-x-auto border-b border-gray-200 pb-px">
        {[
          { id: 'ALL', label: 'Todos' },
          ...GROUP_SECTIONS
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id as 'ALL' | 'GROUP_A' | 'GROUP_B' | 'KNOCKOUT');
              setSelectedJornada(null);
            }}
            className={`shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${activeTab === tab.id
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Jornada filter — only for group matches */}
      {jornadaKeys.length > 0 && activeTab !== 'KNOCKOUT' && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-gray-500 shrink-0">Fecha:</span>
          <button
            onClick={() => setSelectedJornada(null)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              selectedJornada === null
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Todas
          </button>
          {jornadaKeys.map((key, idx) => {
            const [year, month, day] = key.split('-').map(Number);
            const label = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
            return (
              <button
                key={key}
                onClick={() => setSelectedJornada(key)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  selectedJornada === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                F{idx + 1} · {label}
              </button>
            );
          })}
        </div>
      )}

      {matchesByGroup
        .filter(section => activeTab === 'ALL' || section.id === activeTab)
        .map((section) => {
          const totalMatches = STATUS_ORDER.reduce((sum, status) => sum + section.matches[status].length, 0);

          return (
            <section key={section.id} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">{section.label}</h2>
                <span className="text-sm text-gray-500">{totalMatches} partidos</span>
              </div>

              {totalMatches === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
                  Aún no hay partidos para este grupo.
                </div>
              ) : section.id === 'KNOCKOUT' ? (
                <KnockoutBracket matches={section.matches.LIVE.concat(section.matches.SCHEDULED, section.matches.SUSPENDED, section.matches.FINISHED, section.matches.CANCELLED)} teams={Object.fromEntries(teams.map(t => [t.id, { id: t.id, name: t.name }]))} />
              ) : (
                STATUS_ORDER.map((status) => {
                  const items = section.matches[status];
                  if (items.length === 0) {
                    return null;
                  }

                  const sectionKey = `${section.id}-${status}`;
                  const isExpanded = expandedSections[sectionKey];
                  const displayedItems = isExpanded ? items : items.slice(0, 6);
                  const hasMore = items.length > 6;
                  const hiddenCount = items.length - 6;

                  return (
                    <div key={sectionKey} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xl font-semibold text-gray-900">{STATUS_LABELS[status]}</h3>
                        {status === 'LIVE' && (
                          <span className="flex items-center gap-2 text-sm font-semibold text-red-600">
                            <span className="h-2 w-2 animate-ping rounded-full bg-red-500"></span>
                            En juego
                          </span>
                        )}
                      </div>
                      {status === 'SUSPENDED' && (
                        <p className="text-xs text-gray-500">
                          Estos partidos requieren reprogramación o una reanudación manual.
                        </p>
                      )}
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {displayedItems.map((match) => renderMatch(match))}
                      </div>
                      {hasMore && (
                        <div className="mt-4 flex justify-center">
                          <button
                            onClick={() => handleToggleExpand(sectionKey)}
                            className="rounded-lg bg-gray-100 px-6 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
                          >
                            {isExpanded ? 'Ver menos' : `Ver más partidos (${hiddenCount} adicionales)`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </section>
          );
        })}

      {matches.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No hay partidos programados aún</p>
        </div>
      )}
    </div>
  );
};
