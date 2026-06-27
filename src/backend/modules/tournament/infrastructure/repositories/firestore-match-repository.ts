import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';

import { db, firestoreWriteWithTimeout, getDocPreferCache, getDocsPreferCache } from '../../../../lib/firebase.ts';
import type { Match, MatchEvent } from '../../domain/entities/index.ts';
import type { KnockoutStage } from '../../domain/value-objects/match-stage.ts';
import type { MatchEventId, MatchId, TournamentId } from '../../domain/value-objects/index.ts';
import type { KnockoutProgressAuditLog, MatchRepository, RealtimeListener, UnsubscribeFn } from '../../domain/repositories/index.ts';

const withTournamentMatchesCollection = (store: Firestore, tournamentId: TournamentId) =>
  collection(store, 'tournaments', tournamentId, 'matches');

const withMatchEventsCollection = (store: Firestore, tournamentId: TournamentId, matchId: MatchId) =>
  collection(store, 'tournaments', tournamentId, 'matches', matchId, 'events');

const withKnockoutAuditCollection = (store: Firestore, tournamentId: TournamentId) =>
  collection(store, 'tournaments', tournamentId, 'knockout_audit');

const withKnockoutProgressLock = (store: Firestore, tournamentId: TournamentId, stage: KnockoutStage) =>
  doc(store, 'tournaments', tournamentId, 'system_locks', `knockout-progress-${stage}`);

const DEFAULT_KNOCKOUT_LOCK_TTL_MS = 2 * 60 * 1000;

const convertDatesFromFirestore = (value: unknown): unknown => {
  if (!value) {
    return value;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (Array.isArray(value)) {
    return value.map((item) => convertDatesFromFirestore(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, convertDatesFromFirestore(nested)]),
    );
  }

  return value;
};

const convertDatesToFirestore = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => convertDatesToFirestore(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, convertDatesToFirestore(nested)]),
    );
  }

  return value;
};

const mapMatchFromFirestore = (snapshot: DocumentData, id: string): Match => ({
  id,
  tournamentId: snapshot.tournamentId,
  stage: snapshot.stage,
  homeTeamId: snapshot.homeTeamId,
  awayTeamId: snapshot.awayTeamId,
  scheduledAt: snapshot.scheduledAt?.toDate?.() ?? new Date(),
  status: snapshot.status,
  score: snapshot.score,
  venue: snapshot.venue,
  bracketNodeId: snapshot.bracketNodeId,
  lineups: snapshot.lineups
    ? (convertDatesFromFirestore(snapshot.lineups) as Match['lineups'])
    : undefined,
  officials: snapshot.officials ?? undefined,
  report: snapshot.report ? (convertDatesFromFirestore(snapshot.report) as Match['report']) : undefined,
  vocalReport: snapshot.vocalReport ? (convertDatesFromFirestore(snapshot.vocalReport) as Match['vocalReport']) : undefined,
  vocalAccess: snapshot.vocalAccess ? (convertDatesFromFirestore(snapshot.vocalAccess) as Match['vocalAccess']) : undefined,
  createdAt: snapshot.createdAt?.toDate?.() ?? new Date(),
  updatedAt: snapshot.updatedAt?.toDate?.(),
});

const serializeMatch = (match: Omit<Match, 'id'>) => ({
  tournamentId: match.tournamentId,
  stage: match.stage,
  homeTeamId: match.homeTeamId,
  awayTeamId: match.awayTeamId,
  scheduledAt: Timestamp.fromDate(match.scheduledAt),
  status: match.status,
  score: match.score,
  venue: match.venue ?? null,
  bracketNodeId: match.bracketNodeId ?? null,
  lineups: match.lineups ? convertDatesToFirestore(match.lineups) : null,
  officials: match.officials ?? null,
  report: match.report ? convertDatesToFirestore(match.report) : null,
  vocalReport: match.vocalReport ? convertDatesToFirestore(match.vocalReport) : null,
  vocalAccess: match.vocalAccess ? convertDatesToFirestore(match.vocalAccess) : null,
  createdAt: Timestamp.fromDate(match.createdAt),
  updatedAt: match.updatedAt ? Timestamp.fromDate(match.updatedAt) : null,
});

