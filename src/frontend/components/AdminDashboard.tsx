import type { Team } from '../../backend/modules/tournament/domain/entities/team.ts';
import type { Match } from '../../backend/modules/tournament/domain/entities/match.ts';
import type { CardEvent } from '../../backend/modules/tournament/domain/entities/match-event.ts';
import { useOnlineCount } from '../hooks/useOnlineCount.ts';

interface Props {
  teams: Team[];
  matches: Match[];
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

const StatCard = ({ label, value, sub, color = 'indigo' }: StatCardProps) => {
  const ring: Record<string, string> = {
    indigo: 'border-indigo-200 bg-indigo-50',
    green: 'border-green-200 bg-green-50',
    yellow: 'border-yellow-200 bg-yellow-50',
    red: 'border-red-200 bg-red-50',
    gray: 'border-gray-200 bg-gray-50',
    blue: 'border-blue-200 bg-blue-50',
  };
  const text: Record<string, string> = {
    indigo: 'text-indigo-700',
    green: 'text-green-700',
    yellow: 'text-yellow-700',
    red: 'text-red-700',
    gray: 'text-gray-700',
    blue: 'text-blue-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${ring[color] ?? ring.indigo}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${text[color] ?? text.indigo}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
};

const formatPeakDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const AdminDashboard = ({ teams, matches }: Props) => {
  const { count: onlineCount, peak, isConfigured } = useOnlineCount();

  const groupATeams = teams.filter((t) => t.groupId === 'A');
  const groupBTeams = teams.filter((t) => t.groupId === 'B');
  const totalPlayers = teams.reduce((s, t) => s + (t.players?.length ?? 0), 0);

  const finishedMatches = matches.filter((m) => m.status === 'FINISHED');
  const scheduledMatches = matches.filter((m) => m.status === 'SCHEDULED');
  const liveMatches = matches.filter((m) => m.status === 'LIVE');

  const totalGoals = finishedMatches.reduce(
    (s, m) => s + (m.score?.home ?? 0) + (m.score?.away ?? 0),
    0,
  );

  let yellowCards = 0;
  let redCards = 0;
  for (const m of matches) {
    for (const ev of m.events ?? []) {
      if (ev.type === 'CARD') {
        const card = ev as CardEvent;
        if (card.cardType === 'YELLOW') yellowCards++;
        else if (card.cardType === 'RED' || card.cardType === 'DOUBLE_YELLOW') redCards++;
      }
    }
  }

  const now = new Date();
  const activeVocals = matches.filter(
    (m) => m.vocalAccess && new Date(m.vocalAccess.expiresAt) > now,
  ).length;

  return (
    <div className="space-y-8">
      {/* Presencia en tiempo real */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          En la app ahora mismo
        </h2>
        {isConfigured ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {/* En línea ahora */}
            <div className="flex items-center gap-4 rounded-2xl border border-indigo-300 bg-gradient-to-r from-indigo-50 to-blue-50 p-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-600 shadow-lg">
                <span className="text-2xl font-bold text-white">
                  {onlineCount === null ? '…' : onlineCount}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-indigo-800">
                  {onlineCount === null ? 'Conectando…' : onlineCount === 1 ? '1 persona ahora' : `${onlineCount} personas ahora`}
                </p>
                <p className="text-xs text-indigo-500">Actualiza en tiempo real</p>
              </div>
              <span className="ml-auto flex shrink-0 h-3 w-3">
                <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
              </span>
            </div>

            {/* Pico histórico */}
            <div className="flex items-center gap-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-500 shadow-lg">
                <span className="text-2xl font-bold text-white">
                  {peak ? peak.count : '—'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-amber-800">
                  {peak ? `Pico: ${peak.count} ${peak.count === 1 ? 'persona' : 'personas'}` : 'Sin pico registrado'}
                </p>
                <p className="text-xs text-amber-600 truncate">
                  {peak ? formatPeakDate(peak.timestamp) : 'El pico se registra automáticamente'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
            <p className="text-sm font-medium text-gray-600">
              Presencia en tiempo real no configurada
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Agrega <code className="rounded bg-gray-200 px-1">VITE_FIREBASE_DATABASE_URL</code> al archivo{' '}
              <code className="rounded bg-gray-200 px-1">.env</code> y activa Realtime Database en Firebase Console.
            </p>
          </div>
        )}
      </div>

      {/* Stats del torneo */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Resumen del torneo
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            label="Equipos"
            value={teams.length}
            sub={`${groupATeams.length} Grupo A · ${groupBTeams.length} Grupo B`}
            color="indigo"
          />
          <StatCard
            label="Jugadores"
            value={totalPlayers}
            sub={`${(totalPlayers / Math.max(teams.length, 1)).toFixed(1)} promedio por equipo`}
            color="blue"
          />
          <StatCard
            label="Partidos jugados"
            value={finishedMatches.length}
            sub={`de ${matches.length} totales`}
            color="green"
          />
          <StatCard
            label="Pendientes"
            value={scheduledMatches.length}
            sub={liveMatches.length > 0 ? `${liveMatches.length} en curso ahora` : undefined}
            color="gray"
          />
          <StatCard
            label="Goles"
            value={totalGoals}
            sub={finishedMatches.length > 0 ? `${(totalGoals / finishedMatches.length).toFixed(1)} por partido` : undefined}
            color="green"
          />
          <StatCard
            label="Tarjetas amarillas"
            value={yellowCards}
            color="yellow"
          />
          <StatCard
            label="Tarjetas rojas"
            value={redCards}
            color="red"
          />
          <StatCard
            label="Vocales activos"
            value={activeVocals}
            sub="con acceso OTP vigente"
            color="indigo"
          />
        </div>
      </div>
    </div>
  );
};
