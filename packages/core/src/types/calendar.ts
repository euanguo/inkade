import { z } from "zod";
import {
  calendarEventIdSchema,
  calendarSubIdSchema,
  workspaceIdSchema,
  type CalendarEventId,
  type CalendarSubId,
  type WorkspaceId,
} from "../ids.ts";

export interface CalendarSubscription {
  readonly id: CalendarSubId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly url: string;
  readonly color: string;
  readonly enabled: boolean;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CalendarEventCacheRecord {
  readonly id: CalendarEventId;
  readonly subscriptionId: CalendarSubId;
  readonly workspaceId: WorkspaceId;
  readonly uid: string;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay: boolean;
  readonly timezone: string | null;
  readonly rrule: string | null;
  readonly exdates: readonly string[];
  readonly updatedAt: string;
}

export interface CalendarEventInstance {
  readonly id: string;
  readonly eventId: CalendarEventId;
  readonly subscriptionId: CalendarSubId;
  readonly subscriptionName: string;
  readonly color: string;
  readonly uid: string;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay: boolean;
  readonly timezone: string | null;
  readonly recurring: boolean;
  readonly readOnly: true;
}

const calendarColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: "Color must be a #RRGGBB hex string" });

const calendarFeedUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "webcal:";
      } catch {
        return false;
      }
    },
    { message: "Subscription URL must use http, https, or webcal protocol" },
  );

export const createCalendarSubscriptionInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  url: calendarFeedUrlSchema,
  color: calendarColorSchema.default("#3b82f6"),
  enabled: z.boolean().default(true),
});
export type CreateCalendarSubscriptionInput = z.input<typeof createCalendarSubscriptionInputSchema>;
export type ParsedCreateCalendarSubscriptionInput = z.infer<
  typeof createCalendarSubscriptionInputSchema
>;

export const updateCalendarSubscriptionInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  url: calendarFeedUrlSchema.optional(),
  color: calendarColorSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateCalendarSubscriptionInput = z.input<typeof updateCalendarSubscriptionInputSchema>;
export type ParsedUpdateCalendarSubscriptionInput = z.infer<
  typeof updateCalendarSubscriptionInputSchema
>;

export const listCalendarEventsQuerySchema = z.object({
  start: z.string().trim().min(1),
  end: z.string().trim().min(1),
  subscriptionId: calendarSubIdSchema.optional(),
});
export type ListCalendarEventsQuery = z.input<typeof listCalendarEventsQuerySchema>;
export type ParsedListCalendarEventsQuery = z.infer<typeof listCalendarEventsQuerySchema>;

export const calendarSubscriptionSchema = z.object({
  id: calendarSubIdSchema,
  workspaceId: workspaceIdSchema,
  name: z.string(),
  url: z.string(),
  color: z.string(),
  enabled: z.boolean(),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const calendarEventIdRefSchema = calendarEventIdSchema;
