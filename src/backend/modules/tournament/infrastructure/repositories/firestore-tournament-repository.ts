import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';

import { db, firestoreWriteWithTimeout, getDocPreferCache } from '../../../../lib/firebase.ts';
import type { Tournament } from '../../domain/entities/index.ts';
import { normalizeTournamentConfig } from '../../domain/entities/tournament.ts';
import type { TournamentId } from '../../domain/value-objects/index.ts';
import type { CreateTournamentOptions, RealtimeListener, TournamentRepository, UnsubscribeFn } from '../../domain/repositories/index.ts';

const tournamentsCollection = (store: Firestore) => collection(store, 'tournaments');
const teamsCollection = (store: Firestore, tournamentId: TournamentId) =>
  collection(store, 'tournaments', tournamentId, 'teams');
const matchesCollection = (store: Firestore, tournamentId: TournamentId) =>
  collection(store, 'tournaments', tournamentId, 'matches');
const matchEventsCollection = (store: Firestore, tournamentId: TournamentId, matchId: string) =>
  collection(store, 'tournaments', tournamentId, 'matches', matchId, 'events');

const mapTournamentFromFirestore = (snapshot: DocumentData, id: string): Tournament => {
  const config = normalizeTournamentConfig(snapshot.config);
  const fallbackMaxTeams = Math.max(1, Math.floor(config.teamsCount / 2));
  const groups = Array.isArray(snapshot.groups)
    ? snapshot.groups.map((group: DocumentData) => ({
      id: (group.id === 'B' ? 'B' : 'A') as 'A' | 'B',
      name: typeof group.name === 'string' && group.name.trim() ? group.name : `Grupo ${group.id === 'B' ? 'B' : 'A'}`,
      maxTeams: typeof group.maxTeams === 'number' && group.maxTeams > 0 ? Math.floor(group.maxTeams) : fallbackMaxTeams,
    }))
    : [
      { id: 'A' as const, name: 'Grupo A', maxTeams: fallbackMaxTeams },
      { id: 'B' as const, name: 'Grupo B', maxTeams: fallbackMaxTeams },
    ];

  return {
    id,
    name: snapshot.name,
    season: snapshot.season,
    status: snapshot.status,
    config,
    groups,
    createdAt: snapshot.createdAt?.toDate?.() ?? new Date(),
    updatedAt: snapshot.updatedAt?.toDate?.(),
  };
};

const serializeTournament = (tournament: Omit<Tournament, 'id'>) => ({
  name: tournament.name,
  season: tournament.season,
  status: tournament.status,
  config: normalizeTournamentConfig(tournament.config),
  groups: tournament.groups,
  createdAt: Timestamp.fromDate(tournament.createdAt),
  updatedAt: tournament.updatedAt ? Timestamp.fromDate(tournament.updatedAt) : null,
});

export class FirestoreTournamentRepository implements TournamentRepository {
  private readonly store: Firestore;

  constructor(store: Firestore = db) {
    this.store = store;
  }

  async create(tournament: Omit<Tournament, 'id'>, options: CreateTournamentOptions = {}): Promise<Tournament> {
    if (options.tournamentId) {
      const tournamentRef = doc(this.store, 'tournaments', options.tournamentId);
      await firestoreWriteWithTimeout(setDoc(tournamentRef, serializeTournament(tournament)));
      return { ...tournament, id: options.tournamentId } as Tournament;
    }

    const tournamentsRef = tournamentsCollection(this.store);
    const newRef = doc(tournamentsRef);
    await firestoreWriteWithTimeout(setDoc(newRef, serializeTournament(tournament)));
    return { ...tournament, id: newRef.id } as Tournament;
  }

  async update(tournamentId: TournamentId, updates: Partial<Omit<Tournament, 'id'>>): Promise<void> {
    const tournamentRef = doc(this.store, 'tournaments', tournamentId);
    const normalizedUpdates: Partial<Omit<Tournament, 'id'>> = {
      ...updates,
      ...(updates.config ? { config: normalizeTournamentConfig(updates.config) } : {}),
    };

    await firestoreWriteWithTimeout(updateDoc(tournamentRef, {
      ...normalizedUpdates,
      updatedAt: Timestamp.fromDate(new Date()),
    }));
  }

  async findById(tournamentId: TournamentId): Promise<Tournament | null> {
    const tournamentRef = doc(this.store, 'tournaments', tournamentId);
    const snapshot = await getDocPreferCache(tournamentRef);

    if (!snapshot.exists()) {
      return null;
    }

    return mapTournamentFromFirestore(snapshot.data(), snapshot.id);
  }

  listen(tournamentId: TournamentId, listener: RealtimeListener<Tournament | null>): UnsubscribeFn {
    const tournamentRef = doc(this.store, 'tournaments', tournamentId);

    return onSnapshot(
      tournamentRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          listener.onData(null);
          return;
        }

        listener.onData(mapTournamentFromFirestore(snapshot.data(), snapshot.id));
      },
      (error) => listener.onError?.(error),
    );
  }

  async delete(tournamentId: TournamentId): Promise<void> {
    const tournamentRef = doc(this.store, 'tournaments', tournamentId);

    const matchesSnapshot = await getDocs(matchesCollection(this.store, tournamentId));
    await Promise.all(
      matchesSnapshot.docs.map(async (matchDoc) => {
        const eventsSnapshot = await getDocs(matchEventsCollection(this.store, tournamentId, matchDoc.id));
        await Promise.all(eventsSnapshot.docs.map((eventDoc) => firestoreWriteWithTimeout(deleteDoc(eventDoc.ref))));
        await firestoreWriteWithTimeout(deleteDoc(matchDoc.ref));
      }),
    );

    const teamsSnapshot = await getDocs(teamsCollection(this.store, tournamentId));
    await Promise.all(teamsSnapshot.docs.map((teamDoc) => firestoreWriteWithTimeout(deleteDoc(teamDoc.ref))));

    await firestoreWriteWithTimeout(deleteDoc(tournamentRef));
  }
}
