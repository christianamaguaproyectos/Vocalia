import type { Match } from '../../domain/entities/match.ts';
import type { MatchRepository } from '../../domain/repositories/index.ts';
import type { MatchStatus, TournamentId } from '../../domain/value-objects/index.ts';
import type { KnockoutStage } from '../../domain/value-objects/match-stage.ts';

export interface SanitizeKnockoutBracketDeps {
  matchRepository: MatchRepository;
}

export interface SanitizeKnockoutBracketInput {
  tournamentId: TournamentId;
  dryRun?: boolean;
  triggeredBy?: string;
  triggeredRole?: string;
  triggerSource?: string;
}

export interface SanitizeKnockoutBracketStageResult {
  stage: BracketStage;
  totalMatches: number;
  expectedMatches: number;
  assignedNodeIds: number;
  updatedNodeIds: number;
  removedDuplicates: number;
  keptMatchIds: string[];
  removedMatchIds: string[];
}

export interface SanitizeKnockoutBracketResult {
  dryRun: boolean;
  updatedNodeIds: number;
  removedDuplicates: number;
  stageResults: SanitizeKnockoutBracketStageResult[];
}

type BracketStage = 'ROUND_OF_16' | 'QUARTER_FINAL' | 'SEMI_FINAL' | 'FINAL';

const STAGE_NODE_IDS: Record<BracketStage, string[]> = {
  ROUND_OF_16: ['R16_1', 'R16_2', 'R16_3', 'R16_4', 'R16_5', 'R16_6', 'R16_7', 'R16_8'],
  QUARTER_FINAL: ['QF_1', 'QF_2', 'QF_3', 'QF_4'],
  SEMI_FINAL: ['SF_1', 'SF_2'],
  FINAL: ['FINAL_1'],
};

const BRACKET_STAGES: BracketStage[] = ['ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'];

const STATUS_PRIORITY: Record<MatchStatus, number> = {
  FINISHED: 5,
  LIVE: 4,
  SUSPENDED: 3,
  SCHEDULED: 2,
  CANCELLED: 1,
};

const DEFAULT_AUDIT_ACTOR = 'system';
const DEFAULT_AUDIT_ROLE = 'system';
const DEFAULT_AUDIT_SOURCE = 'sanitize-script';

const countAssignedTeams = (match: Match): number => {
  let count = 0;
  if (match.homeTeamId) count += 1;
  if (match.awayTeamId) count += 1;
  return count;
};

const sortBySchedule = (a: Match, b: Match): number => {
  if (a.scheduledAt.getTime() !== b.scheduledAt.getTime()) {
    return a.scheduledAt.getTime() - b.scheduledAt.getTime();
  }

  if (a.createdAt.getTime() !== b.createdAt.getTime()) {
    return a.createdAt.getTime() - b.createdAt.getTime();
  }

  return a.id.localeCompare(b.id);
};

const compareKeeperPriority = (a: Match, b: Match): number => {
  const statusDiff = STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
  if (statusDiff !== 0) {
    return statusDiff;
  }

  const teamDiff = countAssignedTeams(b) - countAssignedTeams(a);
  if (teamDiff !== 0) {
    return teamDiff;
  }

  const scoreDiff = (b.score.home + b.score.away) - (a.score.home + a.score.away);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  return sortBySchedule(a, b);
};

const normalizeNodeLabel = (nodeId: string): string => nodeId.replace('_', '');

