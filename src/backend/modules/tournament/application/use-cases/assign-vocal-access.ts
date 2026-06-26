import type { MatchRepository, TeamRepository } from '../../domain/repositories/index.ts';
import type { MatchId, TournamentId } from '../../domain/value-objects/identifiers.ts';
import { sendMail } from '../../../../lib/mail-service.ts';
import { generateSixDigitOtp, hashVocalOtp } from '../../../../../frontend/shared/auth/vocal-otp.ts';

const DEFAULT_ACCESS_HOURS = 24;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AssignVocalAccessDeps {
  matchRepository: MatchRepository;
  teamRepository: TeamRepository;
}

export interface AssignVocalAccessInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  vocalEmail: string;
  assignedBy: string;
  accessBaseUrl: string;
  accessHours?: number;
}

export interface AssignVocalAccessResult {
  otp: string;
  expiresAt: Date;
  assignedEmail: string;
  accessLink: string;
  emailSent: boolean;
  emailError?: string;
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const formatDateEs = (date: Date) => {
  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const assignVocalAccessUseCase = ({ matchRepository, teamRepository }: AssignVocalAccessDeps) => async (
  input: AssignVocalAccessInput,
): Promise<AssignVocalAccessResult> => {
  const match = await matchRepository.findById(input.matchId, input.tournamentId);
  if (!match) {
    throw new Error('No se encontró el partido para asignar vocalía.');
  }

  const assignedEmail = normalizeEmail(input.vocalEmail);
  if (!EMAIL_REGEX.test(assignedEmail)) {
    throw new Error('El correo del vocal no es válido.');
  }

  const [homeTeam, awayTeam] = await Promise.all([
    teamRepository.findById({ teamId: match.homeTeamId, tournamentId: match.tournamentId }),
    teamRepository.findById({ teamId: match.awayTeamId, tournamentId: match.tournamentId }),
  ]);

  const homeTeamName = homeTeam?.name ?? match.homeTeamId;
  const awayTeamName = awayTeam?.name ?? match.awayTeamId;

  const safeHours = Math.max(1, Math.floor(input.accessHours ?? DEFAULT_ACCESS_HOURS));
  const assignedAt = new Date();
  const standardExpiryMs = assignedAt.getTime() + safeHours * 60 * 60 * 1000;
  
  // Calculate 24 hours after the scheduled match time
  const matchTime = new Date(match.scheduledAt).getTime();
  const bufferMs = 24 * 60 * 60 * 1000; // 24 hours buffer
  const matchExpiryMs = matchTime + bufferMs;

  const expiresAt = new Date(Math.max(standardExpiryMs, matchExpiryMs));
  const otp = generateSixDigitOtp();
  const otpHash = await hashVocalOtp(match.id, otp);
  const accessLink = `${input.accessBaseUrl.replace(/\/$/, '')}/vocal-access/${match.id}`;

  await matchRepository.update(match.id, {
    tournamentId: match.tournamentId,
    vocalAccess: {
      assignedEmail,
      otpHash,
      assignedBy: input.assignedBy,
      assignedAt,
      expiresAt,
      lastOtpSentAt: assignedAt,
    },
  });

  const subject = `Código de acceso Vocalía - ${homeTeamName} vs ${awayTeamName}`;
  let emailSent = false;
  let emailError: string | undefined;

  try {
    await sendMail({
      to: assignedEmail,
      subject,
      htmlBody: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">Asignación de Vocalía</h2>
        <p>Hola,</p>
        <p>Has sido asignado como <strong>vocal</strong> para el siguiente partido de la Copa Mazorca de Oro:</p>

        <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 4px 0; font-weight: bold; width: 30%;">Partido:</td>
              <td style="padding: 4px 0;">${homeTeamName} vs ${awayTeamName}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Fecha y Hora:</td>
              <td style="padding: 4px 0; text-transform: capitalize;">${formatDateEs(match.scheduledAt)}</td>
            </tr>
            ${match.venue ? `
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Sede/Cancha:</td>
              <td style="padding: 4px 0;">${match.venue}</td>
            </tr>
            ` : ''}
          </table>
        </div>

        <p>Para registrar las alineaciones, eventos del partido (goles, cambios, tarjetas) e informe final, utiliza el siguiente código de acceso único:</p>

        <div style="text-align: center; margin: 25px 0;">
          <div style="display: inline-block; background-color: #e0e7ff; color: #4338ca; font-size: 28px; font-weight: bold; letter-spacing: 4px; padding: 10px 24px; border-radius: 8px; border: 1px dashed #6366f1;">
            ${otp}
          </div>
        </div>

        <p style="text-align: center; margin: 20px 0;">
          <a href="${accessLink}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 24px; font-weight: bold; border-radius: 6px;">
            Ingresar a la Vocalía
          </a>
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #64748b;">
          <strong>Nota de seguridad:</strong> Este código OTP y enlace de acceso son válidos únicamente para este partido y expiran automáticamente el <strong>${formatDateEs(expiresAt)}</strong> (tiempo suficiente posterior al horario de juego para subir el informe).
        </p>
      </div>
    `,
    });
    emailSent = true;
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number'
      ? ` (status ${(error as { status: number }).status})`
      : '';
    const text = typeof (error as { text?: unknown })?.text === 'string'
      ? (error as { text: string }).text
      : (error instanceof Error ? error.message : String(error));
    emailError = `${text}${status}`;
    console.error('[assign-vocal-access] Email send failed:', error);
  }

  return {
    otp,
    expiresAt,
    assignedEmail,
    accessLink,
    emailSent,
    emailError,
  };
};
