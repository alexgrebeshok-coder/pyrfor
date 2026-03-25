/**
 * Google Calendar adapter — uses Google Calendar API v3
 * Requires: OAuth credential via ConnectorCredential
 */

import { getValidAccessToken } from "@/lib/connectors/oauth/oauth-service";
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEvent,
  NewCalendarEvent,
} from "../calendar-provider";

const BASE = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = "google";
  readonly name = "Google Calendar";

  private async fetchApi(
    credentialId: string,
    path: string,
    init?: RequestInit
  ): Promise<Response> {
    const token = await getValidAccessToken(credentialId);
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  async listCalendars(credentialId: string): Promise<CalendarInfo[]> {
    const res = await this.fetchApi(
      credentialId,
      "/users/me/calendarList"
    );
    if (!res.ok) throw new Error(`Google Calendar list failed: ${res.status}`);

    const data = await res.json();
    return (data.items ?? []).map(
      (c: {
        id: string;
        summary: string;
        description?: string;
        primary?: boolean;
        backgroundColor?: string;
        accessRole?: string;
      }) => ({
        id: c.id,
        name: c.summary,
        description: c.description,
        primary: c.primary ?? false,
        color: c.backgroundColor,
        accessRole: (c.accessRole === "owner"
          ? "owner"
          : c.accessRole === "writer"
            ? "writer"
            : "reader") as "owner" | "writer" | "reader",
      })
    );
  }

  async listEvents(
    credentialId: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "200",
    });

    const res = await this.fetchApi(
      credentialId,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    );
    if (!res.ok) throw new Error(`Google events fetch failed: ${res.status}`);

    const data = await res.json();
    return (data.items ?? []).map(
      (e: {
        id: string;
        summary?: string;
        description?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        location?: string;
        attendees?: Array<{ email: string }>;
        status?: string;
        htmlLink?: string;
      }) => ({
        id: `google-${e.id}`,
        externalId: e.id,
        title: e.summary || "(No title)",
        description: e.description,
        start: new Date(e.start?.dateTime || e.start?.date || ""),
        end: new Date(e.end?.dateTime || e.end?.date || ""),
        allDay: !e.start?.dateTime,
        location: e.location,
        attendees: e.attendees?.map((a) => a.email),
        status:
          e.status === "confirmed"
            ? "confirmed"
            : e.status === "tentative"
              ? "tentative"
              : "cancelled",
        source: "google",
        sourceCalendarId: calendarId,
        color: "#4285f4",
        url: e.htmlLink,
      })
    );
  }

  async createEvent(
    credentialId: string,
    calendarId: string,
    event: NewCalendarEvent
  ): Promise<CalendarEvent> {
    const body = {
      summary: event.title,
      description: event.description,
      start: event.allDay
        ? { date: event.start.toISOString().split("T")[0] }
        : { dateTime: event.start.toISOString() },
      end: event.allDay
        ? { date: event.end.toISOString().split("T")[0] }
        : { dateTime: event.end.toISOString() },
      location: event.location,
      attendees: event.attendees?.map((email) => ({ email })),
    };

    const res = await this.fetchApi(
      credentialId,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: "POST", body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`Google create event failed: ${res.status}`);

    const created = await res.json();
    return {
      id: `google-${created.id}`,
      externalId: created.id,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay ?? false,
      source: "google",
      sourceCalendarId: calendarId,
      color: "#4285f4",
    };
  }

  async updateEvent(
    credentialId: string,
    calendarId: string,
    eventId: string,
    updates: Partial<NewCalendarEvent>
  ): Promise<CalendarEvent> {
    const externalId = eventId.replace("google-", "");
    const body: Record<string, unknown> = {};
    if (updates.title) body.summary = updates.title;
    if (updates.description) body.description = updates.description;
    if (updates.start)
      body.start = { dateTime: updates.start.toISOString() };
    if (updates.end)
      body.end = { dateTime: updates.end.toISOString() };
    if (updates.location) body.location = updates.location;

    const res = await this.fetchApi(
      credentialId,
      `/calendars/${encodeURIComponent(calendarId)}/events/${externalId}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`Google update event failed: ${res.status}`);

    const updated = await res.json();
    return {
      id: eventId,
      externalId,
      title: updated.summary || "",
      start: new Date(
        updated.start?.dateTime || updated.start?.date
      ),
      end: new Date(
        updated.end?.dateTime || updated.end?.date
      ),
      allDay: !updated.start?.dateTime,
      source: "google",
      sourceCalendarId: calendarId,
      color: "#4285f4",
    };
  }

  async deleteEvent(
    credentialId: string,
    calendarId: string,
    eventId: string
  ): Promise<void> {
    const externalId = eventId.replace("google-", "");
    const res = await this.fetchApi(
      credentialId,
      `/calendars/${encodeURIComponent(calendarId)}/events/${externalId}`,
      { method: "DELETE" }
    );
    if (!res.ok && res.status !== 410)
      throw new Error(`Google delete event failed: ${res.status}`);
  }
}
