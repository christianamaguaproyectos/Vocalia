import { useMemo, useState } from 'react';
import { doc, writeBatch, collection, getDocs } from 'firebase/firestore';
import { db } from '../../backend/lib/firebase.ts';
import { useAppDependencies } from '../app/providers/AppDependenciesProvider.tsx';
import { APP_CONFIG } from '../../core/config/app-config.ts';
import {
  assignVocalAccessUseCase,
  createTestTeamsUseCase,
  deleteTournamentUseCase,
  generateGroupMatchesUseCase,
  generateKnockoutMatchesUseCase,
  simulateGroupStageUseCase,
  simulateKnockoutStageUseCase,
} from '../../backend/modules/tournament/application/use-cases/index.ts';
import { useMatches, useTeams, useTournament } from '../../backend/modules/tournament/presentation/hooks/index.ts';
import { AdminCreateTeamForm, TeamList } from '../../backend/modules/tournament/presentation/components/index.ts';
import { MatchesList } from '../components/MatchesList.tsx';
import { UserManagementPanel } from '../components/UserManagementPanel.tsx';
import { AdminDashboard } from '../components/AdminDashboard.tsx';
import { useAuth } from '../app/providers/AuthProvider.tsx';
import { resizeImageToBase64 } from '../shared/utils/image.ts';
import type { GroupId } from '../../backend/modules/tournament/domain/value-objects/index.ts';
import type { Match } from '../../backend/modules/tournament/domain/entities/index.ts';
import type { TournamentConfig, TiebreakerCriterion } from '../../backend/modules/tournament/domain/entities/tournament.ts';
import { listVocaliaUsers } from '../shared/auth/vocalia-users.ts';

const TIEBREAKER_OPTIONS: Array<{ value: TiebreakerCriterion; label: string }> = [
  { value: 'GOAL_DIFFERENCE', label: 'Diferencia de gol' },
  { value: 'GOALS_FOR', label: 'Goles a favor' },
  { value: 'HEAD_TO_HEAD', label: 'Enfrentamiento directo' },
  { value: 'WINS', label: 'Partidos ganados' },
  { value: 'GOALS_AGAINST', label: 'Menos goles en contra' },
  { value: 'ALPHABETICAL', label: 'Orden alfabético' },
];

const YELLOW_RESET_STAGE_OPTIONS: Array<{ value: TournamentConfig['accumulatedYellowsResetStage']; label: string }> = [
  { value: 'NEVER', label: 'Nunca' },
  { value: 'ROUND_OF_16', label: 'Octavos de final' },
  { value: 'QUARTER_FINAL', label: 'Cuartos de final' },
  { value: 'SEMI_FINAL', label: 'Semifinales' },
  { value: 'FINAL', label: 'Final' },
  { value: 'THIRD_PLACE', label: 'Tercer puesto' },
];

