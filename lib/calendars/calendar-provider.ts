/**
 * Calendar provider abstraction — unified interface for calendar sync
 * Supports: Internal (DB), Google Calendar, Microsoft 365, Yandex Calendar
 */

export interface CalendarInfo {
  id: string;
  name: string;
  description?: string;
  primary: boolean;
  color?: string;
  accessRole: "owner" | "writer" | "reader";
}

export interface CalendarEvent {
  id: string;
  externalId?: string;
  title: string;
  description?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  attendees?: string[];
  status?: "confirmed" | "tentative" | "cancelled";
  source: string; // "internal" | "google" | "microsoft" | "yandex"
  sourceCalendarId?: string;
  color?: string;
  url?: string;
}

export interface NewCalendarEvent {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  location?: string;
  attendees?: string[];
}

export interface SyncDeltaResult {
  created: CalendarEvent[];
  updated: CalendarEvent[];
  deleted: string[]; // event IDs
  nextSyncToken?: string;
}

export interface CalendarProvider {
  readonly id: string;
  readonly name: string;

  listCalendars(credentialId: string): Promise<CalendarInfo[]>;

  listEvents(
    credentialId: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date
  ): Promise<CalendarEvent[]>;

  createEvent(
    credentialId: string,
    calendarId: string,
    event: NewCalendarEvent
  ): Promise<CalendarEvent>;

  updateEvent(
    credentialId: string,
    calendarId: string,
    eventId: string,
    updates: Partial<NewCalendarEvent>
  ): Promise<CalendarEvent>;

  deleteEvent(
    credentialId: string,
    calendarId: string,
    eventId: string
  ): Promise<void>;

  syncDelta?(
    credentialId: string,
    calendarId: string,
    syncToken?: string
  ): Promise<SyncDeltaResult>;
}
