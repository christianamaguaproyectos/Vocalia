export interface AppConfig {
  defaultTournamentId: string;
}

const defaultTournamentId = import.meta.env.VITE_TOURNAMENT_ID ?? 'default-tournament';

export const APP_CONFIG: AppConfig = {
  defaultTournamentId,
};
