export type PeriodType = 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';

export interface EventTime {
  minute: number; // minuto entero del evento
  additional?: number; // tiempo agregado en minutos
  period: PeriodType;
}

export const createEventTime = (minute: number, period: PeriodType = 'REGULAR', additional?: number): EventTime => ({
  minute,
  additional,
  period,
});
