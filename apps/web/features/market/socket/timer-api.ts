import type { TimerApi } from './types';

export const defaultTimers: TimerApi = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms) as unknown as number,
  clearInterval: (handle) => globalThis.clearInterval(handle),
};
