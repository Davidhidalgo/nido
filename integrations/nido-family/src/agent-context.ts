import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  calendarReference,
  calendarWritable,
  type CalendarAlias,
  type CalendarEvent,
  type CalendarPort,
  type FamilyConfig,
} from "./core.js";
import { note4Home, type HomeSnapshot } from "./note4-home.js";

/** Full records for commands, separate from the clipped six-event device projection. */
export class AgentContext {
  private refreshFailed = false;
  private snapshot?: {
    updatedAt: string;
    from: string;
    to: string;
    timeZone: string;
    mode: string;
    events: (CalendarEvent & {
      calendar: CalendarAlias;
      sourceCalendarId: string;
      readOnly: boolean;
    })[];
  };
  private pending?: Promise<HomeSnapshot>;
  constructor(
    private calendar: CalendarPort,
    private config: FamilyConfig,
    private path: string,
  ) {}
  async refresh(anchor?: string): Promise<HomeSnapshot> {
    // Serialize refreshes; a different requested date must still get its own window.
    if (this.pending) {
      await this.pending;
      return this.refresh(anchor);
    }
    const task = this.fetch(anchor);
    this.pending = task;
    try {
      const home = await task;
      this.refreshFailed = false;
      return home;
    } catch (error) {
      this.refreshFailed = true;
      throw error;
    } finally {
      this.pending = undefined;
    }
  }
  private async fetch(anchor?: string) {
    const records: (CalendarEvent & {
      calendar: CalendarAlias;
      sourceCalendarId: string;
      readOnly: boolean;
    })[] = [];
    let from = "",
      to = "";
    const adapter: CalendarPort = {
      list: async (id, start, end) => {
        from = start;
        to = end;
        const events = await this.calendar.list(id, start, end);
        records.push(
          ...events.map((event) => ({
            ...event,
            sourceCalendarId: id,
            readOnly: !calendarWritable(this.config, id),
            calendar: calendarReference(this.config, id),
          })),
        );
        return events;
      },
      get: (...args) => this.calendar.get(...args),
      create: (...args) => this.calendar.create(...args),
      update: (...args) => this.calendar.update(...args),
      delete: (...args) => this.calendar.delete(...args),
    };
    const home = await note4Home(adapter, this.config, anchor);
    const snapshot = {
      updatedAt: new Date().toISOString(),
      from,
      to,
      timeZone: this.config.timeZone,
      mode: this.config.mode,
      events: records
        .filter((event) => event.status !== "cancelled")
        .map((event) => ({
          calendar: event.calendar,
          sourceCalendarId: event.sourceCalendarId,
          readOnly: event.readOnly,
          id: event.id,
          etag: event.etag,
          summary: event.summary,
          start: event.start,
          end: event.end,
          description: event.description,
          location: event.location,
          status: event.status,
          attendees: event.attendees,
          attendeesOmitted: event.attendeesOmitted,
          recurrence: event.recurrence,
          recurringEventId: event.recurringEventId,
          eventType: event.eventType,
          extendedProperties: event.extendedProperties,
        })),
    };
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporary, this.path);
    this.snapshot = snapshot;
    return home;
  }
  async context() {
    let refreshFailed = this.refreshFailed;
    if (!this.snapshot || Date.now() - Date.parse(this.snapshot.updatedAt) >= 300000) {
      try {
        await this.refresh();
      } catch {
        refreshFailed = true;
      }
    }
    return { available: !!this.snapshot, stale: refreshFailed, ...this.snapshot };
  }
}
