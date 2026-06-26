export interface Score {
  home: number;
  away: number;
  penaltiesHome?: number;
  penaltiesAway?: number;
}

export const initialScore = (): Score => ({ home: 0, away: 0, penaltiesHome: 0, penaltiesAway: 0 });

export const applyGoalToScore = (score: Score, side: 'home' | 'away', period?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT'): Score => {
  if (period === 'PENALTY_SHOOTOUT') {
    if (side === 'home') {
      return { ...score, penaltiesHome: (score.penaltiesHome || 0) + 1 };
    }
    return { ...score, penaltiesAway: (score.penaltiesAway || 0) + 1 };
  }

  if (side === 'home') {
    return { ...score, home: score.home + 1 };
  }

  return { ...score, away: score.away + 1 };
};

export const revertGoalFromScore = (score: Score, side: 'home' | 'away', period?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT'): Score => {
  if (period === 'PENALTY_SHOOTOUT') {
    if (side === 'home') {
      return { ...score, penaltiesHome: Math.max(0, (score.penaltiesHome || 0) - 1) };
    }
    return { ...score, penaltiesAway: Math.max(0, (score.penaltiesAway || 0) - 1) };
  }

  if (side === 'home') {
    return { ...score, home: Math.max(0, score.home - 1) };
  }

  return { ...score, away: Math.max(0, score.away - 1) };
};
