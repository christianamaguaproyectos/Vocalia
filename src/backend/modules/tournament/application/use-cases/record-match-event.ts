import type { MatchRepository, TeamRepository, TournamentRepository } from '../../domain/repositories/index.ts';
import type { MatchEvent, MatchEventType } from '../../domain/entities/match-event.ts';
import type { Match, Team } from '../../domain/entities/index.ts';
import type { MatchId, PlayerId, TeamId, TournamentId } from '../../domain/value-objects/index.ts';
import { applyGoalToScore } from '../../domain/value-objects/score.ts';
import { sendMailAsync } from '../../../../lib/mail-service.ts';

export type RecordableEvent =
  | {
    type: 'GOAL' | 'OWN_GOAL' | 'PENALTY_GOAL';
    teamId: TeamId;
    scorerId?: PlayerId;
    timeMinute: number;
    timeAdditional?: number;
    period?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
    notes?: string;
  }
  | {
    type: 'PENALTY_MISSED';
    teamId: TeamId;
    scorerId?: PlayerId;
    timeMinute: number;
    timeAdditional?: number;
    period?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
    notes?: string;
  }
  | {
    type: 'CARD';
    teamId: TeamId;
    playerId: PlayerId;
    cardType: 'YELLOW' | 'DOUBLE_YELLOW' | 'RED';
    timeMinute: number;
    timeAdditional?: number;
    period?: 'REGULAR' | 'EXTRA_TIME';
    notes?: string;
  }
  | {
    type: 'SUBSTITUTION';
    teamId: TeamId;
    playerInId: PlayerId;
    playerOutId: PlayerId;
    timeMinute: number;
    timeAdditional?: number;
    period?: 'REGULAR' | 'EXTRA_TIME';
    notes?: string;
  }
  | {
    type:
    | 'MATCH_STARTED'
    | 'FIRST_HALF_ENDED'
    | 'SECOND_HALF_STARTED'
    | 'SECOND_HALF_ENDED'
    | 'MATCH_ENDED'
    | 'COMMENT'
    | 'VAR_REVIEW'
    | 'PENALTY_SHOOTOUT_STARTED';
    notes?: string;
    timeMinute?: number;
    timeAdditional?: number;
    period?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
    teamId?: TeamId;
  }
  | {
    type: 'MATCH_SUSPENDED' | 'MATCH_RESUMED';
    notes?: string;
    timeMinute: number;
    timeAdditional?: number;
    period?: 'REGULAR' | 'EXTRA_TIME';
    teamId?: TeamId;
  };

export interface RecordMatchEventDeps {
  matchRepository: MatchRepository;
  tournamentRepository: TournamentRepository;
  teamRepository: TeamRepository;
}

export interface RecordMatchEventInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  recordedBy: string;
  event: RecordableEvent;
  skipNotifications?: boolean;
}

const isGoalEvent = (type: MatchEventType): type is 'GOAL' | 'OWN_GOAL' | 'PENALTY_GOAL' => {
  return type === 'GOAL' || type === 'OWN_GOAL' || type === 'PENALTY_GOAL';
};

type GoalRecordableEvent = Extract<RecordableEvent, { type: 'GOAL' | 'OWN_GOAL' | 'PENALTY_GOAL' }>;

const isGoalRecordableEvent = (event: RecordableEvent): event is GoalRecordableEvent => {
  return isGoalEvent(event.type);
};

