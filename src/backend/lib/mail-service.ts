import emailjs from '@emailjs/browser';

import {
  dispatchMailSystemAlert,
  MAIL_SYSTEM_ROTATION_WARNING,
} from '../../core/notifications/mail-system-alert.ts';

export interface MailPayload {
  to: string;
  subject: string;
  htmlBody: string;
}

interface EmailJsConfig {
  label: string;
  index: number;
  serviceId: string;
  templateId: string;
  publicKey: string;
}

const ACTIVE_EMAILJS_ACCOUNT_KEY = 'mail-service:active-emailjs-account-index';
const DAILY_LIMIT_REGEX = /daily\s+limit\s+reached/i;

const normalizeEnv = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const getEmailJsPool = (): EmailJsConfig[] => {
  const rawPool = [
    {
      label: 'Cuenta 1',
      serviceId: normalizeEnv(import.meta.env.VITE_EMAILJS_S1),
      templateId: normalizeEnv(import.meta.env.VITE_EMAILJS_T1),
      publicKey: normalizeEnv(import.meta.env.VITE_EMAILJS_P1),
    },
    {
      label: 'Cuenta 2',
      serviceId: normalizeEnv(import.meta.env.VITE_EMAILJS_S2),
      templateId: normalizeEnv(import.meta.env.VITE_EMAILJS_T2),
      publicKey: normalizeEnv(import.meta.env.VITE_EMAILJS_P2),
    },
    {
      label: 'Cuenta 3',
      serviceId: normalizeEnv(import.meta.env.VITE_EMAILJS_S3),
      templateId: normalizeEnv(import.meta.env.VITE_EMAILJS_T3),
      publicKey: normalizeEnv(import.meta.env.VITE_EMAILJS_P3),
    },
  ];

  return rawPool
    .map((entry, index) => ({
      ...entry,
      index,
    }))
    .filter((entry) => entry.serviceId && entry.templateId && entry.publicKey);
};

const getStoredActiveIndex = (max: number): number => {
  if (typeof window === 'undefined') {
    return 0;
  }

  const raw = window.localStorage.getItem(ACTIVE_EMAILJS_ACCOUNT_KEY);
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= max) {
    return 0;
  }

  return parsed;
};

const setStoredActiveIndex = (index: number): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ACTIVE_EMAILJS_ACCOUNT_KEY, String(index));
};

const getFailoverOrder = (start: number, size: number): number[] => {
  return Array.from({ length: size }, (_, offset) => (start + offset) % size);
};

const isQuotaError = (error: unknown): boolean => {
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : null;
  const text = typeof (error as { text?: unknown })?.text === 'string'
    ? (error as { text: string }).text
    : '';
  const message = error instanceof Error ? error.message : String(error ?? '');

  return status === 403 || DAILY_LIMIT_REGEX.test(text) || DAILY_LIMIT_REGEX.test(message);
};

const sendWithPool = async (templateParams: Record<string, unknown>): Promise<void> => {
  const pool = getEmailJsPool();
  if (pool.length === 0) {
    console.warn('[mail-service] Missing EmailJS pool env vars (VITE_EMAILJS_S1/T1/P1 ... S3/T3/P3). Email send skipped.');
    throw new Error('EmailJS pool env vars are not configured.');
  }

  const startIndex = getStoredActiveIndex(pool.length);
  const attemptOrder = getFailoverOrder(startIndex, pool.length);
  let lastError: unknown;

  for (let attempt = 0; attempt < attemptOrder.length; attempt += 1) {
    const accountIndex = attemptOrder[attempt];
    const account = pool[accountIndex];

    try {
      console.info(`[mail-service] Attempting send with ${account.label}`);
      await emailjs.send(account.serviceId, account.templateId, templateParams, account.publicKey);

      setStoredActiveIndex(accountIndex);
      return;
    } catch (error) {
      lastError = error;
      const hasQuotaError = isQuotaError(error);
      const hasNextAccount = attempt < attemptOrder.length - 1;

      if (!hasQuotaError || !hasNextAccount) {
        break;
      }

      const nextIndex = attemptOrder[attempt + 1];
      const nextAccount = pool[nextIndex];

      console.warn(
        `[mail-service] Quota reached in ${account.label}. Rotating to ${nextAccount.label}.`,
      );
      setStoredActiveIndex(nextIndex);
      dispatchMailSystemAlert({
        message: MAIL_SYSTEM_ROTATION_WARNING,
        level: 'warning',
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Unknown EmailJS error'));
};

export const sendMail = async ({ to, subject, htmlBody }: MailPayload): Promise<void> => {
  const emailDestino = to.trim();
  if (!emailDestino) {
    throw new Error('Recipient email is empty.');
  }

  await sendWithPool({
    to: emailDestino,
    subject,
    htmlBody,
  });
};

export interface SendMailWithAttachmentResult {
  sent: boolean;
  error?: string;
}

/**
 * Envía un correo con un PDF adjunto (base64) a varios destinatarios.
 * IMPORTANTE: la plantilla de EmailJS debe tener configurado un
 * "Variable Attachment" cuyo Content sea {{content}} y Filename {{filename}}.
 */
export const sendMailWithAttachment = async (
  recipients: string[],
  subject: string,
  htmlBody: string,
  attachmentBase64: string,
  fileName: string,
): Promise<SendMailWithAttachmentResult> => {
  const cleanRecipients = recipients.map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (cleanRecipients.length === 0) {
    return { sent: false, error: 'No hay destinatarios.' };
  }

  const results = await Promise.allSettled(
    cleanRecipients.map((to) =>
      sendWithPool({
        to,
        subject,
        htmlBody,
        content: attachmentBase64,
        filename: fileName,
      }),
    ),
  );

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length === 0) {
    return { sent: true };
  }

  const reason = failures[0].reason;
  const text = typeof (reason as { text?: unknown })?.text === 'string'
    ? (reason as { text: string }).text
    : reason instanceof Error
      ? reason.message
      : String(reason);

  return {
    sent: failures.length < results.length,
    error: `Falló el envío a ${failures.length} de ${results.length} destinatario(s): ${text}`,
  };
};

export const sendMailAsync = (payload: MailPayload): void => {
  void sendMail(payload)
    .then(() => {
      console.info(
        `[mail-service] Email sent successfully | to=${payload.to} | subject=${payload.subject}`,
      );
    })
    .catch((error) => {
      const status = typeof error?.status === 'number' ? String(error.status) : 'n/a';
      const text = typeof error?.text === 'string' && error.text.length > 0 ? error.text : 'n/a';
      const message = error instanceof Error ? error.message : String(error);

      console.error(
        `[mail-service] Email send failed | to=${payload.to} | subject=${payload.subject} | status=${status} | text=${text} | message=${message}`,
      );
    });
};
