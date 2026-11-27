import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";
import { convertIcsCalendar, type IcsDuration, type IcsEvent, type IcsRecurrenceRule } from "ts-ics";
import {
  evaluateScopeAccess,
  InkadeError,
  type CalendarEventCacheRecord,
  type CalendarEventInstance,
  type CalendarSubId,
  type CalendarSubscription,
  type CreateCalendarSubscriptionInput,
  type ListCalendarEventsQuery,
  type UpdateCalendarSubscriptionInput,
} from "@inkade/core";
import type { SearchConfigRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import {
  assertSafeExternalUrl,
  defaultDnsResolver,
  type DnsResolver,
  type FetchFn,
} from "./clipper-service.ts";
import { getAllWorkspaceSpaces } from "./scope-guard.ts";

const MAX_ICS_BYTES = 5 * 1024 * 1024;
const ICS_FETCH_TIMEOUT_MS = 15_000;
const MAX_RRULE_INSTANCES_PER_EVENT = 500;

function normalizeCalendarFeedUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/^webcal:\/\//i, "https://");
}

function durationToMilliseconds(duration?: IcsDuration): number {
  if (!duration) return 60 * 60 * 1000;
  const totalSeconds =
    (duration.weeks ?? 0) * 7 * 86400 +
    (duration.days ?? 0) * 86400 +
    (duration.hours ?? 0) * 3600 +
    (duration.minutes ?? 0) * 60 +
    (duration.seconds ?? 0);
  return Math.max(totalSeconds * 1000, 15 * 60 * 1000);
}