const shouldAffectScore = (type: MatchEventType): boolean => {
  return type === 'GOAL' || type === 'OWN_GOAL' || type === 'PENALTY_GOAL';
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatMinuteLabel = (event: MatchEvent): string => {
  const additional = typeof event.time.additional === 'number' && event.time.additional > 0
    ? `+${event.time.additional}`
    : '';
  return `${event.time.minute}${additional}'`;
};

const toSortableMinute = (event: MatchEvent): number => {
  const additional = typeof event.time.additional === 'number' ? event.time.additional : 0;
  return event.time.minute * 100 + additional;
};

const sortEventsByTime = (items: MatchEvent[]): MatchEvent[] => {
  return [...items].sort((a, b) => {
    const minuteDiff = toSortableMinute(a) - toSortableMinute(b);
    if (minuteDiff !== 0) {
      return minuteDiff;
    }

    return a.createdAt.getTime() - b.createdAt.getTime();
  });
};

const resolveCardTypeLabel = (cardType: 'YELLOW' | 'DOUBLE_YELLOW' | 'RED'): string => {
  if (cardType === 'YELLOW') {
    return 'Amarilla';
  }
  if (cardType === 'DOUBLE_YELLOW') {
    return 'Doble amarilla';
  }
  return 'Roja';
};

const buildTeamPlayerLookup = (teams: Array<Team | null>) => {
  const playersById = new Map<string, string>();

  teams.forEach((team) => {
    (team?.players ?? []).forEach((player) => {
      const name = player.displayName?.trim() || player.fullName?.trim() || player.id;
      playersById.set(player.id, name);
    });
  });

  return playersById;
};

const resolveMatchScoreLabel = (match: Match): string => {
  const regularScore = `${match.score.home} - ${match.score.away}`;
  const hasPenaltyScore =
    typeof match.score.penaltiesHome === 'number' &&
    typeof match.score.penaltiesAway === 'number' &&
    (match.score.penaltiesHome > 0 || match.score.penaltiesAway > 0);

  if (!hasPenaltyScore) {
    return regularScore;
  }

  return `${regularScore} (Penales ${match.score.penaltiesHome} - ${match.score.penaltiesAway})`;
};

const normalizeEmailList = (emails: string[]): string[] => {
  return emails
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, source) => value.length > 0 && EMAIL_REGEX.test(value) && source.indexOf(value) === index);
};

const lineBreakToHtml = (text: string): string => {
  return escapeHtml(text).replace(/\n/g, '<br/>');
};

