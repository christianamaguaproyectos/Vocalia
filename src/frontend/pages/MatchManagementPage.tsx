import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Link, useLocation, useParams, Navigate } from 'react-router-dom';

import type { Match, MatchEvent, Player } from '../../backend/modules/tournament/domain/entities/index.ts';
import type { CardType } from '../../backend/modules/tournament/domain/value-objects/index.ts';
import {
  assignVocalAccessUseCase,
  recordMatchEventUseCase,
  submitMatchReportUseCase,
  submitVocalReportUseCase,
  updateMatchLineupUseCase,
  updateMatchOfficialsUseCase,
  progressKnockoutStageUseCase,
  deleteMatchEventUseCase,
} from '../../backend/modules/tournament/application/use-cases/index.ts';
import { calculatePlayerStats, suggestVocalForMatch, type PlayerStatsSummary } from '../../backend/modules/tournament/application/services/index.ts';
import { useAppDependencies } from '../app/providers/AppDependenciesProvider.tsx';
import { useTeams, useMatches, useTournament } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { useAuth } from '../app/providers/AuthProvider.tsx';
import { calculatePlayerSuspensions } from '../../backend/modules/tournament/application/services/calculate-suspensions.ts';
import { APP_CONFIG } from '../../core/config/app-config.ts';
import { getVocalAccessSession } from '../shared/auth/vocal-access-session.ts';
import { listVocaliaUsers, type VocaliaUser } from '../shared/auth/vocalia-users.ts';
import { sendMail } from '../../backend/lib/mail-service.ts';

type EventFormType = 'GOAL' | 'CARD' | 'SUBSTITUTION';
type LineupSide = 'home' | 'away';

const CLOCK_STORAGE_PREFIX = 'match-clock-state:';
type MatchHalf = 'FIRST' | 'SECOND';
const DEFAULT_MATCH_DURATION_MINUTES = 60;
const DEFAULT_MAX_SUBSTITUTIONS = 5;
const DEFAULT_MAX_SUBSTITUTION_WINDOWS = 3;
const DEFAULT_MIN_PLAYERS_TO_START = 5;
const DEFAULT_PLAYERS_ON_FIELD = 7;

const HALF_LABELS: Record<MatchHalf, string> = {
  FIRST: 'Primer tiempo',
  SECOND: 'Segundo tiempo',
};

interface HalfClockState {
  elapsedSeconds: number;
  extraMinutes: number;
  completed: boolean;
  eventLogged: boolean;
}

interface ClockState {
  currentHalf: MatchHalf;
  isRunning: boolean;
  firstHalf: HalfClockState;
  secondHalf: HalfClockState;
}

const createHalfClockState = (): HalfClockState => ({
  elapsedSeconds: 0,
  extraMinutes: 0,
  completed: false,
  eventLogged: false,
});

const createInitialClockState = (): ClockState => ({
  currentHalf: 'FIRST',
  isRunning: false,
  firstHalf: createHalfClockState(),
  secondHalf: createHalfClockState(),
});

const getHalfKey = (half: MatchHalf) => (half === 'FIRST' ? 'firstHalf' : 'secondHalf');

const createEmptyLineupState = () => ({
  starters: [] as string[],
  substitutes: [] as string[],
  unavailable: [] as string[],
});

interface TeamSubstitutionState {
  count: number;
  windows: Set<string>;
  playersOut: Set<string>;
}

const sortEvents = (items: MatchEvent[]) =>
  [...items].sort((a, b) => {
    if (a.time.minute !== b.time.minute) {
      return a.time.minute - b.time.minute;
    }

    const addA = a.time.additional ?? 0;
    const addB = b.time.additional ?? 0;

    if (addA !== addB) {
      return addA - addB;
    }

    return a.createdAt.getTime() - b.createdAt.getTime();
  });

