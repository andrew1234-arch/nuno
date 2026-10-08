import { serve } from "@hono/node-server";
import { createDb } from "@nuno/shared";
import { createApp } from "./app.js";
import { PgRepo } from "./repo.js";

const port = Number(process.env.API_PORT ?? 8787);
const { db } = createDb();
const app = createApp(new PgRepo(db));

serve({ fetch: app.fetch, port }, (info) => console.log(`[api] listening on http://localhost:${info.port}`));
