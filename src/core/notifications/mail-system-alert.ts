export const MAIL_SYSTEM_ALERT_EVENT = 'mail-system-alert';

export type MailSystemAlertLevel = 'info' | 'warning' | 'error';

export interface MailSystemAlertDetail {
  message: string;
  level?: MailSystemAlertLevel;
}

export const MAIL_SYSTEM_ROTATION_WARNING = 'Aviso de Sistema: Rotando servidor de correo (Cupo agotado en cuenta actual)';

export const dispatchMailSystemAlert = (detail: MailSystemAlertDetail): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent<MailSystemAlertDetail>(MAIL_SYSTEM_ALERT_EVENT, { detail }));
};
