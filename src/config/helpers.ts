import type { ServiceId } from "./types.services.js";

/** Get the list of enabled service IDs from config */
export function getEnabledServiceIds(config: { services?: Record<string, { enabled?: boolean }> }): ServiceId[] {
  const services = config.services ?? {};
  return Object.entries(services)
    .filter(([, svc]) => svc?.enabled)
    .map(([id]) => id as ServiceId);
}