export const AdminPage = () => {
  const tournamentId = APP_CONFIG.defaultTournamentId;
  const { user, role, createUserWithRole } = useAuth();
  const { teamRepository, tournamentRepository, matchRepository } = useAppDependencies();
  const { tournament } = useTournament(tournamentId);
  const { teams } = useTeams(tournamentId);
  const { matches } = useMatches(tournamentId);

  const [activeTab, setActiveTab] = useState<'teams' | 'matches' | 'tournament' | 'users' | 'dashboard'>('teams');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);
  const [isDeletingTournament, setIsDeletingTournament] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulateMessage, setSimulateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isGeneratingKnockout, setIsGeneratingKnockout] = useState(false);
  const [knockoutMessage, setKnockoutMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSimulatingKnockout, setIsSimulatingKnockout] = useState(false);
  const [knockoutSimulationMessage, setKnockoutSimulationMessage] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);

  const [isCreatingTestTeams, setIsCreatingTestTeams] = useState(false);
  const [testTeamsMessage, setTestTeamsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedJornada, setSelectedJornada] = useState<string | null>(null);
  const [byeTeamGroupA, setByeTeamGroupA] = useState<string>('');
  const [byeTeamGroupB, setByeTeamGroupB] = useState<string>('');

  // Team accounts
  const [teamCredentials, setTeamCredentials] = useState<Array<{ teamId: string; teamName: string; email: string; password: string }>>([]);
  const [isCreatingTeamAccounts, setIsCreatingTeamAccounts] = useState(false);
  const [teamAccountsMessage, setTeamAccountsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [teamAccountsCreated, setTeamAccountsCreated] = useState(false);

  // Migración de cifrado
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Cedula deletion
  const [cedulaScanResult, setCedulaScanResult] = useState<Array<{ teamId: string; teamName: string; playerName: string; cedula: string }> | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeletingCedulas, setIsDeletingCedulas] = useState(false);
  const [cedulaDeletionMessage, setCedulaDeletionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [auditDocId, setAuditDocId] = useState<string | null>(null);

  const generateGroupMatches = useMemo(
    () => generateGroupMatchesUseCase({ matchRepository, teamRepository, tournamentRepository }),
    [matchRepository, teamRepository, tournamentRepository],
  );

  const deleteTournament = useMemo(
    () => deleteTournamentUseCase({ tournamentRepository }),
    [tournamentRepository],
  );

  const simulateGroupStage = useMemo(
    () => simulateGroupStageUseCase({ matchRepository, teamRepository, tournamentRepository }),
    [matchRepository, teamRepository, tournamentRepository],
  );

  const createTestTeams = useMemo(
    () => createTestTeamsUseCase({ teamRepository, tournamentRepository }),
    [teamRepository, tournamentRepository],
  );

  const generateKnockoutMatches = useMemo(
    () => generateKnockoutMatchesUseCase({ matchRepository, teamRepository, tournamentRepository }),
    [matchRepository, teamRepository, tournamentRepository],
  );

  const assignVocalAccess = useMemo(
    () => assignVocalAccessUseCase({ matchRepository, teamRepository }),
    [matchRepository, teamRepository],
  );

  const simulateKnockoutStage = useMemo(
    () => simulateKnockoutStageUseCase({ matchRepository, teamRepository, tournamentRepository }),
    [matchRepository, teamRepository, tournamentRepository],
  );



  const handleGenerateMatches = async (groupId: GroupId, forceRegenerate = false) => {
    if (forceRegenerate) {
      const ok = window.confirm(
        `¿Regenerar el calendario del Grupo ${groupId}? Se borrarán todos los partidos pendientes y se crearán de nuevo.`,
      );
      if (!ok) return;
    }

    setIsGenerating(true);
    setGenerateError(null);
    setGenerateSuccess(null);

    const byeTeamId = groupId === 'A' ? byeTeamGroupA : byeTeamGroupB;

    try {
      const createdMatches = await generateGroupMatches({
        tournamentId,
        groupId,
        startDate: new Date(),
        forceRegenerate,
        byeTeamIdInFirstRound: byeTeamId || undefined,
      });
      setGenerateSuccess(`Se generaron ${createdMatches.length} partidos para el Grupo ${groupId}`);
    } catch (error) {
      console.error('[AdminPage] Failed to generate matches', error);
      setGenerateError(error instanceof Error ? error.message : 'No se pudo generar el calendario');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteTournament = async () => {
    if (isDeletingTournament) {
      return;
    }

    const confirmation = prompt(
      'Esta acción eliminará el torneo completo, incluidos equipos, partidos y eventos. Escribe ELIMINAR para continuar.',
    );

    if (confirmation?.toUpperCase() !== 'ELIMINAR') {
      return;
    }

    setIsDeletingTournament(true);
    setDeleteMessage(null);

    try {
      await deleteTournament(tournamentId);
      setDeleteMessage({
        type: 'success',
        text: 'El torneo se eliminó correctamente. Se creó una nueva configuración vacía para que puedas comenzar de nuevo.',
      });
    } catch (error) {
      console.error('[AdminPage] Failed to delete tournament', error);
      setDeleteMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo eliminar el torneo',
      });
    } finally {
      setIsDeletingTournament(false);
    }
  };

  const sortMatchesByDate = (items: Match[]) => [...items].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const groupATeams = useMemo(() => teams.filter((t) => t.groupId === 'A').sort((a, b) => a.name.localeCompare(b.name, 'es')), [teams]);
  const groupBTeams = useMemo(() => teams.filter((t) => t.groupId === 'B').sort((a, b) => a.name.localeCompare(b.name, 'es')), [teams]);
  const groupAMatches = useMemo(
    () => sortMatchesByDate(matches.filter((m) => m.stage.type === 'GROUP' && m.stage.group === 'GROUP_A')),
    [matches],
  );
  const groupBMatches = useMemo(
    () => sortMatchesByDate(matches.filter((m) => m.stage.type === 'GROUP' && m.stage.group === 'GROUP_B')),
    [matches],
  );
  const knockoutMatches = useMemo(
    () => sortMatchesByDate(matches.filter((m) => m.stage.type === 'KNOCKOUT')),
    [matches],
  );

  const allGroupMatches = useMemo(
    () => sortMatchesByDate([...groupAMatches, ...groupBMatches]),
    [groupAMatches, groupBMatches],
  );

  // Each unique Saturday becomes a jornada. Key = 'YYYY-MM-DD'.
  const jornadaKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const m of allGroupMatches) {
      const d = m.scheduledAt;
      if (d) seen.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return Array.from(seen).sort();
  }, [allGroupMatches]);

  const jornadaFilteredMatches = useMemo(() => {
    if (!selectedJornada) return null;
    return allGroupMatches.filter((m) => {
      const d = m.scheduledAt;
      if (!d) return false;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return key === selectedJornada;
    });
  }, [allGroupMatches, selectedJornada]);

  const groupCount = Math.max(1, tournament?.groups.length ?? 2);
  const configuredTeamsCount = tournament?.config.teamsCount ?? 32;
  const maxQualifiedByTeams = Math.max(1, Math.floor(configuredTeamsCount / groupCount));
  const configuredQualifiedCount = Math.min(tournament?.config.qualifiedCount ?? 8, maxQualifiedByTeams);
  const configuredMaxSubstitutions = tournament?.config.maxSubstitutions ?? 5;
  const configuredMaxSubstitutionWindows = tournament?.config.maxSubstitutionWindows ?? 3;
  const configuredAllowReentry = tournament?.config.allowReentry ?? false;
  const configuredMatchDuration = tournament?.config.matchDuration ?? 60;
  const configuredAllowExtraTime = tournament?.config.allowExtraTime ?? true;
  const configuredExtraTimeDuration = tournament?.config.extraTimeDuration ?? 15;
  const configuredPlayerRegistrationLimit = tournament?.config.playerRegistrationLimit ?? 23;
  const configuredPlayersOnField = tournament?.config.playersOnField ?? 7;
  const configuredMinPlayersToStart = tournament?.config.minPlayersToStart ?? 5;
  const configuredPointsPerWin = tournament?.config.pointsPerWin ?? 3;
  const configuredPointsPerDraw = tournament?.config.pointsPerDraw ?? 1;
  const configuredPointsPerLoss = tournament?.config.pointsPerLoss ?? 0;
  const configuredTiebreakerOrder = tournament?.config.tiebreakerOrder ?? [
    'GOAL_DIFFERENCE',
    'GOALS_FOR',
    'HEAD_TO_HEAD',
    'ALPHABETICAL',
  ];
  const configuredYellowCardsForSuspension = tournament?.config.yellowCardsForSuspension ?? 3;
  const configuredDirectRedSuspensionDays = tournament?.config.directRedSuspensionDays ?? 1;
  const configuredAccumulatedYellowsResetStage = tournament?.config.accumulatedYellowsResetStage ?? 'NEVER';
  const configuredTournamentLogoUrl = tournament?.config.tournamentLogoUrl ?? '';
  const configuredTournamentPrimaryColor = tournament?.config.tournamentPrimaryColor ?? '#4f46e5';

  const knockoutStartStageLabel = useMemo(() => {
    if (configuredQualifiedCount === 8) {
      return 'octavos de final';
    }
    if (configuredQualifiedCount === 4) {
      return 'cuartos de final';
    }
    if (configuredQualifiedCount === 2) {
      return 'semifinales';
    }
    return 'final directa';
  }, [configuredQualifiedCount]);

  const knockoutPairingExample = configuredQualifiedCount > 1
    ? `1° vs ${configuredQualifiedCount}°, 2° vs ${configuredQualifiedCount - 1}°`
    : '1° vs 1°';

  const updateTournamentConfig = async (nextConfig: TournamentConfig, options?: { syncGroupMaxTeams?: boolean }) => {
    const shouldSyncGroups = options?.syncGroupMaxTeams ?? false;

    if (!tournament) {
      return;
    }

    const updates: { config: TournamentConfig; groups?: typeof tournament.groups } = {
      config: nextConfig,
    };

    if (shouldSyncGroups) {
      const perGroupLimit = Math.max(1, Math.ceil(nextConfig.teamsCount / Math.max(1, tournament.groups.length)));
      updates.groups = tournament.groups.map((group) => ({
        ...group,
        maxTeams: perGroupLimit,
      }));
    }

    await tournamentRepository.update(tournamentId, updates);
  };

  const updateTournamentConfigPatch = async (
    patch: Partial<TournamentConfig>,
    options?: { syncGroupMaxTeams?: boolean },
  ) => {
    if (!tournament) {
      return;
    }

    await updateTournamentConfig(
      {
        ...tournament.config,
        ...patch,
      },
      options,
    );
  };

  const handleGenerateKnockout = async () => {
    if (isGeneratingKnockout) {
      return;
    }

    setKnockoutMessage(null);
    setIsGeneratingKnockout(true);

    try {
      const created = await generateKnockoutMatches({ tournamentId });

      setKnockoutMessage({
        type: 'success',
        text: `Se generaron ${created.length} partidos para la fase eliminatoria con éxito.`,
      });
    } catch (error) {
      console.error('[AdminPage] Failed to generate knockout matches', error);
      setKnockoutMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo generar la fase eliminatoria',
      });
    } finally {
      setIsGeneratingKnockout(false);
    }
  };

  const handleSimulateGroupStage = async () => {
    if (isSimulating) {
      return;
    }

    setSimulateMessage(null);

    if (!import.meta.env.DEV) {
      setSimulateMessage({ type: 'error', text: 'La simulación solo está disponible en entornos de desarrollo.' });
      return;
    }

    try {
      setIsSimulating(true);
      const result = await simulateGroupStage({ tournamentId });
      setSimulateMessage({
        type: 'success',
        text: `Se crearon ${result.teamsCreated} equipos y se simularon ${result.matchesSimulated} partidos de la fase de grupos.`,
      });
    } catch (error) {
      console.error('[AdminPage] Failed to simulate group stage', error);
      setSimulateMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo ejecutar la simulación',
      });
    } finally {
      setIsSimulating(false);
    }
  };

  const handleCreateTestTeams = async () => {
    if (isCreatingTestTeams) return;
    if (!import.meta.env.DEV) return;

    setTestTeamsMessage(null);
    try {
      setIsCreatingTestTeams(true);
      const result = await createTestTeams({ tournamentId });
      setTestTeamsMessage({
        type: 'success',
        text: `Se crearon ${result.teamsCreated} equipos de prueba con plantillas automáticas.`,
      });
    } catch (error) {
      console.error('[AdminPage] Failed to create test teams', error);
      setTestTeamsMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudieron crear los equipos de prueba',
      });
    } finally {
      setIsCreatingTestTeams(false);
    }
  };

  const handleSimulateKnockoutStage = async () => {
    if (isSimulatingKnockout) {
      return;
    }

    setKnockoutSimulationMessage(null);

    if (!import.meta.env.DEV) {
      setKnockoutSimulationMessage({ type: 'error', text: 'La simulación solo está disponible en desarrollo.' });
      return;
    }

    if (knockoutMatches.length === 0) {
      setKnockoutSimulationMessage({ type: 'error', text: 'Primero genera los cruces eliminatorios.' });
      return;
    }

    try {
      setIsSimulatingKnockout(true);
      const result = await simulateKnockoutStage({
        tournamentId,
        triggeredBy: user?.email ?? user?.uid ?? 'unknown-user',
        triggeredRole: role ?? 'unknown-role',
        triggerSource: 'admin-knockout-simulation',
      });
      setKnockoutSimulationMessage({
        type: 'success',
        text: `Se simularon ${result.matchesSimulated} partidos eliminatorios.`,
      });
    } catch (error) {
      console.error('[AdminPage] Failed to simulate knockout stage', error);
      setKnockoutSimulationMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo ejecutar la simulación de eliminatoria',
      });
    } finally {
      setIsSimulatingKnockout(false);
    }
  };

  const generatePassword = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(14)))
      .map((b) => chars[b % chars.length]).join('');
  };

  const handlePrepareTeamCredentials = () => {
    const usedSlugs = new Set<string>();
    const creds = teams.map((team) => {
      const slug = ((team.shortName?.trim() || team.name) ?? 'equipo')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'equipo';
      let unique = slug;
      let i = 2;
      while (usedSlugs.has(unique)) { unique = `${slug}${i++}`; }
      usedSlugs.add(unique);
      return { teamId: team.id, teamName: team.name, email: `${unique}@mazorcadeoro.com`, password: generatePassword() };
    });
    setTeamCredentials(creds);
    setTeamAccountsCreated(false);
    setTeamAccountsMessage(null);
  };

  const handleCreateTeamAccounts = async () => {
    if (teamCredentials.length === 0) return;
    setIsCreatingTeamAccounts(true);
    setTeamAccountsMessage(null);
    let created = 0; let skipped = 0;
    const errors: string[] = [];
    for (const cred of teamCredentials) {
      try {
        await createUserWithRole({ email: cred.email, password: cred.password, displayName: cred.teamName, role: 'viewer', teamId: cred.teamId });
        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already-in-use') || msg.includes('email-already')) { skipped++; }
        else { errors.push(`${cred.teamName}: ${msg}`); }
      }
    }
    setIsCreatingTeamAccounts(false);
    setTeamAccountsCreated(true);
    if (errors.length > 0) {
      setTeamAccountsMessage({ type: 'error', text: `${created} creadas, ${skipped} ya existían. Errores: ${errors.join('; ')}` });
    } else {
      setTeamAccountsMessage({ type: 'success', text: `${created} cuentas creadas.${skipped > 0 ? ` ${skipped} ya existían.` : ''}` });
    }
  };

  const handleMigrateEncryption = async () => {
    if (!window.confirm(`¿Re-guardar los ${teams.length} equipos para cifrar los nombres de jugadores existentes?`)) return;
    setIsMigrating(true);
    setMigrationMessage(null);
    let migrated = 0;
    const errors: string[] = [];
    for (const team of teams) {
      try {
        await teamRepository.update({
          tournamentId,
          teamId: team.id,
          updates: { players: team.players ?? [] },
        });
        migrated++;
      } catch (err) {
        errors.push(`${team.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setIsMigrating(false);
    if (errors.length > 0) {
      setMigrationMessage({ type: 'error', text: `${migrated} equipos migrados. Errores: ${errors.join('; ')}` });
    } else {
      setMigrationMessage({ type: 'success', text: `✅ ${migrated} equipos migrados — todos los jugadores ahora están cifrados en Firestore.` });
    }
  };

  const handleScanCedulas = async () => {
    setIsScanning(true);
    setCedulaScanResult(null);
    setCedulaDeletionMessage(null);
    try {
      const teamsSnap = await getDocs(collection(db, `tournaments/${tournamentId}/teams`));
      const found: NonNullable<typeof cedulaScanResult> = [];
      for (const teamDoc of teamsSnap.docs) {
        const data = teamDoc.data();
        const players: Array<Record<string, unknown>> = data.players ?? [];
        for (const p of players) {
          if (p['nationalId'] && String(p['nationalId']).trim()) {
            found.push({ teamId: teamDoc.id, teamName: String(data['name'] ?? teamDoc.id), playerName: String(p['fullName'] ?? p['displayName'] ?? 'Jugador'), cedula: String(p['nationalId']) });
          }
        }
      }
      setCedulaScanResult(found);
    } catch (err) {
      setCedulaDeletionMessage({ type: 'error', text: `Error al escanear: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setIsScanning(false);
    }
  };

  const handleDeleteCedulas = async () => {
    if (!cedulaScanResult || cedulaScanResult.length === 0) return;
    if (!window.confirm(`¿Confirmas eliminar ${cedulaScanResult.length} cédulas? Esta acción no se puede deshacer.`)) return;
    setIsDeletingCedulas(true);
    setCedulaDeletionMessage(null);
    try {
      const auditId = `cedula-purge-${Date.now()}`;
      const auditRef = doc(collection(db, 'audit'), auditId);
      const b0 = writeBatch(db);
      b0.set(auditRef, {
        event: 'CEDULA_PURGE', initiatedAt: new Date().toISOString(),
        initiatedBy: user?.email ?? 'admin', phase: 'IN_PROGRESS',
        beforeState: { count: cedulaScanResult.length, players: cedulaScanResult },
        deletionProcess: 'writeBatch + deleteField equivalente: se elimina campo nationalId del array players de cada equipo afectado.',
      });
      await b0.commit();
      setAuditDocId(auditId);

      const affectedTeamIds = [...new Set(cedulaScanResult.map((r) => r.teamId))];
      const teamsSnap = await getDocs(collection(db, `tournaments/${tournamentId}/teams`));
      for (const tid of affectedTeamIds) {
        const teamDoc = teamsSnap.docs.find((d) => d.id === tid);
        if (!teamDoc) continue;
        const players: Array<Record<string, unknown>> = (teamDoc.data()['players'] ?? []).map(
          (p: Record<string, unknown>) => { const c = { ...p }; delete c['nationalId']; return c; }
        );
        const b = writeBatch(db);
        b.update(doc(db, `tournaments/${tournamentId}/teams`, tid), { players });
        await b.commit();
      }

      const verifySnap = await getDocs(collection(db, `tournaments/${tournamentId}/teams`));
      let remaining = 0;
      for (const d of verifySnap.docs) {
        remaining += ((d.data()['players'] ?? []) as Array<Record<string, unknown>>).filter((p) => p['nationalId'] && String(p['nationalId']).trim()).length;
      }

      const b2 = writeBatch(db);
      b2.update(auditRef, { phase: 'COMPLETED', afterState: { verifiedAt: new Date().toISOString(), cedulasRemaining: remaining, verified: remaining === 0 } });
      await b2.commit();

      setCedulaScanResult([]);
      setCedulaDeletionMessage({
        type: remaining === 0 ? 'success' : 'error',
        text: remaining === 0
          ? `✅ ${cedulaScanResult.length} cédulas eliminadas y verificadas. Auditoría: ${auditId}`
          : `⚠️ Proceso completado pero quedan ${remaining} cédulas. Auditoría: ${auditId}`,
      });
    } catch (err) {
      setCedulaDeletionMessage({ type: 'error', text: `Error al eliminar: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setIsDeletingCedulas(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Panel de Administración</h1>
        <p className="text-gray-600">Gestiona equipos, partidos y configuración del torneo</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('teams')}
            className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${activeTab === 'teams'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
          >
            Equipos
          </button>
          <button
            onClick={() => setActiveTab('matches')}
            className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${activeTab === 'matches'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
          >
            Calendario
          </button>
          <button
            onClick={() => setActiveTab('tournament')}
            className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${activeTab === 'tournament'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
          >
            Torneo
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${activeTab === 'users'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
          >
            Usuarios
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${activeTab === 'dashboard'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
          >
            Dashboard
          </button>
        </nav>
      </div>

      {/* Teams Tab */}
      {activeTab === 'teams' && (
        <div className="space-y-6">
          <AdminCreateTeamForm tournamentId={tournamentId} />
          <TeamList tournamentId={tournamentId} />
        </div>
      )}

      {/* Matches Tab */}
      {activeTab === 'matches' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Generar Calendario de Fase de Grupos</h2>
            <p className="mb-6 text-sm text-gray-600">
              Genera automáticamente todos los partidos para cada grupo usando el sistema round-robin (todos contra
              todos). Luego podrás editar la fecha, hora y sede de cada partido.
            </p>

            {generateError && <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{generateError}</div>}
            {generateSuccess && (
              <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">{generateSuccess}</div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Grupo A</h3>
                  <span className="text-sm text-gray-500">{groupATeams.length} equipos</span>
                </div>
                <div className="text-sm text-gray-600">
                  Partidos generados: {groupAMatches.length}
                </div>
                {groupATeams.length % 2 !== 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Equipo que descansa en Jornada 1
                    </label>
                    <select
                      value={byeTeamGroupA}
                      onChange={(e) => setByeTeamGroupA(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">— Automático —</option>
                      {groupATeams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {groupAMatches.length === 0 ? (
                  <button
                    onClick={() => handleGenerateMatches('A')}
                    disabled={isGenerating || groupATeams.length < 2}
                    className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    Generar calendario
                  </button>
                ) : (
                  <button
                    onClick={() => handleGenerateMatches('A', true)}
                    disabled={isGenerating}
                    className="w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    Regenerar calendario
                  </button>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Grupo B</h3>
                  <span className="text-sm text-gray-500">{groupBTeams.length} equipos</span>
                </div>
                <div className="text-sm text-gray-600">
                  Partidos generados: {groupBMatches.length}
                </div>
                {groupBTeams.length % 2 !== 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Equipo que descansa en Jornada 1
                    </label>
                    <select
                      value={byeTeamGroupB}
                      onChange={(e) => setByeTeamGroupB(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">— Automático —</option>
                      {groupBTeams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {groupBMatches.length === 0 ? (
                  <button
                    onClick={() => handleGenerateMatches('B')}
                    disabled={isGenerating || groupBTeams.length < 2}
                    className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    Generar calendario
                  </button>
                ) : (
                  <button
                    onClick={() => handleGenerateMatches('B', true)}
                    disabled={isGenerating}
                    className="w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    Regenerar calendario
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Generar fase eliminatoria</h2>
            <p className="mb-4 text-sm text-gray-600">
              Cruza automáticamente a los {configuredQualifiedCount} mejores de cada grupo con siembra inversa
              ({knockoutPairingExample} y así sucesivamente).
              Con la configuración actual, la eliminatoria inicia en {knockoutStartStageLabel}.
            </p>
            {knockoutMessage && (
              <div
                className={`mb-4 rounded-md px-3 py-2 text-sm ${knockoutMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}
              >
                {knockoutMessage.text}
              </div>
            )}
            <button
              onClick={handleGenerateKnockout}
              disabled={isGeneratingKnockout}
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:bg-purple-300"
            >
              {isGeneratingKnockout ? 'Generando...' : 'Generar cruces de eliminación'}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              Si necesitas reiniciar esta fase, primero elimina el torneo completo desde la pestaña "Torneo".
            </p>



            {import.meta.env.DEV && (
              <div className="mt-6 rounded-md border border-dashed border-purple-300 bg-purple-50 p-4">
                <div className="mb-2 text-sm font-semibold text-purple-900">Simulación rápida de eliminatoria</div>
                <p className="text-xs text-purple-800">
                  Finaliza automáticamente todos los partidos de eliminación generando eventos, goles y tarjetas
                  aleatorias. Solo disponible en entornos de desarrollo.
                </p>
                {knockoutSimulationMessage && (
                  <div
                    className={`mt-3 rounded-md px-3 py-2 text-xs ${knockoutSimulationMessage.type === 'success'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                      }`}
                  >
                    {knockoutSimulationMessage.text}
                  </div>
                )}
                <button
                  onClick={handleSimulateKnockoutStage}
                  disabled={isSimulatingKnockout || knockoutMatches.length === 0}
                  className="mt-3 rounded-md bg-purple-700 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-800 disabled:bg-purple-300"
                >
                  {isSimulatingKnockout ? 'Simulando eliminatoria...' : 'Simular partidos eliminatorios'}
                </button>
              </div>
            )}
          </div>

          {/* Group matches with jornada filter */}
          {allGroupMatches.length > 0 && (
            <div className="space-y-4">
              {/* Filter bar */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm font-medium text-gray-600 shrink-0">Fecha:</span>
                <button
                  onClick={() => setSelectedJornada(null)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    selectedJornada === null
                      ? 'bg-indigo-600 text-white'
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
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      F{idx + 1} · {label}
                    </button>
                  );
                })}
              </div>

              {/* Filtered view: single list with all groups */}
              {jornadaFilteredMatches ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-500">{jornadaFilteredMatches.length} partido(s)</p>
                  <MatchesList matches={jornadaFilteredMatches} teams={teams} collapsed={true} />
                </div>
              ) : (
                /* Default view: separated by group */
                <div className="space-y-6">
                  {groupAMatches.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-base font-semibold text-gray-900">
                        Grupo A <span className="text-sm font-normal text-gray-400">({groupAMatches.length} partidos)</span>
                      </h3>
                      <MatchesList matches={groupAMatches} teams={teams} collapsed={true} />
                    </div>
                  )}
                  {groupBMatches.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-base font-semibold text-gray-900">
                        Grupo B <span className="text-sm font-normal text-gray-400">({groupBMatches.length} partidos)</span>
                      </h3>
                      <MatchesList matches={groupBMatches} teams={teams} collapsed={true} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Knockout Matches */}
          {knockoutMatches.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Partidos eliminatorios ({knockoutMatches.length})
              </h3>
              <MatchesList matches={knockoutMatches} teams={teams} collapsed={true} />
            </div>
          )}

          {matches.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">No hay partidos generados</h3>
              <p className="text-sm text-gray-600">
                Primero genera los calendarios usando los botones de arriba.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Resumen de Partidos</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="text-2xl font-bold text-gray-900">{matches.length}</div>
                <div className="text-sm text-gray-600">Total de partidos</div>
              </div>
              <div className="rounded-lg bg-green-50 p-4">
                <div className="text-2xl font-bold text-green-600">
                  {matches.filter((m) => m.status === 'FINISHED').length}
                </div>
                <div className="text-sm text-gray-600">Finalizados</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-4">
                <div className="text-2xl font-bold text-blue-600">
                  {matches.filter((m) => m.status === 'SCHEDULED').length}
                </div>
                <div className="text-sm text-gray-600">Pendientes</div>
              </div>
              <div className="rounded-lg bg-yellow-50 p-4">
                <div className="text-2xl font-bold text-yellow-600">
                  {matches.filter((m) => m.status === 'SUSPENDED').length}
                </div>
                <div className="text-sm text-gray-600">Suspendidos</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tournament Tab */}
      {activeTab === 'tournament' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Información del Torneo</h2>
            {tournament && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
                  <input
                    type="text"
                    defaultValue={tournament.name}
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val && val !== tournament.name) {
                        await tournamentRepository.update(tournamentId, { name: val });
                      }
                    }}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Temporada</label>
                    <input
                      type="text"
                      defaultValue={tournament.season || String(new Date().getFullYear())}
                      onBlur={async (e) => {
                        const val = e.target.value.trim();
                        if (val && val !== tournament.season) {
                          await tournamentRepository.update(tournamentId, { season: val });
                        }
                      }}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Estado</label>
                    <select
                      defaultValue={tournament.status}
                      onChange={async (e) => {
                        const val = e.target.value as 'DRAFT' | 'READY' | 'LIVE' | 'FINISHED';
                        if (val !== tournament.status) {
                          await tournamentRepository.update(tournamentId, { status: val });
                        }
                      }}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                    >
                      <option value="DRAFT">Borrador</option>
                      <option value="READY">Listo</option>
                      <option value="LIVE">En vivo</option>
                      <option value="FINISHED">Finalizado</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-4 rounded-md border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Configuración competitiva</h3>
                    <p className="text-xs text-gray-500">
                      Estos valores controlan los cupos del torneo, los clasificados, los cambios permitidos y la duración
                      reglamentaria de cada partido.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Cantidad total de equipos</label>
                      <input
                        type="number"
                        min={2}
                        defaultValue={configuredTeamsCount}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 2) {
                            e.target.value = String(configuredTeamsCount);
                            return;
                          }

                          const nextTeamsCount = Math.floor(parsed);
                          if (nextTeamsCount === configuredTeamsCount) {
                            return;
                          }

                          const maxQualifiedForTeams = Math.max(1, Math.floor(nextTeamsCount / groupCount));
                          const allowedQualifiedValues = [8, 4, 2, 1].filter((value) => value <= maxQualifiedForTeams);
                          const nextQualifiedCount =
                            allowedQualifiedValues.find((value) => value <= configuredQualifiedCount) ?? 1;

                          try {
                            await updateTournamentConfigPatch(
                              {
                                teamsCount: nextTeamsCount,
                                totalTeams: nextTeamsCount,
                                groupSize: Math.max(1, Math.floor(nextTeamsCount / groupCount)),
                                qualifiedCount: nextQualifiedCount,
                              },
                              { syncGroupMaxTeams: true },
                            );
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredTeamsCount);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Clasificados por grupo</label>
                      <select
                        value={configuredQualifiedCount}
                        onChange={async (e) => {
                          const nextQualifiedCount = Number(e.target.value);
                          if (!Number.isFinite(nextQualifiedCount) || nextQualifiedCount === configuredQualifiedCount) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ qualifiedCount: nextQualifiedCount });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        {[1, 2, 4, 8]
                          .filter((value) => value <= maxQualifiedByTeams)
                          .map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Duración del partido (minutos)</label>
                      <input
                        type="number"
                        min={20}
                        step={2}
                        defaultValue={configuredMatchDuration}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 20) {
                            e.target.value = String(configuredMatchDuration);
                            return;
                          }

                          const baseDuration = Math.max(20, Math.floor(parsed));
                          const nextMatchDuration = baseDuration % 2 === 0 ? baseDuration : baseDuration + 1;
                          if (nextMatchDuration === configuredMatchDuration) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ matchDuration: nextMatchDuration });
                            e.target.value = String(nextMatchDuration);
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredMatchDuration);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Máximo de cambios por equipo</label>
                      <input
                        type="number"
                        min={-1}
                        defaultValue={configuredMaxSubstitutions}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < -1) {
                            e.target.value = String(configuredMaxSubstitutions);
                            return;
                          }

                          const nextMaxSubstitutions = Math.floor(parsed);
                          if (nextMaxSubstitutions === configuredMaxSubstitutions) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ maxSubstitutions: nextMaxSubstitutions });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredMaxSubstitutions);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">Usa -1 para cambios ilimitados.</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Ventanas de cambios por equipo</label>
                      <input
                        type="number"
                        min={-1}
                        defaultValue={configuredMaxSubstitutionWindows}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < -1) {
                            e.target.value = String(configuredMaxSubstitutionWindows);
                            return;
                          }

                          const nextWindows = Math.floor(parsed);
                          if (nextWindows === configuredMaxSubstitutionWindows) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ maxSubstitutionWindows: nextWindows });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredMaxSubstitutionWindows);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">Usa -1 para ventanas ilimitadas.</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">¿Permitir reingreso?</label>
                      <select
                        value={configuredAllowReentry ? 'yes' : 'no'}
                        onChange={async (e) => {
                          const nextAllowReentry = e.target.value === 'yes';
                          if (nextAllowReentry === configuredAllowReentry) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ allowReentry: nextAllowReentry });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="no">No</option>
                        <option value="yes">Sí</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Límite de jugadores registrados</label>
                      <input
                        type="number"
                        min={1}
                        defaultValue={configuredPlayerRegistrationLimit}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 1) {
                            e.target.value = String(configuredPlayerRegistrationLimit);
                            return;
                          }

                          const nextLimit = Math.floor(parsed);
                          if (nextLimit === configuredPlayerRegistrationLimit) {
                            return;
                          }

                          const nextMinPlayersToStart = Math.min(configuredMinPlayersToStart, nextLimit);
                          try {
                            await updateTournamentConfigPatch({
                              playerRegistrationLimit: nextLimit,
                              minPlayersToStart: nextMinPlayersToStart,
                            });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredPlayerRegistrationLimit);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Titulares en cancha</label>
                      <input
                        type="number"
                        min={1}
                        defaultValue={configuredPlayersOnField}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 1) {
                            e.target.value = String(configuredPlayersOnField);
                            return;
                          }

                          const nextPlayersOnField = Math.min(Math.floor(parsed), configuredPlayerRegistrationLimit);
                          if (nextPlayersOnField === configuredPlayersOnField) {
                            e.target.value = String(nextPlayersOnField);
                            return;
                          }

                          // El mínimo para iniciar no puede superar a los titulares en cancha.
                          const nextMinPlayers = Math.min(configuredMinPlayersToStart, nextPlayersOnField);
                          try {
                            await updateTournamentConfigPatch({
                              playersOnField: nextPlayersOnField,
                              minPlayersToStart: nextMinPlayers,
                            });
                            e.target.value = String(nextPlayersOnField);
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredPlayersOnField);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">Máximo de titulares que se pueden alinear (lo normal de tu formato, p. ej. 7).</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Jugadores mínimos para iniciar</label>
                      <input
                        type="number"
                        min={1}
                        defaultValue={configuredMinPlayersToStart}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 1) {
                            e.target.value = String(configuredMinPlayersToStart);
                            return;
                          }

                          const nextMinPlayers = Math.min(Math.floor(parsed), configuredPlayersOnField);
                          if (nextMinPlayers === configuredMinPlayersToStart) {
                            e.target.value = String(nextMinPlayers);
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ minPlayersToStart: nextMinPlayers });
                            e.target.value = String(nextMinPlayers);
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredMinPlayersToStart);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">Piso para poder jugar. Con menos de este número, el equipo no puede iniciar. No puede superar a los titulares en cancha.</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">¿Permitir tiempo extra?</label>
                      <select
                        value={configuredAllowExtraTime ? 'yes' : 'no'}
                        onChange={async (e) => {
                          const nextAllowExtraTime = e.target.value === 'yes';
                          if (nextAllowExtraTime === configuredAllowExtraTime) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ allowExtraTime: nextAllowExtraTime });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="yes">Sí</option>
                        <option value="no">No</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Duración del tiempo extra (minutos)</label>
                      <input
                        type="number"
                        min={1}
                        defaultValue={configuredExtraTimeDuration}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 1) {
                            e.target.value = String(configuredExtraTimeDuration);
                            return;
                          }

                          const nextExtraTimeDuration = Math.floor(parsed);
                          if (nextExtraTimeDuration === configuredExtraTimeDuration) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ extraTimeDuration: nextExtraTimeDuration });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredExtraTimeDuration);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Puntos por victoria</label>
                      <input
                        type="number"
                        defaultValue={configuredPointsPerWin}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed === configuredPointsPerWin) {
                            e.target.value = String(configuredPointsPerWin);
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({
                              pointsPerWin: parsed,
                              pointsRule: {
                                ...(tournament.config.pointsRule ?? {
                                  win: configuredPointsPerWin,
                                  draw: configuredPointsPerDraw,
                                  loss: configuredPointsPerLoss,
                                }),
                                win: parsed,
                              },
                            });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredPointsPerWin);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Puntos por empate</label>
                      <input
                        type="number"
                        defaultValue={configuredPointsPerDraw}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed === configuredPointsPerDraw) {
                            e.target.value = String(configuredPointsPerDraw);
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({
                              pointsPerDraw: parsed,
                              pointsRule: {
                                ...(tournament.config.pointsRule ?? {
                                  win: configuredPointsPerWin,
                                  draw: configuredPointsPerDraw,
                                  loss: configuredPointsPerLoss,
                                }),
                                draw: parsed,
                              },
                            });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredPointsPerDraw);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Puntos por derrota</label>
                      <input
                        type="number"
                        defaultValue={configuredPointsPerLoss}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed === configuredPointsPerLoss) {
                            e.target.value = String(configuredPointsPerLoss);
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({
                              pointsPerLoss: parsed,
                              pointsRule: {
                                ...(tournament.config.pointsRule ?? {
                                  win: configuredPointsPerWin,
                                  draw: configuredPointsPerDraw,
                                  loss: configuredPointsPerLoss,
                                }),
                                loss: parsed,
                              },
                            });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredPointsPerLoss);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Orden de desempate</label>
                      <input
                        type="text"
                        defaultValue={configuredTiebreakerOrder.join(', ')}
                        onBlur={async (e) => {
                          const allowed = new Set(TIEBREAKER_OPTIONS.map((option) => option.value));
                          const parsed = e.target.value
                            .split(',')
                            .map((value) => value.trim().toUpperCase().replace(/\s+/g, '_'))
                            .filter((value) => value.length > 0);

                          const uniqueParsed = parsed.filter((value, index, array) => array.indexOf(value) === index);
                          const isValid = uniqueParsed.length > 0 && uniqueParsed.every((value) => allowed.has(value as TiebreakerCriterion));

                          if (!isValid) {
                            e.target.value = configuredTiebreakerOrder.join(', ');
                            return;
                          }

                          const nextOrder = uniqueParsed as TiebreakerCriterion[];
                          if (JSON.stringify(nextOrder) === JSON.stringify(configuredTiebreakerOrder)) {
                            e.target.value = nextOrder.join(', ');
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ tiebreakerOrder: nextOrder });
                            e.target.value = nextOrder.join(', ');
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = configuredTiebreakerOrder.join(', ');
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Valores válidos: {TIEBREAKER_OPTIONS.map((option) => option.value).join(', ')}
                      </p>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Reinicio de amarillas acumuladas</label>
                      <select
                        value={configuredAccumulatedYellowsResetStage}
                        onChange={async (e) => {
                          const nextStage = e.target.value as TournamentConfig['accumulatedYellowsResetStage'];
                          if (nextStage === configuredAccumulatedYellowsResetStage) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ accumulatedYellowsResetStage: nextStage });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        {YELLOW_RESET_STAGE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Amarillas para suspensión</label>
                      <input
                        type="number"
                        min={1}
                        defaultValue={configuredYellowCardsForSuspension}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 1) {
                            e.target.value = String(configuredYellowCardsForSuspension);
                            return;
                          }

                          const nextValue = Math.floor(parsed);
                          if (nextValue === configuredYellowCardsForSuspension) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ yellowCardsForSuspension: nextValue });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredYellowCardsForSuspension);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Suspensión por roja directa (partidos)</label>
                      <input
                        type="number"
                        min={1}
                        defaultValue={configuredDirectRedSuspensionDays}
                        onBlur={async (e) => {
                          const parsed = Number(e.target.value);
                          if (!Number.isFinite(parsed) || parsed < 1) {
                            e.target.value = String(configuredDirectRedSuspensionDays);
                            return;
                          }

                          const nextValue = Math.floor(parsed);
                          if (nextValue === configuredDirectRedSuspensionDays) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ directRedSuspensionDays: nextValue });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = String(configuredDirectRedSuspensionDays);
                          }
                        }}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Color principal del torneo</label>
                      <input
                        type="color"
                        defaultValue={configuredTournamentPrimaryColor}
                        onBlur={async (e) => {
                          const nextColor = e.target.value;
                          if (nextColor === configuredTournamentPrimaryColor) {
                            return;
                          }

                          try {
                            await updateTournamentConfigPatch({ tournamentPrimaryColor: nextColor });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'No se pudo actualizar la configuración.');
                            e.target.value = configuredTournamentPrimaryColor;
                          }
                        }}
                        className="h-10 w-full rounded-md border border-gray-300 bg-white px-1 py-1"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Logo del torneo</label>
                    <div className="mt-1 flex items-center gap-4">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-300 bg-gray-50 text-gray-400">
                        {configuredTournamentLogoUrl ? (
                          <img src={configuredTournamentLogoUrl} alt="Logo del torneo" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs">Sin logo</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingLogo}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (!file.type.startsWith('image/')) {
                              alert('Por favor selecciona un archivo de imagen');
                              return;
                            }
                            if (file.size > 5 * 1024 * 1024) {
                              alert('La imagen no puede superar los 5 MB');
                              return;
                            }
                            try {
                              setUploadingLogo(true);
                              const base64 = await resizeImageToBase64(file);
                              await updateTournamentConfigPatch({ tournamentLogoUrl: base64 });
                            } catch (error) {
                              alert(error instanceof Error ? error.message : 'No se pudo subir el logo.');
                            } finally {
                              setUploadingLogo(false);
                              e.target.value = '';
                            }
                          }}
                          className="text-xs"
                        />
                        {uploadingLogo && <span className="text-xs text-gray-500">Subiendo imagen...</span>}
                        {configuredTournamentLogoUrl && !uploadingLogo && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await updateTournamentConfigPatch({ tournamentLogoUrl: '' });
                              } catch (error) {
                                alert(error instanceof Error ? error.message : 'No se pudo quitar el logo.');
                              }
                            }}
                            className="text-left text-xs font-semibold text-red-600 hover:text-red-700"
                          >
                            Eliminar logo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Estadísticas Generales</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-indigo-50 p-4">
                <div className="text-2xl font-bold text-indigo-600">{teams.length}</div>
                <div className="text-sm text-gray-600">Equipos registrados</div>
              </div>
              <div className="rounded-lg bg-purple-50 p-4">
                <div className="text-2xl font-bold text-purple-600">{matches.length}</div>
                <div className="text-sm text-gray-600">Partidos totales</div>
              </div>
              <div className="rounded-lg bg-green-50 p-4">
                <div className="text-2xl font-bold text-green-600">
                  {matches.reduce((sum, m) => sum + m.score.home + m.score.away, 0)}
                </div>
                <div className="text-sm text-gray-600">Goles marcados</div>
              </div>
              <div className="rounded-lg bg-yellow-50 p-4">
                <div className="text-2xl font-bold text-yellow-600">
                  {matches.filter((m) => m.status === 'LIVE').length}
                </div>
                <div className="text-sm text-gray-600">Partidos en vivo</div>
              </div>
            </div>
          </div>

          {import.meta.env.DEV && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 shadow-sm">
              <h3 className="mb-2 text-lg font-semibold text-blue-900">Herramientas de desarrollo</h3>
              <p className="mb-4 text-sm text-blue-800">
                Estas opciones solo están disponibles en modo desarrollo para facilitar las pruebas.
              </p>

              {testTeamsMessage && (
                <div
                  className={`mb-3 rounded-md px-3 py-2 text-sm ${testTeamsMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                >
                  {testTeamsMessage.text}
                </div>
              )}
              {simulateMessage && (
                <div
                  className={`mb-3 rounded-md px-3 py-2 text-sm ${simulateMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                >
                  {simulateMessage.text}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleCreateTestTeams}
                  disabled={isCreatingTestTeams}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
                >
                  {isCreatingTestTeams ? 'Creando...' : 'Crear equipos de prueba'}
                </button>
                <button
                  onClick={handleSimulateGroupStage}
                  disabled={isSimulating}
                  className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:bg-purple-300"
                >
                  {isSimulating ? 'Simulando...' : 'Simular fase de grupos'}
                </button>
              </div>
              <p className="mt-2 text-xs text-blue-700">
                "Crear equipos" usa la configuración vigente del torneo. "Simular" registra resultados aleatorios en los partidos existentes.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
            <h3 className="mb-2 text-lg font-semibold text-red-600">Reiniciar torneo</h3>
            <p className="mb-4 text-sm text-gray-600">
              Esta acción eliminará todos los equipos, partidos y eventos asociados al torneo actual. Se creará una nueva
              configuración vacía automáticamente para que puedas comenzar desde cero.
            </p>
            {deleteMessage && (
              <div
                className={`mb-4 rounded-md px-3 py-2 text-sm ${deleteMessage.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
                  }`}
              >
                {deleteMessage.text}
              </div>
            )}
            <button
              onClick={handleDeleteTournament}
              disabled={isDeletingTournament}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-red-300"
            >
              {isDeletingTournament ? 'Eliminando...' : 'Eliminar torneo y datos'}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              Confirma escribiendo <strong>ELIMINAR</strong> cuando se te solicite.
            </p>
          </div>

          {/* Migración de cifrado */}
          <div className="rounded-xl border border-violet-100 bg-violet-50 p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-violet-900">Cifrar jugadores existentes</h3>
              <p className="text-sm text-violet-700 mt-1">
                Los jugadores agregados antes de activar el cifrado siguen en texto plano en Firestore.
                Este proceso los re-guarda para aplicar AES-256-GCM a sus nombres.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={handleMigrateEncryption}
                disabled={isMigrating || teams.length === 0}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-violet-300"
              >
                {isMigrating ? 'Cifrando...' : `Cifrar ${teams.reduce((s, t) => s + (t.players?.length ?? 0), 0)} jugadores (${teams.length} equipos)`}
              </button>
              {migrationMessage && (
                <p className={`text-sm font-medium ${migrationMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                  {migrationMessage.text}
                </p>
              )}
            </div>
          </div>

          {/* Cedula deletion */}
          <div className="rounded-xl border border-red-100 bg-red-50 p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-red-900">Eliminar cédulas de la BD</h3>
              <p className="text-sm text-red-700 mt-1">Escanea la BD, genera auditoría y elimina permanentemente el campo cédula de todos los jugadores.</p>
            </div>
            {cedulaScanResult === null ? (
              <button onClick={handleScanCedulas} disabled={isScanning} className="rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:bg-orange-300">
                {isScanning ? 'Escaneando...' : 'Paso 1: Escanear cédulas en BD'}
              </button>
            ) : (
              <div className="space-y-3">
                {cedulaScanResult.length === 0 ? (
                  <p className="text-sm font-medium text-green-700">✅ No hay cédulas almacenadas en la base de datos.</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-orange-700">
                      Se encontraron <strong>{cedulaScanResult.length}</strong> cédulas en {new Set(cedulaScanResult.map((r) => r.teamId)).size} equipos.
                    </p>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-red-100 text-red-700 sticky top-0">
                          <tr>
                            <th className="px-2 py-1 text-left">Equipo</th>
                            <th className="px-2 py-1 text-left">Jugador</th>
                            <th className="px-2 py-1 text-left">Cédula</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-50">
                          {cedulaScanResult.map((r, i) => (
                            <tr key={i}>
                              <td className="px-2 py-1 text-gray-600">{r.teamName}</td>
                              <td className="px-2 py-1 text-gray-800">{r.playerName}</td>
                              <td className="px-2 py-1 font-mono text-gray-500">{r.cedula}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={handleDeleteCedulas} disabled={isDeletingCedulas} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-red-300">
                      {isDeletingCedulas ? 'Eliminando y verificando...' : `Paso 2: Eliminar ${cedulaScanResult.length} cédulas y guardar auditoría`}
                    </button>
                  </>
                )}
                {cedulaDeletionMessage && (
                  <p className={`text-sm font-medium ${cedulaDeletionMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                    {cedulaDeletionMessage.text}
                  </p>
                )}
                {auditDocId && (
                  <p className="text-xs text-gray-500">ID auditoría: <code className="bg-gray-100 px-1 rounded">{auditDocId}</code> — Firestore › colección <code className="bg-gray-100 px-1 rounded">audit</code></p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-8">
          <UserManagementPanel />
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-indigo-900">Cuentas por equipo</h3>
              <p className="text-sm text-indigo-700 mt-1">Crea una cuenta por cada equipo para que sus representantes puedan iniciar sesión y ver solo su plantilla.</p>
            </div>
            {teamCredentials.length === 0 ? (
              <button onClick={handlePrepareTeamCredentials} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                Generar credenciales ({teams.length} equipos)
              </button>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-indigo-600 font-medium">⚠️ Guarda estas contraseñas antes de crear las cuentas — no se podrán ver de nuevo.</p>
                <div className="overflow-x-auto rounded-lg border border-indigo-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-indigo-100 text-xs uppercase text-indigo-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Equipo</th>
                        <th className="px-3 py-2 text-left">Correo</th>
                        <th className="px-3 py-2 text-left">Contraseña</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-indigo-50">
                      {teamCredentials.map((c) => (
                        <tr key={c.teamId}>
                          <td className="px-3 py-2 font-medium text-gray-800">{c.teamName}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-600">{c.email}</td>
                          <td className="px-3 py-2 font-mono text-xs font-bold text-indigo-700">{c.password}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!teamAccountsCreated && (
                  <div className="flex gap-3">
                    <button onClick={handleCreateTeamAccounts} disabled={isCreatingTeamAccounts} className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-green-300">
                      {isCreatingTeamAccounts ? 'Creando cuentas...' : 'Confirmar y crear cuentas'}
                    </button>
                    <button onClick={() => { setTeamCredentials([]); setTeamAccountsMessage(null); }} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      Cancelar
                    </button>
                  </div>
                )}
                {teamAccountsMessage && (
                  <p className={`text-sm font-medium ${teamAccountsMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                    {teamAccountsMessage.text}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <AdminDashboard teams={teams} matches={matches} />
      )}
    </div>
  );
};