const mapEventFromFirestore = (snapshot: DocumentData, id: string): MatchEvent => ({
  id,
  matchId: snapshot.matchId,
  type: snapshot.type,
  teamId: snapshot.teamId,
  recordedBy: snapshot.recordedBy,
  createdAt: snapshot.createdAt?.toDate?.() ?? new Date(),
  time: snapshot.time,
  period: snapshot.period,
  notes: snapshot.notes,
  ...(snapshot.scorerId ? { scorerId: snapshot.scorerId } : {}),
  ...(snapshot.updatedScore ? { updatedScore: snapshot.updatedScore } : {}),
  ...(snapshot.cardType ? { cardType: snapshot.cardType } : {}),
  ...(snapshot.playerId ? { playerId: snapshot.playerId } : {}),
  ...(snapshot.playerInId ? { playerInId: snapshot.playerInId } : {}),
  ...(snapshot.playerOutId ? { playerOutId: snapshot.playerOutId } : {}),
} as MatchEvent);

const serializeEvent = (event: Omit<MatchEvent, 'id'>) => {
  const serialized: Record<string, unknown> = {
    matchId: event.matchId,
    type: event.type,
    teamId: event.teamId ?? null,
    recordedBy: event.recordedBy,
    createdAt: Timestamp.fromDate(event.createdAt),
    time: {
      minute: event.time.minute,
      additional: event.time.additional ?? null,
      period: event.time.period,
    },
    notes: event.notes ?? null,
  };

  if ('period' in event && event.period) {
    serialized.period = event.period;
  }

  if ('scorerId' in event && event.scorerId) {
    serialized.scorerId = event.scorerId;
  }
  if ('updatedScore' in event && event.updatedScore) {
    serialized.updatedScore = event.updatedScore;
  }
  if ('cardType' in event && event.cardType) {
    serialized.cardType = event.cardType;
  }
  if ('playerId' in event && event.playerId) {
    serialized.playerId = event.playerId;
  }
  if ('playerInId' in event && event.playerInId) {
    serialized.playerInId = event.playerInId;
  }
  if ('playerOutId' in event && event.playerOutId) {
    serialized.playerOutId = event.playerOutId;
  }

  return serialized;
};

export class FirestoreMatchRepository implements MatchRepository {
  private readonly store: Firestore;

  constructor(store: Firestore = db) {
    this.store = store;
  }

