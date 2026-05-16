import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";

import { requireAdmin, session } from "../auth-middleware";
import { user as userTable } from "../db/schema";
import type { AppEnv } from "../env";

const admin = new OpenAPIHono<AppEnv>();

// /openapi.json は public にしたいので、auth middleware より前に登録する。
// Hono の use("*", ...) は登録順より後のルートにのみ適用されるため、
// この順序を保つこと（middleware を上に動かすと openapi.json が 401 化する）。
admin.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "evodo-sns admin API", version: "0.1.0" },
});

admin.use("*", session);
admin.use("*", requireAdmin);

const UserListItem = z
  .object({
    id: z.string(),
    email: z.string().email(),
    username: z.string().nullable(),
    role: z.string(),
    banned: z.boolean().nullable(),
    createdAt: z.string(),
  })
  .openapi("UserListItem");

const listUsersRoute = createRoute({
  method: "get",
  path: "/users",
  responses: {
    200: {
      description: "全ユーザー一覧",
      content: {
        "application/json": {
          schema: z.object({ users: z.array(UserListItem) }),
        },
      },
    },
  },
});

admin.openapi(listUsersRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      username: userTable.username,
      role: userTable.role,
      banned: userTable.banned,
      createdAt: userTable.createdAt,
    })
    .from(userTable)
    .limit(100);

  return c.json({
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      username: r.username ?? null,
      role: r.role ?? "user",
      banned: r.banned ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

export default admin;
