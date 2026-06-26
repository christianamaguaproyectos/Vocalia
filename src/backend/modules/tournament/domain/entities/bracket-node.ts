import type { BracketNodeId, MatchId } from '../value-objects/identifiers.ts';
import type { KnockoutStage } from '../value-objects/match-stage.ts';

export interface BracketNode {
  id: BracketNodeId;
  stage: KnockoutStage;
  label: string;
  matchId?: MatchId;
  parentNodeId?: BracketNodeId;
  childNodeIds?: BracketNodeId[];
  createdAt: Date;
}