function serializeIcsRrule(rule?: IcsRecurrenceRule): string | null {
  if (!rule?.frequency) return null;
  const parts: string[] = [`FREQ=${rule.frequency}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until?.date) {
    const iso = rule.until.date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    parts.push(`UNTIL=${iso}`);
  }
  if (rule.byDay && rule.byDay.length > 0) {
    parts.push(`BYDAY=${rule.byDay.map((d) => `${d.occurrence ?? ""}${d.day}`).join(",")}`);
  }
  if (rule.byMonth && rule.byMonth.length > 0) {
    parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  }
  if (rule.byMonthday && rule.byMonthday.length > 0) {
    parts.push(`BYMONTHDAY=${rule.byMonthday.join(",")}`);
  }
  if (rule.bySetPos && rule.bySetPos.length > 0) {
    parts.push(`BYSETPOS=${rule.bySetPos.join(",")}`);
  }
  if (rule.workweekStart) {
    parts.push(`WKST=${rule.workweekStart}`);
  }
  return parts.join(";");
}

function formatZonedCompactStamp(isoString: string, timeZone: string): string {
  const inst = Temporal.Instant.from(isoString);
  return inst
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString()
    .replace(/[-:]/g, "")
    .slice(0, 15);
}

function parseWindowBoundary(raw: string, isEnd: boolean): Temporal.Instant {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const plain = Temporal.PlainDate.from(trimmed);
    const shifted = isEnd ? plain.add({ days: 1 }) : plain;
    return shifted.toZonedDateTime("UTC").toInstant();
  }
  return Temporal.Instant.from(trimmed);
}

function sanitizeTimeZone(tz: string | null | undefined): string {
  const candidate = tz?.trim();
  if (!candidate) return "UTC";
  try {
    Temporal.Now.zonedDateTimeISO(candidate);
    return candidate;
  } catch {
    return "UTC";
  }
}

function parseIcsEventToCacheRecord(
  ev: IcsEvent,
): Omit<CalendarEventCacheRecord, "id" | "subscriptionId" | "workspaceId" | "updatedAt"> | null {
  if (!ev.uid || !ev.start?.date) return null;
  const allDay = ev.start.type === "DATE";
  const startIso = ev.start.date.toISOString();
  let endIso: string;
  if (ev.end?.date) {
    endIso = ev.end.date.toISOString();
  } else {
    const durMs = allDay
      ? 24 * 60 * 60 * 1000
      : durationToMilliseconds(ev.duration ?? undefined);
    endIso = new Date(ev.start.date.getTime() + durMs).toISOString();
  }

  const exdates = (ev.exceptionDates ?? [])
    .map((d) =>
      d.date
        ? allDay
          ? d.date.toISOString().slice(0, 10)
          : Temporal.Instant.from(d.date.toISOString()).toString()
        : null,
    )
    .filter((v): v is string => Boolean(v));

  return {
    uid: ev.uid,
    title: ev.summary?.trim() || "(Untitled Event)",
    description: ev.description?.trim() || null,
    location: ev.location?.trim() || null,
    startAt: startIso,
    endAt: endIso,
    allDay,
    timezone: ev.start.local?.timezone ?? null,
    rrule: serializeIcsRrule(ev.recurrenceRule),
    exdates,
  };
}

export interface CalendarServiceRepos {
  readonly searchConfigRepo: SearchConfigRepo;
  readonly spaceRepo: SpaceRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

export interface CalendarServiceOptions {
  readonly fetchFn?: FetchFn | undefined;
  readonly resolveDns?: DnsResolver | undefined;
}

export class CalendarService {
  private readonly fetchFn: FetchFn;
  private readonly resolveDns: DnsResolver;

  constructor(
    private readonly repos: CalendarServiceRepos,
    private readonly sseHub: SseHub,
    options?: CalendarServiceOptions,
  ) {
    this.fetchFn = options?.fetchFn ?? ((input, init) => fetch(input, init));
    this.resolveDns = options?.resolveDns ?? defaultDnsResolver;
  }

  private async assertSubscriptionPermission(
    principal: Principal,
    action: "read" | "write",
  ): Promise<void> {
    if (action === "read") return;
    if (principal.kind === "user") return;
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const hasWrite = allSpaces.some(
      (space) =>
        evaluateScopeAccess(
          principal.scope,
          "write",
          { spaceId: space.id, resourceType: "space" },
          allSpaces,
        ).allowed,
    );
    if (!hasWrite) {
      throw new InkadeError("FORBIDDEN", "Token lacks write permission to manage calendar subscriptions");
    }
  }

  async listSubscriptions(principal: Principal): Promise<readonly CalendarSubscription[]> {
    await this.assertSubscriptionPermission(principal, "read");
    return this.repos.searchConfigRepo.listCalendarSubscriptions(principal.workspaceId);
  }

  async createSubscription(
    principal: Principal,
    input: CreateCalendarSubscriptionInput,
  ): Promise<{ readonly subscription: CalendarSubscription; readonly syncedCount: number }> {
    await this.assertSubscriptionPermission(principal, "write");
    const fetchUrl = normalizeCalendarFeedUrl(input.url);
    await assertSafeExternalUrl(fetchUrl, this.resolveDns);

    const created = await this.repos.searchConfigRepo.createCalendarSubscription(
      principal.workspaceId,
      input,
    );

    const synced = await this.syncSubscriptionInternal(principal, created, {
      throwOnNetworkError: false,
    });
    return synced;
  }

  async updateSubscription(
    principal: Principal,
    subscriptionId: CalendarSubId,
    input: UpdateCalendarSubscriptionInput,
  ): Promise<CalendarSubscription> {
    await this.assertSubscriptionPermission(principal, "write");
    if (input.url !== undefined) {
      await assertSafeExternalUrl(normalizeCalendarFeedUrl(input.url), this.resolveDns);
    }
    const updated = await this.repos.searchConfigRepo.updateCalendarSubscription(
      principal.workspaceId,
      subscriptionId,
      input,
    );
    this.sseHub.publish({
      type: "calendar.subscription.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { action: "updated", subscriptionId: updated.id },
    });
    return updated;
  }

  async deleteSubscription(principal: Principal, subscriptionId: CalendarSubId): Promise<void> {
    await this.assertSubscriptionPermission(principal, "write");
    await this.repos.searchConfigRepo.deleteCalendarSubscription(
      principal.workspaceId,
      subscriptionId,
    );
    this.sseHub.publish({
      type: "calendar.subscription.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { action: "deleted", subscriptionId },
    });
  }

  async refreshSubscription(
    principal: Principal,
    subscriptionId: CalendarSubId,
  ): Promise<{ readonly subscription: CalendarSubscription; readonly syncedCount: number }> {
    await this.assertSubscriptionPermission(principal, "write");
    const existing = await this.repos.searchConfigRepo.getCalendarSubscriptionById(
      principal.workspaceId,
      subscriptionId,
    );
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Calendar subscription "${subscriptionId}" not found`);
    }
    return this.syncSubscriptionInternal(principal, existing, { throwOnNetworkError: false });
  }

  private async syncSubscriptionInternal(
    principal: Principal,
    sub: CalendarSubscription,
    options: { readonly throwOnNetworkError: boolean },
  ): Promise<{ readonly subscription: CalendarSubscription; readonly syncedCount: number }> {
    const normalizedUrl = normalizeCalendarFeedUrl(sub.url);
    const ts = new Date().toISOString();
    try {
      await assertSafeExternalUrl(normalizedUrl, this.resolveDns);
      const headers: Record<string, string> = {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8",
      };
      if (sub.etag) headers["If-None-Match"] = sub.etag;
      if (sub.lastModified) headers["If-Modified-Since"] = sub.lastModified;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ICS_FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await this.fetchFn(normalizedUrl, {
          method: "GET",
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status === 304) {
        const updated = await this.repos.searchConfigRepo.updateCalendarSubscription(
          principal.workspaceId,
          sub.id,
          { lastSyncedAt: ts, lastError: null },
        );
        const existingEvents = await this.repos.searchConfigRepo.listCalendarEventsCache(
          principal.workspaceId,
          { subscriptionId: sub.id, onlyEnabledSubscriptions: false },
        );
        return { subscription: updated, syncedCount: existingEvents.length };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const rawText = await response.text();
      if (Buffer.byteLength(rawText, "utf8") > MAX_ICS_BYTES) {
        throw new Error("ICS feed exceeds 5 MB limit");
      }

      const parsed = convertIcsCalendar(undefined, rawText);
      const eventRecords = (parsed.events ?? [])
        .map(parseIcsEventToCacheRecord)
        .filter((ev): ev is NonNullable<typeof ev> => ev !== null);

      await this.repos.searchConfigRepo.replaceCalendarEventsCache(
        principal.workspaceId,
        sub.id,
        eventRecords,
      );

      const updated = await this.repos.searchConfigRepo.updateCalendarSubscription(
        principal.workspaceId,
        sub.id,
        {
          etag: response.headers.get("etag") ?? null,
          lastModified: response.headers.get("last-modified") ?? null,
          lastSyncedAt: ts,
          lastError: null,
        },
      );

      this.sseHub.publish({
        type: "calendar.subscription.updated",
        workspaceId: principal.workspaceId,
        spaceId: null,
        actorType: principal.actorType,
        payload: { action: "synced", subscriptionId: updated.id },
      });

      return { subscription: updated, syncedCount: eventRecords.length };
    } catch (error) {
      if (options.throwOnNetworkError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.repos.searchConfigRepo.updateCalendarSubscription(
        principal.workspaceId,
        sub.id,
        { lastError: message.slice(0, 500) },
      );
      return { subscription: failed, syncedCount: 0 };
    }
  }

  async listEvents(
    principal: Principal,
    query: ListCalendarEventsQuery,
  ): Promise<readonly CalendarEventInstance[]> {
    await this.assertSubscriptionPermission(principal, "read");
    const windowStart = parseWindowBoundary(query.start, false);
    const windowEnd = parseWindowBoundary(query.end, true);
    if (Temporal.Instant.compare(windowStart, windowEnd) >= 0) {
      return [];
    }

    const cached = await this.repos.searchConfigRepo.listCalendarEventsCache(principal.workspaceId, {
      subscriptionId: query.subscriptionId,
      onlyEnabledSubscriptions: true,
    });

    const instances: CalendarEventInstance[] = [];

    for (const ev of cached) {
      const startInstant = Temporal.Instant.from(ev.startAt);
      const endInstant = Temporal.Instant.from(ev.endAt);
      const durationMs = Math.max(
        60_000,
        endInstant.epochMilliseconds - startInstant.epochMilliseconds,
      );
      const durationNs = BigInt(durationMs) * 1_000_000n;

      if (!ev.rrule) {
        if (
          Temporal.Instant.compare(endInstant, windowStart) > 0 &&
          Temporal.Instant.compare(startInstant, windowEnd) < 0
        ) {
          instances.push({
            id: `${ev.subscriptionId}_${ev.uid}`,
            eventId: ev.id,
            subscriptionId: ev.subscriptionId,
            subscriptionName: ev.subscriptionName,
            color: ev.color,
            uid: ev.uid,
            title: ev.title,
            description: ev.description,
            location: ev.location,
            startAt: ev.allDay ? ev.startAt.slice(0, 10) : ev.startAt,
            endAt: ev.allDay ? ev.endAt.slice(0, 10) : ev.endAt,
            allDay: ev.allDay,
            timezone: ev.timezone,
            recurring: false,
            readOnly: true,
          });
        }
        continue;
      }

      try {
        const tz = sanitizeTimeZone(ev.timezone);
        const dtstartStamp = formatZonedCompactStamp(ev.startAt, tz);
        const rule = new RRuleTemporal({
          rruleString: `DTSTART;TZID=${tz}:${dtstartStamp}\nRRULE:${ev.rrule}`,
        });
        const searchAfter = Temporal.Instant.fromEpochNanoseconds(
          windowStart.epochNanoseconds - durationNs,
        ).toZonedDateTimeISO(tz);
        const searchBefore = windowEnd.toZonedDateTimeISO(tz);
        const occurrences = rule.between(searchAfter, searchBefore, true);
        const exdateSet = new Set(
          ev.exdates.map((rawEx) => {
            if (ev.allDay || /^\d{4}-\d{2}-\d{2}$/.test(rawEx)) return rawEx.slice(0, 10);
            try {
              return Temporal.Instant.from(rawEx).toString();
            } catch {
              return rawEx;
            }
          }),
        );

        for (let i = 0; i < occurrences.length && i < MAX_RRULE_INSTANCES_PER_EVENT; i++) {
          const occInstant = occurrences[i]!.toInstant();
          const occEndInstant = Temporal.Instant.fromEpochNanoseconds(
            occInstant.epochNanoseconds + BigInt(durationMs) * 1_000_000n,
          );
          if (
            Temporal.Instant.compare(occEndInstant, windowStart) <= 0 ||
            Temporal.Instant.compare(occInstant, windowEnd) >= 0
          ) {
            continue;
          }
          const occKey = ev.allDay ? occInstant.toString().slice(0, 10) : occInstant.toString();
          if (exdateSet.has(occKey)) {
            continue;
          }
          instances.push({
            id: `${ev.subscriptionId}_${ev.uid}_${occKey}`,
            eventId: ev.id,
            subscriptionId: ev.subscriptionId,
            subscriptionName: ev.subscriptionName,
            color: ev.color,
            uid: ev.uid,
            title: ev.title,
            description: ev.description,
            location: ev.location,
            startAt: ev.allDay ? occInstant.toString().slice(0, 10) : occInstant.toString(),
            endAt: ev.allDay ? occEndInstant.toString().slice(0, 10) : occEndInstant.toString(),
            allDay: ev.allDay,
            timezone: ev.timezone,
            recurring: true,
            readOnly: true,
          });
        }
      } catch {
        // Fallback: if RRULE failed to parse, emit the base DTSTART occurrence if inside window
        if (
          Temporal.Instant.compare(endInstant, windowStart) > 0 &&
          Temporal.Instant.compare(startInstant, windowEnd) < 0
        ) {
          instances.push({
            id: `${ev.subscriptionId}_${ev.uid}`,
            eventId: ev.id,
            subscriptionId: ev.subscriptionId,
            subscriptionName: ev.subscriptionName,
            color: ev.color,
            uid: ev.uid,
            title: ev.title,
            description: ev.description,
            location: ev.location,
            startAt: ev.allDay ? ev.startAt.slice(0, 10) : ev.startAt,
            endAt: ev.allDay ? ev.endAt.slice(0, 10) : ev.endAt,
            allDay: ev.allDay,
            timezone: ev.timezone,
            recurring: false,
            readOnly: true,
          });
        }
      }
    }

    return instances.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }
}
