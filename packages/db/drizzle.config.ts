import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/schema/sqlite.ts", "./src/schema/auth-sqlite.ts"],
  out: "./drizzle",
  dialect: "sqlite",
});
