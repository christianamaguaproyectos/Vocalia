import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Menu, X, WifiOff } from 'lucide-react';

import { useAuth } from '../../app/providers/AuthProvider.tsx';
import { useTournament } from '../../../backend/modules/tournament/presentation/hooks/index.ts';
import { APP_CONFIG } from '../../../core/config/app-config.ts';

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
const getOnlineSnapshot = () => navigator.onLine;

interface LayoutProps {
  children: ReactNode;
}

export const MainLayout = ({ children }: LayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, signOut } = useAuth();
  const { tournament } = useTournament(APP_CONFIG.defaultTournamentId);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot);
  const tournamentPrimaryColor = tournament?.config.tournamentPrimaryColor ?? '#4f46e5';
  const tournamentLogoUrl = tournament?.config.tournamentLogoUrl?.trim() || '/DANEC.jpg';
  const tournamentName = tournament?.name?.trim() || 'Mazorca de Oro';

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Update favicon dynamically based on tournament logo
  useEffect(() => {
    if (!tournamentLogoUrl) return;
    const updateIcon = (selector: string) => {
      let link = document.querySelector(selector) as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = selector.includes('apple') ? 'apple-touch-icon' : 'icon';
        document.head.appendChild(link);
      }
      link.href = tournamentLogoUrl;
    };
    updateIcon("link[rel~='icon']");
    updateIcon("link[rel='apple-touch-icon']");
  }, [tournamentLogoUrl]);

  const isActive = (path: string) => location.pathname === path;

  const navLinkClass = (path: string) =>
    `flex items-center px-3 py-3 rounded-md text-sm font-medium transition-colors ${isActive(path)
      ? 'text-white'
      : 'text-gray-700 active:bg-gray-200'
    }`;

  const navLinkStyle = (path: string) => (isActive(path) ? { backgroundColor: tournamentPrimaryColor } : undefined);

  const navLinks = (
    <>
      <Link to="/" className={navLinkClass('/')} style={navLinkStyle('/')}>Inicio</Link>
      <Link to="/teams" className={navLinkClass('/teams')} style={navLinkStyle('/teams')}>Equipos</Link>
      <Link to="/standings" className={navLinkClass('/standings')} style={navLinkStyle('/standings')}>Posiciones</Link>
      <Link to="/matches" className={navLinkClass('/matches')} style={navLinkStyle('/matches')}>Partidos</Link>
      <Link to="/stats" className={navLinkClass('/stats')} style={navLinkStyle('/stats')}>Estadísticas</Link>
      {(role === 'admin' || role === 'superadmin') && (
        <Link to="/admin" className={navLinkClass('/admin')} style={navLinkStyle('/admin')}>Admin</Link>
      )}
      {(role === 'vocalia' || role === 'superadmin') && (
        <Link to="/vocalia" className={navLinkClass('/vocalia')} style={navLinkStyle('/vocalia')}>Vocalía</Link>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-14 items-center justify-between">
            {/* Brand */}
            <Link to="/" className="flex items-center gap-2 flex-shrink-0">
              <img
                src={tournamentLogoUrl}
                alt={`Logo ${tournamentName}`}
                className="h-10 w-auto max-w-[160px] object-contain"
                loading="eager"
                onError={(event) => {
                  event.currentTarget.src = '/DANEC.jpg';
                }}
              />
              <span className="text-lg font-bold sm:text-xl" style={{ color: tournamentPrimaryColor }}>{tournamentName}</span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex md:items-center md:gap-1">
              {navLinks}
            </div>

            {/* Right side: user info + hamburger */}
            <div className="flex items-center gap-2">
              {user ? (
                <div className="hidden items-center gap-2 text-sm text-gray-600 sm:flex">
                  <div className="text-right">
                    <div className="text-xs font-semibold text-gray-900 truncate max-w-[120px]">
                      {user.displayName || user.email}
                    </div>
                    <div className="text-[10px] text-gray-500">Rol: {role ?? 'N/D'}</div>
                  </div>
                  <button
                    onClick={async () => {
                      if (isSigningOut) return;
                      setIsSigningOut(true);
                      try {
                        await signOut();
                        navigate('/login');
                      } finally {
                        setIsSigningOut(false);
                      }
                    }}
                    disabled={isSigningOut}
                    className="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    {isSigningOut ? 'Saliendo...' : 'Salir'}
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="hidden rounded-md border px-3 py-2 text-sm font-semibold active:bg-indigo-50 sm:inline-flex"
                  style={{ borderColor: tournamentPrimaryColor, color: tournamentPrimaryColor }}
                >
                  Ingresar
                </Link>
              )}

              {/* Hamburger button - mobile only */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="inline-flex items-center justify-center rounded-md p-2 text-gray-700 md:hidden"
                aria-label="Menú de navegación"
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div className="border-t border-gray-200 bg-white md:hidden">
            <div className="flex flex-col gap-1 px-4 py-3">
              {navLinks}

              {/* User section in mobile menu */}
              <div className="mt-2 border-t border-gray-200 pt-3">
                {user ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">
                        {user.displayName || user.email}
                      </div>
                      <div className="text-xs text-gray-500">Rol: {role ?? 'N/D'}</div>
                    </div>
                    <button
                      onClick={async () => {
                        if (isSigningOut) return;
                        setIsSigningOut(true);
                        try {
                          await signOut();
                          navigate('/login');
                        } finally {
                          setIsSigningOut(false);
                        }
                      }}
                      disabled={isSigningOut}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 active:bg-gray-100"
                    >
                      {isSigningOut ? 'Saliendo...' : 'Cerrar sesión'}
                    </button>
                  </div>
                ) : (
                  <Link
                    to="/login"
                    className="flex items-center justify-center rounded-md px-4 py-3 text-sm font-semibold text-white"
                    style={{ backgroundColor: tournamentPrimaryColor }}
                  >
                    Ingresar
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>

      {!isOnline && (
        <div className="bg-amber-500 text-white text-center text-xs font-medium py-1.5 px-4 flex items-center justify-center gap-1.5">
          <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Sin conexión — los cambios se sincronizarán al reconectar</span>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-4 sm:py-6 lg:px-8">{children}</main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-center text-xs text-gray-500 sm:py-6 sm:text-sm">
          © {new Date().getFullYear()} Departamento de Tecnología - Grupo Danec
        </div>
      </footer>
    </div>
  );
};
