import type { GroupStanding } from '../../backend/modules/tournament/domain/entities/index.ts';
import type { Team } from '../../backend/modules/tournament/domain/entities/index.ts';

interface StandingsTableProps {
    standings: GroupStanding[];
    groupName: string;
    teams: Team[];
    qualifiedCount: number;
}

export const StandingsTable = ({ standings, groupName, teams, qualifiedCount }: StandingsTableProps) => {
    const getTeam = (teamId: string) => {
        return teams.find((t) => t.id === teamId);
    };

    const getTeamName = (teamId: string) => {
        const team = getTeam(teamId);
        return team?.name || teamId;
    };

    return (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 sm:px-6 sm:py-4">
                <h2 className="text-base font-semibold text-gray-900 sm:text-lg">{groupName}</h2>
            </div>
            <div className="overflow-x-auto scrollbar-hide">
                <table className="w-full text-xs sm:text-sm">
                    <thead className="bg-gray-50">
                        <tr className="text-left font-medium uppercase tracking-wider text-gray-500">
                            <th className="px-2 py-2 sm:px-4 sm:py-3">#</th>
                            <th className="px-2 py-2 sm:px-4 sm:py-3">Equipo</th>
                            <th className="px-1 py-2 text-center sm:px-3 sm:py-3">PJ</th>
                            <th className="px-1 py-2 text-center sm:px-3 sm:py-3">G</th>
                            <th className="px-1 py-2 text-center sm:px-3 sm:py-3">E</th>
                            <th className="px-1 py-2 text-center sm:px-3 sm:py-3">P</th>
                            <th className="hidden px-1 py-2 text-center sm:table-cell sm:px-3 sm:py-3">GF</th>
                            <th className="hidden px-1 py-2 text-center sm:table-cell sm:px-3 sm:py-3">GC</th>
                            <th className="px-1 py-2 text-center sm:px-3 sm:py-3">DG</th>
                            <th className="px-2 py-2 text-center font-bold sm:px-3 sm:py-3">PTS</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {standings.map((standing, index) => (
                            <tr key={standing.teamId} className={index < qualifiedCount ? 'bg-green-50' : ''}>
                                <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900 sm:px-4 sm:py-3">{index + 1}</td>
                                <td className="whitespace-nowrap px-2 py-2 font-semibold text-gray-900 sm:px-4 sm:py-3 max-w-[100px] truncate sm:max-w-none">
                                    <div className="flex items-center gap-2">
                                        {(() => {
                                            const team = getTeam(standing.teamId);
                                            return team?.crestUrl ? (
                                                <img src={team.crestUrl} alt={team.name} className="h-5 w-5 rounded-full object-cover border border-gray-100" />
                                            ) : (
                                                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-150 border border-gray-200 text-[8px] font-bold text-gray-400">
                                                    🛡️
                                                </div>
                                            );
                                        })()}
                                        <span>{getTeamName(standing.teamId)}</span>
                                    </div>
                                </td>
                                <td className="whitespace-nowrap px-1 py-2 text-center text-gray-900 sm:px-3 sm:py-3">
                                    {standing.matchesPlayed}
                                </td>
                                <td className="whitespace-nowrap px-1 py-2 text-center text-gray-900 sm:px-3 sm:py-3">{standing.wins}</td>
                                <td className="whitespace-nowrap px-1 py-2 text-center text-gray-900 sm:px-3 sm:py-3">{standing.draws}</td>
                                <td className="whitespace-nowrap px-1 py-2 text-center text-gray-900 sm:px-3 sm:py-3">{standing.losses}</td>
                                <td className="hidden whitespace-nowrap px-1 py-2 text-center text-gray-900 sm:table-cell sm:px-3 sm:py-3">
                                    {standing.goalsFor}
                                </td>
                                <td className="hidden whitespace-nowrap px-1 py-2 text-center text-gray-900 sm:table-cell sm:px-3 sm:py-3">
                                    {standing.goalsAgainst}
                                </td>
                                <td
                                    className={`whitespace-nowrap px-1 py-2 text-center font-semibold sm:px-3 sm:py-3 ${standing.goalDifference > 0
                                            ? 'text-green-600'
                                            : standing.goalDifference < 0
                                                ? 'text-red-600'
                                                : 'text-gray-900'
                                        }`}
                                >
                                    {standing.goalDifference > 0 ? '+' : ''}
                                    {standing.goalDifference}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-center font-bold text-gray-900 sm:px-3 sm:py-3">
                                    {standing.points}
                                    {standing.penaltyPoints != null && standing.penaltyPoints > 0 && (
                                        <span className="text-[10px] text-red-500 font-normal ml-1 cursor-help" title={`-${standing.penaltyPoints} pts penalización`}>
                                            (-{standing.penaltyPoints})
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {standings.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-gray-500 sm:px-6 sm:py-12">
                    No hay datos disponibles. Los partidos aún no han comenzado.
                </div>
            )}
        </div>
    );
};
