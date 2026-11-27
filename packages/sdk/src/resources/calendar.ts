import type {
  CalendarEventInstance,
  CalendarSubId,
  CalendarSubscription,
  CreateCalendarSubscriptionInput,
  ListCalendarEventsQuery,
  UpdateCalendarSubscriptionInput,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";

export interface SyncCalendarSubscriptionResponse {
  readonly subscription: CalendarSubscription;
  readonly syncedCount: number;
}

export interface CalendarResource {
  listSubscriptions(): Promise<readonly CalendarSubscription[]>;
  createSubscription(
    input: CreateCalendarSubscriptionInput,
  ): Promise<SyncCalendarSubscriptionResponse>;
  updateSubscription(
    subscriptionId: CalendarSubId,
    input: UpdateCalendarSubscriptionInput,
  ): Promise<CalendarSubscription>;
  deleteSubscription(subscriptionId: CalendarSubId): Promise<void>;
  refreshSubscription(subscriptionId: CalendarSubId): Promise<SyncCalendarSubscriptionResponse>;
  listEvents(query: ListCalendarEventsQuery): Promise<readonly CalendarEventInstance[]>;
}

export function createCalendarResource(transport: InkadeHttpTransport): CalendarResource {
  return {
    async listSubscriptions() {
      const res = await transport.requestJson<{
        readonly subscriptions: readonly CalendarSubscription[];
      }>("/api/v1/calendar-subscriptions");
      return res.subscriptions;
    },

    createSubscription(input) {
      return transport.requestJson<SyncCalendarSubscriptionResponse>(
        "/api/v1/calendar-subscriptions",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    async updateSubscription(subscriptionId, input) {
      const res = await transport.requestJson<{ readonly subscription: CalendarSubscription }>(
        `/api/v1/calendar-subscriptions/${encodeURIComponent(subscriptionId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.subscription;
    },

    async deleteSubscription(subscriptionId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/calendar-subscriptions/${encodeURIComponent(subscriptionId)}`,
        { method: "DELETE" },
      );
    },

    refreshSubscription(subscriptionId) {
      return transport.requestJson<SyncCalendarSubscriptionResponse>(
        `/api/v1/calendar-subscriptions/${encodeURIComponent(subscriptionId)}/refresh`,
        { method: "POST" },
      );
    },

    async listEvents(queryParams) {
      const query = buildQuery({
        start: queryParams.start,
        end: queryParams.end,
        subscriptionId: queryParams.subscriptionId,
      });
      const res = await transport.requestJson<{
        readonly events: readonly CalendarEventInstance[];
      }>(`/api/v1/calendar-events${query}`);
      return res.events;
    },
  };
}
