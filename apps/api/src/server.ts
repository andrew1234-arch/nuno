import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createDb } from "@nuno/shared";
import { createApp } from "./app.js";
import { PgRepo } from "./repo.js";

const port = Number(process.env.API_PORT ?? 8787);
const { db } = createDb();
// Set TRUST_PROXY=1 only when running behind a reverse proxy that sets X-Forwarded-For.
const app = createApp(new PgRepo(db), {
  clientIp: (c) => getConnInfo(c).remote.address,
  trustProxy: process.env.TRUST_PROXY === "1",
});

serve({ fetch: app.fetch, port }, (info) => console.log(`[api] listening on http://localhost:${info.port}`));
