export type UnsubscribeFn = () => void;

export interface RealtimeListener<T> {
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
}
