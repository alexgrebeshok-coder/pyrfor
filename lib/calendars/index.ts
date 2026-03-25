/**
 * Calendar provider factory
 */

import type { CalendarProvider } from "./calendar-provider";
import { InternalCalendarProvider } from "./adapters/internal";
import { GoogleCalendarProvider } from "./adapters/google-calendar";
import { MicrosoftCalendarProvider } from "./adapters/microsoft-calendar";

const providers: Record<string, CalendarProvider> = {
  internal: new InternalCalendarProvider(),
  google: new GoogleCalendarProvider(),
  microsoft: new MicrosoftCalendarProvider(),
};

export function getCalendarProvider(
  providerId: string
): CalendarProvider {
  const provider = providers[providerId];
  if (!provider)
    throw new Error(`Unknown calendar provider: ${providerId}`);
  return provider;
}

export function listCalendarProviders(): Array<{
  id: string;
  name: string;
}> {
  return Object.values(providers).map((p) => ({
    id: p.id,
    name: p.name,
  }));
}

export type {
  CalendarProvider,
  CalendarInfo,
  CalendarEvent,
  NewCalendarEvent,
} from "./calendar-provider";
