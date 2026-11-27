import { createInkadeApp } from "./app.ts";

export * from "./types.ts";
export * from "./app.ts";
export * from "./services/index.ts";
export * from "./realtime/sse-hub.ts";
export * from "./realtime/yjs-sync.ts";

const isMainModule =
  typeof import.meta !== "undefined" &&
  "main" in import.meta &&
  Boolean((import.meta as { main?: boolean }).main);

if (isMainModule) {
  const port = Number(process.env.PORT ?? 3456);
  const host = process.env.HOST ?? "0.0.0.0";
  const instance = createInkadeApp({
    dbPath: process.env.INKADE_DB_PATH ?? "./data/inkade.db",
    dataDir: process.env.INKADE_DATA_DIR ?? "./data",
    localAutoAuth: process.env.INKADE_LOCAL_AUTO_AUTH === "true",
    webDistDir: process.env.INKADE_WEB_DIST_DIR,
    enableBriefingScheduler: true,
  });

  await instance.ready;

  const server = Bun.serve({
    port,
    hostname: host,
    fetch: (req, bunServer) => instance.fetch(req, bunServer),
    websocket: instance.websocket,
    idleTimeout: 120,
  });

  instance.logger.info(
    { hostname: server.hostname, port: server.port },
    "Inkade server listening",
  );

  let shuttingDown = false;
  const handleShutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    instance.logger.info({ signal }, "Shutting down Inkade server");
    try {
      await server.stop(false);
    } catch {
      // Ignore server stop errors during teardown
    }
    try {
      await instance.yjsHub.flushAllRooms();
    } catch {
      // Best-effort Yjs persistence flush
    }
    instance.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void handleShutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void handleShutdown("SIGTERM");
  });
}
