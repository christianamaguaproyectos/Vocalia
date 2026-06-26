import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { getVocalAccessSession } from '../auth/vocal-access-session.ts';

interface Props {
  children: ReactNode;
}

export const RequireVocalAccessRoute = ({ children }: Props) => {
  const { matchId } = useParams<{ matchId: string }>();

  if (!matchId) {
    return <Navigate to="/" replace />;
  }

  const session = getVocalAccessSession(matchId);
  if (!session) {
    return <Navigate to={`/vocal-access/${matchId}`} replace />;
  }

  return <>{children}</>;
};
