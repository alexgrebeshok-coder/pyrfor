/**
 * Microsoft 365 Calendar adapter — uses Microsoft Graph API
 * Requires: OAuth credential via ConnectorCredential (microsoft provider)
 */

import { getValidAccessToken } from "@/lib/connectors/oauth/oauth-service";
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEvent,
  NewCalendarEvent,
} from "../calendar-provider";

const BASE = "https://graph.microsoft.com/v1.0";

export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly id = "microsoft";
  readonly name = "Microsoft 365 Calendar";

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
    const res = await this.fetchApi(credentialId, "/me/calendars");
    if (!res.ok) throw new Error(`MS Calendar list failed: ${res.status}`);

    const data = await res.json();
    return (data.value ?? []).map(
      (c: {
        id: string;
        name: string;
        isDefaultCalendar?: boolean;
        color?: string;
        canEdit?: boolean;
      }) => ({
        id: c.id,
        name: c.name,
        primary: c.isDefaultCalendar ?? false,
        color: c.color,
        accessRole: c.canEdit ? ("writer" as const) : ("reader" as const),
      })
    );
  }

  async listEvents(
    credentialId: string,
    _calendarId: string,
    timeMin: Date,
    timeMax: Date
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      startDateTime: timeMin.toISOString(),
      endDateTime: timeMax.toISOString(),
      $top: "200",
      $orderby: "start/dateTime",
    });

    const res = await this.fetchApi(
      credentialId,
      `/me/calendarView?${params}`
    );
    if (!res.ok) throw new Error(`MS events fetch failed: ${res.status}`);

    const data = await res.json();
    return (data.value ?? []).map(
      (e: {
        id: string;
        subject?: string;
        body?: { content?: string };
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        isAllDay?: boolean;
        location?: { displayName?: string };
        attendees?: Array<{
          emailAddress?: { address?: string };
        }>;
        showAs?: string;
        webLink?: string;
      }) => ({
        id: `ms-${e.id}`,
        externalId: e.id,
        title: e.subject || "(No title)",
        description: e.body?.content?.slice(0, 500),
        start: new Date(e.start?.dateTime || ""),
        end: new Date(e.end?.dateTime || ""),
        allDay: e.isAllDay ?? false,
        location: e.location?.displayName,
        attendees: e.attendees?.map(
          (a) => a.emailAddress?.address || ""
        ),
        status:
          e.showAs === "tentative"
            ? ("tentative" as const)
            : ("confirmed" as const),
        source: "microsoft",
        color: "#0078d4",
        url: e.webLink,
      })
    );
  }

  async createEvent(
    credentialId: string,
    _calendarId: string,
    event: NewCalendarEvent
  ): Promise<CalendarEvent> {
    const body = {
      subject: event.title,
      body: event.description
        ? { contentType: "Text", content: event.description }
        : undefined,
      start: {
        dateTime: event.start.toISOString(),
        timeZone: "UTC",
      },
      end: {
        dateTime: event.end.toISOString(),
        timeZone: "UTC",
      },
      isAllDay: event.allDay ?? false,
      location: event.location
        ? { displayName: event.location }
        : undefined,
      attendees: event.attendees?.map((email) => ({
        emailAddress: { address: email },
        type: "required",
      })),
    };

    const res = await this.fetchApi(credentialId, "/me/events", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`MS create event failed: ${res.status}`);

    const created = await res.json();
    return {
      id: `ms-${created.id}`,
      externalId: created.id,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay ?? false,
      source: "microsoft",
      color: "#0078d4",
    };
  }

  async updateEvent(
    credentialId: string,
    _calendarId: string,
    eventId: string,
    updates: Partial<NewCalendarEvent>
  ): Promise<CalendarEvent> {
    const externalId = eventId.replace("ms-", "");
    const body: Record<string, unknown> = {};
    if (updates.title) body.subject = updates.title;
    if (updates.description)
      body.body = { contentType: "Text", content: updates.description };
    if (updates.start)
      body.start = {
        dateTime: updates.start.toISOString(),
        timeZone: "UTC",
      };
    if (updates.end)
      body.end = {
        dateTime: updates.end.toISOString(),
        timeZone: "UTC",
      };

    const res = await this.fetchApi(
      credentialId,
      `/me/events/${externalId}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    if (!res.ok)
      throw new Error(`MS update event failed: ${res.status}`);

    const updated = await res.json();
    return {
      id: eventId,
      externalId,
      title: updated.subject || "",
      start: new Date(updated.start?.dateTime),
      end: new Date(updated.end?.dateTime),
      allDay: updated.isAllDay ?? false,
      source: "microsoft",
      color: "#0078d4",
    };
  }

  async deleteEvent(
    credentialId: string,
    _calendarId: string,
    eventId: string
  ): Promise<void> {
    const externalId = eventId.replace("ms-", "");
    const res = await this.fetchApi(
      credentialId,
      `/me/events/${externalId}`,
      { method: "DELETE" }
    );
    if (!res.ok && res.status !== 404)
      throw new Error(`MS delete event failed: ${res.status}`);
  }
}
