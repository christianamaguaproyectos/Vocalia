import type { Match } from '../../domain/entities/match.ts';
import type { TournamentId } from '../../domain/value-objects/index.ts';
import type { MatchRepository } from '../../domain/repositories/index.ts';
import type { KnockoutStage } from '../../domain/value-objects/match-stage.ts';
import { initialScore } from '../../domain/value-objects/score.ts';

export interface ProgressKnockoutStageDeps {
    matchRepository: MatchRepository;
}

export interface ProgressKnockoutStageInput {
    tournamentId: TournamentId;
    currentStage: KnockoutStage;
    triggeredBy?: string;
    triggeredRole?: string;
    triggerSource?: string;
}

const MATCH_SPACING_HOURS = 3;
const STAGE_GAP_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AUDIT_ACTOR = 'system';
const DEFAULT_AUDIT_ROLE = 'system';
const DEFAULT_AUDIT_SOURCE = 'unknown';

type ProgressibleStage = 'ROUND_OF_16' | 'QUARTER_FINAL' | 'SEMI_FINAL';
type BracketedStage = ProgressibleStage | 'FINAL';
type SlotField = 'homeTeamId' | 'awayTeamId';

const STAGE_NODE_IDS: Record<BracketedStage, string[]> = {
    ROUND_OF_16: ['R16_1', 'R16_2', 'R16_3', 'R16_4', 'R16_5', 'R16_6', 'R16_7', 'R16_8'],
    QUARTER_FINAL: ['QF_1', 'QF_2', 'QF_3', 'QF_4'],
    SEMI_FINAL: ['SF_1', 'SF_2'],
    FINAL: ['FINAL_1'],
};

const NODE_ADVANCEMENT_MAP: Record<ProgressibleStage, Record<string, { nextNodeId: string; slot: SlotField }>> = {
    ROUND_OF_16: {
        // Seeding policy for Quarter Finals:
        // Llave A: (1° vs 8°) vs (4° vs 5°)
        // Llave D: (4° vs 5°) vs (1° vs 8°)
        // Llave B: (2° vs 7°) vs (3° vs 6°)
        // Llave C: (3° vs 6°) vs (2° vs 7°)
        // This keeps 1° and 2° on opposite semifinal branches.
        R16_1: { nextNodeId: 'QF_1', slot: 'homeTeamId' },
        R16_4: { nextNodeId: 'QF_1', slot: 'awayTeamId' },
        R16_5: { nextNodeId: 'QF_2', slot: 'homeTeamId' },
        R16_8: { nextNodeId: 'QF_2', slot: 'awayTeamId' },
        R16_2: { nextNodeId: 'QF_3', slot: 'homeTeamId' },
        R16_3: { nextNodeId: 'QF_3', slot: 'awayTeamId' },
        R16_6: { nextNodeId: 'QF_4', slot: 'homeTeamId' },
        R16_7: { nextNodeId: 'QF_4', slot: 'awayTeamId' },
    },
    QUARTER_FINAL: {
        QF_1: { nextNodeId: 'SF_1', slot: 'homeTeamId' },
        QF_2: { nextNodeId: 'SF_1', slot: 'awayTeamId' },
        QF_3: { nextNodeId: 'SF_2', slot: 'homeTeamId' },
        QF_4: { nextNodeId: 'SF_2', slot: 'awayTeamId' },
    },
    SEMI_FINAL: {
        SF_1: { nextNodeId: 'FINAL_1', slot: 'homeTeamId' },
        SF_2: { nextNodeId: 'FINAL_1', slot: 'awayTeamId' },
    },
};

const NEXT_STAGE_MAP: Record<KnockoutStage, KnockoutStage | null> = {
    ROUND_OF_16: 'QUARTER_FINAL',
    QUARTER_FINAL: 'SEMI_FINAL',
    SEMI_FINAL: 'FINAL',
    FINAL: null,
    THIRD_PLACE: null,
};