export const sanitizeKnockoutBracketUseCase = ({ matchRepository }: SanitizeKnockoutBracketDeps) => async ({
  tournamentId,
  dryRun = false,
  triggeredBy,
  triggeredRole,
  triggerSource,
}: SanitizeKnockoutBracketInput): Promise<SanitizeKnockoutBracketResult> => {
  const auditActor = (triggeredBy ?? '').trim() || DEFAULT_AUDIT_ACTOR;
  const auditRole = (triggeredRole ?? '').trim() || DEFAULT_AUDIT_ROLE;
  const auditSource = (triggerSource ?? '').trim() || DEFAULT_AUDIT_SOURCE;

  const writeAudit = async (stage: BracketStage, message: string, metadata?: Record<string, unknown>) => {
    try {
      await matchRepository.appendKnockoutProgressAuditLog({
        tournamentId,
        currentStage: stage,
        action: 'SANITIZE',
        message,
        triggeredBy: auditActor,
        triggeredRole: auditRole,
        source: auditSource,
        metadata,
      });
    } catch (error) {
      console.warn('[sanitizeKnockoutBracketUseCase] No se pudo escribir log de auditoria', error);
    }
  };

  const allMatches = await matchRepository.listByTournament(tournamentId);
  const knockoutMatches = allMatches.filter(
    (match) =>
      match.stage.type === 'KNOCKOUT' &&
      (match.stage.knockout === 'ROUND_OF_16' ||
        match.stage.knockout === 'QUARTER_FINAL' ||
        match.stage.knockout === 'SEMI_FINAL' ||
        match.stage.knockout === 'FINAL'),
  );

  const stageResults: SanitizeKnockoutBracketStageResult[] = [];
  let updatedNodeIds = 0;
  let removedDuplicates = 0;

  for (const stage of BRACKET_STAGES) {
    const expectedNodeIds = STAGE_NODE_IDS[stage];
    const stageMatches = knockoutMatches
      .filter((match) => match.stage.knockout === stage)
      .sort(sortBySchedule);

    const validNodeSet = new Set(expectedNodeIds);
    const nodeBuckets = new Map<string, Match[]>();
    const unassignedPool: Match[] = [];

    for (const match of stageMatches) {
      if (match.bracketNodeId && validNodeSet.has(match.bracketNodeId)) {
        const bucket = nodeBuckets.get(match.bracketNodeId) ?? [];
        bucket.push(match);
        nodeBuckets.set(match.bracketNodeId, bucket);
      } else {
        unassignedPool.push(match);
      }
    }

    unassignedPool.sort(compareKeeperPriority);

    const updates: Array<{ matchId: string; nodeId: string }> = [];
    const toDelete: Match[] = [];
    const keptMatchIds: string[] = [];

    for (const nodeId of expectedNodeIds) {
      const bucket = (nodeBuckets.get(nodeId) ?? []).sort(compareKeeperPriority);
      let keeper = bucket[0];

      if (!keeper && unassignedPool.length > 0) {
        keeper = unassignedPool.shift();
      }

      if (!keeper) {
        continue;
      }

      keptMatchIds.push(keeper.id);

      if (keeper.bracketNodeId !== nodeId) {
        updates.push({ matchId: keeper.id, nodeId });
      }

      if (bucket.length > 1) {
        toDelete.push(...bucket.slice(1));
      }
    }

    if (unassignedPool.length > 0) {
      toDelete.push(...unassignedPool);
    }

    const uniqueToDelete = Array.from(new Map(toDelete.map((match) => [match.id, match])).values());

    if (!dryRun) {
      const now = new Date();
      if (updates.length > 0) {
        await Promise.all(
          updates.map((item) =>
            matchRepository.update(item.matchId, {
              tournamentId,
              bracketNodeId: item.nodeId,
              updatedAt: now,
            }),
          ),
        );
      }

      if (uniqueToDelete.length > 0) {
        await Promise.all(uniqueToDelete.map((match) => matchRepository.delete(match.id, tournamentId)));
      }
    }

    updatedNodeIds += updates.length;
    removedDuplicates += uniqueToDelete.length;

    const stageSummary: SanitizeKnockoutBracketStageResult = {
      stage,
      totalMatches: stageMatches.length,
      expectedMatches: expectedNodeIds.length,
      assignedNodeIds: keptMatchIds.length,
      updatedNodeIds: updates.length,
      removedDuplicates: uniqueToDelete.length,
      keptMatchIds,
      removedMatchIds: uniqueToDelete.map((match) => match.id),
    };

    stageResults.push(stageSummary);

    await writeAudit(
      stage,
      `Saneamiento ${stage}: ${updates.length} nodo(s) reasignados y ${uniqueToDelete.length} duplicado(s) ${dryRun ? 'detectados' : 'eliminados'}.`,
      {
        dryRun,
        stage,
        expectedNodeIds: expectedNodeIds.map(normalizeNodeLabel),
        reassignedNodeIds: updates.map((update) => update.nodeId),
        removedMatchIds: uniqueToDelete.map((match) => match.id),
      },
    );
  }

  return {
    dryRun,
    updatedNodeIds,
    removedDuplicates,
    stageResults,
  };
};
