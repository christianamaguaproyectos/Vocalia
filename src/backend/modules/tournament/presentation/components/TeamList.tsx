import { useEffect, useMemo, useRef, useState } from 'react';

import type { Player, Team, MatchEvent } from '../../domain/entities/index.ts';
import { APP_CONFIG } from '../../../../../core/config/app-config.ts';
import { useAppDependencies } from '../../../../../frontend/app/providers/AppDependenciesProvider.tsx';
import { PlayerCard } from '../../../../../frontend/components/PlayerCard.tsx';
import type { GroupId } from '../../domain/value-objects/index.ts';
import { useMatches, useTournament } from '../hooks/index.ts';
import { calculatePlayerSuspensions } from '../../application/services/calculate-suspensions.ts';
import { useAuth } from '../../../../../frontend/app/providers/AuthProvider.tsx';

/** Resize an image file and return a base64 data URL (max ~150KB) */
const resizeImageToBase64 = (file: File, maxWidth = 200, maxHeight = 200, quality = 0.7): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

const GROUP_ORDER: GroupId[] = ['A', 'B'];

const parseRepresentativeEmails = (raw: string): string[] => {
  return raw
    .split(/[;,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter((email, index, source) => email.length > 0 && source.indexOf(email) === index);
};

interface TeamListProps {
  tournamentId?: string;
  readOnly?: boolean;
}

interface PlayerFormState {
  fullName: string;
  displayName: string;
  number: string;
  manualSuspensionMatches: string;
  suspensionReason: string;
}

const createEmptyPlayerForm = (): PlayerFormState => ({
  fullName: '',
  displayName: '',
  number: '',
  manualSuspensionMatches: '',
  suspensionReason: '',
});

export const TeamList = ({ tournamentId = APP_CONFIG.defaultTournamentId, readOnly = false }: TeamListProps) => {
  const { teamId: userTeamId } = useAuth();
  const { teamRepository, matchRepository } = useAppDependencies();
  const { tournament } = useTournament(tournamentId);
  const { matches } = useMatches(tournamentId);
  const [teams, setTeams] = useState<Team[]>([]);
  const visibleTeams = userTeamId ? teams.filter((t) => t.id === userTeamId) : teams;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerForms, setPlayerForms] = useState<Record<string, PlayerFormState>>({});
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [bulkUploadingTeamId, setBulkUploadingTeamId] = useState<string | null>(null);
  const excelInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [showCardsForTeam, setShowCardsForTeam] = useState<string | null>(null);
  const [uploadingPlayerId, setUploadingPlayerId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editPlayerForm, setEditPlayerForm] = useState<PlayerFormState>(createEmptyPlayerForm());
  const [representativeEmailDrafts, setRepresentativeEmailDrafts] = useState<Record<string, string>>({});
  const [isSavingRepresentativeTeamId, setIsSavingRepresentativeTeamId] = useState<string | null>(null);
  const [editingTeamNameId, setEditingTeamNameId] = useState<string | null>(null);
  const [editTeamNameForm, setEditTeamNameForm] = useState<{ name: string; shortName: string }>({ name: '', shortName: '' });
  const [teamPenaltyPointsDrafts, setTeamPenaltyPointsDrafts] = useState<Record<string, string>>({});
  const [isSavingPenaltyTeamId, setIsSavingPenaltyTeamId] = useState<string | null>(null);
  const [matchEvents, setMatchEvents] = useState<MatchEvent[]>([]);

  useEffect(() => {
    if (matches.length === 0) return;
    let isActive = true;
    Promise.all(matches.map(m => matchRepository.listEvents(m.id, m.tournamentId)))
      .then(eventsPerMatch => {
        if (!isActive) return;
        setMatchEvents(eventsPerMatch.flat());
      })
      .catch(console.error);
    return () => { isActive = false; };
  }, [matches, matchRepository]);

  const groupedTeams = useMemo(() => {
    const byGroup: Record<GroupId, Team[]> = { A: [], B: [] };

    visibleTeams.forEach((team) => {
      const group = team.groupId as GroupId;
      if (!byGroup[group]) return;
      byGroup[group] = [...byGroup[group], team];
    });

    GROUP_ORDER.forEach((group) => {
      byGroup[group] = [...byGroup[group]].sort((a, b) => {
        const nameCompare = a.name.localeCompare(b.name, 'es');
        if (nameCompare !== 0) return nameCompare;
        const createdA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const createdB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return createdA - createdB;
      });
    });

    return byGroup;
  }, [visibleTeams]);

  const allSuspensions = useMemo(() => {
    const result = new Map<string, ReturnType<typeof calculatePlayerSuspensions>>();
    const populatedMatches = matches.map(m => ({
      ...m,
      events: matchEvents.filter(e => e.matchId === m.id)
    }));

    for (const team of teams) {
      result.set(
        team.id,
        calculatePlayerSuspensions(team.id, team.players?.map(p => p.id) || [], populatedMatches, undefined, tournament?.config),
      );
    }
    return result;
  }, [teams, matches, matchEvents, tournament?.config]);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = teamRepository.listenAll(tournamentId, {
      onData: (data) => {
        setTeams(data);
        setRepresentativeEmailDrafts((current) => {
          const next = { ...current };
          data.forEach((team) => {
            if (next[team.id] == null) {
              next[team.id] = (team.representativeEmails ?? []).join('; ');
            }
          });
          return next;
        });
        setTeamPenaltyPointsDrafts((current) => {
          const next = { ...current };
          data.forEach((team) => {
            if (next[team.id] == null) {
              next[team.id] = team.penaltyPoints != null ? String(team.penaltyPoints) : '0';
            }
          });
          return next;
        });
        setIsLoading(false);
      },
      onError: (err) => {
        console.error('[TeamList] Failed to load teams', err);
        setError('No se pudieron cargar los equipos');
        setIsLoading(false);
      },
    });

    return unsubscribe;
  }, [teamRepository, tournamentId]);

  const handlePlayerFormChange = (teamId: string, field: keyof PlayerFormState, value: string) => {
    setPlayerForms((prev) => ({
      ...prev,
      [teamId]: { ...(prev[teamId] ?? createEmptyPlayerForm()), [field]: value },
    }));
  };

  const handleAddPlayer = async (team: Team) => {
    const form = playerForms[team.id] ?? createEmptyPlayerForm();
    const fullName = form.fullName.trim();
    const displayName = form.displayName.trim();
    const number = form.number.trim();

    if (!fullName) {
      alert('El nombre del jugador es obligatorio');
      return;
    }

    const newPlayer: Player = {
      id: crypto.randomUUID(),
      teamId: team.id,
      fullName,
      displayName: displayName || undefined,
      number: number ? Number(number) : undefined,
      createdAt: new Date(),
    };

    try {
      setBusyTeamId(team.id);
      const existing = team.players ?? [];
      const playerRegistrationLimit = Math.max(1, tournament?.config.playerRegistrationLimit ?? 23);
      if (existing.length >= playerRegistrationLimit) {
        throw new Error(`El equipo ya alcanzó el límite de ${playerRegistrationLimit} jugadores registrados.`);
      }
      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: { players: [...existing, newPlayer] },
      });
      setPlayerForms((prev) => ({ ...prev, [team.id]: createEmptyPlayerForm() }));
    } catch (err) {
      console.error('[TeamList] Failed to add player', err);
      alert('No se pudo agregar el jugador');
    } finally {
      setBusyTeamId(null);
    }
  };

  // Lee un valor de fila aceptando varias variantes de encabezado (acentos, mayúsculas, N°, etc.).
  const pickCell = (row: Record<string, unknown>, keys: string[]): string => {
    const normalize = (s: string) =>
      s.normalize('NFD')
        .replace(/[̀-ͯ]/g, '')  // quitar diacríticos
        .toLowerCase()                     // minúsculas ANTES de filtrar caracteres
        .replace(/n[°º\.]/g, 'n ')        // "n°", "nº" → "n " (conserva el espacio siguiente)
        .replace(/[^a-z0-9 ]/g, ' ')      // eliminar símbolos restantes
        .replace(/\s+/g, ' ')
        .trim();
    const wanted = keys.map(normalize);
    for (const rawKey of Object.keys(row)) {
      if (wanted.includes(normalize(rawKey))) {
        const value = row[rawKey];
        return value === null || value === undefined ? '' : String(value).trim();
      }
    }
    return '';
  };

  const handleBulkUploadPlayers = async (team: Team, file: File) => {
    try {
      setBulkUploadingTeamId(team.id);

      // Carga diferida de xlsx para no inflar el bundle principal.
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();

      // Algunos Excel con imágenes incrustadas corrompen el ZIP interno de SheetJS.
      // Si la lectura falla por ese motivo, el catch de abajo da un mensaje claro.
      let workbook: ReturnType<typeof XLSX.read>;
      try {
        workbook = XLSX.read(buffer, { type: 'array', cellFormula: false });
      } catch (readErr) {
        const msg = String(readErr);
        if (msg.includes('compressed size') || msg.includes('Bad') || msg.includes('inflate')) {
          throw new Error(
            'El Excel tiene imágenes incrustadas que impiden la lectura. ' +
            'En Excel, selecciona y elimina la imagen, guarda el archivo y vuelve a intentarlo. ' +
            'También puedes guardar como .csv.',
          );
        }
        throw readErr;
      }

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) {
        throw new Error('El archivo no contiene ninguna hoja.');
      }

      // raw:true → SheetJS devuelve números exactos (evita "1.72E+09" en cédulas).
      // Obtenemos la fila de inicio absoluta del sheet para calcular coordenadas correctas.
      const sheetRef = firstSheet['!ref'];
      if (!sheetRef) throw new Error('La hoja no contiene datos.');
      const sheetStartRow = XLSX.utils.decode_range(sheetRef).s.r; // 0-indexed

      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '', raw: true });
      const HEADER_HINTS = ['nombre', 'cedula', 'numero', 'camiseta', 'apellido', 'jugador', 'dorsal', 'dni'];
      const normSimple = (s: string) =>
        s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

      // Buscamos la fila con los encabezados (relativa al inicio del sheet).
      // Soporta hasta 10 filas de título/logo antes de los datos.
      let headerRelativeIndex = 0;
      for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
        const cells = (rawRows[i] as unknown[]).map((v) => normSimple(String(v ?? '')));
        if (HEADER_HINTS.some((hint) => cells.some((cell) => cell.includes(hint)))) {
          headerRelativeIndex = i;
          break;
        }
      }

      // range debe ser ABSOLUTO (fila 0-indexed dentro del sheet completo).
      const absoluteHeaderRow = sheetStartRow + headerRelativeIndex;

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
        range: absoluteHeaderRow,
        raw: true,
      });
      if (rows.length === 0) {
        throw new Error('La hoja no tiene filas con datos.');
      }

      const existing = team.players ?? [];
      const playerRegistrationLimit = Math.max(1, tournament?.config.playerRegistrationLimit ?? 23);

      const newPlayers: Player[] = [];
      const skipped: string[] = [];
      let availableSlots = playerRegistrationLimit - existing.length;

      for (const row of rows) {
        // Nombre: primero intenta columna combinada, luego nombre+apellido separados
        const combinedName = pickCell(row, [
          'NOMBRES Y APELLIDOS', 'NOMBRE Y APELLIDOS',
          'NOMBRES Y APELLIDO', 'NOMBRE Y APELLIDO',
          'NOMBRE COMPLETO', 'NOMBRE APELLIDO',
          'JUGADOR', 'ATLETA',
        ]);
        let fullName: string;
        if (combinedName) {
          fullName = combinedName;
        } else {
          const nombre = pickCell(row, ['NOMBRE', 'NOMBRES', 'FIRST NAME', 'PRIMER NOMBRE']);
          const apellido = pickCell(row, ['APELLIDO', 'APELLIDOS', 'LAST NAME', 'SURNAME', 'SEGUNDO NOMBRE']);
          fullName = `${nombre} ${apellido}`.trim();
        }

        const numeroRaw = pickCell(row, [
          'NUMERO', 'NÚMERO',
          'N° DE CAMISETA', 'N DE CAMISETA', 'CAMISETA',
          'NO DE CAMISETA', 'NUMERO DE CAMISETA', 'NÚMERO DE CAMISETA',
          'NUM CAMISETA', 'CAMISA', 'DORSAL',
        ]);

        if (!fullName) {
          continue; // fila vacía o sin nombre
        }
        if (availableSlots <= 0) {
          skipped.push(`${fullName}: se alcanzó el límite de ${playerRegistrationLimit} jugadores`);
          continue;
        }

        const parsedNumber = Number.parseInt(numeroRaw.replace(/\D/g, ''), 10);

        newPlayers.push({
          id: crypto.randomUUID(),
          teamId: team.id,
          fullName,
          number: Number.isFinite(parsedNumber) ? parsedNumber : undefined,
          createdAt: new Date(),
        });
        availableSlots -= 1;
      }

      if (newPlayers.length === 0) {
        alert(
          `No se agregó ningún jugador.\n\n${
            skipped.length > 0 ? `Detalles:\n${skipped.join('\n')}` : 'Verifica que el Excel tenga las columnas NOMBRE, APELLIDO y NUMERO.'
          }`,
        );
        return;
      }

      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: { players: [...existing, ...newPlayers] },
      });

      const summary = `Se agregaron ${newPlayers.length} jugador(es) a ${team.name}.`;
      alert(skipped.length > 0 ? `${summary}\n\nOmitidos (${skipped.length}):\n${skipped.join('\n')}` : summary);
    } catch (err) {
      console.error('[TeamList] Failed to bulk upload players', err);
      alert(err instanceof Error ? `No se pudo cargar el Excel: ${err.message}` : 'No se pudo cargar el Excel.');
    } finally {
      setBulkUploadingTeamId(null);
      const input = excelInputRefs.current[team.id];
      if (input) {
        input.value = '';
      }
    }
  };

  const handleRemovePlayer = async (team: Team, playerId: string) => {
    if (!confirm('¿Eliminar este jugador del equipo?')) return;

    try {
      setBusyTeamId(team.id);
      const remaining = (team.players ?? []).filter((p) => p.id !== playerId);
      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: { players: remaining },
      });
    } catch (err) {
      console.error('[TeamList] Failed to remove player', err);
      alert('No se pudo eliminar el jugador');
    } finally {
      setBusyTeamId(null);
    }
  };

  const handleUploadPhoto = async (team: Team, playerId: string, file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecciona un archivo de imagen');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen no puede superar los 5 MB');
      return;
    }

    try {
      setUploadingPlayerId(playerId);
      const photoUrl = await resizeImageToBase64(file);
      const updatedPlayers = (team.players ?? []).map((p) =>
        p.id === playerId ? { ...p, photoUrl, updatedAt: new Date() } : p,
      );
      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: { players: updatedPlayers },
      });
    } catch (err) {
      console.error('[TeamList] Failed to upload photo', err);
      alert('No se pudo subir la foto');
    } finally {
      setUploadingPlayerId(null);
    }
  };

  const handleSaveTeamName = async (team: Team) => {
    const name = editTeamNameForm.name.trim();
    if (!name) return;
    try {
      setBusyTeamId(team.id);
      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: {
          name,
          shortName: editTeamNameForm.shortName.trim().toUpperCase() || undefined,
        },
      });
      setEditingTeamNameId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo actualizar el nombre.');
    } finally {
      setBusyTeamId(null);
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    if (!confirm(`¿Eliminar el equipo "${team.name}" y todos sus jugadores?`)) return;

    try {
      setBusyTeamId(team.id);
      await teamRepository.remove({ tournamentId: team.tournamentId, teamId: team.id });
    } catch (err) {
      console.error('[TeamList] Failed to delete team', err);
      alert('No se pudo eliminar el equipo');
    } finally {
      setBusyTeamId(null);
    }
  };

  const handleSaveRepresentativeEmails = async (team: Team) => {
    const raw = representativeEmailDrafts[team.id] ?? '';
    const representativeEmails = parseRepresentativeEmails(raw);

    try {
      setIsSavingRepresentativeTeamId(team.id);
      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: { representativeEmails },
      });
      setRepresentativeEmailDrafts((prev) => ({ ...prev, [team.id]: representativeEmails.join('; ') }));
    } catch (err) {
      console.error('[TeamList] Failed to save representative emails', err);
      alert('No se pudieron guardar los correos de representantes.');
    } finally {
      setIsSavingRepresentativeTeamId(null);
    }
  };

  const handleSaveTeamPenaltyPoints = async (team: Team) => {
    const raw = teamPenaltyPointsDrafts[team.id] ?? '0';
    const parsed = Number(raw.trim());

    if (Number.isNaN(parsed) || parsed < 0) {
      alert('Por favor ingresa un número de puntos de penalización válido (0 o mayor).');
      return;
    }

    try {
      setIsSavingPenaltyTeamId(team.id);
      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: { penaltyPoints: parsed },
      });
      setTeamPenaltyPointsDrafts((prev) => ({ ...prev, [team.id]: String(parsed) }));
    } catch (err) {
      console.error('[TeamList] Failed to save penalty points', err);
      alert('No se pudieron guardar los puntos de penalización.');
    } finally {
      setIsSavingPenaltyTeamId(null);
    }
  };

  const handleEditPlayer = (player: Player) => {
    setEditingPlayerId(player.id);
    setEditPlayerForm({
      fullName: player.fullName,
      displayName: player.displayName ?? '',
      number: player.number != null ? String(player.number) : '',
      manualSuspensionMatches: player.manualSuspensionMatches != null ? String(player.manualSuspensionMatches) : '',
      suspensionReason: player.suspensionReason ?? '',
    });
  };

  const handleSavePlayerEdit = async (team: Team, playerId: string) => {
    const fullName = editPlayerForm.fullName.trim();
    if (!fullName) {
      alert('El nombre completo es obligatorio');
      return;
    }
    try {
      setBusyTeamId(team.id);
      const updatedPlayers = (team.players ?? []).map((p) =>
        p.id === playerId
          ? {
            ...p,
            fullName,
            displayName: editPlayerForm.displayName.trim() || undefined,
            number: editPlayerForm.number.trim() ? Number(editPlayerForm.number.trim()) : undefined,
            manualSuspensionMatches: editPlayerForm.manualSuspensionMatches.trim() ? Number(editPlayerForm.manualSuspensionMatches.trim()) : undefined,
            suspensionReason: editPlayerForm.suspensionReason.trim() || undefined,
            updatedAt: new Date(),
          }
          : p,
      );
      await teamRepository.update({
        tournamentId: team.tournamentId,
        teamId: team.id,
        updates: { players: updatedPlayers },
      });
      setEditingPlayerId(null);
      setEditPlayerForm(createEmptyPlayerForm());
    } catch (err) {
      console.error('[TeamList] Failed to update player', err);
      alert('No se pudo actualizar el jugador');
    } finally {
      setBusyTeamId(null);
    }
  };

  const handleCancelPlayerEdit = () => {
    setEditingPlayerId(null);
    setEditPlayerForm(createEmptyPlayerForm());
  };

  const toggleTeam = (teamId: string) => {
    setExpandedTeamId((prev) => (prev === teamId ? null : teamId));
    if (showCardsForTeam === teamId) setShowCardsForTeam(null);
  };

  if (isLoading) return <p className="text-sm text-gray-500">Cargando equipos...</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (teams.length === 0) return <p className="text-sm text-gray-500">Aun no hay equipos registrados.</p>;

  return (
    <div className="space-y-8">
      {GROUP_ORDER.map((groupId) => {
        const teamsForGroup = groupedTeams[groupId];
        return (
          <section key={groupId} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Grupo {groupId}</h3>
              <span className="text-xs font-medium text-gray-500">{teamsForGroup.length} equipos</span>
            </div>
            {teamsForGroup.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                Todavía no hay equipos registrados en este grupo.
              </p>
            ) : (
              <div className="space-y-1">
                {teamsForGroup.map((team) => {
                  const isExpanded = expandedTeamId === team.id;
                  const playerCount = team.players?.length ?? 0;

                  return (
                    <div key={team.id} className="rounded-md border border-gray-200 bg-white shadow-sm">
                      {/* Collapsed header — always visible */}
                      <div className="flex w-full items-center justify-between px-4 py-3">
                        <button
                          onClick={() => toggleTeam(team.id)}
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                          {team.crestUrl ? (
                            <img src={team.crestUrl} alt={team.name} className="h-6 w-6 rounded-full object-cover border border-gray-200" />
                          ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 border border-gray-200 text-[10px] font-bold text-gray-400">
                              🛡️
                            </div>
                          )}
                          <span className="font-semibold text-gray-800">{team.name}</span>
                          {team.shortName && (
                            <span className="text-xs uppercase text-gray-400">{team.shortName}</span>
                          )}
                        </button>
                        <div className="flex items-center gap-2">
                          {!readOnly && (
                            <button
                              onClick={() => {
                                setEditingTeamNameId(team.id);
                                setEditTeamNameForm({ name: team.name, shortName: team.shortName ?? '' });
                              }}
                              className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              title="Editar nombre"
                            >
                              ✏️
                            </button>
                          )}
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            {playerCount} jugadores
                          </span>
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
                          {/* Edit team name inline */}
                          {editingTeamNameId === team.id && (
                            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
                              <p className="text-xs font-semibold text-blue-700">Editar nombre del equipo</p>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={editTeamNameForm.name}
                                  onChange={(e) => setEditTeamNameForm((prev) => ({ ...prev, name: e.target.value }))}
                                  placeholder="Nombre completo *"
                                  className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                                />
                                <input
                                  type="text"
                                  value={editTeamNameForm.shortName}
                                  onChange={(e) => setEditTeamNameForm((prev) => ({ ...prev, shortName: e.target.value }))}
                                  placeholder="Abrev."
                                  maxLength={5}
                                  className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSaveTeamName(team)}
                                  disabled={busyTeamId === team.id || !editTeamNameForm.name.trim()}
                                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
                                >
                                  Guardar
                                </button>
                                <button
                                  onClick={() => setEditingTeamNameId(null)}
                                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Team actions */}
                          <div className="flex flex-wrap gap-2">
                            {playerCount > 0 && (
                              <button
                                onClick={() => setShowCardsForTeam(showCardsForTeam === team.id ? null : team.id)}
                                className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 active:bg-indigo-100"
                              >
                                {showCardsForTeam === team.id ? 'Ocultar carnets' : 'Ver carnets virtuales'}
                              </button>
                            )}
                            {!readOnly && (
                              <button
                                onClick={() => handleDeleteTeam(team)}
                                disabled={busyTeamId === team.id}
                                className="rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-600 active:bg-red-50 disabled:text-red-300"
                              >
                                Eliminar equipo
                              </button>
                            )}
                          </div>

                          {!readOnly && (
                            <div className="grid gap-4 md:grid-cols-3">
                              {/* Team Crest Uploader */}
                              <div className="rounded border border-indigo-200 bg-indigo-50/50 p-3 flex flex-col justify-between">
                                <div>
                                  <h5 className="mb-2 text-sm font-semibold text-indigo-900">Escudo del equipo</h5>
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-300 bg-white text-gray-400">
                                      {team.crestUrl ? (
                                        <img src={team.crestUrl} alt={team.name} className="h-full w-full object-cover" />
                                      ) : (
                                        <span className="text-[10px]">Sin escudo</span>
                                      )}
                                    </div>
                                    <input
                                      type="file"
                                      accept="image/*"
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
                                          setBusyTeamId(team.id);
                                          const base64 = await resizeImageToBase64(file);
                                          await teamRepository.update({
                                            tournamentId: team.tournamentId,
                                            teamId: team.id,
                                            updates: { crestUrl: base64 },
                                          });
                                        } catch (err) {
                                          alert('No se pudo subir la foto del escudo');
                                        } finally {
                                          setBusyTeamId(null);
                                        }
                                      }}
                                      className="w-full text-xs"
                                    />
                                  </div>
                                </div>
                                {team.crestUrl && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!confirm('¿Eliminar el escudo de este equipo?')) return;
                                      try {
                                        setBusyTeamId(team.id);
                                        await teamRepository.update({
                                          tournamentId: team.tournamentId,
                                          teamId: team.id,
                                          updates: { crestUrl: null as any },
                                        });
                                      } catch (err) {
                                        alert('No se pudo eliminar el escudo');
                                      } finally {
                                        setBusyTeamId(null);
                                      }
                                    }}
                                    className="mt-2 text-left text-xs font-semibold text-red-600 hover:text-red-700"
                                  >
                                    Eliminar escudo
                                  </button>
                                )}
                              </div>

                              <div className="rounded border border-cyan-200 bg-cyan-50 p-3">
                                <h5 className="mb-2 text-sm font-semibold text-cyan-900">Correos de representantes</h5>
                                <div className="flex flex-col gap-2">
                                  <textarea
                                    value={representativeEmailDrafts[team.id] ?? (team.representativeEmails ?? []).join('; ')}
                                    onChange={(event) =>
                                      setRepresentativeEmailDrafts((prev) => ({
                                        ...prev,
                                        [team.id]: event.target.value,
                                      }))
                                    }
                                    rows={2}
                                    className="w-full rounded border border-cyan-300 bg-white px-3 py-2 text-sm"
                                    placeholder="rep1@club.com; rep2@club.com"
                                  />
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-cyan-800">Se usarán para el correo automático al finalizar partidos.</p>
                                    <button
                                      onClick={() => handleSaveRepresentativeEmails(team)}
                                      disabled={isSavingRepresentativeTeamId === team.id}
                                      className="rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-800 disabled:bg-cyan-300"
                                    >
                                      {isSavingRepresentativeTeamId === team.id ? 'Guardando...' : 'Guardar correos'}
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded border border-red-200 bg-red-50 p-3">
                                <h5 className="mb-2 text-sm font-semibold text-red-900">Penalización de Puntos</h5>
                                <div className="flex flex-col gap-2">
                                  <input
                                    type="number"
                                    min="0"
                                    value={teamPenaltyPointsDrafts[team.id] ?? String(team.penaltyPoints ?? '0')}
                                    onChange={(event) =>
                                      setTeamPenaltyPointsDrafts((prev) => ({
                                        ...prev,
                                        [team.id]: event.target.value,
                                      }))
                                    }
                                    className="w-24 rounded border border-red-300 bg-white px-3 py-1.5 text-sm"
                                    placeholder="Ej: 3"
                                  />
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-red-800">Estos puntos se restarán directamente de la tabla de posiciones.</p>
                                    <button
                                      onClick={() => handleSaveTeamPenaltyPoints(team)}
                                      disabled={isSavingPenaltyTeamId === team.id}
                                      className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:bg-red-300"
                                    >
                                      {isSavingPenaltyTeamId === team.id ? 'Guardando...' : 'Aplicar penalización'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Virtual cards */}
                          {showCardsForTeam === team.id && playerCount > 0 && (
                            <div className="flex flex-wrap gap-3">
                              {(team.players ?? []).map((player) => (
                                <PlayerCard key={player.id} player={player} teamName={team.name} />
                              ))}
                            </div>
                          )}

                          {/* Players list — compact table style */}
                          {playerCount > 0 && (
                            <div className="overflow-x-auto scrollbar-hide rounded-md border border-gray-200">
                              <table className="w-full text-xs sm:text-sm">
                                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                  <tr>
                                    <th className="px-3 py-2 text-left">Foto</th>
                                    <th className="px-3 py-2 text-left">Nombre visible</th>
                                    <th className="px-3 py-2 text-left">Nombre real</th>
                                    <th className="px-3 py-2 text-center">#</th>
                                    <th className="px-3 py-2 text-center">Sanciones</th>
                                    {!readOnly && <th className="px-3 py-2 text-right">Acción</th>}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {(team.players ?? []).map((player) => {
                                    const isEditingThis = editingPlayerId === player.id;
                                    return isEditingThis && !readOnly ? (
                                      <tr key={player.id} className="bg-indigo-50">
                                        <td className="px-3 py-2" colSpan={6}>
                                          <div className="space-y-2">
                                            <div className="text-xs font-semibold text-indigo-700">Editando jugador</div>
                                            <div className="flex flex-wrap items-end gap-2">
                                              <input
                                                value={editPlayerForm.fullName}
                                                onChange={(e) => setEditPlayerForm((prev) => ({ ...prev, fullName: e.target.value }))}
                                                placeholder="Nombre completo *"
                                                className="flex-1 min-w-[180px] rounded border border-gray-300 px-3 py-2 text-sm"
                                              />
                                              <input
                                                value={editPlayerForm.displayName}
                                                onChange={(e) => setEditPlayerForm((prev) => ({ ...prev, displayName: e.target.value }))}
                                                placeholder="Nombre visible (opc.)"
                                                className="flex-1 min-w-[150px] rounded border border-gray-300 px-3 py-2 text-sm"
                                              />
                                              <input
                                                value={editPlayerForm.number}
                                                onChange={(e) => setEditPlayerForm((prev) => ({ ...prev, number: e.target.value }))}
                                                placeholder="#"
                                                type="number"
                                                min="0"
                                                className="w-16 rounded border border-gray-300 px-3 py-2 text-sm"
                                              />
                                            </div>
                                            <div className="flex flex-wrap items-end gap-2 mt-2">
                                              <div className="flex flex-col">
                                                <label className="text-xs text-gray-500 mb-1">Partidos Suspendido (Manual)</label>
                                                <input
                                                  value={editPlayerForm.manualSuspensionMatches}
                                                  onChange={(e) => setEditPlayerForm((prev) => ({ ...prev, manualSuspensionMatches: e.target.value }))}
                                                  placeholder="Ej: 3"
                                                  type="number"
                                                  min="0"
                                                  className="w-24 rounded border border-gray-300 px-3 py-2 text-sm"
                                                />
                                              </div>
                                              <div className="flex flex-col flex-1">
                                                <label className="text-xs text-gray-500 mb-1">Motivo de Suspensión</label>
                                                <input
                                                  value={editPlayerForm.suspensionReason}
                                                  onChange={(e) => setEditPlayerForm((prev) => ({ ...prev, suspensionReason: e.target.value }))}
                                                  placeholder="Ej: Pelea en la fecha 3"
                                                  className="w-full min-w-[180px] rounded border border-gray-300 px-3 py-2 text-sm"
                                                />
                                              </div>
                                              <button
                                                onClick={() => handleSavePlayerEdit(team, player.id)}
                                                disabled={busyTeamId === team.id}
                                                className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300 mb-1"
                                              >
                                                Guardar
                                              </button>
                                              <button
                                                onClick={handleCancelPlayerEdit}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 mb-1"
                                              >
                                                Cancelar
                                              </button>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    ) : (
                                      <tr key={player.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-1.5">
                                          {!readOnly ? (
                                            <div
                                              className="relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-xs font-bold text-indigo-600 hover:ring-2 hover:ring-indigo-400"
                                              onClick={() => fileInputRefs.current[player.id]?.click()}
                                              title="Subir foto"
                                            >
                                              {uploadingPlayerId === player.id ? (
                                                <span className="animate-spin text-[10px]">⏳</span>
                                              ) : player.photoUrl ? (
                                                <img src={player.photoUrl} alt={player.fullName} className="h-full w-full object-cover" />
                                              ) : (
                                                <span>📷</span>
                                              )}
                                              <input
                                                ref={(el) => { fileInputRefs.current[player.id] = el; }}
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) handleUploadPhoto(team, player.id, file);
                                                  e.target.value = '';
                                                }}
                                              />
                                            </div>
                                          ) : (
                                            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
                                              {player.photoUrl ? (
                                                <img src={player.photoUrl} alt={player.fullName} className="h-full w-full object-cover" />
                                              ) : (
                                                <span>{(player.displayName || player.fullName).split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')}</span>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                        <td className="px-3 py-1.5">
                                          <span className="font-medium text-gray-800">
                                            {player.displayName || player.fullName}
                                          </span>
                                        </td>
                                        <td className="px-3 py-1.5">
                                          <span className="text-gray-500 text-xs">
                                            {player.fullName}
                                          </span>
                                        </td>
                                        <td className="px-3 py-1.5 text-center text-gray-500">
                                          {player.number ?? '—'}
                                        </td>
                                        <td className="px-3 py-1.5 text-center">
                                          {(() => {
                                            const autoSusp = allSuspensions.get(team.id)?.get(player.id);
                                            const hasAuto = !!autoSusp?.suspended;
                                            const hasManual = !!player.manualSuspensionMatches;

                                            if (!hasAuto && !hasManual) {
                                              return <span className="text-gray-400">—</span>;
                                            }

                                            const details = [];
                                            const parts = [];
                                            if (hasAuto) {
                                              details.push(`Auto: ${autoSusp.reason}`);
                                              parts.push('Auto');
                                            }
                                            if (hasManual) {
                                              details.push(`Manual (${player.manualSuspensionMatches}): ${player.suspensionReason || 'Sin motivo'}`);
                                              parts.push(`Manual (${player.manualSuspensionMatches})`);
                                            }

                                            return (
                                              <span
                                                className="inline-flex cursor-help items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800"
                                                title={details.join(' | ')}
                                              >
                                                Sancionado [{parts.join(' + ')}]
                                              </span>
                                            );
                                          })()}
                                        </td>
                                        {!readOnly && (
                                          <td className="px-3 py-1.5 text-right">
                                            <div className="flex justify-end gap-2">
                                              <button
                                                onClick={() => handleEditPlayer(player)}
                                                disabled={busyTeamId === team.id}
                                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-indigo-300"
                                              >
                                                Editar
                                              </button>
                                              <button
                                                onClick={() => handleRemovePlayer(team, player.id)}
                                                disabled={busyTeamId === team.id}
                                                className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:text-red-300"
                                              >
                                                Eliminar
                                              </button>
                                            </div>
                                          </td>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {playerCount === 0 && (
                            <p className="text-sm text-gray-500">Este equipo aún no tiene jugadores registrados.</p>
                          )}

                          {/* Add player form — compact inline (admin only) */}
                          {!readOnly && (
                            <div className="rounded border border-dashed border-gray-200 p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <h5 className="text-sm font-semibold text-gray-700">Agregar jugador</h5>
                                <div className="flex items-center gap-2">
                                  <input
                                    ref={(el) => { excelInputRefs.current[team.id] = el; }}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleBulkUploadPlayers(team, file);
                                    }}
                                  />
                                  <button
                                    onClick={() => excelInputRefs.current[team.id]?.click()}
                                    disabled={bulkUploadingTeamId === team.id}
                                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-emerald-300"
                                    title="Acepta: NOMBRES Y APELLIDOS (o NOMBRE+APELLIDO), N° DE CAMISETA"
                                  >
                                    {bulkUploadingTeamId === team.id ? 'Cargando...' : '📄 Cargar desde Excel'}
                                  </button>
                                </div>
                              </div>
                              <p className="mb-2 text-xs text-gray-400">
                                Acepta cualquier formato: columna de nombre completo (<strong>NOMBRES Y APELLIDOS</strong>) o separado (<strong>NOMBRE + APELLIDO</strong>) y número de camiseta (<strong>NUMERO</strong> / <strong>N° DE CAMISETA</strong>).
                              </p>
                              <div className="flex flex-wrap items-end gap-2">
                                <input
                                  value={playerForms[team.id]?.fullName ?? ''}
                                  onChange={(e) => handlePlayerFormChange(team.id, 'fullName', e.target.value)}
                                  placeholder="Nombre completo *"
                                  className="flex-1 min-w-[180px] rounded border border-gray-300 px-3 py-2 text-sm"
                                />
                                <input
                                  value={playerForms[team.id]?.displayName ?? ''}
                                  onChange={(e) => handlePlayerFormChange(team.id, 'displayName', e.target.value)}
                                  placeholder="Nombre visible (opc.)"
                                  className="flex-1 min-w-[150px] rounded border border-gray-300 px-3 py-2 text-sm"
                                />
                                <input
                                  value={playerForms[team.id]?.number ?? ''}
                                  onChange={(e) => handlePlayerFormChange(team.id, 'number', e.target.value)}
                                  placeholder="#"
                                  type="number"
                                  min="0"
                                  className="w-16 rounded border border-gray-300 px-3 py-2 text-sm"
                                />
                                <button
                                  onClick={() => handleAddPlayer(team)}
                                  disabled={busyTeamId === team.id}
                                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300"
                                >
                                  Agregar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};
