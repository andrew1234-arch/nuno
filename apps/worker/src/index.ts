import { drizzle } from "drizzle-orm/d1";
import { sqliteSchema } from "@nuno/shared";
import type { SqlDb } from "@nuno/shared";
import { createApp } from "./app.js";
import { dailyPrune, storageCheck, tick } from "./cron.js";
import { settings, type Env } from "./env.js";
import { SqlRepo } from "./repo.js";

const dbOf = (env: Env): SqlDb => drizzle(env.DB, { schema: sqliteSchema });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Cloudflare sets CF-Connecting-IP; it cannot be spoofed by the client.
    const app = createApp(new SqlRepo(dbOf(env)), { clientIp: (c) => c.req.header("cf-connecting-ip") });
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const cfg = settings(env);
    const db = dbOf(env);
    const started = Date.now();
    let result: Record<string, unknown>;
    switch (controller.cron) {
      case "7 * * * *":
        result = await storageCheck(env.DB, db, cfg);
        break;
      case "30 3 * * *":
        result = await dailyPrune(db, cfg);
        break;
      default:
        result = await tick(db, cfg);
    }
    console.log(JSON.stringify({ cron: controller.cron, ms: Date.now() - started, ...result }));
  },
} satisfies ExportedHandler<Env>;
