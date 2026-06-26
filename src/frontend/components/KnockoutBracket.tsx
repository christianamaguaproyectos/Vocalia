import React, { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import type { Match } from '../../backend/modules/tournament/domain/entities/index.ts';

interface KnockoutBracketProps {
    matches: Match[];
    teams: Record<string, { id: string; name: string }>;
}

export const KnockoutBracket: React.FC<KnockoutBracketProps> = ({ matches, teams }) => {
    // Extract and organize matches by stage
    const bracketData = useMemo(() => {
        const stageOrder: Array<'ROUND_OF_16' | 'QUARTER_FINAL' | 'SEMI_FINAL' | 'FINAL'> = [
            'ROUND_OF_16',
            'QUARTER_FINAL',
            'SEMI_FINAL',
            'FINAL',
        ];
        const firstStageWithMatches = stageOrder.find((stage) =>
            matches.some((match) => match.stage.knockout === stage),
        );
        const startStageIndex = firstStageWithMatches ? stageOrder.indexOf(firstStageWithMatches) : 0;

        const roundOf16 = matches.filter((m) => m.stage.knockout === 'ROUND_OF_16').sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
        const quarterfinals = matches.filter((m) => m.stage.knockout === 'QUARTER_FINAL').sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
        const semifinals = matches.filter((m) => m.stage.knockout === 'SEMI_FINAL').sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
        const finalMatch = matches.find((m) => m.stage.knockout === 'FINAL');

        // Split earlier rounds into Left and Right branches
        const splitInHalf = (list: Match[]) => {
            const mid = Math.ceil(list.length / 2);
            return { left: list.slice(0, mid), right: list.slice(mid) };
        };

        return {
            r16: splitInHalf(roundOf16),
            qf: splitInHalf(quarterfinals),
            sf: splitInHalf(semifinals),
            final: finalMatch,
            startStageIndex,
        };
    }, [matches]);

    const showRoundOf16 = bracketData.startStageIndex <= 0;
    const showQuarterFinal = bracketData.startStageIndex <= 1;
    const showSemiFinal = bracketData.startStageIndex <= 2;

    const getTeamName = (teamId?: string | null) => {
        if (!teamId) return 'Por definir';
        return teams[teamId]?.name || teamId;
    };

    const championTeamId = useMemo(() => {
        const finalMatch = bracketData.final;
        if (!finalMatch || finalMatch.status !== 'FINISHED') return null;

        const homeScore = finalMatch.score.home;
        const awayScore = finalMatch.score.away;

        if (homeScore > awayScore) return finalMatch.homeTeamId;
        if (awayScore > homeScore) return finalMatch.awayTeamId;

        const homePenalties = finalMatch.score.penaltiesHome || 0;
        const awayPenalties = finalMatch.score.penaltiesAway || 0;

        if (homePenalties > awayPenalties) return finalMatch.homeTeamId;
        if (awayPenalties > homePenalties) return finalMatch.awayTeamId;

        return null;
    }, [bracketData.final]);

    const championName = getTeamName(championTeamId);

    const MatchNode = ({ match }: { match?: Match; branch?: 'left' | 'right' }) => {
        if (!match) {
            return (
                <div className="w-40 rounded-lg border border-indigo-500/30 bg-indigo-950/40 p-2 shadow-lg backdrop-blur-sm sm:w-48">
                    <div className="flex flex-col gap-1 text-xs sm:text-sm">
                        <div className="flex items-center justify-between rounded bg-indigo-950/60 px-2 py-1 text-indigo-300">
                            <span className="truncate">Por definir</span>
                            <span className="font-mono opacity-50">-</span>
                        </div>
                        <div className="flex items-center justify-between rounded bg-indigo-950/60 px-2 py-1 text-indigo-300">
                            <span className="truncate">Por definir</span>
                            <span className="font-mono opacity-50">-</span>
                        </div>
                    </div>
                </div>
            );
        }

        const homeScore = match.score.home;
        const awayScore = match.score.away;
        const isFinished = match.status === 'FINISHED';

        const homeWinner = isFinished && homeScore > awayScore;
        const awayWinner = isFinished && awayScore > homeScore;

        return (
            <div className="relative w-40 rounded-lg border border-fuchsia-500/40 bg-indigo-950/60 p-2 shadow-xl backdrop-blur-md sm:w-48">
                <div className="flex flex-col gap-1 text-xs sm:text-sm">
                    <div className={`flex items-center justify-between rounded px-2 py-1 ${homeWinner ? 'bg-fuchsia-600/20 font-bold text-white' : 'bg-indigo-900/40 text-indigo-100'}`}>
                        <span className="truncate pr-2">{getTeamName(match.homeTeamId)}</span>
                        <span className="font-mono tabular-nums">{homeScore}</span>
                    </div>
                    <div className={`flex items-center justify-between rounded px-2 py-1 ${awayWinner ? 'bg-fuchsia-600/20 font-bold text-white' : 'bg-indigo-900/40 text-indigo-100'}`}>
                        <span className="truncate pr-2">{getTeamName(match.awayTeamId)}</span>
                        <span className="font-mono tabular-nums">{awayScore}</span>
                    </div>
                </div>
                {match.status === 'LIVE' && (
                    <div className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500">
                        <div className="h-2 w-2 animate-ping rounded-full bg-white opacity-75"></div>
                    </div>
                )}
            </div>
        );
    };

    // Helper to render a column of matches with connecting lines
    const MatchColumn = ({ matches, branch, roundName, emptyCount }: { matches: Match[]; branch: 'left' | 'right'; roundName: string; emptyCount: number }) => {
        // Fill with empty placeholders if needed
        const displayList = [...matches];
        while (displayList.length < emptyCount) {
            displayList.push(undefined as any);
        }

        return (
            <div className="flex flex-col items-center gap-4">
                <div className="mb-4 text-xs font-bold tracking-widest text-fuchsia-400 uppercase opacity-80">{roundName}</div>
                <div className="flex flex-col justify-around gap-6 h-full">
                    {displayList.map((m, i) => (
                        <div key={m?.id || `empty-${roundName}-${i}`} className="relative flex items-center">
                            <MatchNode match={m} branch={branch} />

                            {/* Connector lines */}
                            {branch === 'left' && (
                                <div className="absolute -right-4 top-1/2 h-[2px] w-4 bg-fuchsia-500/40"></div>
                            )}
                            {branch === 'right' && (
                                <div className="absolute -left-4 top-1/2 h-[2px] w-4 bg-fuchsia-500/40"></div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="relative w-full overflow-x-auto rounded-xl bg-[#0B0F19] p-8">
            {/* Background glow effects */}
            <div className="absolute top-1/4 left-1/4 h-64 w-64 rounded-full bg-indigo-600/20 blur-[100px]"></div>
            <div className="absolute top-1/3 right-1/4 h-64 w-64 rounded-full bg-fuchsia-600/20 blur-[100px]"></div>

            <div className="relative mx-auto flex min-w-[800px] justify-between pb-8 pt-8">

                {/* Left Side (R16, QF, SF) */}
                <div className="flex gap-8">
                    {showRoundOf16 && <MatchColumn matches={bracketData.r16.left} emptyCount={4} roundName="Octavos" branch="left" />}
                    {showQuarterFinal && <MatchColumn matches={bracketData.qf.left} emptyCount={2} roundName="Cuartos" branch="left" />}
                    {showSemiFinal && <MatchColumn matches={bracketData.sf.left} emptyCount={1} roundName="Semi" branch="left" />}
                </div>

                {/* Center (Final) */}
                <div className="flex flex-col items-center justify-center px-4 mt-8">
                    {championTeamId && (
                        <div className="mb-8 flex flex-col items-center animate-in fade-in zoom-in duration-500">
                            <div className="text-xl font-black text-yellow-500 drop-shadow-[0_0_10px_rgba(234,179,8,0.8)] uppercase tracking-wider">¡Campeón!</div>
                            <div className="mt-3 rounded-full border-2 border-yellow-400/50 bg-yellow-400/20 px-8 py-3 text-2xl font-bold text-white shadow-[0_0_30px_rgba(250,204,21,0.4)] backdrop-blur-md">
                                {championName}
                            </div>
                        </div>
                    )}
                    <div className="mb-8 flex flex-col items-center">
                        <Trophy className="mb-2 h-16 w-16 text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.5)]" strokeWidth={1.5} />
                        <div className="text-xl font-black tracking-widest text-white drop-shadow-lg">FINAL</div>
                    </div>
                    <div className="relative">
                        <MatchNode match={bracketData.final} branch="left" />
                        <div className="absolute -left-8 top-1/2 h-[2px] w-8 bg-fuchsia-500/40"></div>
                        <div className="absolute -right-8 top-1/2 h-[2px] w-8 bg-fuchsia-500/40"></div>
                    </div>
                </div>

                {/* Right Side (SF, QF, R16) */}
                <div className="flex gap-8 flex-row-reverse">
                    {showRoundOf16 && <MatchColumn matches={bracketData.r16.right} emptyCount={4} roundName="Octavos" branch="right" />}
                    {showQuarterFinal && <MatchColumn matches={bracketData.qf.right} emptyCount={2} roundName="Cuartos" branch="right" />}
                    {showSemiFinal && <MatchColumn matches={bracketData.sf.right} emptyCount={1} roundName="Semi" branch="right" />}
                </div>

            </div>
        </div>
    );
};
