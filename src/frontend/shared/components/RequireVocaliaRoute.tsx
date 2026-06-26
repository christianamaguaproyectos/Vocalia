import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../../app/providers/AuthProvider.tsx';

interface Props {
    children: ReactNode;
}

export const RequireVocaliaRoute = ({ children }: Props) => {
    const { user, role, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="text-gray-500">Verificando permisos...</div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (role !== 'vocalia' && role !== 'admin' && role !== 'superadmin') {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
};
