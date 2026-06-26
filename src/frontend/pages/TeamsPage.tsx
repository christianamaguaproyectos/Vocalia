import { TeamList } from '../../backend/modules/tournament/presentation/components/index.ts';
import { APP_CONFIG } from '../../core/config/app-config.ts';

export const TeamsPage = () => {
  const tournamentId = APP_CONFIG.defaultTournamentId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Equipos</h1>
        <p className="text-sm text-gray-500">Consulta los equipos registrados y sus plantillas.</p>
      </div>
      <TeamList tournamentId={tournamentId} readOnly={true} />
    </div>
  );
};
