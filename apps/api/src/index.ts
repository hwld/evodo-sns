import { Hono } from "hono";

import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import admin from "./routes/admin";
import v1 from "./routes/v1";

const app = new Hono<AppEnv>();

app.get("/", (c) => c.text("OK"));

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

app.route("/v1", v1);
app.route("/admin/v1", admin);

export default app;
