import { useEffect, useRef, useState } from 'react';

import {
  MAIL_SYSTEM_ALERT_EVENT,
  type MailSystemAlertDetail,
} from '../../../core/notifications/mail-system-alert.ts';

interface AlertItem {
  id: number;
  message: string;
  level: 'info' | 'warning' | 'error';
}

const AUTO_DISMISS_MS = 8000;

const getAlertClasses = (level: AlertItem['level']) => {
  if (level === 'error') {
    return 'border-red-300 bg-red-50 text-red-900';
  }

  if (level === 'info') {
    return 'border-blue-300 bg-blue-50 text-blue-900';
  }

  return 'border-amber-300 bg-amber-50 text-amber-900';
};

export const MailSystemAlertToast = () => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const handleAlert = (event: Event) => {
      const customEvent = event as CustomEvent<MailSystemAlertDetail>;
      const message = customEvent.detail?.message?.trim();

      if (!message) {
        return;
      }

      idRef.current += 1;
      const id = idRef.current;
      const level = customEvent.detail?.level ?? 'warning';

      setAlerts((previous) => [...previous, { id, message, level }].slice(-3));

      window.setTimeout(() => {
        setAlerts((previous) => previous.filter((item) => item.id !== id));
      }, AUTO_DISMISS_MS);
    };

    window.addEventListener(MAIL_SYSTEM_ALERT_EVENT, handleAlert as EventListener);
    return () => {
      window.removeEventListener(MAIL_SYSTEM_ALERT_EVENT, handleAlert as EventListener);
    };
  }, []);

  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[120] space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`w-[min(90vw,420px)] rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${getAlertClasses(alert.level)}`}
        >
          {alert.message}
        </div>
      ))}
    </div>
  );
};
