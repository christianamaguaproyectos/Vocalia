import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { Match, MatchEvent, Player } from '../../backend/modules/tournament/domain/entities/index.ts';
import { useAppDependencies } from '../app/providers/AppDependenciesProvider.tsx';
import { APP_CONFIG } from '../../core/config/app-config.ts';

const sortEvents = (items: MatchEvent[]) =>
    [...items].sort((a, b) => {
        if (a.time.minute !== b.time.minute) {
            return a.time.minute - b.time.minute;
        }
        const addA = a.time.additional ?? 0;
        const addB = b.time.additional ?? 0;
        return addA - addB;
    });

export const MatchViewPage = () => {
    const { matchId } = useParams<{ matchId: string }>();
    const { matchRepository, teamRepository } = useAppDependencies();

    const [match, setMatch] = useState<Match | null>(null);
    const [events, setEvents] = useState<MatchEvent[]>([]);
    const [homePlayers, setHomePlayers] = useState<Player[]>([]);
    const [awayPlayers, setAwayPlayers] = useState<Player[]>([]);
    const [homeTeamName, setHomeTeamName] = useState('');
    const [awayTeamName, setAwayTeamName] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const playerLookup = useMemo(() => {
        const map = new Map<string, Player>();
        homePlayers.forEach((p) => map.set(p.id, p));
        awayPlayers.forEach((p) => map.set(p.id, p));
        return map;
    }, [homePlayers, awayPlayers]);

    const getPlayerLabel = useCallback(
        (playerId?: string) => {
            if (!playerId) return '';
            const player = playerLookup.get(playerId);
            if (!player) return '';
            const base = player.displayName || player.fullName;
            return player.number ? `${base} (#${player.number})` : base;
        },
        [playerLookup],
    );

    const getTeamLabel = useCallback(
        (teamId?: string | null) => {
            if (!teamId || !match) return '';
            if (teamId === match.homeTeamId) return homeTeamName;
            if (teamId === match.awayTeamId) return awayTeamName;
            return teamId;
        },
        [match, homeTeamName, awayTeamName],
    );

    // Compute lineup from starters + substitutions
    const lineupState = useMemo(() => {
        if (!match) {
            return { onField: {} as Record<string, string[]>, bench: {} as Record<string, string[]> };
        }

        const homeOnField = new Set(match.lineups?.home?.starters ?? []);
        const awayOnField = new Set(match.lineups?.away?.starters ?? []);
        const homeBench = new Set(match.lineups?.home?.substitutes ?? []);
        const awayBench = new Set(match.lineups?.away?.substitutes ?? []);

        events
            .filter((e): e is MatchEvent & { teamId: string } => e.type === 'SUBSTITUTION' && Boolean(e.teamId))
            .forEach((event) => {
                const teamSet = event.teamId === match.homeTeamId ? homeOnField : event.teamId === match.awayTeamId ? awayOnField : null;
                const benchSet = event.teamId === match.homeTeamId ? homeBench : event.teamId === match.awayTeamId ? awayBench : null;

                if (!teamSet || !benchSet) return;

                if ('playerOutId' in event && event.playerOutId) {
                    teamSet.delete(event.playerOutId);
                    benchSet.add(event.playerOutId);
                }
                if ('playerInId' in event && event.playerInId) {
                    benchSet.delete(event.playerInId);
                    teamSet.add(event.playerInId);
                }
            });

        return {
            onField: {
                [match.homeTeamId]: Array.from(homeOnField),
                [match.awayTeamId]: Array.from(awayOnField),
            },
            bench: {
                [match.homeTeamId]: Array.from(homeBench),
                [match.awayTeamId]: Array.from(awayBench),
            },
        };
    }, [events, match]);

    // Data loading
    useEffect(() => {
        if (!matchId) return;

        let unsubscribeTeams: (() => void) | undefined;
        let isActive = true;

        const load = async () => {
            try {
                setIsLoading(true);
                const matchData = await matchRepository.findById(matchId, APP_CONFIG.defaultTournamentId);
                if (!matchData) {
                    setError('Partido no encontrado');
                    return;
                }
                if (!isActive) return;
                setMatch(matchData);

                unsubscribeTeams = teamRepository.listenAll(matchData.tournamentId, {
                    onData: (teams) => {
                        if (!isActive) return;
                        const home = teams.find((t) => t.id === matchData.homeTeamId);
                        const away = teams.find((t) => t.id === matchData.awayTeamId);
                        setHomeTeamName(home?.name ?? matchData.homeTeamId);
                        setAwayTeamName(away?.name ?? matchData.awayTeamId);
                        setHomePlayers(home?.players ?? []);
                        setAwayPlayers(away?.players ?? []);
                    },
                    onError: (err) => console.error('Error escuchando equipos:', err),
                });
            } catch (err) {
                console.error('Error loading match:', err);
                setError('Error al cargar el partido');
            } finally {
                setIsLoading(false);
            }
        };

        void load();

        const unsubscribeEvents = matchRepository.listenEvents(matchId, {
            onData: (data) => {
                const sorted = sortEvents(data);
                setEvents(sorted);

                setMatch((prev) => {
                    if (!prev) return prev;
                    let updated: Match | null = null;

                    const lastStatusEvent = [...sorted]
                        .reverse()
                        .find((e) => e.type === 'MATCH_STARTED' || e.type === 'MATCH_ENDED');

                    if (lastStatusEvent?.type === 'MATCH_STARTED' && prev.status !== 'LIVE') {
                        updated = { ...(updated ?? prev), status: 'LIVE' };
                    }
                    if (lastStatusEvent?.type === 'MATCH_ENDED' && prev.status !== 'FINISHED') {
                        updated = { ...(updated ?? prev), status: 'FINISHED' };
                    }

                    const lastScoreEvent = [...sorted]
                        .reverse()
                        .find((e) => 'updatedScore' in e && e.updatedScore);

                    if (
                        lastScoreEvent &&
                        'updatedScore' in lastScoreEvent &&
                        lastScoreEvent.updatedScore &&
                        (prev.score.home !== lastScoreEvent.updatedScore.home ||
                            prev.score.away !== lastScoreEvent.updatedScore.away)
                    ) {
                        updated = {
                            ...(updated ?? prev),
                            score: { ...lastScoreEvent.updatedScore },
                        };
                    }

                    return updated ?? prev;
                });
            },
            onError: (err) => console.error('Error listening events:', err),
        }, APP_CONFIG.defaultTournamentId);

        return () => {
            isActive = false;
            unsubscribeEvents();
            unsubscribeTeams?.();
        };
    }, [matchId, matchRepository, teamRepository]);

    // --- Rendering helpers ---

    const statusBadge = () => {
        if (!match) return null;
        switch (match.status) {
            case 'LIVE':
                return <span className="animate-pulse rounded-full bg-red-500 px-3 py-1 text-sm font-semibold text-white">EN VIVO</span>;
            case 'FINISHED':
                return <span className="rounded-full bg-gray-300 px-3 py-1 text-sm font-semibold text-gray-800">FINALIZADO</span>;
            case 'SUSPENDED':
                return <span className="rounded-full bg-yellow-400 px-3 py-1 text-sm font-semibold text-yellow-900">SUSPENDIDO</span>;
            case 'SCHEDULED':
                return <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">PROGRAMADO</span>;
            default:
                return <span className="rounded-full bg-gray-200 px-3 py-1 text-sm font-semibold text-gray-600">{match.status}</span>;
        }
    };

    const renderEventIcon = (type: MatchEvent['type']) => {
        switch (type) {
            case 'GOAL':
                return '⚽';
            case 'PENALTY_GOAL':
                return '⚽🎯';
            case 'OWN_GOAL':
                return '⚽🔴';
            case 'CARD':
                return '🟨';
            case 'SUBSTITUTION':
                return '🔄';
            case 'MATCH_STARTED':
                return '🏁';
            case 'FIRST_HALF_ENDED':
                return '⏸️';
            case 'SECOND_HALF_STARTED':
                return '▶️';
            case 'MATCH_ENDED':
                return '🏁';
            case 'MATCH_SUSPENDED':
                return '⚠️';
            case 'MATCH_RESUMED':
                return '▶️';
            case 'PENALTY_MISSED':
                return '❌';
            default:
                return '📝';
        }
    };

    const buildEventDescription = (event: MatchEvent): string => {
        switch (event.type) {
            case 'GOAL':
            case 'PENALTY_GOAL': {
                const scorer = getPlayerLabel(event.scorerId);
                const goalLabel = event.type === 'PENALTY_GOAL' ? 'Gol de penal' : 'Gol';
                return `${goalLabel}${scorer ? ` de ${scorer}` : ''}`;
            }
            case 'OWN_GOAL': {
                const scorer = getPlayerLabel(event.scorerId);
                return `Autogol${scorer ? ` de ${scorer}` : ''}`;
            }
            case 'CARD': {
                const playerName = getPlayerLabel(event.playerId);
                const cardLabel =
                    event.cardType === 'RED'
                        ? '🟥 Tarjeta roja'
                        : event.cardType === 'DOUBLE_YELLOW'
                            ? '🟨🟨 Doble amarilla'
                            : '🟨 Tarjeta amarilla';
                return `${cardLabel}${playerName ? ` para ${playerName}` : ''}`;
            }
            case 'SUBSTITUTION': {
                const outName = getPlayerLabel(event.playerOutId);
                const inName = getPlayerLabel(event.playerInId);
                return `Sale ${outName || '?'} · Entra ${inName || '?'}`;
            }
            case 'MATCH_STARTED':
                return 'Comienza el partido';
            case 'FIRST_HALF_ENDED':
                return 'Finaliza el primer tiempo';
            case 'SECOND_HALF_STARTED':
                return 'Arranca el segundo tiempo';
            case 'MATCH_ENDED':
                return 'Finaliza el partido';
            case 'MATCH_SUSPENDED':
                return 'Partido suspendido';
            case 'MATCH_RESUMED':
                return 'Se reanuda el partido';
            case 'PENALTY_MISSED': {
                const shooter = getPlayerLabel(event.scorerId);
                return `Penal fallado${shooter ? ` por ${shooter}` : ''}`;
            }
            case 'COMMENT':
                return event.notes || 'Comentario';
            default:
                return '';
        }
    };

    // --- Render ---

    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="text-gray-500">Cargando partido...</div>
            </div>
        );
    }

    if (error || !match) {
        return (
            <div className="space-y-4 text-center">
                <div className="text-red-600">{error || 'Partido no encontrado'}</div>
                <Link to="/" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                    ← Volver al inicio
                </Link>
            </div>
        );
    }

    const renderLineupSide = (teamId: string, teamName: string) => {
        const onField = (lineupState.onField[teamId] ?? [])
            .map((id) => playerLookup.get(id))
            .filter(Boolean) as Player[];
        const bench = (lineupState.bench[teamId] ?? [])
            .map((id) => playerLookup.get(id))
            .filter(Boolean) as Player[];

        if (onField.length === 0 && bench.length === 0) return null;

        return (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h4 className="mb-3 text-sm font-semibold text-gray-900">{teamName}</h4>
                {onField.length > 0 && (
                    <div className="mb-3">
                        <div className="mb-1 text-xs font-semibold uppercase text-gray-500">Titulares</div>
                        <div className="space-y-1">
                            {onField.map((p) => (
                                <div key={p.id} className="text-sm text-gray-800">
                                    {p.number ? `#${p.number} ` : ''}{p.displayName || p.fullName}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {bench.length > 0 && (
                    <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-gray-500">Suplentes</div>
                        <div className="space-y-1">
                            {bench.map((p) => (
                                <div key={p.id} className="text-sm text-gray-500">
                                    {p.number ? `#${p.number} ` : ''}{p.displayName || p.fullName}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Back link */}
            <Link to="/" className="inline-flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                ← Volver al inicio
            </Link>

            {/* Scoreboard */}
            <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white shadow-lg">
                <div className="mb-2 flex justify-center">{statusBadge()}</div>
                <div className="flex items-center justify-center gap-6">
                    <div className="flex-1 text-right">
                        <div className="text-lg font-bold md:text-xl">{homeTeamName}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-4xl font-extrabold md:text-5xl">
                            {match.score.home} - {match.score.away}
                        </div>
                    </div>
                    <div className="flex-1 text-left">
                        <div className="text-lg font-bold md:text-xl">{awayTeamName}</div>
                    </div>
                </div>
                <div className="mt-3 text-center text-sm opacity-80">
                    {match.scheduledAt.toLocaleDateString('es-ES', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                    })}{' '}
                    • {match.scheduledAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    {match.venue && ` • 📍 ${match.venue}`}
                </div>
            </div>

            {/* Lineups */}
            {(lineupState.onField[match.homeTeamId]?.length > 0 || lineupState.onField[match.awayTeamId]?.length > 0) && (
                <div>
                    <h3 className="mb-3 text-lg font-semibold text-gray-900">Alineaciones</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                        {renderLineupSide(match.homeTeamId, homeTeamName)}
                        {renderLineupSide(match.awayTeamId, awayTeamName)}
                    </div>
                </div>
            )}

            {/* Events Timeline */}
            <div>
                <h3 className="mb-3 text-lg font-semibold text-gray-900">Cronología</h3>
                {events.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                        {match.status === 'SCHEDULED'
                            ? 'El partido aún no ha comenzado.'
                            : 'No hay eventos registrados.'}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {events.map((event) => {
                            const teamLabel = getTeamLabel(event.teamId);
                            const description = buildEventDescription(event);

                            return (
                                <div key={event.id} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                                    <div className="flex w-12 shrink-0 flex-col items-center">
                                        <span className="text-lg">{renderEventIcon(event.type)}</span>
                                        <span className="mt-0.5 text-xs font-semibold text-gray-500">
                                            {event.time.minute}'{event.time.additional ? `+${event.time.additional}` : ''}
                                        </span>
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-semibold text-gray-800">{description}</div>
                                        {teamLabel && (
                                            <div className="text-xs text-gray-500">{teamLabel}</div>
                                        )}
                                        {'updatedScore' in event && event.updatedScore && (
                                            <div className="mt-1 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                                                {event.updatedScore.home} - {event.updatedScore.away}
                                            </div>
                                        )}
                                        {event.notes && event.type !== 'COMMENT' && (
                                            <div className="mt-1 text-xs text-gray-400 italic">Nota: {event.notes}</div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Officials */}
            {match.officials?.referee && (
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">Árbitro</h3>
                    <div className="text-sm text-gray-700">{match.officials.referee.fullName}</div>
                </div>
            )}
        </div>
    );
};
