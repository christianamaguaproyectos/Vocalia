import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';

import { db, firestoreWriteWithTimeout, getDocPreferCache, getDocsPreferCache } from '../../../../lib/firebase.ts';
import { encryptField, decryptField } from '../../../../../frontend/shared/utils/fieldCrypto.ts';
import type { Player, Team } from '../../domain/entities/index.ts';
import type { GroupId, TeamId, TournamentId } from '../../domain/value-objects/index.ts';
import type { RealtimeListener, TeamRepository, UnsubscribeFn } from '../../domain/repositories/index.ts';

const withTournamentTeamsCollection = (store: Firestore, tournamentId: TournamentId) =>
  collection(store, 'tournaments', tournamentId, 'teams');

// Campos cifrados: fullName, displayName
const serializePlayer = async (player: Player) => ({
  id: player.id,
  teamId: player.teamId,
  fullName: await encryptField(player.fullName),
  displayName: player.displayName ? await encryptField(player.displayName) : null,
  number: player.number ?? null,
  position: player.position ?? null,
  photoUrl: player.photoUrl ?? null,
  manualSuspensionMatches: player.manualSuspensionMatches ?? null,
  suspensionReason: player.suspensionReason ?? null,
  createdAt: Timestamp.fromDate(player.createdAt),
  updatedAt: player.updatedAt ? Timestamp.fromDate(player.updatedAt) : null,
});

const mapPlayerFromFirestore = async (snapshot: DocumentData, teamId: string): Promise<Player> => ({
  id: snapshot.id,
  teamId,
  fullName: await decryptField(snapshot.fullName ?? ''),
  displayName: snapshot.displayName ? await decryptField(snapshot.displayName) : undefined,
  number: snapshot.number ?? undefined,
  position: snapshot.position ?? undefined,
  photoUrl: snapshot.photoUrl ?? undefined,
  manualSuspensionMatches: snapshot.manualSuspensionMatches ?? undefined,
  suspensionReason: snapshot.suspensionReason ?? undefined,
  createdAt: snapshot.createdAt?.toDate?.() ?? new Date(),
  updatedAt: snapshot.updatedAt?.toDate?.(),
});

const serializeTeam = async (team: Omit<Team, 'id'>) => ({
  tournamentId: team.tournamentId,
  name: team.name,
  shortName: team.shortName ?? null,
  representativeEmails: team.representativeEmails ?? [],
  groupId: team.groupId,
  crestUrl: team.crestUrl ?? null,
  createdAt: Timestamp.fromDate(team.createdAt),
  updatedAt: team.updatedAt ? Timestamp.fromDate(team.updatedAt) : null,
  players: await Promise.all((team.players ?? []).map(serializePlayer)),
  penaltyPoints: typeof team.penaltyPoints === 'number' ? team.penaltyPoints : null,
});

const mapTeamFromFirestore = async (snapshot: DocumentData, id: string): Promise<Team> => ({
  id,
  tournamentId: snapshot.tournamentId,
  name: snapshot.name,
  shortName: snapshot.shortName ?? undefined,
  representativeEmails: Array.isArray(snapshot.representativeEmails)
    ? snapshot.representativeEmails.filter((value: unknown): value is string => typeof value === 'string')
    : undefined,
  groupId: snapshot.groupId as GroupId,
  crestUrl: snapshot.crestUrl ?? undefined,
  createdAt: snapshot.createdAt?.toDate?.() ?? new Date(),
  updatedAt: snapshot.updatedAt?.toDate?.(),
  players: Array.isArray(snapshot.players)
    ? await Promise.all(
        (snapshot.players as DocumentData[]).map((playerDoc) => mapPlayerFromFirestore(playerDoc, id)),
      )
    : [],
  penaltyPoints: typeof snapshot.penaltyPoints === 'number' ? snapshot.penaltyPoints : undefined,
});

export class FirestoreTeamRepository implements TeamRepository {
  private readonly store: Firestore;

  constructor(store: Firestore = db) {
    this.store = store;
  }

  async create(team: Omit<Team, 'id'>): Promise<Team> {
    const collectionRef = withTournamentTeamsCollection(this.store, team.tournamentId);
    const newRef = doc(collectionRef);
    await firestoreWriteWithTimeout(setDoc(newRef, await serializeTeam(team)));
    return { ...team, id: newRef.id } as Team;
  }

  async update({
    tournamentId,
    teamId,
    updates,
  }: {
    tournamentId: TournamentId;
    teamId: TeamId;
    updates: Partial<Omit<Team, 'id' | 'tournamentId'>>;
  }): Promise<void> {
    const docRef = doc(this.store, 'tournaments', tournamentId, 'teams', teamId);

    const serializedUpdates: Record<string, unknown> = {
      updatedAt: Timestamp.fromDate(new Date()),
    };

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'players' && Array.isArray(value)) {
        serializedUpdates.players = await Promise.all(value.map((player) => serializePlayer(player as Player)));
      } else if (value instanceof Date) {
        serializedUpdates[key] = Timestamp.fromDate(value);
      } else {
        serializedUpdates[key] = value ?? null;
      }
    }

    await firestoreWriteWithTimeout(updateDoc(docRef, serializedUpdates));
  }

  async remove({ tournamentId, teamId }: { tournamentId: TournamentId; teamId: TeamId }): Promise<void> {
    const docRef = doc(this.store, 'tournaments', tournamentId, 'teams', teamId);
    await firestoreWriteWithTimeout(deleteDoc(docRef));
  }

  async findById({ tournamentId, teamId }: { tournamentId: TournamentId; teamId: TeamId }): Promise<Team | null> {
    const docRef = doc(this.store, 'tournaments', tournamentId, 'teams', teamId);
    const snapshot = await getDocPreferCache(docRef);
    if (!snapshot.exists()) return null;
    return mapTeamFromFirestore(snapshot.data(), snapshot.id);
  }

  async listByGroup(tournamentId: TournamentId, groupId: GroupId): Promise<Team[]> {
    const teamsRef = withTournamentTeamsCollection(this.store, tournamentId);
    const q = query(teamsRef, where('groupId', '==', groupId));
    const snapshot = await getDocsPreferCache(q);
    return Promise.all(
      snapshot.docs.map((docSnapshot) => mapTeamFromFirestore(docSnapshot.data(), docSnapshot.id)),
    );
  }

  listenAll(tournamentId: TournamentId, listener: RealtimeListener<Team[]>): UnsubscribeFn {
    const teamsRef = withTournamentTeamsCollection(this.store, tournamentId);

    return onSnapshot(
      teamsRef,
      (snapshot) => {
        void Promise.all(
          snapshot.docs.map((docSnapshot) => mapTeamFromFirestore(docSnapshot.data(), docSnapshot.id)),
        ).then((data) => listener.onData(data));
      },
      (error) => listener.onError?.(error),
    );
  }
}
