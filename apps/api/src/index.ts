import { Hono } from "hono";

import { createAuth } from "./auth";
import type { AppEnv } from "./env";

const app = new Hono<AppEnv>();

app.get("/", (c) => c.text("OK"));

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

export default app;