export const MatchManagementPage = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const location = useLocation();
  const { matchRepository, teamRepository, tournamentRepository } = useAppDependencies();
  const { user, role } = useAuth();
  const isVocalAccessMode = location.pathname.startsWith('/vocal/match/');
  const vocalAccessSession = useMemo(() => (matchId ? getVocalAccessSession(matchId) : null), [matchId]);

  if (role === 'vocalia' && !isVocalAccessMode && !vocalAccessSession && matchId) {
    return <Navigate to={`/vocal-access/${matchId}`} replace />;
  }

  // Regla: solo se puede REGISTRAR la vocalía (iniciar partido, goles, tarjetas,
  // informes) con un acceso por OTP. El superadmin es la única excepción y puede
  // operar directamente. El admin puede abrir el partido para asignar el OTP y
  // configurar el árbitro, pero no operar la vocalía sin código.
  const canOperateVocalia = role === 'superadmin' || isVocalAccessMode || Boolean(vocalAccessSession);

  const ensureCanOperate = (): boolean => {
    if (canOperateVocalia) {
      return true;
    }
    alert('Para registrar la vocalía necesitas ingresar con el código OTP del partido. Solo el superadministrador puede operar sin código.');
    return false;
  };

  // El enlace del OTP debe apuntar al mismo entorno donde se genera: en desarrollo
  // a localhost (para probar local), en producción al dominio real. Así se evita
  // generar en local un enlace que abre la app desplegada (con datos desincronizados).
  const resolvedBaseUrl = window.location.origin;

  const [match, setMatch] = useState<Match | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [homePlayers, setHomePlayers] = useState<Player[]>([]);
  const [awayPlayers, setAwayPlayers] = useState<Player[]>([]);
  const [homeTeamName, setHomeTeamName] = useState('');
  const [awayTeamName, setAwayTeamName] = useState('');

  // Identidad de quien registra la vocalía. Si se ingresó por acceso de vocalía
  // (enlace OTP), debe quedar registrado el correo del vocal asignado, no el del
  // usuario logueado en el navegador (que puede ser el superadmin que abrió el panel).
  const actingUserIdentity = (isVocalAccessMode || vocalAccessSession)
    ? (vocalAccessSession?.assignedEmail || match?.vocalAccess?.assignedEmail || user?.email || 'vocalia')
    : (user?.email || user?.uid || 'vocalia');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSuspending, setIsSuspending] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  const [eventType, setEventType] = useState<EventFormType>('GOAL');
  const [selectedTeam, setSelectedTeam] = useState<'home' | 'away'>('home');
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [cardType, setCardType] = useState<CardType>('YELLOW');
  const [playerOut, setPlayerOut] = useState('');
  const [playerIn, setPlayerIn] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editSelectedPlayer, setEditSelectedPlayer] = useState('');
  const [editCardType, setEditCardType] = useState<CardType>('YELLOW');
  const [editPlayerOut, setEditPlayerOut] = useState('');
  const [editPlayerIn, setEditPlayerIn] = useState('');
  const [isUpdatingEvent, setIsUpdatingEvent] = useState(false);

  const [lineupDraft, setLineupDraft] = useState({
    home: createEmptyLineupState(),
    away: createEmptyLineupState(),
  });
  const [isSavingLineup, setIsSavingLineup] = useState<{ home: boolean; away: boolean }>({ home: false, away: false });
  const [lineupError, setLineupError] = useState<string | null>(null);
  const [refereeForm, setRefereeForm] = useState({ fullName: '', documentId: '', phoneNumber: '', notes: '' });
  const [isSavingReferee, setIsSavingReferee] = useState(false);
  const [vocalAccessEmail, setVocalAccessEmail] = useState('');
  const [vocaliaUsers, setVocaliaUsers] = useState<VocaliaUser[]>([]);
  const [isLoadingVocaliaUsers, setIsLoadingVocaliaUsers] = useState(false);
  const [vocaliaUsersError, setVocaliaUsersError] = useState<string | null>(null);
  const [generatedVocalOtp, setGeneratedVocalOtp] = useState<string | null>(null);
  const [vocalEmailSent, setVocalEmailSent] = useState<boolean | null>(null);
  const [vocalEmailError, setVocalEmailError] = useState<string | null>(null);
  const [isAssigningVocalAccess, setIsAssigningVocalAccess] = useState(false);
  const [reportNotes, setReportNotes] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [vocalReportNotes, setVocalReportNotes] = useState('');
  const [isSubmittingVocalReport, setIsSubmittingVocalReport] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isSendingPdf, setIsSendingPdf] = useState(false);
  const [isLoggingFirstHalf, setIsLoggingFirstHalf] = useState(false);
  const [isStartingSecondHalf, setIsStartingSecondHalf] = useState(false);
  const [isStartingShootout, setIsStartingShootout] = useState(false);

  const [clockState, setClockState] = useState<ClockState>(createInitialClockState);
  const [isClockLoaded, setIsClockLoaded] = useState(false);
  const timerRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const clockStorageKey = matchId ? `${CLOCK_STORAGE_PREFIX}${matchId}` : null;
  const [extraMinutesDraft, setExtraMinutesDraft] = useState<{ FIRST: string; SECOND: string }>({
    FIRST: '',
    SECOND: '',
  });
  const [isExtraTimeLocked, setIsExtraTimeLocked] = useState<{ FIRST: boolean; SECOND: boolean }>({
    FIRST: false,
    SECOND: false,
  });

  const [isRecordingPenalty, setIsRecordingPenalty] = useState(false);
  const [initialKickingTeam, setInitialKickingTeam] = useState<'home' | 'away'>('home');

  const [shootersDraft, setShootersDraft] = useState<{ home: string[]; away: string[] }>({
    home: [],
    away: [],
  });
  const [isSavingShooters, setIsSavingShooters] = useState(false);

  const isRegularTimeEnded = useMemo(() => {
    return events.some((e) => e.type === 'SECOND_HALF_ENDED');
  }, [events]);

  const hasShootoutStarted = useMemo(() => {
    return events.some((e) => e.type === 'PENALTY_SHOOTOUT_STARTED');
  }, [events]);

  // Tournament-wide stats for player stats display
  const [tournamentPlayerStats, setTournamentPlayerStats] = useState<PlayerStatsSummary[]>([]);
  // Partidos del torneo con sus eventos (tarjetas) poblados. Necesario para calcular
  // suspensiones automáticas: los `matches` del hook no traen los eventos cargados.
  const [matchesWithEvents, setMatchesWithEvents] = useState<Match[]>([]);

  const { matches } = useMatches(match?.tournamentId ?? '');
  const { tournament: tournamentConfig } = useTournament(match?.tournamentId ?? APP_CONFIG.defaultTournamentId);
  const configuredDurationMinutes = Math.max(
    20,
    Math.floor(tournamentConfig?.config.matchDuration ?? DEFAULT_MATCH_DURATION_MINUTES),
  );
  const matchDurationMinutes = configuredDurationMinutes % 2 === 0
    ? configuredDurationMinutes
    : configuredDurationMinutes - 1;
  const halfDurationMinutes = Math.max(1, Math.floor(matchDurationMinutes / 2));
  const extraPromptMinute = Math.max(0, halfDurationMinutes - 2);
  const minPlayersToStart = Math.max(
    1,
    Math.floor(tournamentConfig?.config.minPlayersToStart ?? DEFAULT_MIN_PLAYERS_TO_START),
  );
  // Titulares en cancha (máximo a alinear). Nunca menor que el mínimo para iniciar.
  const playersOnField = Math.max(
    minPlayersToStart,
    Math.floor(tournamentConfig?.config.playersOnField ?? DEFAULT_PLAYERS_ON_FIELD),
  );
  const maxSubstitutionsSetting = Math.floor(tournamentConfig?.config.maxSubstitutions ?? DEFAULT_MAX_SUBSTITUTIONS);
  const maxSubstitutionsAllowed = maxSubstitutionsSetting >= -1 ? maxSubstitutionsSetting : DEFAULT_MAX_SUBSTITUTIONS;
  const maxSubstitutionWindowsSetting = Math.floor(
    tournamentConfig?.config.maxSubstitutionWindows ?? DEFAULT_MAX_SUBSTITUTION_WINDOWS,
  );
  const maxSubstitutionWindowsAllowed = maxSubstitutionWindowsSetting >= -1
    ? maxSubstitutionWindowsSetting
    : DEFAULT_MAX_SUBSTITUTION_WINDOWS;
  const allowReentry = tournamentConfig?.config.allowReentry ?? false;
  const allowExtraTime = tournamentConfig?.config.allowExtraTime ?? true;
  const isExtraTimeContext = Boolean(
    match &&
    match.stage.type === 'KNOCKOUT' &&
    allowExtraTime &&
    isRegularTimeEnded &&
    !hasShootoutStarted &&
    match.status === 'LIVE',
  );
  const activeMatchPeriod = isExtraTimeContext ? 'EXTRA_TIME' : 'REGULAR';

  useEffect(() => {
    if (!matchId || matches.length === 0 || !match) return;
    const latestMatch = matches.find(m => m.id === matchId);
    if (!latestMatch) return;

    if (
      match.score.home !== latestMatch.score.home ||
      match.score.away !== latestMatch.score.away ||
      match.score.penaltiesHome !== latestMatch.score.penaltiesHome ||
      match.score.penaltiesAway !== latestMatch.score.penaltiesAway ||
      match.status !== latestMatch.status
    ) {
      setMatch(prev => prev ? { ...prev, score: latestMatch.score, status: latestMatch.status } : prev);
    }
  }, [matches, matchId, match?.score.home, match?.score.away, match?.score.penaltiesHome, match?.score.penaltiesAway, match?.status]);

  useEffect(() => {
    if (match?.officials?.referee) {
      const referee = match.officials.referee;
      setRefereeForm({
        fullName: referee.fullName ?? '',
        documentId: referee.documentId ?? '',
        phoneNumber: referee.phoneNumber ?? '',
        notes: referee.notes ?? '',
      });
      return;
    }

    setRefereeForm({ fullName: '', documentId: '', phoneNumber: '', notes: '' });
  }, [match?.officials]);

  useEffect(() => {
    if (match?.report?.notes) {
      setReportNotes(match.report.notes);
      return;
    }

    setReportNotes('');
  }, [match?.report]);

  useEffect(() => {
    if (match?.vocalReport?.notes) {
      setVocalReportNotes(match.vocalReport.notes);
      return;
    }

    setVocalReportNotes('');
  }, [match?.vocalReport]);

  // La pre-selección del correo del vocal (incluida la asignación previa) se
  // resuelve en un único efecto más abajo, una vez conocidas las opciones reales
  // del <select> (suggestedVocal + usuarios con rol vocalía). Hacerlo aquí, antes
  // de conocer esas opciones, fijaba el valor a una asignación que ya no existe
  // como opción y provocaba que el desplegable mostrara un correo y se enviara otro.

  useEffect(() => {
    if (isVocalAccessMode) {
      return;
    }

    let isMounted = true;

    const loadVocaliaUsers = async () => {
      try {
        setIsLoadingVocaliaUsers(true);
        setVocaliaUsersError(null);
        const users = await listVocaliaUsers();
        if (!isMounted) {
          return;
        }

        setVocaliaUsers(users);
      } catch (err) {
        console.error('Error loading vocalia users:', err);
        if (!isMounted) {
          return;
        }

        setVocaliaUsers([]);
        setVocaliaUsersError('No se pudo cargar la lista de usuarios con rol vocalía.');
      } finally {
        if (isMounted) {
          setIsLoadingVocaliaUsers(false);
        }
      }
    };

    void loadVocaliaUsers();

    return () => {
      isMounted = false;
    };
  }, [isVocalAccessMode]);

  // El valor por defecto de vocalAccessEmail se calcula más abajo, una vez
  // que conocemos la sugerencia de rotación (ver suggestedVocal).

  const recordEvent = useMemo(
    () => recordMatchEventUseCase({ matchRepository, tournamentRepository, teamRepository }),
    [matchRepository, tournamentRepository, teamRepository],
  );

  const updateLineup = useMemo(
    () => updateMatchLineupUseCase({ matchRepository, teamRepository, tournamentRepository }),
    [matchRepository, teamRepository, tournamentRepository],
  );

  const updateOfficials = useMemo(
    () => updateMatchOfficialsUseCase({ matchRepository }),
    [matchRepository],
  );

  const submitReport = useMemo(
    () => submitMatchReportUseCase({ matchRepository }),
    [matchRepository],
  );

  const submitVocalReport = useMemo(
    () => submitVocalReportUseCase({ matchRepository }),
    [matchRepository],
  );

  const assignVocalAccess = useMemo(
    () => assignVocalAccessUseCase({ matchRepository, teamRepository }),
    [matchRepository, teamRepository],
  );

  const progressKnockout = useMemo(
    () => progressKnockoutStageUseCase({ matchRepository }),
    [matchRepository],
  );

  const deleteEvent = useMemo(
    () => deleteMatchEventUseCase({ matchRepository }),
    [matchRepository],
  );

  const playerLookup = useMemo(() => {
    const map = new Map<string, Player>();
    homePlayers.forEach((player) => map.set(player.id, player));
    awayPlayers.forEach((player) => map.set(player.id, player));
    return map;
  }, [homePlayers, awayPlayers]);

  const lineupState = useMemo(() => {
    if (!match) {
      return { onField: {}, bench: {} } as {
        onField: Record<string, string[]>;
        bench: Record<string, string[]>;
      };
    }

    const homeOnField = new Set(match.lineups?.home?.starters ?? []);
    const awayOnField = new Set(match.lineups?.away?.starters ?? []);
    const homeBench = new Set(match.lineups?.home?.substitutes ?? []);
    const awayBench = new Set(match.lineups?.away?.substitutes ?? []);

    events
      .filter((event): event is MatchEvent & { teamId: string } => event.type === 'SUBSTITUTION' && Boolean(event.teamId))
      .forEach((event) => {
        const teamSet = event.teamId === match.homeTeamId ? homeOnField : event.teamId === match.awayTeamId ? awayOnField : null;
        const benchSet = event.teamId === match.homeTeamId ? homeBench : event.teamId === match.awayTeamId ? awayBench : null;

        if (!teamSet || !benchSet) {
          return;
        }

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

  const substitutionStateByTeam = useMemo(() => {
    const counters = new Map<string, TeamSubstitutionState>();
    events
      .filter((event): event is MatchEvent & { teamId: string } => event.type === 'SUBSTITUTION' && Boolean(event.teamId))
      .forEach((event) => {
        const existing = counters.get(event.teamId) ?? {
          count: 0,
          windows: new Set<string>(),
          playersOut: new Set<string>(),
        };

        existing.count += 1;
        existing.windows.add(`${event.period ?? event.time.period}:${event.time.minute}`);
        if ('playerOutId' in event && event.playerOutId) {
          existing.playersOut.add(event.playerOutId);
        }

        counters.set(event.teamId, existing);
      });
    return counters;
  }, [events]);

  const mapIdsToPlayers = useCallback((ids: string[]) => {
    return ids.map((id) => playerLookup.get(id)).filter(Boolean) as Player[];
  }, [playerLookup]);

  const onFieldPlayersByTeam = useMemo(() => {
    if (!match) {
      return {} as Record<string, Player[]>;
    }

    return {
      [match.homeTeamId]: mapIdsToPlayers(lineupState.onField[match.homeTeamId] ?? []),
      [match.awayTeamId]: mapIdsToPlayers(lineupState.onField[match.awayTeamId] ?? []),
    };
  }, [lineupState, mapIdsToPlayers, match]);

  const benchPlayersByTeam = useMemo(() => {
    if (!match) {
      return {} as Record<string, Player[]>;
    }

    return {
      [match.homeTeamId]: mapIdsToPlayers(lineupState.bench[match.homeTeamId] ?? []),
      [match.awayTeamId]: mapIdsToPlayers(lineupState.bench[match.awayTeamId] ?? []),
    };
  }, [lineupState, mapIdsToPlayers, match]);

  const getOnFieldPlayersForTeam = (teamId?: string | null): Player[] => {
    if (!teamId || !match) {
      return [];
    }
    return onFieldPlayersByTeam[teamId] ?? [];
  };

  const getBenchPlayersForTeam = (teamId?: string | null): Player[] => {
    if (!teamId || !match) {
      return [];
    }
    return benchPlayersByTeam[teamId] ?? [];
  };

  const getPlayerLabel = (playerId?: string) => {
    if (!playerId) {
      return '';
    }

    const player = playerLookup.get(playerId);
    if (!player) {
      return '';
    }

    const base = player.displayName || player.fullName;
    return player.number ? `${base} (#${player.number})` : base;
  };

  const getPlayersForTeam = (teamId?: string | null) => {
    if (!teamId || !match) {
      return [] as Player[];
    }

    if (teamId === match.homeTeamId) {
      return homePlayers;
    }

    if (teamId === match.awayTeamId) {
      return awayPlayers;
    }

    return [] as Player[];
  };

  const startHalfClock = (half: MatchHalf) => {
    setClockState((previous) => {
      const key = getHalfKey(half);
      return {
        currentHalf: half,
        isRunning: true,
        firstHalf:
          half === 'FIRST'
            ? { ...createHalfClockState(), extraMinutes: previous.firstHalf.extraMinutes }
            : previous.firstHalf,
        secondHalf:
          half === 'FIRST'
            ? createHalfClockState()
            : { ...createHalfClockState(), extraMinutes: previous.secondHalf.extraMinutes },
        [key]: {
          ...previous[key],
          elapsedSeconds: 0,
          completed: false,
          eventLogged: false,
        },
      } satisfies ClockState;
    });
  };

  const pauseClock = () => {
    setClockState((previous) => ({ ...previous, isRunning: false }));
  };

  const resumeClock = () => {
    setClockState((previous) => ({ ...previous, isRunning: true }));
  };

  const markHalfEventLogged = (half: MatchHalf) => {
    setClockState((previous) => {
      const key = getHalfKey(half);
      return {
        ...previous,
        [key]: {
          ...previous[key],
          eventLogged: true,
        },
      } satisfies ClockState;
    });
  };

  const handleExtraMinutesChange = (half: MatchHalf, value: string) => {
    const sanitized = value.replace(/[^0-9]/g, '');
    setExtraMinutesDraft((prev) => ({ ...prev, [half]: sanitized }));
  };

  const handleConfirmExtraTime = (half: MatchHalf) => {
    const parsed = Number(extraMinutesDraft[half]);
    if (Number.isNaN(parsed)) return;

    const limited = Math.max(0, Math.min(15, parsed));
    setClockState((previous) => {
      const key = getHalfKey(half);
      return {
        ...previous,
        [key]: {
          ...previous[key],
          extraMinutes: limited,
        },
      } satisfies ClockState;
    });
    setIsExtraTimeLocked((prev) => ({ ...prev, [half]: true }));
  };

  const getHalfElapsedMinutes = (halfState: HalfClockState) => Math.floor(halfState.elapsedSeconds / 60);

  const totalMatchMinutes = useMemo(() => {
    const first = Math.min(
      getHalfElapsedMinutes(clockState.firstHalf),
      halfDurationMinutes + clockState.firstHalf.extraMinutes,
    );
    const second = Math.min(
      getHalfElapsedMinutes(clockState.secondHalf),
      halfDurationMinutes + clockState.secondHalf.extraMinutes,
    );

    if (clockState.currentHalf === 'SECOND' || clockState.secondHalf.elapsedSeconds > 0 || clockState.firstHalf.completed) {
      return first + second;
    }

    return first;
  }, [clockState, halfDurationMinutes]);

  const activeHalfState = clockState.currentHalf === 'FIRST' ? clockState.firstHalf : clockState.secondHalf;
  const activeHalfElapsedMinutes = getHalfElapsedMinutes(activeHalfState);
  const activeHalfTarget = halfDurationMinutes + activeHalfState.extraMinutes;
  const shouldPromptExtra = activeHalfElapsedMinutes >= extraPromptMinute && !activeHalfState.completed;
  const currentMinuteValue = Math.max(0, Math.floor(totalMatchMinutes));
  const activeHalfSeconds = Math.floor(activeHalfState.elapsedSeconds % 60);

  const formattedHalfClock = useMemo(() => {
    const mins = String(activeHalfElapsedMinutes).padStart(2, '0');
    const secs = String(activeHalfSeconds).padStart(2, '0');

    if (activeHalfElapsedMinutes >= halfDurationMinutes && activeHalfState.extraMinutes > 0) {
      const extraMins = activeHalfElapsedMinutes - halfDurationMinutes;
      return (
        <div className="flex items-baseline justify-center gap-2">
          <span>{String(halfDurationMinutes).padStart(2, '0')}:00</span>
          <span className="text-4xl text-red-500">+{extraMins}:{secs}</span>
        </div>
      );
    }
    return <span>{mins}:{secs}</span>;
  }, [activeHalfElapsedMinutes, activeHalfSeconds, activeHalfState.extraMinutes, halfDurationMinutes]);

  const nextPenaltyKicker = useMemo(() => {
    if (!match?.lineups?.penaltyShootersHome || !match?.lineups?.penaltyShootersAway) return null;
    const shootoutEventsList = events
      .filter((e): e is typeof e & { type: 'PENALTY_GOAL' | 'PENALTY_MISSED' } => e.period === 'PENALTY_SHOOTOUT' && (e.type === 'PENALTY_GOAL' || e.type === 'PENALTY_MISSED'))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const homeKicks = shootoutEventsList.filter(e => e.teamId === match.homeTeamId).length;
    const awayKicks = shootoutEventsList.filter(e => e.teamId === match.awayTeamId).length;
    const homeShooters = match.lineups.penaltyShootersHome;
    const awayShooters = match.lineups.penaltyShootersAway;

    if (homeShooters.length === 0 || awayShooters.length === 0) return null;

    let nextTeam: 'home' | 'away' = 'home';
    if (homeKicks > awayKicks) {
      nextTeam = 'away';
    } else if (awayKicks > homeKicks) {
      nextTeam = 'home';
    } else {
      if (shootoutEventsList.length > 0) {
        nextTeam = shootoutEventsList[0].teamId === match.homeTeamId ? 'home' : 'away';
      } else {
        nextTeam = initialKickingTeam;
      }
    }

    const nextTeamKicks = nextTeam === 'home' ? homeKicks : awayKicks;
    const shootersList = nextTeam === 'home' ? homeShooters : awayShooters;
    const nextShooterId = shootersList[nextTeamKicks % shootersList.length];

    return {
      side: nextTeam,
      playerId: nextShooterId,
      teamId: nextTeam === 'home' ? match.homeTeamId : match.awayTeamId,
      teamName: nextTeam === 'home' ? homeTeamName : awayTeamName,
      player: playerLookup.get(nextShooterId)
    };
  }, [events, match, homeTeamName, awayTeamName, playerLookup, initialKickingTeam]);
  const firstHalfNeedsLog = clockState.firstHalf.completed && !clockState.firstHalf.eventLogged;
  const canStartSecondHalfNow =
    clockState.firstHalf.eventLogged &&
    !clockState.isRunning &&
    clockState.secondHalf.elapsedSeconds === 0 &&
    match?.status === 'LIVE';

  const getTeamNameForSide = (side: LineupSide) => (side === 'home' ? homeTeamName : awayTeamName);

  const getPlayersForSide = (side: LineupSide) => (side === 'home' ? homePlayers : awayPlayers);

  const getTeamIdForSide = (side: LineupSide) => {
    if (!match) {
      return undefined;
    }
    return side === 'home' ? match.homeTeamId : match.awayTeamId;
  };

  const editableEventTypes: MatchEvent['type'][] = ['GOAL', 'PENALTY_GOAL', 'OWN_GOAL', 'CARD', 'SUBSTITUTION'];

  const getTeamLabel = (teamId?: string | null) => {
    if (!teamId) {
      return '';
    }

    if (!match) {
      return teamId;
    }

    if (teamId === match.homeTeamId) {
      return homeTeamName;
    }

    if (teamId === match.awayTeamId) {
      return awayTeamName;
    }

    return teamId;
  };

  const buildEventDescription = (event: MatchEvent): string[] => {
    const lines: string[] = [];

    switch (event.type) {
      case 'GOAL':
      case 'PENALTY_GOAL': {
        const scorer = getPlayerLabel(event.scorerId);
        const goalLabel = event.type === 'PENALTY_GOAL' ? 'Gol de penal' : 'Gol';
        lines.push(`${goalLabel}${scorer ? ` de ${scorer}` : ''}.`);
        break;
      }
      case 'OWN_GOAL': {
        const scorer = getPlayerLabel(event.scorerId);
        lines.push(`Autogol${scorer ? ` de ${scorer}` : ''}.`);
        break;
      }
      case 'CARD': {
        const playerName = getPlayerLabel(event.playerId);
        const cardLabel =
          event.cardType === 'RED'
            ? 'Tarjeta roja'
            : event.cardType === 'DOUBLE_YELLOW'
              ? 'Doble amarilla'
              : 'Tarjeta amarilla';
        lines.push(`${cardLabel}${playerName ? ` para ${playerName}` : ''}.`);
        break;
      }
      case 'SUBSTITUTION': {
        const outName = getPlayerLabel(event.playerOutId);
        const inName = getPlayerLabel(event.playerInId);
        lines.push(`Sale ${outName || 'Jugador desconocido'} · Entra ${inName || 'Jugador desconocido'}.`);
        break;
      }
      case 'MATCH_STARTED':
        lines.push('Comienza el partido.');
        break;
      case 'FIRST_HALF_ENDED':
        lines.push('Finaliza el primer tiempo.');
        break;
      case 'SECOND_HALF_STARTED':
        lines.push('Arranca el segundo tiempo.');
        break;
      case 'SECOND_HALF_ENDED':
        lines.push('Finaliza el segundo tiempo.');
        break;
      case 'MATCH_SUSPENDED':
        lines.push('El partido queda suspendido.');
        break;
      case 'MATCH_RESUMED':
        lines.push('Se reanuda el partido.');
        break;
      case 'MATCH_ENDED':
        lines.push('Finaliza el partido.');
        break;
      case 'COMMENT':
        lines.push(event.notes || 'Comentario agregado.');
        break;
      case 'VAR_REVIEW':
        lines.push('Revisión VAR registrada.');
        break;
      case 'PENALTY_MISSED': {
        const shooter = getPlayerLabel(event.scorerId);
        lines.push(`Penal fallado${shooter ? ` por ${shooter}` : ''}.`);
        break;
      }
    }

    if (event.notes && event.type !== 'COMMENT') {
      lines.push(`Nota: ${event.notes}`);
    }

    return lines;
  };

  const eventBeingEdited = useMemo(() => {
    if (!editingEventId) {
      return null;
    }

    return events.find((item) => item.id === editingEventId) ?? null;
  }, [editingEventId, events]);

  useEffect(() => {
    if (!eventBeingEdited) {
      setEditSelectedPlayer('');
      setEditCardType('YELLOW');
      setEditPlayerOut('');
      setEditPlayerIn('');
      return;
    }

    if (eventBeingEdited.type === 'GOAL' || eventBeingEdited.type === 'PENALTY_GOAL' || eventBeingEdited.type === 'OWN_GOAL') {
      setEditSelectedPlayer(eventBeingEdited.scorerId ?? '');
    } else if (eventBeingEdited.type === 'CARD') {
      setEditSelectedPlayer(eventBeingEdited.playerId);
      setEditCardType(eventBeingEdited.cardType);
    } else if (eventBeingEdited.type === 'SUBSTITUTION') {
      setEditPlayerOut(eventBeingEdited.playerOutId);
      setEditPlayerIn(eventBeingEdited.playerInId);
    } else {
      setEditSelectedPlayer('');
    }
  }, [eventBeingEdited]);

  useEffect(() => {
    if (!match) {
      setLineupDraft({ home: createEmptyLineupState(), away: createEmptyLineupState() });
      return;
    }

    setLineupDraft({
      home: {
        starters: match.lineups?.home?.starters ?? [],
        substitutes: match.lineups?.home?.substitutes ?? [],
        unavailable: match.lineups?.home?.unavailable ?? [],
      },
      away: {
        starters: match.lineups?.away?.starters ?? [],
        substitutes: match.lineups?.away?.substitutes ?? [],
        unavailable: match.lineups?.away?.unavailable ?? [],
      },
    });
  }, [match]);

  useEffect(() => {
    if (!clockStorageKey) {
      setClockState(createInitialClockState());
      setIsClockLoaded(true);
      return;
    }

    try {
      const stored = localStorage.getItem(clockStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as ClockState;
        const savedAt = Number(localStorage.getItem(clockStorageKey + ':savedAt') || '0');
        let recovered = { ...createInitialClockState(), ...parsed };

        // Instead of purely relying on `savedAt`, we use the real match events to calculate exactly 
        // how many seconds have elapsed since the clock was running, ensuring perfect synchronization.
        if (recovered.isRunning) {
          const gapSeconds = (Date.now() - savedAt) / 1000;
          if (gapSeconds > 0) {
            const halfKey = recovered.currentHalf === 'FIRST' ? 'firstHalf' : 'secondHalf';
            const halfState = recovered[halfKey];
            const targetSeconds = (halfDurationMinutes + halfState.extraMinutes) * 60;
            const nextElapsed = Math.min(halfState.elapsedSeconds + gapSeconds, targetSeconds);
            const reachedEnd = nextElapsed >= targetSeconds;

            recovered = {
              ...recovered,
              [halfKey]: { ...halfState, elapsedSeconds: nextElapsed, completed: reachedEnd || halfState.completed },
              isRunning: reachedEnd ? false : recovered.isRunning,
            };
          }
        }

        setClockState(recovered);
        setIsExtraTimeLocked({
          FIRST: recovered.firstHalf.extraMinutes > 0,
          SECOND: recovered.secondHalf.extraMinutes > 0,
        });
      } else {
        setClockState(createInitialClockState());
        setIsExtraTimeLocked({ FIRST: false, SECOND: false });
      }
    } catch (err) {
      console.warn('[MatchManagementPage] Failed to parse clock state', err);
      setClockState(createInitialClockState());
    } finally {
      setIsClockLoaded(true);
    }
  }, [clockStorageKey, events, halfDurationMinutes]); // added events to dependencies because we use them to sync

  // Sync clock precisely with event history
  useEffect(() => {
    if (!isClockLoaded || !clockStorageKey || events.length === 0 || !match || match.status !== 'LIVE') return;

    setClockState((previous) => {
      // Find the most recent event that caused the clock to run
      const latestRunEvent = events
        .filter(e => e.type === 'MATCH_STARTED' || e.type === 'MATCH_RESUMED' || e.type === 'SECOND_HALF_STARTED')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      if (!latestRunEvent) return previous;

      // Ensure that there are no Suspended or Ended events AFTER this started event
      const subsequentStopEvent = events.find(e =>
        (e.type === 'MATCH_SUSPENDED' || e.type === 'MATCH_ENDED' || e.type === 'FIRST_HALF_ENDED') &&
        e.createdAt.getTime() > latestRunEvent.createdAt.getTime()
      );

      // If there's a stop event after our start event, or if it isn't running, do nothing
      if (subsequentStopEvent || !previous.isRunning) return previous;

      // Calculate exact elapsed seconds using the timestamp of the event and the minutes recorded
      const halfKey = previous.currentHalf === 'FIRST' ? 'firstHalf' : 'secondHalf';
      const halfState = previous[halfKey];

      const realElapsedMs = Date.now() - latestRunEvent.createdAt.getTime();
      const realElapsedSeconds = Math.floor(realElapsedMs / 1000);

      // The event.time.minute is the minute it started.
      // So total elapsed = (event.time.minute * 60) + realElapsedSeconds.
      // But we need it relative to the half.
      const baseMinuteForHalf = latestRunEvent.type === 'SECOND_HALF_STARTED' ? halfDurationMinutes : 0;
      const expectedTotalSeconds = ((latestRunEvent.time.minute - baseMinuteForHalf) * 60) + realElapsedSeconds;

      const targetSeconds = (halfDurationMinutes + halfState.extraMinutes) * 60;

      // Only update if there's a significant desync (> 5 seconds) to avoid jitter
      if (Math.abs(expectedTotalSeconds - halfState.elapsedSeconds) > 5) {
        const nextElapsed = Math.min(expectedTotalSeconds, targetSeconds);
        const reachedEnd = nextElapsed >= targetSeconds;

        return {
          ...previous,
          [halfKey]: { ...halfState, elapsedSeconds: Math.max(0, nextElapsed), completed: reachedEnd || halfState.completed },
          isRunning: reachedEnd ? false : previous.isRunning,
        };
      }

      return previous;
    });
  }, [isClockLoaded, match?.status, events.length, halfDurationMinutes]); // Intentionally omitting events deeply to prevent continuous trigger


  useEffect(() => {
    if (!clockStorageKey || !isClockLoaded) {
      return;
    }

    localStorage.setItem(clockStorageKey, JSON.stringify(clockState));
    localStorage.setItem(clockStorageKey + ':savedAt', String(Date.now()));
  }, [clockState, clockStorageKey, isClockLoaded]);

  useEffect(() => {
    setExtraMinutesDraft({
      FIRST: clockState.firstHalf.extraMinutes ? String(clockState.firstHalf.extraMinutes) : '',
      SECOND: clockState.secondHalf.extraMinutes ? String(clockState.secondHalf.extraMinutes) : '',
    });
  }, [clockState.firstHalf.extraMinutes, clockState.secondHalf.extraMinutes]);

  useEffect(() => {
    if (!clockState.isRunning || match?.status !== 'LIVE') {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let lastTick = Date.now();
    lastTickRef.current = lastTick;
    timerRef.current = window.setInterval(() => {
      const now = Date.now();
      const deltaSeconds = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      setClockState((previous) => {
        if (!previous.isRunning) {
          return previous;
        }

        const halfKey = previous.currentHalf === 'FIRST' ? 'firstHalf' : 'secondHalf';
        const halfState = previous[halfKey];

        if (halfState.completed) {
          return { ...previous, isRunning: false };
        }

        const targetSeconds = (halfDurationMinutes + halfState.extraMinutes) * 60;
        const nextElapsed = Math.min(halfState.elapsedSeconds + deltaSeconds, targetSeconds);
        const reachedEnd = nextElapsed >= targetSeconds;

        return {
          ...previous,
          [halfKey]: {
            ...halfState,
            elapsedSeconds: nextElapsed,
            completed: reachedEnd || halfState.completed,
          },
          isRunning: reachedEnd ? false : previous.isRunning,
        } satisfies ClockState;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [clockState.isRunning, halfDurationMinutes, match?.status]);

  useEffect(() => {
    // Si cambia el match.status a no 'LIVE', frenamos el reloj.
    // Tambien limpiamos timerRef.
    if (match?.status !== 'LIVE') {
      setClockState((previous) => ({ ...previous, isRunning: false }));
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } else if (match?.status === 'LIVE' && isClockLoaded) {
      // Si es LIVE y está el reloj cargado, asegurar que esté corriendo si no lo estaba
      setClockState((previous) => {
        // Si por alguna razón está LIVE pero isRunning es false, y ninguna mitad completó, o está a la mitad.
        if (!previous.isRunning) {
          const halfKey = previous.currentHalf === 'FIRST' ? 'firstHalf' : 'secondHalf';
          if (!previous[halfKey].completed) {
            return { ...previous, isRunning: true };
          }
        }
        return previous;
      });
    }
  }, [match?.status, isClockLoaded]);

  useEffect(() => {
    if (!matchId) {
      return;
    }

    let unsubscribeTeams: (() => void) | undefined;
    let isActive = true;

    const loadMatchData = async () => {
      try {
        setIsLoading(true);
        const matchData = await matchRepository.findById(matchId);
        if (!matchData) {
          setError('Partido no encontrado');
          return;
        }

        if (!isActive) {
          return;
        }

        setMatch(matchData);

        unsubscribeTeams = teamRepository.listenAll(matchData.tournamentId, {
          onData: (teams) => {
            if (!isActive) {
              return;
            }

            const homeTeam = teams.find((team) => team.id === matchData.homeTeamId);
            const awayTeam = teams.find((team) => team.id === matchData.awayTeamId);

            setHomeTeamName(homeTeam?.name ?? matchData.homeTeamId);
            setAwayTeamName(awayTeam?.name ?? matchData.awayTeamId);
            setHomePlayers(homeTeam?.players ?? []);
            setAwayPlayers(awayTeam?.players ?? []);
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

    loadMatchData();

    const unsubscribeEvents = matchRepository.listenEvents(matchId, {
      onData: (data) => {
        const sorted = sortEvents(data);
        setEvents(sorted);

        setMatch((previous) => {
          if (!previous) {
            return previous;
          }

          let updated: Match | null = null;

          const lastStatusEvent = [...sorted]
            .reverse()
            .find((event) => event.type === 'MATCH_STARTED' || event.type === 'MATCH_ENDED');

          if (lastStatusEvent?.type === 'MATCH_STARTED' && previous.status !== 'LIVE') {
            updated = { ...(updated ?? previous), status: 'LIVE' };
          }

          if (lastStatusEvent?.type === 'MATCH_ENDED' && previous.status !== 'FINISHED') {
            updated = { ...(updated ?? previous), status: 'FINISHED' };
          }

          return updated ?? previous;
        });
      },
      onError: (err) => console.error('Error listening to events:', err),
    }, APP_CONFIG.defaultTournamentId);

    return () => {
      isActive = false;
      unsubscribeEvents();
      unsubscribeTeams?.();
    };
  }, [matchId, matchRepository, teamRepository]);

  // Load tournament-wide stats for suspension detection and player stats display
  const { teams: allTournamentTeams } = useTeams(match?.tournamentId ?? '');

  // Vocal designado automáticamente por rotación: responsable de un equipo del
  // grupo contrario, turnándose entre todos. Determinista para cada partido.
  const suggestedVocal = useMemo(
    () => suggestVocalForMatch(match, matches, allTournamentTeams),
    [match, matches, allTournamentTeams],
  );

  // Pre-selecciona el correo del vocal en el <select>, garantizando que el valor
  // seleccionado SIEMPRE corresponda a una opción real del desplegable. Sin esto,
  // si el admin corrige el correo del responsable (cambia la opción sugerida) pero
  // el estado conserva la asignación previa, el desplegable muestra el correo nuevo
  // mientras que "Generar y enviar" usa el viejo: se reenvía al correo equivocado.
  useEffect(() => {
    if (isVocalAccessMode) {
      return;
    }

    // Correos realmente seleccionables (los mismos que se pintan como <option>).
    const availableEmails = [
      suggestedVocal?.email,
      ...vocaliaUsers.map((vocalUser) => vocalUser.email),
    ].filter((email): email is string => Boolean(email));

    // Aún no hay opciones cargadas: no toques la selección para no perder el valor.
    if (availableEmails.length === 0) {
      return;
    }

    // Conserva la elección actual del admin si sigue siendo una opción válida.
    if (vocalAccessEmail && availableEmails.includes(vocalAccessEmail)) {
      return;
    }

    // Por defecto: la asignación previa solo si todavía es una opción válida; si el
    // correo cambió en administración, cae a la sugerencia por rotación y, si no, al
    // primer usuario con rol vocalía.
    const assignedEmail = match?.vocalAccess?.assignedEmail;
    const nextEmail =
      (assignedEmail && availableEmails.includes(assignedEmail) ? assignedEmail : '') ||
      suggestedVocal?.email ||
      vocaliaUsers[0]?.email ||
      '';

    if (nextEmail && nextEmail !== vocalAccessEmail) {
      setVocalAccessEmail(nextEmail);
    }
  }, [isVocalAccessMode, suggestedVocal, vocaliaUsers, vocalAccessEmail, match?.vocalAccess?.assignedEmail]);

  useEffect(() => {
    if (!match?.tournamentId || allTournamentTeams.length === 0) {
      setTournamentPlayerStats([]);
      return;
    }

    let isActive = true;

    const loadTournamentStats = async () => {
      try {
        const allMatches = await matchRepository.listByTournament(match.tournamentId);
        const finishedOrLive = allMatches.filter((m) => m.status === 'FINISHED' || m.status === 'LIVE');
        const eventsPerMatch = await Promise.all(finishedOrLive.map((m) => matchRepository.listEvents(m.id, m.tournamentId)));
        if (!isActive) return;
        const allEvents = eventsPerMatch.flat();
        const stats = calculatePlayerStats({ teams: allTournamentTeams, events: allEvents });
        setTournamentPlayerStats(stats);

        // Mapear los eventos a cada partido para el cálculo de suspensiones automáticas.
        const eventsByMatch = new Map<string, MatchEvent[]>();
        finishedOrLive.forEach((m, index) => eventsByMatch.set(m.id, eventsPerMatch[index] ?? []));
        const merged = allMatches.map((m) => ({ ...m, events: eventsByMatch.get(m.id) ?? m.events ?? [] }));
        setMatchesWithEvents(merged);
      } catch (err) {
        console.error('[MatchManagementPage] Failed to load tournament stats', err);
      }
    };

    void loadTournamentStats();
    return () => { isActive = false; };
  }, [match?.tournamentId, allTournamentTeams, matchRepository]);

  // Compute suspended players (automatic + manual overrides)
  const suspendedPlayerIds = useMemo(() => {
    const suspended = new Set<string>();

    // Suspensiones automáticas a partir del historial del torneo. Se usan los
    // partidos CON eventos poblados (matchesWithEvents); de lo contrario las
    // tarjetas no se ven y nunca se calcularía una suspensión por tarjeta.
    const historyMatches = matchesWithEvents.length > 0 ? matchesWithEvents : matches;
    if (match && historyMatches.length > 0) {
      const homeSuspensions = calculatePlayerSuspensions(
        match.homeTeamId,
        homePlayers.map((p) => p.id),
        historyMatches,
        match.id,
        tournamentConfig?.config,
      );
      const awaySuspensions = calculatePlayerSuspensions(
        match.awayTeamId,
        awayPlayers.map((p) => p.id),
        historyMatches,
        match.id,
        tournamentConfig?.config,
      );

      homeSuspensions.forEach((status, playerId) => {
        if (status.suspended) suspended.add(playerId);
      });
      awaySuspensions.forEach((status, playerId) => {
        if (status.suspended) suspended.add(playerId);
      });
    }

    // Manual suspensions overrides
    const checkManualSuspension = (players: Player[]) => {
      players.forEach(p => {
        if (p.manualSuspensionMatches && p.manualSuspensionMatches > 0) {
          suspended.add(p.id);
        }
      });
    };
    checkManualSuspension(homePlayers);
    checkManualSuspension(awayPlayers);

    return suspended;
  }, [match, matches, matchesWithEvents, homePlayers, awayPlayers, tournamentConfig?.config]);

  // Stats lookup for quick access
  const playerStatsLookup = useMemo(() => {
    const map = new Map<string, PlayerStatsSummary>();
    tournamentPlayerStats.forEach((stat) => map.set(stat.playerId, stat));
    return map;
  }, [tournamentPlayerStats]);

  const normalizeLineupDraftSide = useCallback((side: LineupSide, current: ReturnType<typeof createEmptyLineupState>) => {
    const sidePlayers = side === 'home' ? homePlayers : awayPlayers;
    const eligibleIds = sidePlayers
      .filter((player) => !suspendedPlayerIds.has(player.id))
      .map((player) => player.id);
    const eligibleSet = new Set(eligibleIds);

    const starters = Array.from(
      new Set(current.starters.filter((playerId) => eligibleSet.has(playerId))),
    );
    const starterSet = new Set(starters);
    const substitutes = Array.from(
      new Set(current.substitutes.filter((playerId) => eligibleSet.has(playerId) && !starterSet.has(playerId))),
    );
    const selectedSet = new Set([...starters, ...substitutes]);
    const unavailable = eligibleIds.filter((playerId) => !selectedSet.has(playerId));

    return {
      starters,
      substitutes,
      unavailable,
    };
  }, [awayPlayers, homePlayers, suspendedPlayerIds]);

  const handleSlotSelect = (side: LineupSide, slotIndex: number, playerId: string) => {
    setLineupDraft((prev) => {
      const current = prev[side];
      const slots = Array.from(
        { length: Math.max(playersOnField, current.starters.length) },
        (_, index) => current.starters[index] ?? '',
      );

      for (let index = 0; index < slots.length; index += 1) {
        if (slots[index] === playerId) {
          slots[index] = '';
        }
      }

      slots[slotIndex] = playerId;
      const starters = slots.filter((id): id is string => Boolean(id));

      const nextSide = normalizeLineupDraftSide(side, {
        ...current,
        starters,
        substitutes: current.substitutes.filter((id) => id !== playerId),
      });

      return {
        ...prev,
        [side]: nextSide,
      };
    });
  };

  const handleRemoveStarter = (side: LineupSide, playerId: string) => {
    setLineupDraft((prev) => {
      const current = prev[side];
      const nextSide = normalizeLineupDraftSide(side, {
        ...current,
        starters: current.starters.filter((id) => id !== playerId),
      });

      return {
        ...prev,
        [side]: nextSide,
      };
    });
  };

  const handleToggleSubstitute = (side: LineupSide, playerId: string) => {
    setLineupDraft((prev) => {
      const current = prev[side];
      if (current.starters.includes(playerId)) {
        return prev;
      }

      const isSubstitute = current.substitutes.includes(playerId);
      const nextSide = normalizeLineupDraftSide(side, {
        ...current,
        substitutes: isSubstitute
          ? current.substitutes.filter((id) => id !== playerId)
          : [...current.substitutes, playerId],
      });

      return {
        ...prev,
        [side]: nextSide,
      };
    });
  };

  useEffect(() => {
    setLineupDraft((prev) => ({
      home: normalizeLineupDraftSide('home', prev.home),
      away: normalizeLineupDraftSide('away', prev.away),
    }));
  }, [normalizeLineupDraftSide]);

  const handleStartMatch = async () => {
    if (!ensureCanOperate()) return;
    if (!match || match.status !== 'SCHEDULED' || isStarting) {
      return;
    }

    // Validate referee info
    if (!match.officials?.referee?.fullName?.trim()) {
      alert('Debes registrar la información del árbitro antes de iniciar el partido.');
      return;
    }

    // Validate both lineups are confirmed
    const homeLineup = match.lineups?.home;
    const awayLineup = match.lineups?.away;

    if (!homeLineup?.confirmedAt) {
      alert('Debes confirmar la alineación del equipo local antes de iniciar el partido.');
      return;
    }
    if (!awayLineup?.confirmedAt) {
      alert('Debes confirmar la alineación del equipo visitante antes de iniciar el partido.');
      return;
    }

    try {
      setIsStarting(true);

      await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: 'MATCH_STARTED',
          timeMinute: 0,
        },
      });

      setMatch((prev) => (prev ? { ...prev, status: 'LIVE' } : prev));
      setExtraMinutesDraft({ FIRST: '', SECOND: '' });
      startHalfClock('FIRST');
    } catch (err) {
      console.error('Error starting match:', err);
      alert('Error al iniciar el partido. Verifica tus permisos.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleEndMatch = async () => {
    if (!ensureCanOperate()) return;
    if (!match || match.status !== 'LIVE' || isEnding) {
      return;
    }

    const isKnockout = match.stage.type === 'KNOCKOUT';
    const isTied = match.score.home === match.score.away;
    const isShootoutOver = match.score.penaltiesHome !== match.score.penaltiesAway;

    if (isKnockout && isTied && !isShootoutOver) {
      if (!isRegularTimeEnded) {
        const confirmationMessage = allowExtraTime
          ? 'El partido está empatado.\n¿Finalizar el tiempo reglamentario para jugar tiempo extra?'
          : 'El partido está empatado.\n¿Finalizar el tiempo reglamentario para ir a la tanda de penales?';
        if (!confirm(confirmationMessage)) {
          return;
        }

        const minuteValue = currentMinuteValue > 0 ? currentMinuteValue : matchDurationMinutes;
        try {
          setIsEnding(true);
          await recordEvent({
            matchId: match.id,
            tournamentId: match.tournamentId,
            recordedBy: actingUserIdentity,
            event: {
              type: 'SECOND_HALF_ENDED',
              timeMinute: minuteValue,
            },
          });
          pauseClock();
        } catch (err) {
          console.error('Error ending regular time:', err);
          alert('Error al finalizar el tiempo reglamentario');
        } finally {
          setIsEnding(false);
        }
        return;
      }

      if (allowExtraTime && !hasShootoutStarted) {
        alert('El torneo permite tiempo extra. Registra eventos en ese periodo o inicia penales para definir el ganador.');
        return;
      }

      alert('El partido está empatado en penales. Debes jugar la tanda de penales para definir un ganador antes de finalizar el partido.');
      return;
    }

    if (!confirm('¿Finalizar el partido?')) {
      return;
    }

    const minuteValue = currentMinuteValue > 0 ? currentMinuteValue : matchDurationMinutes;

    try {
      setIsEnding(true);

      const persistedEvent = await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: 'MATCH_ENDED',
          timeMinute: minuteValue,
        },
      });

      if (persistedEvent.type === 'MATCH_ENDED') {
        setMatch((prev) => (prev ? { ...prev, status: 'FINISHED' } : prev));
        pauseClock();

        // If it's a knockout match, try to progress the stage
        if (match.stage.type === 'KNOCKOUT' && match.stage.knockout) {
          try {
            await progressKnockout({
              tournamentId: match.tournamentId,
              currentStage: match.stage.knockout,
              triggeredBy: user?.email ?? user?.uid ?? 'unknown-user',
              triggeredRole: role ?? 'unknown-role',
              triggerSource: 'match-management',
            });
          } catch (progressErr) {
            console.error('Error progressing knockout stage:', progressErr);
            // We don't block the UI here, just log it. The match ended successfully.
          }
        }
      }
    } catch (err) {
      console.error('Error ending match:', err);
      alert('Error al finalizar el partido');
    } finally {
      setIsEnding(false);
    }
  };

  const handleSuspendMatch = async () => {
    if (!ensureCanOperate()) return;
    if (!match || match.status !== 'LIVE' || isSuspending) {
      return;
    }

    try {
      setIsSuspending(true);
      const event = await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: 'MATCH_SUSPENDED',
          timeMinute: Math.max(0, currentMinuteValue),
        },
      });

      if (event.type === 'MATCH_SUSPENDED') {
        setMatch((prev) => (prev ? { ...prev, status: 'SUSPENDED' } : prev));
        pauseClock();
      }
    } catch (err) {
      console.error('Error suspending match:', err);
      alert('Error al suspender el partido');
    } finally {
      setIsSuspending(false);
    }
  };

  const handleResumeMatch = async () => {
    if (!ensureCanOperate()) return;
    if (!match || match.status !== 'SUSPENDED' || isResuming) {
      return;
    }

    try {
      setIsResuming(true);
      const event = await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: 'MATCH_RESUMED',
          timeMinute: Math.max(0, currentMinuteValue),
        },
      });

      if (event.type === 'MATCH_RESUMED') {
        setMatch((prev) => (prev ? { ...prev, status: 'LIVE' } : prev));
        // Delay resumeClock so that the status change propagates before the useEffect at line ~704
        setTimeout(() => resumeClock(), 50);
      }
    } catch (err) {
      console.error('Error resuming match:', err);
      alert('Error al reanudar el partido');
    } finally {
      setIsResuming(false);
    }
  };

  const handleRecordEvent = async () => {
    if (!ensureCanOperate()) return;
    if (!match || isRecording) {
      return;
    }

    try {
      setIsRecording(true);
      const teamId = selectedTeam === 'home' ? match.homeTeamId : match.awayTeamId;
      const minuteValue = Math.max(0, currentMinuteValue);

      if (eventType === 'GOAL') {
        if (!selectedPlayer) {
          alert('Selecciona un jugador autor del gol');
          return;
        }

        const persistedEvent = await recordEvent({
          matchId: match.id,
          tournamentId: match.tournamentId,
          recordedBy: actingUserIdentity,
          event: {
            type: 'GOAL',
            teamId,
            scorerId: selectedPlayer,
            timeMinute: minuteValue,
            period: activeMatchPeriod,
          },
        });

        if ('updatedScore' in persistedEvent && persistedEvent.updatedScore) {
          setMatch((prev) => (prev ? { ...prev, score: { ...persistedEvent.updatedScore } } : prev));
        }
      } else if (eventType === 'CARD') {
        if (!selectedPlayer) {
          alert('Selecciona un jugador');
          return;
        }
        await recordEvent({
          matchId: match.id,
          tournamentId: match.tournamentId,
          recordedBy: actingUserIdentity,
          event: {
            type: 'CARD',
            teamId,
            playerId: selectedPlayer,
            cardType: effectiveCardType,
            timeMinute: minuteValue,
            period: activeMatchPeriod,
          },
        });
      } else if (eventType === 'SUBSTITUTION') {
        if (!playerOut || !playerIn) {
          alert('Selecciona ambos jugadores');
          return;
        }

        if (playerOut === playerIn) {
          alert('El jugador que sale no puede ser el mismo que entra.');
          return;
        }

        const substitutionState = substitutionStateByTeam.get(teamId);
        const substitutionsUsed = substitutionState?.count ?? 0;

        if (maxSubstitutionsAllowed === 0) {
          alert('Este torneo no permite sustituciones.');
          return;
        }

        if (maxSubstitutionsAllowed >= 0 && substitutionsUsed >= maxSubstitutionsAllowed) {
          alert(`Este equipo ya alcanzó el límite de ${maxSubstitutionsAllowed} cambios.`);
          return;
        }

        if (!allowReentry && (substitutionState?.playersOut.has(playerIn) ?? false)) {
          alert('La configuración del torneo no permite reingreso de jugadores ya sustituidos.');
          return;
        }

        const usedWindows = substitutionState?.windows ?? new Set<string>();
        const currentWindow = `${activeMatchPeriod}:${minuteValue}`;
        if (
          maxSubstitutionWindowsAllowed >= 0 &&
          !usedWindows.has(currentWindow) &&
          usedWindows.size >= maxSubstitutionWindowsAllowed
        ) {
          alert(`Este equipo ya alcanzó el límite de ${maxSubstitutionWindowsAllowed} ventana(s) de cambios.`);
          return;
        }

        await recordEvent({
          matchId: match.id,
          tournamentId: match.tournamentId,
          recordedBy: actingUserIdentity,
          event: {
            type: 'SUBSTITUTION',
            teamId,
            playerOutId: playerOut,
            playerInId: playerIn,
            timeMinute: minuteValue,
            period: activeMatchPeriod,
          },
        });
      }

      // Reset form
      setSelectedPlayer('');
      setPlayerOut('');
      setPlayerIn('');
    } catch (err) {
      console.error('Error recording event:', err);
      alert(err instanceof Error ? err.message : 'Error al registrar el evento');
    } finally {
      setIsRecording(false);
    }
  };

  const handleStartShootout = async () => {
    if (!ensureCanOperate()) return;
    if (!match || isStartingShootout) return;
    try {
      setIsStartingShootout(true);
      await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: 'PENALTY_SHOOTOUT_STARTED',
          timeMinute: currentMinuteValue,
          period: 'PENALTY_SHOOTOUT'
        },
      });
    } catch (err) {
      console.error('Error starting shootout:', err);
      alert('Error al iniciar tanda de penales');
    } finally {
      setIsStartingShootout(false);
    }
  };

  const handleRecordPenaltyShootout = async (isGoal: boolean) => {
    if (!ensureCanOperate()) return;
    if (!match || isRecordingPenalty || !nextPenaltyKicker) return;

    try {
      setIsRecordingPenalty(true);

      const persistedEvent = await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: isGoal ? 'PENALTY_GOAL' : 'PENALTY_MISSED',
          teamId: nextPenaltyKicker.teamId,
          scorerId: nextPenaltyKicker.playerId,
          timeMinute: currentMinuteValue,
          period: 'PENALTY_SHOOTOUT'
        },
      });

      if ('updatedScore' in persistedEvent && persistedEvent.updatedScore) {
        const newScore = persistedEvent.updatedScore;
        setMatch((prev) => (prev ? { ...prev, score: { ...newScore } } : prev));

        // Check for mathematical victory
        const nextShootoutEventsList = [...events, persistedEvent].filter(e => e.period === 'PENALTY_SHOOTOUT' && (e.type === 'PENALTY_GOAL' || e.type === 'PENALTY_MISSED'));
        const homeKicks = nextShootoutEventsList.filter(e => e.teamId === match.homeTeamId).length;
        const awayKicks = nextShootoutEventsList.filter(e => e.teamId === match.awayTeamId).length;
        const homeGoals = newScore.penaltiesHome || 0;
        const awayGoals = newScore.penaltiesAway || 0;

        let isOver = false;
        if (homeKicks <= 5 && awayKicks <= 5) {
          const homeRemaining = 5 - homeKicks;
          const awayRemaining = 5 - awayKicks;
          const maxHome = homeGoals + homeRemaining;
          const maxAway = awayGoals + awayRemaining;
          if (homeGoals > maxAway || awayGoals > maxHome) {
            isOver = true;
          }
        } else if (homeKicks === awayKicks && homeGoals !== awayGoals) {
          isOver = true; // Sudden death
        }

        if (isOver) {
          const winnerName = homeGoals > awayGoals ? homeTeamName : awayGoals > homeGoals ? awayTeamName : 'Empate';
          // Add a comment to mark the end
          await recordEvent({
            matchId: match.id,
            tournamentId: match.tournamentId,
            recordedBy: actingUserIdentity,
            event: {
              type: 'COMMENT',
              timeMinute: currentMinuteValue,
              notes: `¡La tanda de penales ha finalizado con la victoria de ${winnerName}!`,
              period: 'PENALTY_SHOOTOUT'
            },
          });
          alert(`¡La tanda de penales ha finalizado con la victoria de ${winnerName}! Puedes finalizar el partido.`);
        }
      }
    } catch (err) {
      console.error('Error recording penalty shoot:', err);
      alert('Error al registrar el penal');
    } finally {
      setIsRecordingPenalty(false);
    }
  };

  const handleSaveShooters = async () => {
    if (!match) return;
    if (shootersDraft.home.length < 5 || shootersDraft.away.length < 5) {
      alert('Debes seleccionar al menos 5 pateadores para cada equipo.');
      return;
    }

    try {
      setIsSavingShooters(true);
      const nextLineups = {
        ...(match.lineups ?? {}),
        penaltyShootersHome: shootersDraft.home,
        penaltyShootersAway: shootersDraft.away,
      };

      await matchRepository.update(match.id, {
        tournamentId: match.tournamentId,
        lineups: nextLineups,
      });

      setMatch(prev => prev ? { ...prev, lineups: nextLineups } : prev);
    } catch (err) {
      console.error('Error saving shooters:', err);
      alert('No se pudo guardar la lista de pateadores');
    } finally {
      setIsSavingShooters(false);
    }
  };

  const handleCancelEventEdit = () => {
    if (isUpdatingEvent) {
      return;
    }
    setEditingEventId(null);
  };

  const handleSaveEventEdit = async () => {
    if (!match || !eventBeingEdited || isUpdatingEvent) {
      return;
    }

    let updates: Partial<Omit<MatchEvent, 'id'>> | null = null;

    if (eventBeingEdited.type === 'GOAL' || eventBeingEdited.type === 'PENALTY_GOAL' || eventBeingEdited.type === 'OWN_GOAL') {
      if (!editSelectedPlayer) {
        alert('Selecciona el jugador correcto para el gol.');
        return;
      }

      updates = {
        scorerId: editSelectedPlayer,
      } as Partial<Omit<MatchEvent, 'id'>>;
    } else if (eventBeingEdited.type === 'CARD') {
      if (!editSelectedPlayer) {
        alert('Selecciona el jugador amonestado.');
        return;
      }

      updates = {
        playerId: editSelectedPlayer,
        cardType: editCardType,
      } as Partial<Omit<MatchEvent, 'id'>>;
    } else if (eventBeingEdited.type === 'SUBSTITUTION') {
      if (!editPlayerOut || !editPlayerIn) {
        alert('Selecciona los jugadores de la sustitución.');
        return;
      }

      updates = {
        playerOutId: editPlayerOut,
        playerInId: editPlayerIn,
      } as Partial<Omit<MatchEvent, 'id'>>;
    } else {
      alert('Este tipo de evento aún no admite edición.');
      return;
    }

    try {
      setIsUpdatingEvent(true);
      await matchRepository.updateEvent(match.id, eventBeingEdited.id, updates, match.tournamentId);
      setEditingEventId(null);
    } catch (err) {
      console.error('Error updating event:', err);
      alert('No se pudo actualizar el evento');
    } finally {
      setIsUpdatingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!ensureCanOperate()) return;
    if (!match) return;

    if (!window.confirm('¿Estás seguro de que deseas eliminar este evento? Esta acción no se puede deshacer y revertirá el marcador automáticamente si es un gol.')) {
      return;
    }

    try {
      await deleteEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        eventId,
        deletedBy: actingUserIdentity,
      });
      // La subscripción a Firestore actualizará los eventos y el match automáticamente
    } catch (err) {
      console.error('Error deleting event:', err);
      alert(err instanceof Error ? err.message : 'No se pudo eliminar el evento');
    }
  };

  const handleRegisterFirstHalfEnd = async () => {
    if (!match || isLoggingFirstHalf || clockState.firstHalf.eventLogged || !clockState.firstHalf.completed) {
      return;
    }

    try {
      setIsLoggingFirstHalf(true);
      const minuteValue = Math.max(halfDurationMinutes, currentMinuteValue);
      await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: 'FIRST_HALF_ENDED',
          timeMinute: minuteValue,
        },
      });
      markHalfEventLogged('FIRST');
    } catch (err) {
      console.error('Error closing first half:', err);
      alert('No se pudo registrar el fin del primer tiempo.');
    } finally {
      setIsLoggingFirstHalf(false);
    }
  };

  const handleStartSecondHalf = async () => {
    if (!ensureCanOperate()) return;
    if (!match || isStartingSecondHalf || !clockState.firstHalf.eventLogged || match.status !== 'LIVE') {
      return;
    }

    try {
      setIsStartingSecondHalf(true);
      const minuteValue = Math.max(halfDurationMinutes, currentMinuteValue);
      await recordEvent({
        matchId: match.id,
        tournamentId: match.tournamentId,
        recordedBy: actingUserIdentity,
        event: {
          type: 'SECOND_HALF_STARTED',
          timeMinute: minuteValue,
        },
      });
      startHalfClock('SECOND');
    } catch (err) {
      console.error('Error starting second half:', err);
      alert('No se pudo iniciar el segundo tiempo.');
    } finally {
      setIsStartingSecondHalf(false);
    }
  };

  const handleSaveLineup = async (side: LineupSide) => {
    if (!ensureCanOperate()) return;
    if (!match) {
      return;
    }

    const payload = normalizeLineupDraftSide(side, lineupDraft[side]);

    if (payload.starters.length < minPlayersToStart) {
      setLineupError(`Debes seleccionar al menos ${minPlayersToStart} titulares antes de guardar.`);
      return;
    }

    if (payload.starters.length > playersOnField) {
      setLineupError(`No puedes alinear más de ${playersOnField} titulares.`);
      return;
    }

    try {
      setLineupError(null);
      setIsSavingLineup((prev) => ({ ...prev, [side]: true }));
      const nextLineups = await updateLineup({
        matchId: match.id,
        tournamentId: match.tournamentId,
        side,
        starters: payload.starters,
        substitutes: payload.substitutes,
        unavailable: payload.unavailable,
        confirmedBy: actingUserIdentity,
      });
      setLineupDraft((prev) => ({ ...prev, [side]: payload }));
      setMatch((prev) => (prev ? { ...prev, lineups: nextLineups } : prev));
    } catch (err) {
      console.error('Error saving lineup:', err);
      setLineupError(err instanceof Error ? err.message : 'No se pudo guardar la alineación');
    } finally {
      setIsSavingLineup((prev) => ({ ...prev, [side]: false }));
    }
  };

  const handleSaveReferee = async () => {
    if (!match) {
      return;
    }

    if (!refereeForm.fullName.trim()) {
      alert('Ingresa el nombre completo del árbitro.');
      return;
    }

    try {
      setIsSavingReferee(true);
      const nextOfficials = await updateOfficials({
        matchId: match.id,
        tournamentId: match.tournamentId,
        referee: {
          fullName: refereeForm.fullName,
          documentId: refereeForm.documentId,
          phoneNumber: refereeForm.phoneNumber,
          notes: refereeForm.notes,
        },
      });
      setMatch((prev) => (prev ? { ...prev, officials: nextOfficials } : prev));
    } catch (err) {
      console.error('Error saving referee info:', err);
      alert(err instanceof Error ? err.message : 'No se pudo guardar la información del árbitro');
    } finally {
      setIsSavingReferee(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!ensureCanOperate()) return;
    if (!match) {
      return;
    }

    if (match.status !== 'FINISHED') {
      alert('El informe solo puede registrarse cuando el partido ha finalizado.');
      return;
    }

    if (!reportNotes.trim()) {
      alert('Ingresa el informe del árbitro.');
      return;
    }

    try {
      setIsSubmittingReport(true);
      const savedReport = await submitReport({
        matchId: match.id,
        tournamentId: match.tournamentId,
        notes: reportNotes,
        submittedBy: actingUserIdentity,
      });
      setMatch((prev) => (prev ? { ...prev, report: savedReport } : prev));
    } catch (err) {
      console.error('Error submitting report:', err);
      alert(err instanceof Error ? err.message : 'No se pudo guardar el informe.');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleSubmitVocalReport = async () => {
    if (!ensureCanOperate()) return;
    if (!match) {
      return;
    }

    if (match.status !== 'FINISHED') {
      alert('El reporte del vocal solo puede registrarse cuando el partido ha finalizado.');
      return;
    }

    if (!vocalReportNotes.trim()) {
      alert('Ingresa el reporte del vocal.');
      return;
    }

    try {
      setIsSubmittingVocalReport(true);
      const savedReport = await submitVocalReport({
        matchId: match.id,
        tournamentId: match.tournamentId,
        notes: vocalReportNotes,
        submittedBy: actingUserIdentity,
      });
      setMatch((prev) => (prev ? { ...prev, vocalReport: savedReport } : prev));
      alert('Reporte del vocal guardado correctamente.');
    } catch (err) {
      console.error('Error submitting vocal report:', err);
      alert(err instanceof Error ? err.message : 'No se pudo guardar el reporte del vocal.');
    } finally {
      setIsSubmittingVocalReport(false);
    }
  };

  const handleAssignVocalAccess = async () => {
    if (!match || isAssigningVocalAccess || isVocalAccessMode) {
      return;
    }

    const normalizedEmail = vocalAccessEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      alert('Selecciona un usuario con rol vocalía.');
      return;
    }

    try {
      setIsAssigningVocalAccess(true);
      setGeneratedVocalOtp(null);
      setVocalEmailSent(null);
      setVocalEmailError(null);

      const assigned = await assignVocalAccess({
        matchId: match.id,
        tournamentId: match.tournamentId,
        vocalEmail: normalizedEmail,
        assignedBy: actingUserIdentity,
        accessBaseUrl: resolvedBaseUrl,
        accessHours: 24,
      });

      setGeneratedVocalOtp(assigned.otp);
      setVocalEmailSent(assigned.emailSent);
      setVocalEmailError(assigned.emailError ?? null);
      setVocalAccessEmail(assigned.assignedEmail);

      const refreshedMatch = await matchRepository.findById(match.id, match.tournamentId);
      if (refreshedMatch) {
        setMatch(refreshedMatch);
      }
    } catch (err) {
      console.error('Error assigning vocal access:', err);
      alert(err instanceof Error ? err.message : 'No se pudo generar y enviar el acceso al vocal.');
    } finally {
      setIsAssigningVocalAccess(false);
    }
  };

  // Construye el informe PDF del partido y devuelve el documento jsPDF (sin guardarlo).
  const buildMatchPdf = (): jsPDF => {
    if (!match) {
      throw new Error('No hay partido cargado.');
    }

    {
      const doc = new jsPDF();
      let cursorY = 0;
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2;

      const ensureSpace = (height = 8) => {
        if (cursorY + height > 280) {
          doc.addPage();
          cursorY = 20;
        }
      };

      // ── Header ──────────────────────────────
      doc.setFillColor(30, 41, 59); // slate-800
      doc.rect(0, 0, pageWidth, 42, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('INFORME DEL PARTIDO', margin, 18);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.text(`${homeTeamName}  vs  ${awayTeamName}`, margin, 28);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      const scoreText = `${match.score.home} - ${match.score.away}`;
      doc.text(scoreText, pageWidth - margin, 24, { align: 'right' });
      if (match.score.penaltiesHome !== undefined && match.score.penaltiesAway !== undefined && (match.score.penaltiesHome > 0 || match.score.penaltiesAway > 0)) {
        doc.setFontSize(14);
        doc.text(`(P: ${match.score.penaltiesHome} - ${match.score.penaltiesAway})`, pageWidth - margin, 32, { align: 'right' });
      }
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Fecha: ${match.scheduledAt.toLocaleString('es-ES')}`, margin, 37);
      cursorY = 52;

      // Helper: section title with colored bar
      const drawSection = (title: string) => {
        ensureSpace(16);
        doc.setFillColor(99, 102, 241); // indigo-500
        doc.rect(margin, cursorY - 4, 3, 10, 'F');
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text(title, margin + 6, cursorY + 3);
        cursorY += 12;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(55, 65, 81);
      };

      const writeRow = (label: string, value?: string) => {
        ensureSpace(7);
        doc.setFont('helvetica', 'bold');
        doc.text(label, margin + 4, cursorY);
        doc.setFont('helvetica', 'normal');
        const safeValue = value || 'N/A';
        const valueLines = doc.splitTextToSize(safeValue, contentWidth - 50);
        valueLines.forEach((line: string, idx: number) => {
          if (idx === 0) {
            doc.text(line, margin + 46, cursorY);
          } else {
            cursorY += 5;
            ensureSpace();
            doc.text(line, margin + 46, cursorY);
          }
        });
        cursorY += 6;
      };

      const writePlain = (text: string) => {
        const lines = doc.splitTextToSize(text, contentWidth - 8);
        lines.forEach((line: string) => {
          ensureSpace();
          doc.text(line, margin + 4, cursorY);
          cursorY += 5;
        });
      };

      // ── Player Stats ─────────────────────────────
      drawSection('DESEMPEÑO INDIVIDUAL');

      const drawTeamStats = (teamName: string, players: Player[]) => {
        ensureSpace(20);
        doc.setFillColor(241, 245, 249); // slate-100
        doc.roundedRect(margin, cursorY - 4, contentWidth, 8, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(30, 41, 59);
        doc.text(teamName, margin + 4, cursorY + 2);
        cursorY += 10;

        // Table Header
        doc.setFontSize(9);
        doc.setTextColor(55, 65, 81);
        doc.text('Jugador', margin + 4, cursorY);
        doc.text('Goles', margin + 80, cursorY, { align: 'center' });
        doc.text('Amarillas', margin + 110, cursorY, { align: 'center' });
        doc.text('Rojas', margin + 140, cursorY, { align: 'center' });
        doc.setLineWidth(0.2);
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, cursorY + 2, margin + contentWidth, cursorY + 2);
        cursorY += 7;

        // Rows
        doc.setFont('helvetica', 'normal');

        players.forEach(p => {
          let goals = 0;
          let yellows = 0;
          let reds = 0;

          events.forEach(e => {
            if ((e.type === 'GOAL' || e.type === 'PENALTY_GOAL') && 'scorerId' in e && e.scorerId === p.id) {
              // If it's a penalty goal from shootout period, let's decide if it counts. Usually penalty shootout goals don't count for player stats but let's just include all for simplicity, or exclude them? The user said "goles". We check regular + extra time
              if (e.period !== 'PENALTY_SHOOTOUT') {
                goals++;
              }
            }
            if (e.type === 'CARD' && 'playerId' in e && e.playerId === p.id) {
              if (e.cardType === 'YELLOW') {
                yellows = Math.min(2, yellows + 1);
              }
              if (e.cardType === 'DOUBLE_YELLOW') {
                yellows = 2;
                reds++;
              }
              if (e.cardType === 'RED') reds++;
            }
          });

          // only draw row if player has stats or was in the lineup
          const isInLineup = match.lineups?.home?.starters.includes(p.id) || match.lineups?.home?.substitutes.includes(p.id) ||
            match.lineups?.away?.starters.includes(p.id) || match.lineups?.away?.substitutes.includes(p.id) || goals > 0 || yellows > 0 || reds > 0;

          if (isInLineup) {
            ensureSpace(6);
            doc.text(p.displayName || p.fullName, margin + 4, cursorY);
            doc.text(goals.toString(), margin + 80, cursorY, { align: 'center' });
            doc.text(yellows.toString(), margin + 110, cursorY, { align: 'center' });
            doc.text(reds.toString(), margin + 140, cursorY, { align: 'center' });

            doc.setDrawColor(240, 240, 240);
            doc.line(margin, cursorY + 2, margin + contentWidth, cursorY + 2);
            cursorY += 6;
          }
        });
        cursorY += 4;
      };

      drawTeamStats(homeTeamName, homePlayers);
      drawTeamStats(awayTeamName, awayPlayers);

      // ── Referee ─────────────────────────────
      drawSection('\u00c1RBITRO');
      if (match.officials?.referee) {
        writeRow('Nombre:', match.officials.referee.fullName);
        if (match.officials.referee.phoneNumber) {
          writeRow('Tel\u00e9fono:', match.officials.referee.phoneNumber);
        }
      } else {
        writePlain('Sin informaci\u00f3n registrada.');
      }
      cursorY += 4;

      // ── Report ──────────────────────────────
      drawSection('INFORME DEL \u00c1RBITRO');
      if (match.report?.notes) {
        ensureSpace(12);
        doc.setFillColor(241, 245, 249);
        const reportLines = doc.splitTextToSize(match.report.notes, contentWidth - 12);
        const blockHeight = reportLines.length * 5 + 6;
        doc.roundedRect(margin, cursorY - 4, contentWidth, blockHeight, 2, 2, 'F');
        doc.setTextColor(55, 65, 81);
        reportLines.forEach((line: string) => {
          ensureSpace();
          doc.text(line, margin + 6, cursorY);
          cursorY += 5;
        });
        cursorY += 4;
      } else {
        writePlain('Sin informe registrado.');
        cursorY += 4;
      }

      // ── Vocal Report ──────────────────────────────
      drawSection('REPORTE DEL VOCAL');
      if (match.vocalReport?.notes) {
        ensureSpace(12);
        doc.setFillColor(241, 245, 249);
        const vocalReportLines = doc.splitTextToSize(match.vocalReport.notes, contentWidth - 12);
        const vocalBlockHeight = vocalReportLines.length * 5 + 6;
        doc.roundedRect(margin, cursorY - 4, contentWidth, vocalBlockHeight, 2, 2, 'F');
        doc.setTextColor(55, 65, 81);
        vocalReportLines.forEach((line: string) => {
          ensureSpace();
          doc.text(line, margin + 6, cursorY);
          cursorY += 5;
        });
        cursorY += 4;
      } else {
        writePlain('Sin reporte de vocal registrado.');
        cursorY += 4;
      }

      // ── Events ──────────────────────────────
      drawSection('CRONOLOG\u00cdA DE EVENTOS');
      if (events.length === 0) {
        writePlain('No se registraron eventos.');
      } else {
        events.forEach((event, idx) => {
          ensureSpace(14);

          // Alternate row background
          if (idx % 2 === 0) {
            doc.setFillColor(248, 250, 252); // slate-50
            doc.rect(margin, cursorY - 4, contentWidth, 12, 'F');
          }

          // Minute badge
          const minuteLabel = `${event.time.minute}'`;
          doc.setFillColor(99, 102, 241);
          doc.roundedRect(margin + 2, cursorY - 3, 14, 7, 1, 1, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.text(minuteLabel, margin + 9, cursorY + 2, { align: 'center' });

          // Event type label
          doc.setTextColor(30, 41, 59);
          doc.setFontSize(9);
          const typeLabels: Record<string, string> = {
            GOAL: '[G] Gol',
            PENALTY_GOAL: '[P] Penal',
            OWN_GOAL: '[A] Autogol',
            CARD: event.type === 'CARD' ? (event.cardType === 'RED' ? '[R] Roja' : event.cardType === 'DOUBLE_YELLOW' ? '[RA] Doble Amarilla' : '[A] Amarilla') : '',
            SUBSTITUTION: '[C] Cambio',
            MATCH_STARTED: '[>] Inicio',
            FIRST_HALF_ENDED: '[||] Fin 1T',
            SECOND_HALF_STARTED: '[>] Inicio 2T',
            SECOND_HALF_ENDED: '[||] Fin 2T',
            MATCH_SUSPENDED: '[!] Suspensi\u00f3n',
            MATCH_RESUMED: '[>] Reanudaci\u00f3n',
            MATCH_ENDED: '[X] Final',
          };
          const typeLabel = typeLabels[event.type] || event.type;
          doc.text(typeLabel, margin + 20, cursorY + 2);

          // Team & description
          const teamLabel = getTeamLabel(event.teamId);
          const desc = buildEventDescription(event).join(' ');
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(75, 85, 99);
          const fullDesc = teamLabel ? `${teamLabel}: ${desc}` : desc;
          doc.text(fullDesc, margin + 56, cursorY + 2);

          cursorY += 12;
        });
      }

      // ── Footer ──────────────────────────────
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(156, 163, 175);
        doc.text(`P\u00e1gina ${i} de ${totalPages}`, pageWidth / 2, 290, { align: 'center' });
        doc.text('Generado por Vocalia', margin, 290);
      }

      return doc;
    }
  };

  const handleGeneratePdf = () => {
    if (!match) return;
    try {
      setIsGeneratingPdf(true);
      const doc = buildMatchPdf();
      doc.save(`partido-${match.id}.pdf`);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('No se pudo generar el PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleSendPdf = async () => {
    if (!match) return;
    try {
      setIsSendingPdf(true);

      const [homeTeam, awayTeam] = await Promise.all([
        teamRepository.findById({ teamId: match.homeTeamId, tournamentId: match.tournamentId }),
        teamRepository.findById({ teamId: match.awayTeamId, tournamentId: match.tournamentId }),
      ]);

      const vocalEmail = match.vocalAccess?.assignedEmail ?? '';
      const FIXED_RECIPIENT = 'melendezvicente22@gmail.com';

      const recipients = Array.from(
        new Set(
          [
            ...(homeTeam?.representativeEmails ?? []),
            ...(awayTeam?.representativeEmails ?? []),
            vocalEmail,
            FIXED_RECIPIENT,
          ]
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
        ),
      );

      // Construir la tabla de desempeño de un equipo.
      const buildTeamStatsRows = (players: Player[]): string => {
        return players
          .map((p) => {
            let goals = 0;
            let yellows = 0;
            let reds = 0;
            events.forEach((ev) => {
              if ((ev.type === 'GOAL' || ev.type === 'PENALTY_GOAL') && 'scorerId' in ev && ev.scorerId === p.id && ev.period !== 'PENALTY_SHOOTOUT') goals++;
              if (ev.type === 'CARD' && 'playerId' in ev && ev.playerId === p.id) {
                if (ev.cardType === 'YELLOW') yellows = Math.min(2, yellows + 1);
                if (ev.cardType === 'DOUBLE_YELLOW') { yellows = 2; reds++; }
                if (ev.cardType === 'RED') reds++;
              }
            });
            const inLineup =
              match.lineups?.home?.starters.includes(p.id) ||
              match.lineups?.home?.substitutes.includes(p.id) ||
              match.lineups?.away?.starters.includes(p.id) ||
              match.lineups?.away?.substitutes.includes(p.id) ||
              goals > 0 || yellows > 0 || reds > 0;
            if (!inLineup) return '';
            return `<tr>
              <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;">${p.displayName || p.fullName}${p.number ? ` <span style="color:#94a3b8;">#${p.number}</span>` : ''}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:center;">${goals}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:center;">${yellows > 0 ? `<span style="background:#fbbf24;color:#fff;padding:1px 6px;border-radius:4px;">${yellows}</span>` : '0'}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:center;">${reds > 0 ? `<span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:4px;">${reds}</span>` : '0'}</td>
            </tr>`;
          })
          .filter(Boolean)
          .join('');
      };

      const buildTeamTable = (teamName: string, players: Player[]): string => {
        const rows = buildTeamStatsRows(players);
        if (!rows) return '';
        return `
          <h3 style="margin:12px 0 4px;color:#1e293b;font-size:14px;">${teamName}</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:5px 8px;text-align:left;color:#475569;">Jugador</th>
                <th style="padding:5px 8px;text-align:center;color:#475569;">Goles</th>
                <th style="padding:5px 8px;text-align:center;color:#475569;">Amarillas</th>
                <th style="padding:5px 8px;text-align:center;color:#475569;">Rojas</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`;
      };

      const CARD_ICONS: Record<string, string> = {
        YELLOW: '🟨', DOUBLE_YELLOW: '🟨🟥', RED: '🟥',
      };
      const EVENT_ICONS: Record<string, string> = {
        GOAL: '⚽', PENALTY_GOAL: '⚽ (P)', OWN_GOAL: '⚽ (AG)',
        CARD: '🃏', SUBSTITUTION: '🔄', MATCH_STARTED: '▶️',
        HALF_TIME: '⏸️', SECOND_HALF_STARTED: '▶️', MATCH_ENDED: '🏁',
        SECOND_HALF_ENDED: '⏸️', PENALTY_SHOOTOUT_STARTED: '🎯',
      };
      const eventsHtml = events.map((ev, idx) => {
        const bg = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
        const icon = ev.type === 'CARD' && 'cardType' in ev
          ? (CARD_ICONS[ev.cardType] ?? '🃏')
          : (EVENT_ICONS[ev.type] ?? '•');
        const desc = buildEventDescription(ev).join(' — ');
        return `<tr style="background:${bg};">
          <td style="padding:5px 8px;font-weight:bold;color:#6366f1;width:36px;">${ev.time.minute}'</td>
          <td style="padding:5px 8px;">${icon} ${desc}</td>
        </tr>`;
      }).join('');

      const penalties = (match.score.penaltiesHome ?? 0) > 0 || (match.score.penaltiesAway ?? 0) > 0
        ? ` <small style="color:#64748b;">(penales ${match.score.penaltiesHome ?? 0}-${match.score.penaltiesAway ?? 0})</small>`
        : '';

      const htmlBody = `
<div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1e293b;">
  <!-- Header -->
  <div style="background:#1e293b;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:20px;">INFORME DEL PARTIDO</h1>
    <p style="margin:4px 0 0;font-size:14px;color:#94a3b8;">${homeTeamName} vs ${awayTeamName}</p>
    <div style="margin-top:8px;font-size:28px;font-weight:bold;">${match.score.home} - ${match.score.away}${penalties}</div>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">Fecha: ${match.scheduledAt.toLocaleString('es-ES')}${match.venue ? ` · ${match.venue}` : ''}</p>
  </div>

  <div style="border:1px solid #e2e8f0;border-top:none;padding:16px 20px;border-radius:0 0 8px 8px;">
    <!-- Desempeño individual -->
    <h2 style="font-size:15px;border-left:3px solid #6366f1;padding-left:8px;margin:12px 0 8px;">DESEMPEÑO INDIVIDUAL</h2>
    ${buildTeamTable(homeTeamName, homePlayers)}
    ${buildTeamTable(awayTeamName, awayPlayers)}

    <!-- Árbitro -->
    <h2 style="font-size:15px;border-left:3px solid #6366f1;padding-left:8px;margin:20px 0 8px;">ÁRBITRO</h2>
    ${match.officials?.referee
      ? `<p style="margin:4px 0;font-size:13px;"><strong>Nombre:</strong> ${match.officials.referee.fullName}${match.officials.referee.phoneNumber ? ` &nbsp;|&nbsp; <strong>Tel:</strong> ${match.officials.referee.phoneNumber}` : ''}</p>`
      : '<p style="font-size:13px;color:#94a3b8;">Sin información registrada.</p>'
    }

    <!-- Informe del árbitro -->
    <h2 style="font-size:15px;border-left:3px solid #6366f1;padding-left:8px;margin:20px 0 8px;">INFORME DEL ÁRBITRO</h2>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;font-size:13px;white-space:pre-wrap;">
      ${match.report?.notes ?? '<span style="color:#94a3b8;">Sin informe registrado.</span>'}
    </div>

    <!-- Reporte del vocal -->
    <h2 style="font-size:15px;border-left:3px solid #6366f1;padding-left:8px;margin:20px 0 8px;">REPORTE DEL VOCAL</h2>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;font-size:13px;white-space:pre-wrap;">
      ${match.vocalReport?.notes ?? '<span style="color:#94a3b8;">Sin reporte del vocal registrado.</span>'}
    </div>

    <!-- Cronología -->
    <h2 style="font-size:15px;border-left:3px solid #6366f1;padding-left:8px;margin:20px 0 8px;">CRONOLOGÍA DE EVENTOS</h2>
    ${eventsHtml
      ? `<table style="width:100%;border-collapse:collapse;font-size:13px;">${eventsHtml}</table>`
      : '<p style="font-size:13px;color:#94a3b8;">No se registraron eventos.</p>'
    }

    <p style="margin-top:24px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px;">
      Generado por Vocalia · Copa Mazorca de Oro
    </p>
  </div>
</div>`;

      const subject = `Informe del partido - ${homeTeamName} vs ${awayTeamName}`;
      const results = await Promise.allSettled(
        recipients.map((to) => sendMail({ to, subject, htmlBody })),
      );

      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length === 0) {
        alert(`Informe enviado correctamente a ${recipients.length} destinatario(s):\n${recipients.join('\n')}`);
      } else {
        const reason = failed[0].reason;
        const errText = typeof (reason as { text?: unknown })?.text === 'string'
          ? (reason as { text: string }).text
          : reason instanceof Error ? reason.message : String(reason);
        alert(
          failed.length < results.length
            ? `Enviado a ${results.length - failed.length} de ${results.length} destinatarios. Error: ${errText}`
            : `No se pudo enviar a ningún destinatario.\nMotivo: ${errText}`,
        );
      }
    } catch (err) {
      console.error('Error sending match report email:', err);
      alert(err instanceof Error ? err.message : 'No se pudo enviar el informe.');
    } finally {
      setIsSendingPdf(false);
    }
  };

  // Track expelled players (RED or DOUBLE_YELLOW card in this match)
  const expelledPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    events.forEach((e) => {
      if (e.type === 'CARD' && (e.cardType === 'RED' || e.cardType === 'DOUBLE_YELLOW')) {
        ids.add(e.playerId);
      }
    });
    return ids;
  }, [events]);

  // Track players who already have a YELLOW card in this match
  const yellowCardPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    events.forEach((e) => {
      if (e.type === 'CARD' && e.cardType === 'YELLOW') {
        ids.add(e.playerId);
      }
    });
    return ids;
  }, [events]);

  // Auto-escalate card type: if player already has a YELLOW, switch to DOUBLE_YELLOW
  const effectiveCardType = useMemo(() => {
    if (cardType === 'YELLOW' && selectedPlayer && yellowCardPlayerIds.has(selectedPlayer)) {
      return 'DOUBLE_YELLOW' as CardType;
    }
    return cardType;
  }, [cardType, selectedPlayer, yellowCardPlayerIds]);

  const isShootoutOverMathematically = useMemo(() => {
    if (!match || match.status !== 'LIVE') return false;
    const hasEndComment = events.some(e => e.period === 'PENALTY_SHOOTOUT' && e.type === 'COMMENT' && e.notes?.includes('victoria de'));
    if (hasEndComment) return true;

    const shootoutEventsList = events.filter(e => e.period === 'PENALTY_SHOOTOUT' && (e.type === 'PENALTY_GOAL' || e.type === 'PENALTY_MISSED'));
    const homeKicks = shootoutEventsList.filter(e => e.teamId === match.homeTeamId).length;
    const awayKicks = shootoutEventsList.filter(e => e.teamId === match.awayTeamId).length;
    const homeGoals = match.score.penaltiesHome || 0;
    const awayGoals = match.score.penaltiesAway || 0;

    if (homeKicks <= 5 && awayKicks <= 5) {
      const homeRemaining = 5 - homeKicks;
      const awayRemaining = 5 - awayKicks;
      const maxHome = homeGoals + homeRemaining;
      const maxAway = awayGoals + awayRemaining;
      if (homeGoals > maxAway || awayGoals > maxHome) return true;
    } else if (homeKicks === awayKicks && homeGoals !== awayGoals) {
      return true; // Sudden death
    }
    return false;
  }, [match, events]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Cargando partido...</div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-red-50 p-4 text-red-700">{error || 'Partido no encontrado'}</div>
        <Link to={isVocalAccessMode ? '/' : '/admin'} className="text-indigo-600 hover:text-indigo-700">
          {isVocalAccessMode ? '← Volver al inicio' : '← Volver al panel de administración'}
        </Link>
      </div>
    );
  }

  const selectedTeamRoster = getPlayersForSide(selectedTeam);
  const selectedTeamId = getTeamIdForSide(selectedTeam);
  const onFieldOptions = getOnFieldPlayersForTeam(selectedTeamId).filter((p) => !expelledPlayerIds.has(p.id));
  const benchOptions = getBenchPlayersForTeam(selectedTeamId).filter((p) => !expelledPlayerIds.has(p.id));
  const goalOptions = onFieldOptions.length > 0 ? onFieldOptions : selectedTeamRoster.filter((p) => !expelledPlayerIds.has(p.id));
  const cardOptions = goalOptions;
  const substitutionOutOptions = onFieldOptions.length > 0 ? onFieldOptions : selectedTeamRoster.filter((p) => !expelledPlayerIds.has(p.id));
  const substitutionInOptions = benchOptions.length > 0 ? benchOptions : selectedTeamRoster.filter((p) => !expelledPlayerIds.has(p.id));
  const selectedSubstitutionState = selectedTeamId ? substitutionStateByTeam.get(selectedTeamId) : undefined;
  const substitutionsUsedBySelectedTeam = selectedSubstitutionState?.count ?? 0;
  const substitutionsRemainingBySelectedTeam = maxSubstitutionsAllowed < 0
    ? null
    : Math.max(0, maxSubstitutionsAllowed - substitutionsUsedBySelectedTeam);
  const substitutionWindowsUsedBySelectedTeam = selectedSubstitutionState?.windows.size ?? 0;
  const substitutionsWindowsRemainingBySelectedTeam = maxSubstitutionWindowsAllowed < 0
    ? null
    : Math.max(0, maxSubstitutionWindowsAllowed - substitutionWindowsUsedBySelectedTeam);
  const substitutionLimitReached = eventType === 'SUBSTITUTION' && substitutionsRemainingBySelectedTeam !== null
    ? substitutionsRemainingBySelectedTeam <= 0
    : false;
  const substitutionSelectionDisabled =
    maxSubstitutionsAllowed === 0 ||
    (substitutionsRemainingBySelectedTeam !== null && substitutionsRemainingBySelectedTeam <= 0);
  const substitutionInOptionsFiltered = substitutionInOptions.filter(
    (player) => allowReentry || !(selectedSubstitutionState?.playersOut.has(player.id) ?? false),
  );
  const canStart = match.status === 'SCHEDULED';
  const canRecord = match.status === 'LIVE';
  const hasPlayers = selectedTeamRoster.length > 0;
  const existingReport = match.report;
  const existingVocalReport = match.vocalReport;
  const canSubmitReport = match.status === 'FINISHED' && !existingReport;
  const canSubmitVocalReport = match.status === 'FINISHED' && !existingVocalReport;
  const canGeneratePdf = match.status === 'FINISHED';
  const showLineups = match.status === 'SCHEDULED';
  const showRefereeForm = match.status === 'SCHEDULED';
  const showClockPanel = match.status !== 'SCHEDULED';
  const vocalAccessLink = `${resolvedBaseUrl}/vocal-access/${match.id}`;

  const eventButtonDisabled =
    isRecording ||
    substitutionLimitReached ||
    (eventType === 'SUBSTITUTION' && maxSubstitutionsAllowed === 0);
  const reportButtonDisabled = !reportNotes.trim() || isSubmittingReport || !canSubmitReport;
  const vocalReportButtonDisabled = !vocalReportNotes.trim() || isSubmittingVocalReport || !canSubmitVocalReport;

  return (
    <div className="space-y-6">
      {!canOperateVocalia && !isVocalAccessMode && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Modo solo asignación</p>
          <p className="mt-1">
            Puedes generar y enviar el código OTP y configurar el árbitro, pero para registrar la vocalía
            (iniciar el partido, goles, tarjetas e informes) hay que ingresar con el código OTP del partido.
            Solo el superadministrador puede operar sin código.
          </p>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        {!isVocalAccessMode ? (
          <Link to="/admin" className="text-indigo-600 hover:text-indigo-700">
            ← Volver al panel
          </Link>
        ) : (
          <span className="text-sm text-gray-500">Acceso de vocalía por código</span>
        )}
        {match.status === 'LIVE' && (
          <span className="animate-pulse rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white">
            EN VIVO
          </span>
        )}
        {match.status === 'SUSPENDED' && (
          <span className="rounded-full bg-yellow-400 px-4 py-2 text-sm font-semibold text-yellow-900">
            SUSPENDIDO
          </span>
        )}
        {match.status === 'FINISHED' && (
          <span className="rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700">FINALIZADO</span>
        )}
      </div>

      {/* Match Info */}
      <div className="rounded-lg border-2 border-gray-200 bg-white p-6 shadow-lg">
        <div className="mb-4 text-center text-sm text-gray-500">
          {match.scheduledAt.toLocaleDateString('es-ES', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
          {' - '}
          {match.scheduledAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <div className="text-center">
            <div className="mb-2 text-2xl font-bold text-gray-900">{homeTeamName}</div>
            <div className="text-sm text-gray-500">Local</div>
          </div>

          <div className="text-center">
            <div className="text-4xl font-bold text-gray-900">
              {match.score.home} - {match.score.away}
            </div>
            {(match.score.penaltiesHome !== undefined || match.score.penaltiesAway !== undefined) &&
              (match.score.penaltiesHome! > 0 || match.score.penaltiesAway! > 0) && (
                <div className="mt-1 text-lg font-semibold text-gray-600">
                  P: ({match.score.penaltiesHome || 0}) - ({match.score.penaltiesAway || 0})
                </div>
              )}
          </div>

          <div className="text-center">
            <div className="mb-2 text-2xl font-bold text-gray-900">{awayTeamName}</div>
            <div className="text-sm text-gray-500">Visitante</div>
          </div>
        </div>

        {canStart && (
          <div className="mt-6 text-center">
            <button
              onClick={handleStartMatch}
              disabled={isStarting}
              className="rounded-md bg-green-600 px-8 py-3 text-lg font-semibold text-white hover:bg-green-700 disabled:bg-green-400"
            >
              Iniciar Partido
            </button>
          </div>
        )}

        {(match.status === 'LIVE' || match.status === 'SUSPENDED') && (
          <div className="mt-6 space-y-4 rounded-lg bg-gray-50 p-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Minuto actual</label>
              <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xl font-semibold text-gray-900">
                {currentMinuteValue}'
              </div>
              <p className="mt-1 text-xs text-gray-500">La vocalía usa este valor en suspensiones, reanudaciones y fin del partido.</p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {match.status === 'LIVE' && (
                <button
                  onClick={handleSuspendMatch}
                  disabled={isSuspending}
                  className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-yellow-900 hover:bg-yellow-400 disabled:bg-yellow-200"
                >
                  Suspender partido
                </button>
              )}
              {match.status === 'SUSPENDED' && (
                <button
                  onClick={handleResumeMatch}
                  disabled={isResuming}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
                >
                  Reanudar partido
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {!isVocalAccessMode && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-cyan-900">Acceso por código para vocalía</h2>
              <p className="text-sm text-cyan-800">
                Genera un OTP de 6 dígitos y envíalo por correo al vocal asignado. El acceso expira en 24 horas.
              </p>
              {suggestedVocal && (
                <p className="mt-1 text-xs font-semibold text-cyan-900">
                  Vocal designado por rotación: responsable de {suggestedVocal.teamName} (Grupo {suggestedVocal.fromGroup}) — {suggestedVocal.email}. Puedes cambiarlo abajo.
                </p>
              )}
            </div>
            {match.vocalAccess?.expiresAt && (
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-900">
                Vigente hasta {new Date(match.vocalAccess.expiresAt).toLocaleString('es-ES')}
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <select
              value={vocalAccessEmail}
              onChange={(event) => setVocalAccessEmail(event.target.value)}
              className="w-full rounded-md border border-cyan-300 px-3 py-2"
              disabled={isLoadingVocaliaUsers || (vocaliaUsers.length === 0 && !suggestedVocal)}
            >
              <option value="" disabled>
                {isLoadingVocaliaUsers
                  ? 'Cargando usuarios vocalía...'
                  : (vocaliaUsers.length === 0 && !suggestedVocal)
                    ? 'No hay vocal disponible'
                    : 'Selecciona el vocal'}
              </option>
              {suggestedVocal && (
                <optgroup label="Designado por rotación (grupo contrario)">
                  <option value={suggestedVocal.email}>
                    Responsable {suggestedVocal.teamName} ({suggestedVocal.email})
                  </option>
                </optgroup>
              )}
              {vocaliaUsers.filter((vocalUser) => vocalUser.email !== suggestedVocal?.email).length > 0 && (
                <optgroup label="Otros vocales (rol vocalía)">
                  {vocaliaUsers
                    .filter((vocalUser) => vocalUser.email !== suggestedVocal?.email)
                    .map((vocalUser) => (
                      <option key={vocalUser.id} value={vocalUser.email}>
                        {vocalUser.displayName ? `${vocalUser.displayName} (${vocalUser.email})` : vocalUser.email}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            <button
              onClick={handleAssignVocalAccess}
              disabled={isAssigningVocalAccess || isLoadingVocaliaUsers || !vocalAccessEmail.trim()}
              className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:bg-cyan-300"
            >
              {isAssigningVocalAccess ? 'Enviando...' : 'Generar y enviar código'}
            </button>
          </div>

          {vocaliaUsersError && (
            <p className="mt-2 text-xs text-red-700">{vocaliaUsersError}</p>
          )}

          {!isLoadingVocaliaUsers && !vocaliaUsersError && vocaliaUsers.length === 0 && !suggestedVocal && (
            <p className="mt-2 text-xs text-cyan-900">
              No hay vocal disponible: agrega correos de responsables a los equipos del grupo contrario, o crea usuarios con rol vocalía en el panel de usuarios.
            </p>
          )}

          {match.vocalAccess && (
            <p className="mt-3 text-xs text-cyan-900">
              Asignado a {match.vocalAccess.assignedEmail} por {match.vocalAccess.assignedBy} el{' '}
              {new Date(match.vocalAccess.assignedAt).toLocaleString('es-ES')}.
            </p>
          )}

          {generatedVocalOtp && (
            <div className="mt-4 space-y-2">
              <div className="rounded-md border border-cyan-300 bg-cyan-50 p-3 text-sm text-cyan-900">
                <p className="text-lg font-bold tracking-widest">{generatedVocalOtp}</p>
                <p className="mt-1 text-xs font-medium">Código OTP — compártelo con el vocal si el correo no llegó.</p>
                <p className="mt-2 break-all text-xs">
                  Enlace: <a href={vocalAccessLink} className="font-medium underline">{vocalAccessLink}</a>
                </p>
              </div>
              {vocalEmailSent === true && (
                <p className="text-xs text-green-700">Correo enviado correctamente a {vocalAccessEmail}.</p>
              )}
              {vocalEmailSent === false && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  <p className="font-semibold">El correo no se pudo enviar.</p>
                  {vocalEmailError && <p className="mt-0.5 text-amber-700">{vocalEmailError}</p>}
                  <p className="mt-1">Usa el código de arriba para dárselo al vocal manualmente.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isVocalAccessMode && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">
            Acceso validado para {vocalAccessSession?.assignedEmail || match.vocalAccess?.assignedEmail || 'vocal asignado'}.
          </p>
          <p>
            Sesión válida hasta{' '}
            {new Date(vocalAccessSession?.expiresAt || match.vocalAccess?.expiresAt || Date.now()).toLocaleString('es-ES')}.
          </p>
        </div>
      )}

      {showClockPanel && (
        <div className="rounded-lg border-2 border-indigo-100 bg-white p-6 shadow-lg">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Cronómetro</p>
              <p className="text-2xl font-bold text-gray-900">{HALF_LABELS[clockState.currentHalf]}</p>
              <p className="text-sm text-gray-500">{clockState.isRunning ? 'En curso' : 'Detenido'}</p>
            </div>
            <div className="text-center">
              <div className="font-mono text-6xl font-bold text-gray-900">{formattedHalfClock}</div>
              <p className="mt-2 text-sm text-gray-500">Objetivo {activeHalfTarget}'</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-500">Minuto total</p>
              <p className="text-4xl font-semibold text-gray-900">{currentMinuteValue}'</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {(['FIRST', 'SECOND'] as MatchHalf[]).map((half) => {
              const state = half === 'FIRST' ? clockState.firstHalf : clockState.secondHalf;
              const isDisabled = clockState.currentHalf !== half;
              const isLocked = isExtraTimeLocked[half];

              return (
                <div key={half} className={`flex flex-col rounded-md border p-4 text-sm ${isDisabled ? 'border-gray-100 bg-gray-100 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-900'}`}>
                  <label className="mb-2 font-semibold">{HALF_LABELS[half]} · minutos extra</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d*"
                      value={isLocked ? state.extraMinutes.toString() : extraMinutesDraft[half]}
                      placeholder={`${state.extraMinutes}`}
                      onChange={(event) => handleExtraMinutesChange(half, event.target.value)}
                      disabled={isDisabled || isLocked}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-base disabled:bg-gray-200 disabled:text-gray-400 flex-1"
                    />
                    {!isLocked && !isDisabled && extraMinutesDraft[half] !== '' && (
                      <button
                        onClick={() => handleConfirmExtraTime(half)}
                        className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:bg-gray-400"
                      >
                        Confirmar
                      </button>
                    )}
                  </div>
                  <span className="mt-2 text-xs text-gray-500">
                    {isLocked
                      ? `Aplicado al minuto ${halfDurationMinutes + state.extraMinutes}'${state.completed ? ' · Tiempo cumplido' : ''}`
                      : `Se aplicará al minuto ${halfDurationMinutes + (Number(extraMinutesDraft[half]) || 0)}'`}
                  </span>
                </div>
              );
            })}
          </div>

          {shouldPromptExtra && (
            <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
              Estás por concluir {HALF_LABELS[clockState.currentHalf].toLowerCase()}. Define los minutos de adición necesarios.
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {firstHalfNeedsLog && (
              <button
                onClick={handleRegisterFirstHalfEnd}
                disabled={isLoggingFirstHalf}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {isLoggingFirstHalf ? 'Registrando...' : 'Registrar fin del 1er tiempo'}
              </button>
            )}
            {canStartSecondHalfNow && (
              <button
                onClick={handleStartSecondHalf}
                disabled={isStartingSecondHalf}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-green-300"
              >
                {isStartingSecondHalf ? 'Iniciando...' : 'Iniciar segundo tiempo'}
              </button>
            )}
          </div>
        </div>
      )}



      {/* Lineups */}
      {showLineups && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Alineaciones oficiales</h2>
              <p className="text-sm text-gray-500">
                Marca titulares y suplentes desde la lista de inscritos. Los jugadores que no estén en ninguna de esas categorías se registrarán automáticamente como No asistió.
              </p>
            </div>
            {(match.lineups?.home?.confirmedAt || match.lineups?.away?.confirmedAt) && (
              <span className="text-xs text-gray-500">
                Última actualización: {new Date(Math.max(
                  match.lineups?.home?.confirmedAt?.getTime() ?? 0,
                  match.lineups?.away?.confirmedAt?.getTime() ?? 0,
                )).toLocaleString('es-ES')}
              </span>
            )}
          </div>

          {lineupError && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{lineupError}</div>}

          <div className="grid gap-6 md:grid-cols-2">
            {(['home', 'away'] as LineupSide[]).map((side) => {
              const teamName = getTeamNameForSide(side);
              const players = getPlayersForSide(side);
              const starters = lineupDraft[side].starters;
              const substitutes = lineupDraft[side].substitutes;
              const startersCount = starters.length;
              const savedLineup = match.lineups?.[side];
              const starterSet = new Set(starters);
              const substituteSet = new Set(substitutes);

              // Available players for starter slots (not starter and not suspended)
              const availableForSelection = players.filter(
                (p) => !starterSet.has(p.id) && !suspendedPlayerIds.has(p.id),
              );

              const substituteCandidates = players.filter(
                (p) => !starterSet.has(p.id) && !suspendedPlayerIds.has(p.id),
              );

              const selectedSubstitutes = substituteCandidates.filter((player) => substituteSet.has(player.id));

              const autoUnavailablePlayers = players.filter(
                (player) =>
                  !suspendedPlayerIds.has(player.id) &&
                  !starterSet.has(player.id) &&
                  !substituteSet.has(player.id),
              );

              // Suspended players from this team
              const suspendedFromTeam = players.filter((p) => suspendedPlayerIds.has(p.id));

              return (
                <div key={side} className="flex flex-col rounded-md border border-gray-200 p-4">
                  <div className="mb-3 space-y-1">
                    <div className="text-lg font-semibold text-gray-900">{teamName}</div>
                    <div className="text-sm text-gray-500">
                      {startersCount}/{playersOnField} titulares (mín. {minPlayersToStart} para jugar)
                    </div>
                    {savedLineup?.confirmedAt && (
                      <div className="text-xs text-gray-400">
                        Confirmado por {savedLineup.confirmedBy || 'N/D'} el {savedLineup.confirmedAt.toLocaleString('es-ES')}
                      </div>
                    )}
                  </div>

                  {players.length === 0 ? (
                    <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
                      Agrega jugadores para este equipo desde la sección de Equipos.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Starter Slots */}
                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-gray-700">Titulares</h4>
                        <div className="space-y-2">
                          {Array.from({ length: playersOnField }).map((_, slotIndex) => {
                            const selectedId = starters[slotIndex] ?? '';
                            const selectedPlayerData = selectedId ? playerLookup.get(selectedId) : null;
                            const stats = selectedId ? playerStatsLookup.get(selectedId) : null;

                            return (
                              <div key={`${side}-slot-${slotIndex}`} className="rounded-md border border-gray-200 bg-gray-50 p-2">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                                    {slotIndex + 1}
                                  </span>
                                  {selectedId ? (
                                    <div className="flex flex-1 items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {selectedPlayerData?.photoUrl ? (
                                          <img
                                            src={selectedPlayerData.photoUrl}
                                            alt={selectedPlayerData.displayName || selectedPlayerData.fullName}
                                            className="h-8 w-8 rounded-full object-cover border border-indigo-200"
                                          />
                                        ) : (
                                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-500">
                                            {(selectedPlayerData?.displayName || selectedPlayerData?.fullName || '?')
                                              .split(' ')
                                              .map((w: string) => w[0]?.toUpperCase() ?? '')
                                              .slice(0, 2)
                                              .join('')}
                                          </span>
                                        )}
                                        <div>
                                          <span className="text-sm font-semibold text-gray-900">
                                            {selectedPlayerData?.displayName || selectedPlayerData?.fullName || 'Jugador'}
                                          </span>
                                          <span className="ml-2 text-xs text-gray-500">
                                            {selectedPlayerData?.number ? `#${selectedPlayerData.number}` : ''} {selectedPlayerData?.position ?? ''}
                                          </span>
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => handleRemoveStarter(side, selectedId)}
                                        className="text-xs font-semibold text-red-500 hover:text-red-700"
                                      >
                                        Quitar
                                      </button>
                                    </div>
                                  ) : (
                                    <select
                                      value=""
                                      onChange={(e) => {
                                        if (e.target.value) handleSlotSelect(side, slotIndex, e.target.value);
                                      }}
                                      className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                                    >
                                      <option value="">-- Seleccionar jugador --</option>
                                      {availableForSelection.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.displayName || p.fullName} {p.number ? `#${p.number}` : ''}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                                {/* Player stats when selected */}
                                {stats && (
                                  <div className="mt-1 flex gap-3 pl-9 text-[11px] text-gray-500">
                                    <span>Goles: <strong className="text-gray-700">{stats.goals}</strong></span>
                                    <span>🟨 <strong className="text-yellow-600">{stats.yellowCards}</strong></span>
                                    <span>🟥 <strong className="text-red-600">{stats.redCards}</strong></span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Substitutes selector */}
                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-gray-700">
                          Suplentes ({selectedSubstitutes.length})
                        </h4>
                        {substituteCandidates.length === 0 ? (
                          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                            No hay jugadores habilitados para suplencia.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {substituteCandidates.map((player) => {
                              const stats = playerStatsLookup.get(player.id);
                              const isChecked = substituteSet.has(player.id);

                              return (
                                <label key={player.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-100 bg-white px-3 py-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleSubstitute(side, player.id)}
                                    className="mt-1 rounded border-gray-300"
                                  />
                                  <div className="flex-1">
                                    <div className="font-medium text-gray-800">
                                      {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                                    </div>
                                    {stats && (
                                      <div className="mt-0.5 flex gap-2 text-[11px] text-gray-500">
                                        <span>G:{stats.goals}</span>
                                        <span className="text-yellow-600">🟨{stats.yellowCards}</span>
                                        <span className="text-red-600">🟥{stats.redCards}</span>
                                      </div>
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Suspended players warning */}
                      {suspendedFromTeam.length > 0 && (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3">
                          <h4 className="mb-1 text-sm font-semibold text-red-700">Suspendidos ({suspendedFromTeam.length})</h4>
                          <div className="space-y-1">
                            {suspendedFromTeam.map((p) => {
                              const stats = playerStatsLookup.get(p.id);
                              return (
                                <div key={p.id} className="flex items-center justify-between text-sm text-red-700">
                                  <span>{p.displayName || p.fullName} {p.number ? `#${p.number}` : ''}</span>
                                  <span className="text-[11px]">
                                    {stats?.redCards ? `🟥${stats.redCards} roja(s)` : ''}
                                    {stats?.doubleYellowCards ? ` 🟨🟨${stats.doubleYellowCards}` : ''}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Automatically calculated unavailable players */}
                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-gray-700">
                          No asistieron (automático) ({autoUnavailablePlayers.length})
                        </h4>
                        {autoUnavailablePlayers.length === 0 ? (
                          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                            Todos los jugadores habilitados fueron asignados como titulares o suplentes.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {autoUnavailablePlayers.map((player) => (
                              <div key={player.id} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm text-gray-600">
                                {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => handleSaveLineup(side)}
                    disabled={isSavingLineup[side] || players.length === 0}
                    className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300"
                  >
                    {isSavingLineup[side] ? 'Guardando...' : 'Guardar alineación'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Event Recording */}
      {canRecord && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Registrar Evento</h2>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Tipo de evento</label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as EventFormType)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                >
                  <option value="GOAL">⚽ Gol</option>
                  <option value="CARD">🟨 Tarjeta</option>
                  <option value="SUBSTITUTION">🔄 Cambio</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Equipo</label>
                <select
                  value={selectedTeam}
                  onChange={(e) => setSelectedTeam(e.target.value as 'home' | 'away')}
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                >
                  <option value="home">{homeTeamName}</option>
                  <option value="away">{awayTeamName}</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Minuto (automático)</label>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-lg font-semibold text-gray-900">
                  {currentMinuteValue}'
                </div>
                <p className="mt-1 text-xs text-gray-500">Se calcula con el cronómetro en vivo.</p>
              </div>
            </div>

            {eventType === 'GOAL' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Autor del gol <span className="text-red-500">*</span></label>
                <select
                  value={selectedPlayer}
                  onChange={(e) => setSelectedPlayer(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                >
                  <option value="">Sin especificar</option>
                  {goalOptions.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {eventType === 'CARD' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Tipo de tarjeta</label>
                  <select
                    value={cardType}
                    onChange={(e) => setCardType(e.target.value as CardType)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                  >
                    <option value="YELLOW">🟨 Amarilla</option>
                    <option value="RED">🟥 Roja</option>
                  </select>
                  {selectedPlayer && yellowCardPlayerIds.has(selectedPlayer) && cardType === 'YELLOW' && (
                    <p className="mt-1 text-xs font-semibold text-orange-600">⚠️ Este jugador ya tiene amarilla. Se registrará como doble amarilla automáticamente.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Jugador</label>
                  <select
                    value={selectedPlayer}
                    onChange={(e) => setSelectedPlayer(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                  >
                    <option value="">Seleccionar...</option>
                    {cardOptions.map((player) => {
                      const hasYellow = yellowCardPlayerIds.has(player.id);
                      return (
                        <option key={player.id} value={player.id}>
                          {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}{hasYellow ? ' ⚠️ Ya tiene amarilla' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            )}

            {eventType === 'SUBSTITUTION' && (
              <div className="space-y-3">
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  Cambios usados: {substitutionsUsedBySelectedTeam}/{maxSubstitutionsAllowed < 0 ? 'Sin límite' : maxSubstitutionsAllowed}
                  {maxSubstitutionsAllowed < 0
                    ? ' · Cambios ilimitados'
                    : substitutionsRemainingBySelectedTeam && substitutionsRemainingBySelectedTeam > 0
                      ? ` · Restan ${substitutionsRemainingBySelectedTeam}`
                      : ' · Límite alcanzado'}
                  {` · Ventanas ${substitutionWindowsUsedBySelectedTeam}/${maxSubstitutionWindowsAllowed < 0 ? 'Sin límite' : maxSubstitutionWindowsAllowed}`}
                  {maxSubstitutionWindowsAllowed < 0
                    ? ' (ilimitadas)'
                    : substitutionsWindowsRemainingBySelectedTeam && substitutionsWindowsRemainingBySelectedTeam > 0
                      ? ` · Restan ${substitutionsWindowsRemainingBySelectedTeam}`
                      : ' · Sin ventanas disponibles'}
                  {allowReentry ? ' · Reingreso permitido' : ' · Sin reingreso'}
                  {isExtraTimeContext ? ' · Periodo actual: Tiempo extra' : ''}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Sale</label>
                  <select
                    value={playerOut}
                    onChange={(e) => setPlayerOut(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    disabled={substitutionSelectionDisabled}
                  >
                    <option value="">Seleccionar...</option>
                    {substitutionOutOptions.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                      </option>
                    ))}
                  </select>
                  </div>
                  <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Entra</label>
                  <select
                    value={playerIn}
                    onChange={(e) => setPlayerIn(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    disabled={substitutionSelectionDisabled}
                  >
                    <option value="">Seleccionar...</option>
                    {substitutionInOptionsFiltered.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                      </option>
                    ))}
                  </select>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleRecordEvent}
                disabled={eventButtonDisabled}
                className="flex-1 rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-400"
              >
                Registrar Evento
              </button>
              <button
                onClick={handleEndMatch}
                disabled={isEnding}
                className="rounded-md bg-red-600 px-6 py-2 font-semibold text-white hover:bg-red-700 disabled:bg-red-400"
              >
                Finalizar Partido
              </button>
            </div>
          </div>

          {!hasPlayers && (
            <div className="mt-4 rounded-md bg-yellow-50 p-3 text-sm text-yellow-700">
              ⚠️ No hay jugadores registrados para este equipo. Agrega jugadores desde el panel de administración para
              poder seleccionarlos en goles, tarjetas y cambios.
            </div>
          )}
        </div>
      )}

      {/* Penalty Shootout (Knockout only) */}
      {canRecord && match.stage.type === 'KNOCKOUT' && match.score.home === match.score.away && isRegularTimeEnded && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold text-purple-900">Tanda de Penales</h2>
                {events.some(e => e.type === 'PENALTY_SHOOTOUT_STARTED') && (
                  <div className="flex items-center gap-2 rounded-full bg-purple-900 px-4 py-1 font-bold text-white">
                    <span>{match.score.penaltiesHome || 0}</span>
                    <span>-</span>
                    <span>{match.score.penaltiesAway || 0}</span>
                  </div>
                )}
              </div>
              <p className="text-sm text-purple-700 mt-1">El partido está empatado. Registra los penales para definir el ganador.</p>
            </div>
            {events.some(e => e.type === 'PENALTY_SHOOTOUT_STARTED') ? (
              <span className="rounded-full bg-purple-200 px-3 py-1 text-xs font-semibold text-purple-800">
                Tanda en curso
              </span>
            ) : match.lineups?.penaltyShootersHome && match.lineups?.penaltyShootersHome.length >= 5 ? (
              <button
                onClick={handleStartShootout}
                disabled={isStartingShootout}
                className="rounded-md bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-700 disabled:bg-purple-400"
              >
                {isStartingShootout ? 'Iniciando...' : 'Iniciar Tanda'}
              </button>
            ) : (
              <span className="rounded-full bg-yellow-200 px-3 py-1 text-xs font-semibold text-yellow-800">
                Configuración requerida
              </span>
            )}
          </div>

          {!events.some(e => e.type === 'PENALTY_SHOOTOUT_STARTED') && (!match.lineups?.penaltyShootersHome || match.lineups?.penaltyShootersHome?.length < 5) && (
            <div className="mt-6 flex flex-col gap-6">
              <div className="rounded-md bg-white p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold text-gray-800">Paso 1: Configurar Pateadores (Mínimo 5)</h3>
                <div className="grid gap-6 md:grid-cols-2">
                  {(['home', 'away'] as const).map(side => {
                    const playersOnField = getOnFieldPlayersForTeam(side === 'home' ? match?.homeTeamId : match?.awayTeamId);
                    const availablePlayers = playersOnField.filter(p => !expelledPlayerIds.has(p.id) && !shootersDraft[side].includes(p.id));

                    return (
                      <div key={`shooters-${side}`}>
                        <div className="mb-2 flex items-center justify-between">
                          <label className="text-sm font-medium text-gray-700">{side === 'home' ? homeTeamName : awayTeamName}</label>
                          <span className="text-xs text-gray-500">{shootersDraft[side].length} pateadores</span>
                        </div>
                        <div className="space-y-2">
                          {shootersDraft[side].map((shooterId, idx) => (
                            <div key={`shooter-${side}-${idx}`} className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                              <span className="flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">{idx + 1}</span>
                                {getPlayerLabel(shooterId)}
                              </span>
                              <button
                                onClick={() => setShootersDraft(prev => ({ ...prev, [side]: prev[side].filter((_, i) => i !== idx) }))}
                                className="text-red-500 hover:text-red-700 text-xs font-semibold"
                              >
                                Quitar
                              </button>
                            </div>
                          ))}
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                setShootersDraft(prev => ({ ...prev, [side]: [...prev[side], e.target.value] }));
                              }
                            }}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          >
                            <option value="">Añadir pateador...</option>
                            {availablePlayers.map(p => (
                              <option key={p.id} value={p.id}>{getPlayerLabel(p.id)}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleSaveShooters}
                    disabled={isSavingShooters || shootersDraft.home.length < 5 || shootersDraft.away.length < 5}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300"
                  >
                    {isSavingShooters ? 'Guardando...' : 'Guardar Pateadores'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {events.some(e => e.type === 'PENALTY_SHOOTOUT_STARTED') && nextPenaltyKicker && (
            <div className="mt-6 flex flex-col gap-4">
              {!events.some(e => e.period === 'PENALTY_SHOOTOUT' && (e.type === 'PENALTY_GOAL' || e.type === 'PENALTY_MISSED')) && (
                <div className="mb-2">
                  <label className="mb-1 block text-sm font-medium text-purple-800">Elige quién patea el primer penal</label>
                  <select
                    value={initialKickingTeam}
                    onChange={(e) => setInitialKickingTeam(e.target.value as 'home' | 'away')}
                    className="w-full rounded-md border border-purple-300 px-3 py-2"
                  >
                    <option value="home">{homeTeamName}</option>
                    <option value="away">{awayTeamName}</option>
                  </select>
                  <p className="mt-1 text-xs text-purple-600">A partir del primer cobro, los turnos se alternarán automáticamente.</p>
                </div>
              )}
              <div className="rounded-md border-2 border-purple-200 bg-white p-6 text-center shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-wide text-purple-600 mb-2">Siguiente Pateador</div>
                <div className="text-3xl font-bold text-gray-900 mb-1">{nextPenaltyKicker.player?.displayName || nextPenaltyKicker.player?.fullName}</div>
                <div className="text-xl font-medium text-purple-800">{nextPenaltyKicker.teamName}</div>
              </div>
              {!isShootoutOverMathematically ? (
                <div className="flex gap-4">
                  <button
                    onClick={() => handleRecordPenaltyShootout(true)}
                    disabled={isRecordingPenalty}
                    className="flex-1 rounded-md bg-green-600 px-4 py-3 font-bold text-white shadow hover:bg-green-700 disabled:bg-gray-400 disabled:shadow-none min-h-[60px]"
                  >
                    ⚽ GOL
                  </button>
                  <button
                    onClick={() => handleRecordPenaltyShootout(false)}
                    disabled={isRecordingPenalty}
                    className="flex-1 rounded-md bg-red-600 px-4 py-3 font-bold text-white shadow hover:bg-red-700 disabled:bg-gray-400 disabled:shadow-none min-h-[60px]"
                  >
                    ❌ FALLÓ
                  </button>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4 text-center text-sm font-medium text-green-800">
                  La tanda de penales ha finalizado. Puedes dar por terminado el partido.
                </div>
              )}
            </div>
          )}
        </div>
      )
      }

      {
        !canRecord && match.status === 'SCHEDULED' && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
            Inicia el partido para habilitar el registro de eventos en vivo.
          </div>
        )
      }

      {
        match.status === 'SUSPENDED' && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
            El partido está suspendido. Reanúdalo para continuar registrando eventos.
          </div>
        )
      }

      {
        match.status === 'FINISHED' && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            El partido está finalizado. Puedes revisar la cronología, pero no se pueden agregar más eventos.
          </div>
        )
      }

      {/* Referee Info */}
      {
        showRefereeForm && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">Información del árbitro</h2>
              <div className="grid gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Nombre completo</label>
                  <input
                    type="text"
                    value={refereeForm.fullName}
                    onChange={(event) => setRefereeForm((prev) => ({ ...prev, fullName: event.target.value }))}
                    placeholder="Ej. Juan Pérez"
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-1">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Teléfono (Opcional)</label>
                    <input
                      type="tel"
                      value={refereeForm.phoneNumber}
                      onChange={(event) => setRefereeForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                      placeholder="Ej. 099 123 456"
                      className="w-full rounded-md border border-gray-300 px-3 py-2"
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={handleSaveReferee}
                disabled={isSavingReferee}
                className="mt-4 w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:bg-teal-300"
              >
                {isSavingReferee ? 'Guardando...' : 'Guardar información del árbitro'}
              </button>
            </div>
          </div>
        )
      }

      {/* Match Report — always visible */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Informe del partido</h2>
        {existingReport ? (
          <div className="space-y-2 text-sm text-gray-700">
            <div className="rounded-md bg-green-50 p-3 text-green-700">
              Informe registrado por {existingReport.submittedBy} el {existingReport.submittedAt.toLocaleString('es-ES')}.
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-gray-100 bg-gray-50 p-3 text-gray-800">{existingReport.notes}</div>
          </div>
        ) : (
          <div className="space-y-4">
            <textarea
              value={reportNotes}
              onChange={(event) => setReportNotes(event.target.value)}
              rows={6}
              disabled={!!existingReport || match.status === 'SCHEDULED'}
              placeholder={match.status === 'SCHEDULED' ? 'Solo disponible cuando inicie el partido.' : 'Describe lo ocurrido en el encuentro (se puede editar durante el partido)...'}
              className="w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
            />
            <button
              onClick={handleSubmitReport}
              disabled={reportButtonDisabled}
              className="w-full rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:bg-purple-300"
            >
              {isSubmittingReport ? 'Enviando...' : 'Enviar informe del árbitro'}
            </button>
            {!canSubmitReport && (
              <p className="text-xs text-gray-500">El partido debe finalizar antes de cargar el informe.</p>
            )}
          </div>
        )}
      </div>

      {/* Vocal Report — independent from referee report */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Reporte del vocal</h2>
        {existingVocalReport ? (
          <div className="space-y-2 text-sm text-gray-700">
            <div className="rounded-md bg-blue-50 p-3 text-blue-700">
              Reporte registrado por {existingVocalReport.submittedBy} el {existingVocalReport.submittedAt.toLocaleString('es-ES')}.
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-gray-100 bg-gray-50 p-3 text-gray-800">
              {existingVocalReport.notes}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <textarea
              value={vocalReportNotes}
              onChange={(event) => setVocalReportNotes(event.target.value)}
              rows={8}
              disabled={match.status === 'SCHEDULED'}
              placeholder={
                match.status === 'SCHEDULED'
                  ? 'Solo disponible cuando inicie el partido.'
                  : 'Describe observaciones de vocalía, incidencias y cierre administrativo del encuentro...'
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
            />
            <button
              onClick={handleSubmitVocalReport}
              disabled={vocalReportButtonDisabled}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {isSubmittingVocalReport ? 'Guardando...' : 'Guardar reporte del vocal'}
            </button>
            {!canSubmitVocalReport && (
              <p className="text-xs text-gray-500">El partido debe finalizar antes de guardar este reporte.</p>
            )}
          </div>
        )}
      </div>

      {/* PDF */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Informe en PDF</h2>
            <p className="text-sm text-gray-500">Descarga un informe con alineaciones, datos del árbitro y cronología de eventos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleGeneratePdf}
              disabled={!canGeneratePdf || isGeneratingPdf}
              className="rounded-md bg-gray-900 px-6 py-2 text-sm font-semibold text-white hover:bg-black disabled:bg-gray-400"
            >
              {isGeneratingPdf ? 'Generando...' : 'Descargar PDF'}
            </button>
            <button
              onClick={handleSendPdf}
              disabled={!canGeneratePdf || isSendingPdf}
              className="rounded-md bg-emerald-600 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-emerald-300"
            >
              {isSendingPdf ? 'Enviando...' : '✉️ Enviar PDF a representantes'}
            </button>
          </div>
        </div>
        {!canGeneratePdf && (
          <p className="mt-2 text-xs text-gray-500">Espera a que el partido finalice para generar el PDF.</p>
        )}
      </div>

      {/* Events Timeline */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Cronología del Partido ({events.length} eventos)</h2>

        {events.length === 0 ? (
          <div className="py-8 text-center text-gray-500">No hay eventos registrados aún</div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              const isEditing = editingEventId === event.id;
              const teamLabel = getTeamLabel(event.teamId);
              const description = buildEventDescription(event);
              const canEdit = editableEventTypes.includes(event.type);
              const playersForEdit = getPlayersForTeam(event.teamId);

              const renderBadge = () => {
                switch (event.type) {
                  case 'GOAL':
                    return <span className="text-green-600">⚽ Gol</span>;
                  case 'PENALTY_GOAL':
                    return <span className="text-green-600">⚽ Gol de penal</span>;
                  case 'OWN_GOAL':
                    return <span className="text-orange-600">⚽ Autogol</span>;
                  case 'CARD':
                    return (
                      <span className={event.cardType === 'RED' ? 'text-red-600' : 'text-yellow-600'}>
                        {event.cardType === 'RED' ? '🟥 Tarjeta roja' : event.cardType === 'DOUBLE_YELLOW' ? '🟨🟨 Doble amarilla' : '🟨 Tarjeta amarilla'}
                      </span>
                    );
                  case 'SUBSTITUTION':
                    return <span className="text-blue-600">🔄 Cambio</span>;
                  case 'MATCH_STARTED':
                    return <span className="text-green-600">🟢 Inicio</span>;
                  case 'MATCH_SUSPENDED':
                    return <span className="text-yellow-700">⏸️ Suspendido</span>;
                  case 'MATCH_RESUMED':
                    return <span className="text-blue-600">▶️ Reanudado</span>;
                  case 'MATCH_ENDED':
                    return <span className="text-red-600">⏹️ Final</span>;
                  case 'COMMENT':
                    return <span className="text-gray-600">💬 Comentario</span>;
                  case 'VAR_REVIEW':
                    return <span className="text-purple-600">🎥 Revisión VAR</span>;
                  case 'PENALTY_MISSED':
                    return <span className="text-orange-500">⚽ Penal fallado</span>;
                  default:
                    return <span className="text-gray-600">Evento</span>;
                }
              };

              return (
                <div key={event.id} className="rounded-md border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 text-sm font-bold text-gray-500">
                      {event.time.minute}
                      {event.time.additional ? `+${event.time.additional}` : ''}'
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800">
                          {renderBadge()}
                          {teamLabel && <span className="text-xs font-medium text-gray-500">({teamLabel})</span>}
                        </div>
                        {'updatedScore' in event && event.updatedScore && (
                          <span className="rounded bg-white px-2 py-1 text-xs font-semibold text-gray-700">
                            {event.updatedScore.home} - {event.updatedScore.away}
                          </span>
                        )}
                        {canEdit && !isEditing && (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setEditingEventId(event.id)}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleDeleteEvent(event.id)}
                              className="text-xs font-semibold text-red-600 hover:text-red-700"
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1 text-sm text-gray-700">
                        {description.map((line, index) => (
                          <div key={`${event.id}-line-${index}`}>{line}</div>
                        ))}
                      </div>

                      {isEditing && (
                        <div className="rounded-md border border-indigo-200 bg-white p-3 text-sm shadow-sm">
                          {event.type === 'GOAL' || event.type === 'PENALTY_GOAL' || event.type === 'OWN_GOAL' ? (
                            <div className="space-y-3">
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-gray-700">Jugador que anotó</label>
                                <select
                                  value={editSelectedPlayer}
                                  onChange={(e) => setEditSelectedPlayer(e.target.value)}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                                >
                                  <option value="">Seleccionar...</option>
                                  {playersForEdit.map((player) => (
                                    <option key={player.id} value={player.id}>
                                      {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ) : null}

                          {event.type === 'CARD' && (
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-gray-700">Jugador</label>
                                <select
                                  value={editSelectedPlayer}
                                  onChange={(e) => setEditSelectedPlayer(e.target.value)}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                                >
                                  <option value="">Seleccionar...</option>
                                  {playersForEdit.map((player) => (
                                    <option key={player.id} value={player.id}>
                                      {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-gray-700">Tipo de tarjeta</label>
                                <select
                                  value={editCardType}
                                  onChange={(e) => setEditCardType(e.target.value as CardType)}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                                >
                                  <option value="YELLOW">🟨 Amarilla</option>
                                  <option value="DOUBLE_YELLOW">🟨🟨 Doble amarilla</option>
                                  <option value="RED">🟥 Roja</option>
                                </select>
                              </div>
                            </div>
                          )}

                          {event.type === 'SUBSTITUTION' && (
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-gray-700">Sale</label>
                                <select
                                  value={editPlayerOut}
                                  onChange={(e) => setEditPlayerOut(e.target.value)}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                                >
                                  <option value="">Seleccionar...</option>
                                  {playersForEdit.map((player) => (
                                    <option key={player.id} value={player.id}>
                                      {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-gray-700">Entra</label>
                                <select
                                  value={editPlayerIn}
                                  onChange={(e) => setEditPlayerIn(e.target.value)}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                                >
                                  <option value="">Seleccionar...</option>
                                  {playersForEdit.map((player) => (
                                    <option key={player.id} value={player.id}>
                                      {player.displayName || player.fullName} {player.number ? `#${player.number}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          )}

                          <div className="mt-3 flex justify-end gap-2">
                            <button
                              onClick={handleSaveEventEdit}
                              disabled={isUpdatingEvent}
                              className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300"
                            >
                              Guardar cambios
                            </button>
                            <button
                              onClick={handleCancelEventEdit}
                              disabled={isUpdatingEvent}
                              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:bg-gray-100"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div >
  );
};
