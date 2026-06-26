import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAppDependencies } from '../app/providers/AppDependenciesProvider.tsx';
import { hashVocalOtp } from '../shared/auth/vocal-otp.ts';
import { saveVocalAccessSession } from '../shared/auth/vocal-access-session.ts';

export const VocalAccessPage = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { matchRepository, teamRepository } = useAppDependencies();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [matchTitle, setMatchTitle] = useState('Partido');
  const [assignedEmail, setAssignedEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [expectedHash, setExpectedHash] = useState('');

  useEffect(() => {
    if (!matchId) {
      setError('No se indicó un partido válido.');
      setIsLoading(false);
      return;
    }

    let active = true;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const match = await matchRepository.findById(matchId, undefined, { forceServer: true });
        if (!active) {
          return;
        }

        if (!match) {
          setError('No se encontró el partido asociado a este acceso.');
          return;
        }

        const [homeTeam, awayTeam] = await Promise.all([
          teamRepository.findById({ teamId: match.homeTeamId, tournamentId: match.tournamentId }),
          teamRepository.findById({ teamId: match.awayTeamId, tournamentId: match.tournamentId }),
        ]);

        if (!active) {
          return;
        }

        const vocalAccess = match.vocalAccess;
        if (!vocalAccess) {
          setError('Este partido no tiene un acceso de vocalía asignado.');
          return;
        }

        const accessExpiresAt = new Date(vocalAccess.expiresAt);
        if (accessExpiresAt.getTime() <= Date.now()) {
          setError('Este código ya expiró. Solicita un nuevo acceso al administrador.');
          return;
        }

        setMatchTitle(`${homeTeam?.name ?? match.homeTeamId} vs ${awayTeam?.name ?? match.awayTeamId}`);
        setAssignedEmail(vocalAccess.assignedEmail);
        setExpiresAt(accessExpiresAt);
        setExpectedHash(vocalAccess.otpHash);
      } catch (loadError) {
        console.error('[VocalAccessPage] Failed to load vocal access', loadError);
        setError('No se pudo validar el acceso. Inténtalo nuevamente.');
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [matchId, matchRepository, teamRepository]);

  const maskedEmail = useMemo(() => {
    if (!assignedEmail.includes('@')) {
      return assignedEmail;
    }

    const [local, domain] = assignedEmail.split('@');
    if (local.length <= 2) {
      return `${local[0] ?? '*'}***@${domain}`;
    }

    return `${local.slice(0, 2)}***@${domain}`;
  }, [assignedEmail]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!matchId || isSubmitting) {
      return;
    }

    const normalized = otpCode.replace(/\D/g, '').slice(0, 6);
    if (normalized.length !== 6) {
      setError('Ingresa un código OTP de 6 dígitos.');
      return;
    }

    try {
      setError(null);
      setIsSubmitting(true);
      const inputHash = await hashVocalOtp(matchId, normalized);

      if (inputHash !== expectedHash) {
        setError('Código inválido. Verifica el código enviado al correo asignado.');
        return;
      }

      const effectiveExpiresAt = expiresAt ? expiresAt.toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      saveVocalAccessSession({
        matchId,
        assignedEmail,
        verifiedAt: new Date().toISOString(),
        expiresAt: effectiveExpiresAt,
      });

      navigate(`/vocal/match/${matchId}`, { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-200">
        <div className="text-sm">Validando acceso de vocalía...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4 py-12 text-slate-100">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-sm">
        <h1 className="text-2xl font-bold">Acceso Vocalía por Código</h1>
        <p className="mt-2 text-sm text-slate-300">{matchTitle}</p>

        {assignedEmail && (
          <p className="mt-2 text-xs text-slate-400">
            Código enviado a: <span className="font-semibold text-slate-200">{maskedEmail}</span>
          </p>
        )}

        {expiresAt && (
          <p className="mt-1 text-xs text-amber-300">
            Válido hasta: {expiresAt.toLocaleString('es-ES')}
          </p>
        )}

        {error && <div className="mt-4 rounded-md border border-red-800 bg-red-900/40 p-3 text-sm text-red-200">{error}</div>}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200" htmlFor="vocal-otp">Código OTP (6 dígitos)</label>
            <input
              id="vocal-otp"
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-center text-2xl tracking-[0.4em] text-slate-100 outline-none transition focus:border-cyan-400"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-cyan-800 disabled:text-slate-400"
          >
            {isSubmitting ? 'Validando...' : 'Ingresar a Vocalía'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm">
          <Link to="/" className="text-cyan-300 hover:text-cyan-200">Volver al inicio</Link>
        </div>
      </div>
    </div>
  );
};