  async tryAcquireKnockoutProgressLock({
    tournamentId,
    currentStage,
    ttlMs = DEFAULT_KNOCKOUT_LOCK_TTL_MS,
  }: {
    tournamentId: TournamentId;
    currentStage: KnockoutStage;
    ttlMs?: number;
  }): Promise<boolean> {
    const lockRef = withKnockoutProgressLock(this.store, tournamentId, currentStage);
    const safeTtl = Math.max(10_000, ttlMs);

    return runTransaction(this.store, async (transaction) => {
      const now = Date.now();
      const lockSnapshot = await transaction.get(lockRef);

      if (lockSnapshot.exists()) {
        const existing = lockSnapshot.data() as { expiresAt?: Timestamp };
        const expiresAtMs = existing.expiresAt?.toMillis() ?? 0;
        if (expiresAtMs > now) {
          return false;
        }
      }

      transaction.set(lockRef, {
        tournamentId,
        currentStage,
        acquiredAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + safeTtl),
      });

      return true;
    });
  }

  async releaseKnockoutProgressLock({
    tournamentId,
    currentStage,
  }: {
    tournamentId: TournamentId;
    currentStage: KnockoutStage;
  }): Promise<void> {
    const lockRef = withKnockoutProgressLock(this.store, tournamentId, currentStage);
    await firestoreWriteWithTimeout(deleteDoc(lockRef));
  }

  async appendKnockoutProgressAuditLog(input: KnockoutProgressAuditLog): Promise<void> {
    const auditCollection = withKnockoutAuditCollection(this.store, input.tournamentId);
    const newRef = doc(auditCollection);

    await firestoreWriteWithTimeout(
      setDoc(newRef, {
        tournamentId: input.tournamentId,
        currentStage: input.currentStage,
        nextStage: input.nextStage ?? null,
        action: input.action,
        message: input.message,
        triggeredBy: input.triggeredBy,
        triggeredRole: input.triggeredRole ?? null,
        source: input.source ?? null,
        metadata: input.metadata ? convertDatesToFirestore(input.metadata) : null,
        createdAt: Timestamp.fromDate(new Date()),
      }),
    );
  }

  async create(match: Omit<Match, 'id'>): Promise<Match> {
    const collectionRef = withTournamentMatchesCollection(this.store, match.tournamentId);
    const newRef = doc(collectionRef);
    await firestoreWriteWithTimeout(setDoc(newRef, serializeMatch(match)));
    return { ...match, id: newRef.id } as Match;
  }

  async delete(matchId: MatchId, tournamentId: TournamentId): Promise<void> {
    const eventsRef = withMatchEventsCollection(this.store, tournamentId, matchId);
    const eventsSnapshot = await getDocsPreferCache(eventsRef);

    if (eventsSnapshot.docs.length > 0) {
      await Promise.all(eventsSnapshot.docs.map((eventDoc) => firestoreWriteWithTimeout(deleteDoc(eventDoc.ref))));
    }

    const matchRef = doc(this.store, 'tournaments', tournamentId, 'matches', matchId);
    await firestoreWriteWithTimeout(deleteDoc(matchRef));
  }

  async update(matchId: MatchId, updates: Partial<Omit<Match, 'id'>>): Promise<void> {
    if (!updates.tournamentId) {
      throw new Error('tournamentId is required for match updates');
    }

    const docRef = doc(this.store, 'tournaments', updates.tournamentId, 'matches', matchId);
    const serializedUpdates: Record<string, unknown> = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        serializedUpdates[key] = convertDatesToFirestore(value);
      }
    });

    serializedUpdates.updatedAt = Timestamp.fromDate(new Date());

    await firestoreWriteWithTimeout(updateDoc(docRef, serializedUpdates));
  }

  async findById(matchId: MatchId, tournamentId?: TournamentId, options?: { forceServer?: boolean }): Promise<Match | null> {
    // forceServer evita el caché offline (necesario, p. ej., para validar el OTP
    // de vocalía siempre contra el dato más reciente del servidor).
    const readDoc = options?.forceServer ? getDocFromServer : getDocPreferCache;
    const readDocs = options?.forceServer ? getDocsFromServer : getDocsPreferCache;

    if (tournamentId) {
      const matchRef = doc(this.store, 'tournaments', tournamentId, 'matches', matchId);
      const matchSnapshot = await readDoc(matchRef);
      return matchSnapshot.exists() ? mapMatchFromFirestore(matchSnapshot.data(), matchSnapshot.id) : null;
    }

    const tournamentsRef = collection(this.store, 'tournaments');
    const tournamentsSnapshot = await readDocs(tournamentsRef);

    for (const tournamentDoc of tournamentsSnapshot.docs) {
      const matchRef = doc(this.store, 'tournaments', tournamentDoc.id, 'matches', matchId);
      const matchSnapshot = await readDoc(matchRef);

      if (matchSnapshot.exists()) {
        return mapMatchFromFirestore(matchSnapshot.data(), matchSnapshot.id);
      }
    }

    return null;
  }

  async listByTournament(tournamentId: TournamentId): Promise<Match[]> {
    const matchesRef = withTournamentMatchesCollection(this.store, tournamentId);
    const snapshot = await getDocsPreferCache(matchesRef);

    return snapshot.docs.map((docSnapshot) => mapMatchFromFirestore(docSnapshot.data(), docSnapshot.id));
  }

  listenByTournament(tournamentId: TournamentId, listener: RealtimeListener<Match[]>): UnsubscribeFn {
    const matchesRef = withTournamentMatchesCollection(this.store, tournamentId);

    return onSnapshot(
      matchesRef,
      (snapshot) => {
        const data = snapshot.docs.map((docSnapshot) => mapMatchFromFirestore(docSnapshot.data(), docSnapshot.id));
        listener.onData(data);
      },
      (error) => listener.onError?.(error),
    );
  }

  async appendEvent(matchId: MatchId, event: Omit<MatchEvent, 'id'>, tournamentId?: TournamentId): Promise<MatchEvent> {
    const tid = tournamentId ?? (await this.findById(matchId))?.tournamentId;
    if (!tid) {
      throw new Error('Match not found');
    }

    const eventsRef = withMatchEventsCollection(this.store, tid, matchId);
    const newRef = doc(eventsRef);
    await firestoreWriteWithTimeout(setDoc(newRef, serializeEvent(event)));
    return { ...event, id: newRef.id } as MatchEvent;
  }

  async listEvents(matchId: MatchId, tournamentId?: TournamentId, options?: { forceServer?: boolean }): Promise<MatchEvent[]> {
    const tid = tournamentId ?? (await this.findById(matchId))?.tournamentId;
    if (!tid) {
      throw new Error('Match not found');
    }

    const eventsRef = withMatchEventsCollection(this.store, tid, matchId);
    const snapshot = options?.forceServer
      ? await getDocsFromServer(eventsRef)
      : await getDocsPreferCache(eventsRef);
    const events = snapshot.docs.map((docSnapshot) => mapEventFromFirestore(docSnapshot.data(), docSnapshot.id));

    return events.sort((a, b) => {
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
  }

  async updateEvent(matchId: MatchId, eventId: MatchEventId, updates: Partial<Omit<MatchEvent, 'id'>>, tournamentId?: TournamentId): Promise<void> {
    const tid = tournamentId ?? (await this.findById(matchId))?.tournamentId;
    if (!tid) {
      throw new Error('Match not found');
    }

    const eventRef = doc(this.store, 'tournaments', tid, 'matches', matchId, 'events', eventId);
    await firestoreWriteWithTimeout(updateDoc(eventRef, updates as Record<string, unknown>));
  }

  async removeEvent(matchId: MatchId, eventId: MatchEventId, tournamentId?: TournamentId): Promise<void> {
    const tid = tournamentId ?? (await this.findById(matchId))?.tournamentId;
    if (!tid) {
      throw new Error('Match not found');
    }

    const eventRef = doc(this.store, 'tournaments', tid, 'matches', matchId, 'events', eventId);
    await firestoreWriteWithTimeout(deleteDoc(eventRef));
  }

  listenEvents(matchId: MatchId, listener: RealtimeListener<MatchEvent[]>, tournamentId?: TournamentId): UnsubscribeFn {
    if (tournamentId) {
      const eventsRef = withMatchEventsCollection(this.store, tournamentId, matchId);
      return onSnapshot(
        eventsRef,
        (snapshot) => {
          const data = snapshot.docs.map((docSnapshot) => mapEventFromFirestore(docSnapshot.data(), docSnapshot.id));
          listener.onData(data);
        },
        (error) => listener.onError?.(error),
      );
    }

    let unsubscribe: UnsubscribeFn = () => { };

    this.findById(matchId).then((match) => {
      if (!match) {
        listener.onError?.(new Error('Match not found'));
        return;
      }

      const eventsRef = withMatchEventsCollection(this.store, match.tournamentId, matchId);

      unsubscribe = onSnapshot(
        eventsRef,
        (snapshot) => {
          const data = snapshot.docs.map((docSnapshot) => mapEventFromFirestore(docSnapshot.data(), docSnapshot.id));
          listener.onData(data);
        },
        (error) => listener.onError?.(error),
      );
    });

    return () => unsubscribe();
  }
}
