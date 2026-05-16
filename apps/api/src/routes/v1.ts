import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { requireAuth, session } from "../auth-middleware";
import type { AppEnv } from "../env";

const v1 = new OpenAPIHono<AppEnv>();

// /openapi.json は public にしたいので、auth middleware より前に登録する。
// Hono の use("*", ...) は登録順より後のルートにのみ適用されるため、
// この順序を保つこと（middleware を上に動かすと openapi.json が 401 化する）。
v1.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "evodo-sns v1 API", version: "0.1.0" },
});

v1.use("*", session);
v1.use("*", requireAuth);

const MeResponse = z
  .object({
    id: z.string(),
    email: z.string().email(),
    username: z.string().nullable(),
    displayUsername: z.string().nullable(),
    name: z.string(),
    role: z.string(),
    bio: z.string().nullable(),
  })
  .openapi("Me");

const meRoute = createRoute({
  method: "get",
  path: "/me",
  responses: {
    200: {
      description: "現在ログイン中のユーザー情報",
      content: { "application/json": { schema: MeResponse } },
    },
  },
});

v1.openapi(meRoute, (c) => {
  const user = c.get("user")!;
  return c.json({
    id: user.id,
    email: user.email,
    username: user.username ?? null,
    displayUsername: user.displayUsername ?? null,
    name: user.name,
    role: user.role ?? "user",
    bio: user.bio ?? null,
  });
});

export default v1;