const queueFinishedMatchSummaryEmail = async ({
  match,
  matchRepository,
  teamRepository,
}: {
  match: Match;
  matchRepository: MatchRepository;
  teamRepository: TeamRepository;
}) => {
  const [homeTeam, awayTeam, events] = await Promise.all([
    teamRepository.findById({ tournamentId: match.tournamentId, teamId: match.homeTeamId }),
    teamRepository.findById({ tournamentId: match.tournamentId, teamId: match.awayTeamId }),
    matchRepository.listEvents(match.id, match.tournamentId),
  ]);

  const homeTeamName = homeTeam?.name ?? match.homeTeamId;
  const awayTeamName = awayTeam?.name ?? match.awayTeamId;
  const recipients = normalizeEmailList([
    ...(homeTeam?.representativeEmails ?? []),
    ...(awayTeam?.representativeEmails ?? []),
  ]);

  if (recipients.length === 0) {
    return;
  }

  const playersById = buildTeamPlayerLookup([homeTeam, awayTeam]);
  const teamNameById = new Map<string, string>([
    [match.homeTeamId, homeTeamName],
    [match.awayTeamId, awayTeamName],
  ]);

  const orderedEvents = sortEventsByTime(events);
  const goalRows = orderedEvents
    .filter((event) => event.type === 'GOAL' || event.type === 'PENALTY_GOAL' || event.type === 'OWN_GOAL')
    .map((event) => {
      const scorerId = 'scorerId' in event ? event.scorerId : undefined;
      const playerName = scorerId ? playersById.get(scorerId) ?? scorerId : 'Sin jugador especificado';
      const teamName = event.teamId ? teamNameById.get(event.teamId) ?? event.teamId : 'Sin equipo';
      const kind = event.type === 'OWN_GOAL'
        ? 'Autogol'
        : event.type === 'PENALTY_GOAL'
          ? event.period === 'PENALTY_SHOOTOUT'
            ? 'Gol de penal (tanda)'
            : 'Gol de penal'
          : 'Gol';

      return {
        minute: formatMinuteLabel(event),
        teamName,
        playerName,
        kind,
      };
    });

  const cardRows = orderedEvents
    .filter((event): event is MatchEvent & { type: 'CARD'; playerId: string; cardType: 'YELLOW' | 'DOUBLE_YELLOW' | 'RED' } => event.type === 'CARD')
    .map((event) => {
      const playerName = playersById.get(event.playerId) ?? event.playerId;
      const teamName = event.teamId ? teamNameById.get(event.teamId) ?? event.teamId : 'Sin equipo';

      return {
        minute: formatMinuteLabel(event),
        teamName,
        playerName,
        cardType: resolveCardTypeLabel(event.cardType),
      };
    });

  const refereeReport = match.report?.notes?.trim() || 'Sin reporte del árbitro.';
  const vocalReport = match.vocalReport?.notes?.trim() || 'Sin reporte del vocal.';
  const scoreLabel = resolveMatchScoreLabel(match);
  const subject = `Resumen del partido: ${homeTeamName} vs ${awayTeamName}`;

  const goalsHtml = goalRows.length > 0
    ? goalRows
      .map((row) => `<tr><td>${escapeHtml(row.minute)}</td><td>${escapeHtml(row.teamName)}</td><td>${escapeHtml(row.playerName)}</td><td>${escapeHtml(row.kind)}</td></tr>`)
      .join('')
    : '<tr><td colspan="4" style="padding: 10px; color: #6b7280;">Sin goles registrados.</td></tr>';

  const cardsHtml = cardRows.length > 0
    ? cardRows
      .map((row) => `<tr><td>${escapeHtml(row.minute)}</td><td>${escapeHtml(row.teamName)}</td><td>${escapeHtml(row.playerName)}</td><td>${escapeHtml(row.cardType)}</td></tr>`)
      .join('')
    : '<tr><td colspan="4" style="padding: 10px; color: #6b7280;">Sin tarjetas registradas.</td></tr>';

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; background: #f8fafc; padding: 24px;">
      <div style="max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
        <div style="padding: 18px 22px; background: #0f172a; color: #ffffff;">
          <h2 style="margin: 0; font-size: 22px;">Resumen oficial del partido</h2>
          <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.9;">${escapeHtml(homeTeamName)} vs ${escapeHtml(awayTeamName)}</p>
        </div>

        <div style="padding: 20px 22px;">
          <p style="margin: 0 0 14px; font-size: 15px;"><strong>Marcador final:</strong> ${escapeHtml(scoreLabel)}</p>

          <h3 style="margin: 18px 0 8px; font-size: 16px; color: #0f172a;">Goleadores</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left;">
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Minuto</th>
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Equipo</th>
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Jugador</th>
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Tipo</th>
              </tr>
            </thead>
            <tbody>${goalsHtml}</tbody>
          </table>

          <h3 style="margin: 18px 0 8px; font-size: 16px; color: #0f172a;">Tarjetas</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left;">
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Minuto</th>
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Equipo</th>
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Jugador</th>
                <th style="padding: 10px; border: 1px solid #e5e7eb;">Tarjeta</th>
              </tr>
            </thead>
            <tbody>${cardsHtml}</tbody>
          </table>

          <h3 style="margin: 18px 0 8px; font-size: 16px; color: #0f172a;">Reporte del árbitro</h3>
          <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; font-size: 14px; line-height: 1.45;">
            ${lineBreakToHtml(refereeReport)}
          </div>

          <h3 style="margin: 18px 0 8px; font-size: 16px; color: #0f172a;">Reporte del vocal</h3>
          <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; font-size: 14px; line-height: 1.45;">
            ${lineBreakToHtml(vocalReport)}
          </div>
        </div>
      </div>
    </div>
  `;

  recipients.forEach((recipient) => {
    sendMailAsync({
      to: recipient,
      subject,
      htmlBody: html,
    });
  });
};

export const recordMatchEventUseCase = ({ matchRepository, tournamentRepository, teamRepository }: RecordMatchEventDeps) => async (
  input: RecordMatchEventInput,
): Promise<MatchEvent> => {
  const match = await matchRepository.findById(input.matchId, input.tournamentId);

  if (!match) {
    throw new Error('Match not found');
  }

  const now = new Date();
  const period = input.event.period ?? 'REGULAR';
  const timeMinute = input.event.timeMinute ?? 0;
  const tournament = await tournamentRepository.findById(match.tournamentId);

  if (input.event.type === 'SUBSTITUTION') {
    // Capturamos el id ya estrechado: dentro de los closures de abajo (filter/some)
    // TypeScript pierde el narrowing de `input.event` y `playerInId` no sería accesible.
    const incomingPlayerId = input.event.playerInId;

    if (input.event.playerInId === input.event.playerOutId) {
      throw new Error('Un jugador no puede sustituirse a sí mismo.');
    }

    const maxSubstitutions = tournament?.config.maxSubstitutions ?? 5;
    const maxSubstitutionWindows = tournament?.config.maxSubstitutionWindows ?? 3;
    const allowReentry = tournament?.config.allowReentry ?? false;

    const events = await matchRepository.listEvents(match.id, match.tournamentId);
    const substitutionsByTeam = events.filter(
      (event): event is MatchEvent & { type: 'SUBSTITUTION'; teamId: TeamId; playerInId: PlayerId; playerOutId: PlayerId } =>
        event.type === 'SUBSTITUTION' &&
        event.teamId === input.event.teamId &&
        Boolean(event.playerInId) &&
        Boolean(event.playerOutId),
    );

    if (maxSubstitutions === 0) {
      throw new Error('Este torneo no permite sustituciones según su configuración actual.');
    }

    if (maxSubstitutions >= 0 && substitutionsByTeam.length >= maxSubstitutions) {
      throw new Error(`El equipo ya alcanzó el límite de ${maxSubstitutions} sustituciones.`);
    }

    if (!allowReentry) {
      const playerAlreadyOut = substitutionsByTeam.some((event) => event.playerOutId === incomingPlayerId);
      if (playerAlreadyOut) {
        throw new Error('La configuración del torneo no permite reingreso de jugadores ya sustituidos.');
      }
    }

    if (maxSubstitutionWindows >= 0) {
      const windowKey = `${period}:${timeMinute}`;
      const usedWindows = new Set(
        substitutionsByTeam.map((event) => `${event.period ?? event.time.period}:${event.time.minute}`),
      );

      if (!usedWindows.has(windowKey) && usedWindows.size >= maxSubstitutionWindows) {
        throw new Error(`El equipo ya alcanzó el máximo de ${maxSubstitutionWindows} ventana(s) de sustitución.`);
      }
    }
  }

  let nextScore = match.score;
  if (shouldAffectScore(input.event.type)) {
    const scoringSide =
      input.event.type === 'OWN_GOAL'
        ? match.homeTeamId === input.event.teamId
          ? 'away'
          : 'home'
        : match.homeTeamId === input.event.teamId
          ? 'home'
          : 'away';

    // Only PENALTY_GOAL during PENALTY_SHOOTOUT period counts towards the shootout score
    if (input.event.type === 'PENALTY_GOAL' && period === 'PENALTY_SHOOTOUT') {
      nextScore = applyGoalToScore(match.score, scoringSide, period);
    } else if (period !== 'PENALTY_SHOOTOUT' || input.event.type !== 'PENALTY_GOAL') {
      // Regular goals, own goals, and penalty goals during regular/extra time
      nextScore = applyGoalToScore(match.score, scoringSide, period);
    }
  }

  const eventToPersist: Omit<MatchEvent, 'id'> = {
    type: input.event.type,
    matchId: match.id,
    teamId: 'teamId' in input.event ? input.event.teamId : undefined,
    recordedBy: input.recordedBy,
    createdAt: now,
    time: {
      minute: timeMinute,
      additional: input.event.timeAdditional,
      period,
    },
    period,
    notes: input.event.notes,
    ...(isGoalRecordableEvent(input.event)
      ? {
        scorerId: input.event.scorerId,
        updatedScore: nextScore,
      }
      : {}),
    ...(input.event.type === 'CARD'
      ? {
        cardType: input.event.cardType,
        playerId: input.event.playerId,
      }
      : {}),
    ...(input.event.type === 'SUBSTITUTION'
      ? {
        playerInId: input.event.playerInId,
        playerOutId: input.event.playerOutId,
      }
      : {}),
  } as Omit<MatchEvent, 'id'>;

  const persistedEvent = await matchRepository.appendEvent(match.id, eventToPersist, match.tournamentId);

  if (shouldAffectScore(input.event.type)) {
    await matchRepository.update(match.id, {
      tournamentId: match.tournamentId,
      score: nextScore,
      updatedAt: now,
    });
  }

  if (input.event.type === 'MATCH_STARTED') {
    await matchRepository.update(match.id, {
      tournamentId: match.tournamentId,
      status: 'LIVE',
      updatedAt: now,
    });
  }

  if (input.event.type === 'MATCH_SUSPENDED') {
    await matchRepository.update(match.id, {
      tournamentId: match.tournamentId,
      status: 'SUSPENDED',
      updatedAt: now,
    });
  }

  if (input.event.type === 'MATCH_RESUMED') {
    await matchRepository.update(match.id, {
      tournamentId: match.tournamentId,
      status: 'LIVE',
      updatedAt: now,
    });
  }

  if (input.event.type === 'MATCH_ENDED') {
    const transitionedToFinished = match.status !== 'FINISHED';

    await matchRepository.update(match.id, {
      tournamentId: match.tournamentId,
      status: 'FINISHED',
      updatedAt: now,
    });

    if (transitionedToFinished) {
      try {
        const [homeTeam, awayTeam] = await Promise.all([
          teamRepository.findById({ tournamentId: match.tournamentId, teamId: match.homeTeamId }),
          teamRepository.findById({ tournamentId: match.tournamentId, teamId: match.awayTeamId }),
        ]);

        const decrementTeamSuspensions = async (team: Team | null) => {
          if (!team || !team.players || team.players.length === 0) return;
          let updated = false;
          const updatedPlayers = team.players.map(p => {
            if (p.manualSuspensionMatches && p.manualSuspensionMatches > 0) {
              updated = true;
              const nextVal = p.manualSuspensionMatches - 1;
              return {
                ...p,
                manualSuspensionMatches: nextVal > 0 ? nextVal : undefined,
                suspensionReason: nextVal > 0 ? p.suspensionReason : undefined,
              };
            }
            return p;
          });

          if (updated) {
            await teamRepository.update({
              tournamentId: team.tournamentId,
              teamId: team.id,
              updates: { players: updatedPlayers }
            });
          }
        };

        await Promise.all([
          decrementTeamSuspensions(homeTeam),
          decrementTeamSuspensions(awayTeam),
        ]);
      } catch (err) {
        console.error('[recordMatchEventUseCase] Failed to decrement manual suspensions', err);
      }

      if (!input.skipNotifications) {
        void (async () => {
          const refreshedMatch = await matchRepository.findById(match.id, match.tournamentId);
          if (!refreshedMatch) {
            return;
          }

          await queueFinishedMatchSummaryEmail({
            match: refreshedMatch,
            matchRepository,
            teamRepository,
          });
        })().catch((error) => {
          console.error('[recordMatchEventUseCase] Failed to send finished match summary email', error);
        });
      }
    }
  }

  return persistedEvent;
};