const isProgressibleStage = (stage: KnockoutStage): stage is ProgressibleStage => {
    return stage === 'ROUND_OF_16' || stage === 'QUARTER_FINAL' || stage === 'SEMI_FINAL';
};

const isBracketedStage = (stage: KnockoutStage): stage is BracketedStage => {
    return stage === 'ROUND_OF_16' || stage === 'QUARTER_FINAL' || stage === 'SEMI_FINAL' || stage === 'FINAL';
};

const sortStageMatches = (a: Match, b: Match) => {
    if (a.scheduledAt.getTime() !== b.scheduledAt.getTime()) {
        return a.scheduledAt.getTime() - b.scheduledAt.getTime();
    }

    if (a.createdAt.getTime() !== b.createdAt.getTime()) {
        return a.createdAt.getTime() - b.createdAt.getTime();
    }

    return a.id.localeCompare(b.id);
};

const normalizeStageMatches = async ({
    stage,
    stageMatches,
    tournamentId,
    matchRepository,
}: {
    stage: BracketedStage;
    stageMatches: Match[];
    tournamentId: TournamentId;
    matchRepository: MatchRepository;
}): Promise<Map<string, Match>> => {
    const expectedNodeIds = STAGE_NODE_IDS[stage];
    const sorted = [...stageMatches].sort(sortStageMatches);

    if (sorted.length > expectedNodeIds.length) {
        console.warn(
            `[progressKnockoutStageUseCase] Hay ${sorted.length} partidos en ${stage} y solo ${expectedNodeIds.length} nodos esperados. Se ignorarán excedentes para avanzar ganadores.`,
        );
    }

    const byNodeId = new Map<string, Match>();
    const withoutNode: Match[] = [];

    for (const match of sorted) {
        const nodeId = match.bracketNodeId;
        if (nodeId && expectedNodeIds.includes(nodeId) && !byNodeId.has(nodeId)) {
            byNodeId.set(nodeId, match);
            continue;
        }

        withoutNode.push(match);
    }

    const availableNodeIds = expectedNodeIds.filter((nodeId) => !byNodeId.has(nodeId));
    const updates: Promise<void>[] = [];
    const now = new Date();

    withoutNode.forEach((match, index) => {
        const nodeId = availableNodeIds[index];
        if (!nodeId) {
            return;
        }

        byNodeId.set(nodeId, {
            ...match,
            bracketNodeId: nodeId,
        });

        if (match.bracketNodeId !== nodeId) {
            updates.push(
                matchRepository.update(match.id, {
                    tournamentId,
                    bracketNodeId: nodeId,
                    updatedAt: now,
                }),
            );
        }
    });

    if (updates.length > 0) {
        await Promise.all(updates);
    }

    return byNodeId;
};

const ensureNextStageMatches = async ({
    tournamentId,
    currentStageMatches,
    nextStage,
    existingNextStageMatches,
    matchRepository,
}: {
    tournamentId: TournamentId;
    currentStageMatches: Match[];
    nextStage: BracketedStage;
    existingNextStageMatches: Match[];
    matchRepository: MatchRepository;
}): Promise<{ createdMatches: Match[]; byNodeId: Map<string, Match> }> => {
    const expectedNodeIds = STAGE_NODE_IDS[nextStage];
    const byNodeId = await normalizeStageMatches({
        stage: nextStage,
        stageMatches: existingNextStageMatches,
        tournamentId,
        matchRepository,
    });

    const createdMatches: Match[] = [];
    const now = new Date();

    const lastCurrentDate = currentStageMatches.reduce(
        (latest, match) => (match.scheduledAt > latest ? match.scheduledAt : latest),
        new Date(0),
    );
    const firstKickoff = new Date(lastCurrentDate.getTime() + STAGE_GAP_MS);

    for (const nodeId of expectedNodeIds) {
        if (byNodeId.has(nodeId)) {
            continue;
        }

        const nodeIndex = expectedNodeIds.indexOf(nodeId);
        const scheduledAt = new Date(firstKickoff.getTime() + nodeIndex * MATCH_SPACING_HOURS * 60 * 60 * 1000);

        const created = await matchRepository.create({
            tournamentId,
            stage: {
                type: 'KNOCKOUT',
                knockout: nextStage,
            },
            homeTeamId: '',
            awayTeamId: '',
            bracketNodeId: nodeId,
            scheduledAt,
            status: 'SCHEDULED',
            score: initialScore(),
            createdAt: now,
        });

        createdMatches.push(created);
        byNodeId.set(nodeId, created);
    }

    return { createdMatches, byNodeId };
};

