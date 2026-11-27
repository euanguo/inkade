import type { Hono } from "hono";
import { z } from "zod";
import {
  batchUpdateTasksInputSchema,
  calendarSubIdSchema,
  createCalendarSubscriptionInputSchema,
  createTaskInputSchema,
  listCalendarEventsQuerySchema,
  listTasksQuerySchema,
  rescheduleTaskInputSchema,
  taskTargetIdSchema,
  updateCalendarSubscriptionInputSchema,
  updateTaskInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

const taskParamSchema = z.object({
  taskId: taskTargetIdSchema,
});

const calendarSubParamSchema = z.object({
  subscriptionId: calendarSubIdSchema,
});

export function registerTaskRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/tasks", zValidate("query", listTasksQuerySchema), async (c) => {
    const tasks = await services.workspace.listTasks(c.get("principal"), c.req.valid("query"));
    return c.json({ tasks });
  });

  router.post("/tasks", zValidate("json", createTaskInputSchema), async (c) => {
    const result = await services.task.createTask(c.get("principal"), c.req.valid("json"));
    return c.json(result, 201);
  });

  router.patch(
    "/tasks/:taskId",
    zValidate("param", taskParamSchema),
    zValidate("json", updateTaskInputSchema),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const result = await services.task.updateTask(
        c.get("principal"),
        taskId,
        c.req.valid("json"),
      );
      return c.json(result);
    },
  );

  router.post(
    "/tasks/reschedule",
    zValidate("json", rescheduleTaskInputSchema),
    async (c) => {
      const result = await services.task.rescheduleTask(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json(result);
    },
  );

  router.post(
    "/tasks/batch-update",
    zValidate("json", batchUpdateTasksInputSchema),
    async (c) => {
      const result = await services.task.batchUpdateTasks(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json(result);
    },
  );

  router.get("/outline-nodes/tasks", zValidate("query", listTasksQuerySchema), async (c) => {
    const tasks = await services.workspace.listTasks(c.get("principal"), c.req.valid("query"));
    return c.json({ tasks });
  });

  router.post("/outline-nodes/tasks", zValidate("json", createTaskInputSchema), async (c) => {
    const result = await services.task.createTask(c.get("principal"), c.req.valid("json"));
    return c.json(result, 201);
  });

  router.post(
    "/outline-nodes/tasks/batch-update",
    zValidate("json", batchUpdateTasksInputSchema),
    async (c) => {
      const result = await services.task.batchUpdateTasks(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json(result);
    },
  );

  router.get("/calendar-subscriptions", async (c) => {
    const subscriptions = await services.calendar.listSubscriptions(c.get("principal"));
    return c.json({ subscriptions });
  });

  router.post(
    "/calendar-subscriptions",
    zValidate("json", createCalendarSubscriptionInputSchema),
    async (c) => {
      const result = await services.calendar.createSubscription(
        c.get("principal"),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  router.patch(
    "/calendar-subscriptions/:subscriptionId",
    zValidate("param", calendarSubParamSchema),
    zValidate("json", updateCalendarSubscriptionInputSchema),
    async (c) => {
      const { subscriptionId } = c.req.valid("param");
      const subscription = await services.calendar.updateSubscription(
        c.get("principal"),
        subscriptionId,
        c.req.valid("json"),
      );
      return c.json({ subscription });
    },
  );

  router.delete(
    "/calendar-subscriptions/:subscriptionId",
    zValidate("param", calendarSubParamSchema),
    async (c) => {
      const { subscriptionId } = c.req.valid("param");
      await services.calendar.deleteSubscription(c.get("principal"), subscriptionId);
      return c.json({ deleted: true, subscriptionId });
    },
  );

  router.post(
    "/calendar-subscriptions/:subscriptionId/refresh",
    zValidate("param", calendarSubParamSchema),
    async (c) => {
      const { subscriptionId } = c.req.valid("param");
      const result = await services.calendar.refreshSubscription(
        c.get("principal"),
        subscriptionId,
      );
      return c.json(result);
    },
  );

  router.get(
    "/calendar-events",
    zValidate("query", listCalendarEventsQuerySchema),
    async (c) => {
      const events = await services.calendar.listEvents(c.get("principal"), c.req.valid("query"));
      return c.json({ events });
    },
  );
}
