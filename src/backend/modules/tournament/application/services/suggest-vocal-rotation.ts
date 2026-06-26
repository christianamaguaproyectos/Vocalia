import type { Match } from '../../domain/entities/match.ts';
import type { Team } from '../../domain/entities/team.ts';

export interface SuggestedVocal {
  teamId: string;
  teamName: string;
  email: string;
  fromGroup: 'A' | 'B';
}

const groupLetterOfMatch = (match: Match): 'A' | 'B' | null => {
  if (match.stage.type !== 'GROUP') return null;
  if (match.stage.group === 'GROUP_A') return 'A';
  if (match.stage.group === 'GROUP_B') return 'B';
  return null;
};

const firstEmailOf = (team: Team): string | null => {
  const email = team.representativeEmails?.find((v) => v.trim().length > 0);
  return email ? email.trim().toLowerCase() : null;
};

const matchSortKey = (match: Match): string => {
  const t = match.scheduledAt instanceof Date
    ? match.scheduledAt.getTime()
    : new Date(match.scheduledAt).getTime();
  return `${String(Number.isFinite(t) ? t : 0).padStart(16, '0')}|${match.venue ?? ''}|${match.id}`;
};

const dayKey = (match: Match): string => {
  const d = match.scheduledAt instanceof Date ? match.scheduledAt : new Date(match.scheduledAt);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const matchHour = (match: Match): number =>
  (match.scheduledAt instanceof Date ? match.scheduledAt : new Date(match.scheduledAt)).getHours();

const matchTimestamp = (match: Match): number =>
  match.scheduledAt instanceof Date ? match.scheduledAt.getTime() : new Date(match.scheduledAt).getTime();

const findTeamByEmail = (email: string, teams: Team[]): Team | undefined => {
  const norm = email.toLowerCase().trim();
  return teams.find((t) => t.representativeEmails?.some((e) => e.toLowerCase().trim() === norm));
};

/**
 * Calcula qué equipo hace de vocal para cada partido del grupo `needsVocalGroup`,
 * procesando todas las jornadas (días) en orden cronológico.
 *
 * Modelo:
 *  - El vocal de cada partido sale del grupo contrario, de algún partido del MISMO
 *    horario (día + hora). El candidato NO se limita a un único "gemelo": se considera
 *    a todos los equipos del grupo contrario que juegan a esa hora.
 *  - De cada partido contrario se usa COMO MUCHO un equipo (el otro no hace vocal),
 *    así un mismo partido nunca aporta sus dos equipos.
 *  - Un equipo que hizo vocal en la jornada anterior no repite en la siguiente; el
 *    reparto se resuelve minimizando repeticiones y balanceando la carga total. Esto
 *    evita el caso en que los dos equipos de un gemelo ya fueron vocales la semana previa.
 *  - Cada equipo juega un único partido por horario, así que no puede ser vocal dos
 *    veces el mismo día.
 *
 * Devuelve el teamId asignado al partido objetivo, o null si no se puede determinar.
 */
const computeVocalAssignment = (
  targetMatch: Match,
  needsVocalGroup: 'A' | 'B',
  sourceGroup: 'A' | 'B',
  allMatches: Match[],
  allTeams: Team[],
): string | null => {
  const teamWithEmail = (id: string): boolean => {
    const t = allTeams.find((x) => x.id === id);
    return t ? firstEmailOf(t) !== null : false;
  };

  // Jornadas = TODOS los días en que el grupo que necesita vocal juega, ascendente.
  // El historial se lleva por equipo a lo largo de todas las jornadas, sin importar la hora.
  const dayFirstTime = new Map<string, number>();
  for (const m of allMatches) {
    if (groupLetterOfMatch(m) !== needsVocalGroup) continue;
    const dk = dayKey(m);
    const t = matchTimestamp(m);
    if (!dayFirstTime.has(dk) || t < dayFirstTime.get(dk)!) dayFirstTime.set(dk, t);
  }
  const days = [...dayFirstTime.entries()].sort((a, b) => a[1] - b[1]).map(([d]) => d);

  const vocalLastDayIdx = new Map<string, number>(); // teamId → última jornada que fue vocal
  const vocalCount = new Map<string, number>();      // teamId → total de vocalías (para balancear)
  const assigned = new Map<string, string>();        // matchId → teamId

  // Resuelve los vocales de un horario (día + hora): a cada partido que necesita vocal
  // le asigna UN equipo del grupo contrario del mismo horario, usando como mucho un equipo
  // por partido contrario. Minimiza repetir respecto de la jornada anterior y balancea la
  // carga. Fuerza bruta porque un horario tiene muy pocos partidos.
  const assignSlot = (needs: Match[], src: Match[], dIdx: number): Map<string, string> => {
    const fixed = new Map<string, string>(); // asignaciones manuales del admin
    const usedSrc = new Set<number>();
    const pending: Match[] = [];

    for (const n of needs) {
      if (n.vocalAccess?.assignedEmail) {
        const t = findTeamByEmail(n.vocalAccess.assignedEmail, allTeams);
        if (t) {
          fixed.set(n.id, t.id);
          const si = src.findIndex((s) => s.homeTeamId === t.id || s.awayTeamId === t.id);
          if (si >= 0) usedSrc.add(si);
          continue;
        }
      }
      pending.push(n);
    }

    const teamCost = (id: string): number =>
      (vocalLastDayIdx.get(id) === dIdx - 1 ? 1000 : 0) + (vocalCount.get(id) ?? 0);

    let best: Map<string, string> | null = null;
    let bestCost = Infinity;

    const recurse = (idx: number, used: Set<number>, acc: Map<string, string>, cost: number): void => {
      if (cost >= bestCost) return;
      if (idx === pending.length) {
        bestCost = cost;
        best = new Map(acc);
        return;
      }
      const n = pending[idx];
      let placed = false;
      for (let s = 0; s < src.length; s++) {
        if (used.has(s)) continue;
        for (const team of [src[s].homeTeamId, src[s].awayTeamId]) {
          if (!teamWithEmail(team)) continue;
          placed = true;
          used.add(s);
          acc.set(n.id, team);
          recurse(idx + 1, used, acc, cost + teamCost(team));
          acc.delete(n.id);
          used.delete(s);
        }
      }
      if (!placed) recurse(idx + 1, used, acc, cost); // sin equipo disponible → queda sin asignar
    };

    recurse(0, usedSrc, new Map(fixed), 0);
    return best ?? fixed;
  };

  days.forEach((day, dIdx) => {
    const needsToday = allMatches
      .filter((m) => groupLetterOfMatch(m) === needsVocalGroup && dayKey(m) === day)
      .sort((a, b) => matchSortKey(a).localeCompare(matchSortKey(b)));
    const srcToday = allMatches
      .filter((m) => groupLetterOfMatch(m) === sourceGroup && dayKey(m) === day)
      .sort((a, b) => matchSortKey(a).localeCompare(matchSortKey(b)));

    const hours = [...new Set(needsToday.map(matchHour))];
    const dayPicks: string[] = [];

    for (const h of hours) {
      const needs = needsToday.filter((m) => matchHour(m) === h);
      const src = srcToday.filter((m) => matchHour(m) === h);
      const slot = assignSlot(needs, src, dIdx);
      for (const [matchId, teamId] of slot) {
        assigned.set(matchId, teamId);
        dayPicks.push(teamId);
      }
    }

    // El historial se actualiza al cerrar la jornada (los equipos no se repiten entre
    // horarios del mismo día, así que el orden de actualización no afecta el reparto).
    for (const teamId of dayPicks) {
      vocalLastDayIdx.set(teamId, dIdx);
      vocalCount.set(teamId, (vocalCount.get(teamId) ?? 0) + 1);
    }
  });

  return assigned.get(targetMatch.id) ?? null;
};

/**
 * Devuelve la sugerencia de vocal para un partido de fase de grupos.
 * Null para partidos de eliminatoria o cuando no hay datos suficientes.
 */
export const suggestVocalForMatch = (
  match: Match | null | undefined,
  allMatches: Match[],
  allTeams: Team[],
): SuggestedVocal | null => {
  if (!match) return null;

  const matchGroup = groupLetterOfMatch(match);
  if (!matchGroup) return null;

  const sourceGroup: 'A' | 'B' = matchGroup === 'A' ? 'B' : 'A';

  const teamId = computeVocalAssignment(match, matchGroup, sourceGroup, allMatches, allTeams);

  if (teamId) {
    const team = allTeams.find((t) => t.id === teamId);
    const email = team ? firstEmailOf(team) : null;
    if (team && email) return { teamId: team.id, teamName: team.name, email, fromGroup: sourceGroup };
  }

  // Fallback: rotación cronológica entre equipos del grupo fuente con email
  const fallbackTeams = allTeams
    .filter((t) => t.groupId === sourceGroup && firstEmailOf(t) !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (fallbackTeams.length === 0) return null;

  const sameGroupMatches = allMatches
    .filter((m) => groupLetterOfMatch(m) === matchGroup)
    .sort((a, b) => matchSortKey(a).localeCompare(matchSortKey(b)));

  const pos = sameGroupMatches.findIndex((m) => m.id === match.id);
  const designated = fallbackTeams[(pos < 0 ? 0 : pos) % fallbackTeams.length];
  const email = firstEmailOf(designated);
  if (!email) return null;

  return { teamId: designated.id, teamName: designated.name, email, fromGroup: sourceGroup };
};