const resolveWinnerId = (match: Match): string => {
    if (match.score.home > match.score.away) {
        return match.homeTeamId;
    }

    if (match.score.away > match.score.home) {
        return match.awayTeamId;
    }

    const penaltiesHome = match.score.penaltiesHome ?? 0;
    const penaltiesAway = match.score.penaltiesAway ?? 0;

    if (penaltiesHome > penaltiesAway) {
        return match.homeTeamId;
    }

    if (penaltiesAway > penaltiesHome) {
        return match.awayTeamId;
    }

    return '';
};

const formatNodeLabel = (nodeId: string): string => nodeId.replace('_', '');

export const progressKnockoutStageUseCase = ({ matchRepository }: ProgressKnockoutStageDeps) => async ({
    tournamentId,
    currentStage,
    triggeredBy,
    triggeredRole,
    triggerSource,
}: ProgressKnockoutStageInput) => {
    const nextStage = NEXT_STAGE_MAP[currentStage];
    if (!nextStage || !isProgressibleStage(currentStage) || !isBracketedStage(nextStage)) {
        return [];
    }

    const auditActor = (triggeredBy ?? '').trim() || DEFAULT_AUDIT_ACTOR;
    const auditRole = (triggeredRole ?? '').trim() || DEFAULT_AUDIT_ROLE;
    const auditSource = (triggerSource ?? '').trim() || DEFAULT_AUDIT_SOURCE;

    const writeAuditLog = async (entry: {
        action: 'LOCK_ACQUIRED' | 'LOCK_REJECTED' | 'MATCH_CREATED' | 'TEAM_ADVANCED' | 'PROGRESSION_COMPLETED' | 'SANITIZE';
        message: string;
        metadata?: Record<string, unknown>;
    }) => {
        try {
            await matchRepository.appendKnockoutProgressAuditLog({
                tournamentId,
                currentStage,
                nextStage,
                action: entry.action,
                message: entry.message,
                triggeredBy: auditActor,
                triggeredRole: auditRole,
                source: auditSource,
                metadata: entry.metadata,
            });
        } catch (auditError) {
            console.warn('[progressKnockoutStageUseCase] No se pudo escribir log de auditoría', auditError);
        }
    };

    const lockAcquired = await matchRepository.tryAcquireKnockoutProgressLock({
        tournamentId,
        currentStage,
    });

    if (!lockAcquired) {
        await writeAuditLog({
            action: 'LOCK_REJECTED',
            message: `Progresión rechazada por lock activo en ${currentStage}.`,
            metadata: {
                lockStage: currentStage,
            },
        });
        throw new Error(`La progresión de ${currentStage} ya está en curso por otro cliente. Intenta nuevamente en unos segundos.`);
    }

    await writeAuditLog({
        action: 'LOCK_ACQUIRED',
        message: `Progresión iniciada para ${currentStage} -> ${nextStage}.`,
        metadata: {
            fromStage: currentStage,
            toStage: nextStage,
        },
    });

    try {
        const matches = await matchRepository.listByTournament(tournamentId);

        const currentStageMatches = matches.filter(
            (match) => match.stage.type === 'KNOCKOUT' && match.stage.knockout === currentStage,
        );

        if (currentStageMatches.length === 0) {
            return [];
        }

        const currentByNodeId = await normalizeStageMatches({
            stage: currentStage,
            stageMatches: currentStageMatches,
            tournamentId,
            matchRepository,
        });

        const existingNextStageMatches = matches.filter(
            (match) => match.stage.type === 'KNOCKOUT' && match.stage.knockout === nextStage,
        );

        const { createdMatches, byNodeId: nextByNodeId } = await ensureNextStageMatches({
            tournamentId,
            currentStageMatches,
            nextStage,
            existingNextStageMatches,
            matchRepository,
        });

        for (const createdMatch of createdMatches) {
            await writeAuditLog({
                action: 'MATCH_CREATED',
                message: `Partido ${formatNodeLabel(createdMatch.bracketNodeId ?? createdMatch.id)} creado para ${nextStage}.`,
                metadata: {
                    stage: nextStage,
                    nodeId: createdMatch.bracketNodeId ?? null,
                    matchId: createdMatch.id,
                    scheduledAt: createdMatch.scheduledAt,
                },
            });
        }

        const updates: Promise<void>[] = [];
        const auditPromises: Promise<void>[] = [];
        const now = new Date();
        const advancementMap = NODE_ADVANCEMENT_MAP[currentStage];

        for (const currentNodeId of STAGE_NODE_IDS[currentStage]) {
            const currentMatch = currentByNodeId.get(currentNodeId);
            if (!currentMatch || currentMatch.status !== 'FINISHED') {
                continue;
            }

            const winnerId = resolveWinnerId(currentMatch);
            if (!winnerId) {
                continue;
            }

            const route = advancementMap[currentNodeId];
            if (!route) {
                continue;
            }

            const nextMatch = nextByNodeId.get(route.nextNodeId);
            if (!nextMatch) {
                continue;
            }

            const targetSlot = route.slot;
            const oppositeSlot: SlotField = targetSlot === 'homeTeamId' ? 'awayTeamId' : 'homeTeamId';

            const updatePayload: Partial<Omit<Match, 'id'>> = {
                tournamentId,
                updatedAt: now,
            };

            if (nextMatch[targetSlot] !== winnerId) {
                updatePayload[targetSlot] = winnerId;
            }

            if (nextMatch[oppositeSlot] === winnerId) {
                updatePayload[oppositeSlot] = '';
            }

            if (!('homeTeamId' in updatePayload) && !('awayTeamId' in updatePayload)) {
                continue;
            }

            updates.push(matchRepository.update(nextMatch.id, updatePayload));
            const routeFrom = formatNodeLabel(currentNodeId);
            const routeTo = formatNodeLabel(route.nextNodeId);
            auditPromises.push(
                writeAuditLog({
                    action: 'TEAM_ADVANCED',
                    message: `Ganador ${routeFrom} avanzó a ${routeTo} (${targetSlot}).`,
                    metadata: {
                        fromNodeId: currentNodeId,
                        toNodeId: route.nextNodeId,
                        winnerTeamId: winnerId,
                        targetSlot,
                        sourceMatchId: currentMatch.id,
                        targetMatchId: nextMatch.id,
                    },
                }),
            );
            nextByNodeId.set(route.nextNodeId, {
                ...nextMatch,
                ...updatePayload,
            });
        }

        if (updates.length > 0) {
            await Promise.all(updates);
        }

        if (auditPromises.length > 0) {
            await Promise.all(auditPromises);
        }

        await writeAuditLog({
            action: 'PROGRESSION_COMPLETED',
            message: `Progresión completada para ${currentStage} -> ${nextStage}.`,
            metadata: {
                createdMatches: createdMatches.length,
                promotedTeams: updates.length,
            },
        });

        return createdMatches;
    } finally {
        try {
            await matchRepository.releaseKnockoutProgressLock({ tournamentId, currentStage });
        } catch (releaseError) {
            console.warn('[progressKnockoutStageUseCase] No se pudo liberar el lock de progresión', releaseError);
        }
    }
};
