export type GroupStage = 'GROUP_A' | 'GROUP_B';

export type KnockoutStage =
  | 'ROUND_OF_16'
  | 'QUARTER_FINAL'
  | 'SEMI_FINAL'
  | 'FINAL'
  | 'THIRD_PLACE';

export type StageType = 'GROUP' | 'KNOCKOUT';

export interface MatchStage {
  type: StageType;
  group?: GroupStage;
  knockout?: KnockoutStage;
}

export const isKnockoutStage = (stage: MatchStage): stage is MatchStage & { type: 'KNOCKOUT'; knockout: KnockoutStage } => {
  return stage.type === 'KNOCKOUT' && Boolean(stage.knockout);
};
