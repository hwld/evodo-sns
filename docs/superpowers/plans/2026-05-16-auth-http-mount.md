# 認証バックエンド HTTP マウント Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Better Auth の HTTP ハンドラ・session middleware・`/v1` `/admin/v1` の OpenAPIHono 構造を実装し、ローカルでログイン API が叩ける状態にする。

**Architecture:**

- `apps/api` の Hono ルートに `auth.handler` を `/api/auth/*` でマウント
- session/user を Hono context に乗せる middleware と、`requireAuth` / `requireAdmin` の二段ガード
- `/v1/*` `/admin/v1/*` を `OpenAPIHono` で構築、それぞれ独立した OpenAPI ドキュメントを生成

**Tech Stack:** Hono + `@hono/zod-openapi` + Better Auth + Drizzle + Cloudflare Workers + `@cloudflare/vitest-pool-workers`

**スコープ外（別プラン）:**

- Resend 統合（本番 OTP 送信）
- フロント（apps/web のログイン UI、apps/admin のガード）
- Safari ITP 対策の reverse proxy
- 本番 D1 作成 / secret 投入

---

## File Structure

```
apps/api/
├── src/
│   ├── auth.ts                   # existing — createAuth(env)
│   ├── auth.cli.ts               # existing — CLI stub
│   ├── env.ts                    # NEW — Bindings + Variables types
│   ├── auth-middleware.ts        # NEW — session, requireAuth, requireAdmin
│   ├── routes/
│   │   ├── v1.ts                 # NEW — OpenAPIHono /v1/* with /me
│   │   └── admin.ts              # NEW — OpenAPIHono /admin/v1/* with /users
│   ├── index.ts                  # MODIFY — mount auth.handler + routes
│   └── db/schema.ts              # existing
├── test/
│   ├── apply-migrations.ts       # NEW — vitest setup: apply D1 migrations
│   └── routes.test.ts            # NEW — integration tests for guards
└── vitest.config.ts              # MODIFY — wire migrations + setup file
```

**Design decisions:**

- middleware は **1 ファイル** `auth-middleware.ts` に `session` / `requireAuth` / `requireAdmin` を全部入れる（YAGNI: 1 機能、3 関数）
- routes は **`/v1` と `/admin` で別ファイル**（独立した OpenAPI ドキュメントを持つので境界が明確）
- 型定義は `env.ts` に集約（Bindings は Cloudflare、Variables は Hono の context 用）
- 統合テストのみ（`SELF.fetch()`）。ユニットレベルの middleware モックは作らない

---

## Task 1: Vitest 用 D1 マイグレーション適用セットアップ

**Files:**

- Modify: `apps/api/vitest.config.ts`
- Create: `apps/api/test/apply-migrations.ts`
- Create: `apps/api/test/routes.test.ts`

- [ ] **Step 1: Vitest config を migrations 注入対応に書き換える**

`apps/api/vitest.config.ts` を以下に置き換え:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
```

- [ ] **Step 2: setup file を作成**

`apps/api/test/apply-migrations.ts`:

```ts
import { applyD1Migrations, env } from "cloudflare:test";

// vitest.config.ts の miniflare.bindings.TEST_MIGRATIONS で注入される
declare module "cloudflare:test" {
  interface ProvidedEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 3: smoke test を書く（migrations が適用されたかの確認）**

`apps/api/test/routes.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("test infrastructure", () => {
  it("D1 has Better Auth tables after migrations", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const tables = results.map((r) => r.name);
    expect(tables).toContain("user");
    expect(tables).toContain("session");
    expect(tables).toContain("account");
    expect(tables).toContain("verification");
    expect(tables).toContain("passkey");
  });
});
```

- [ ] **Step 4: テストを走らせて通ることを確認**

Run: `cd apps/api && pnpm test`
Expected: PASS — "D1 has Better Auth tables after migrations"

もしマイグレーション関連で `TEST_MIGRATIONS is not assignable to type D1Migration[]` のような型エラーが出たら、`apps/api/tsconfig.json` の `types` に `@cloudflare/vitest-pool-workers/types` を追加する。

- [ ] **Step 5: typecheck + lint も通すことを確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 両方とも通る（出力なし）

- [ ] **Step 6: commit**

```bash
git add apps/api/vitest.config.ts apps/api/test/apply-migrations.ts apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
test(api): D1 マイグレーション自動適用のテスト基盤を整備

vitest 実行時にローカル D1（in-memory）へ Better Auth のマイグレーションを
事前適用する setup ファイルを追加。これで integration test から
SELF.fetch() 経由で Better Auth API を叩けるようになる。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 環境とコンテキストの型を集約（env.ts）

**Files:**

- Create: `apps/api/src/env.ts`

- [ ] **Step 1: env.ts を作成**

`apps/api/src/env.ts`:

```ts
import type { Auth } from "./auth";

export type Bindings = {
  DB: D1Database;
  ENVIRONMENT: "development" | "production";
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  ADMIN_USER_IDS?: string;
};

export type SessionUser = Auth["$Infer"]["Session"]["user"];
export type SessionData = Auth["$Infer"]["Session"]["session"];

export type Variables = {
  user: SessionUser | null;
  session: SessionData | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
```

- [ ] **Step 2: typecheck で参照が解決することを確認**

Run: `pnpm typecheck`
Expected: 通る（このタスクでは新規ファイル追加のみ、他から参照していない）

- [ ] **Step 3: commit**

```bash
git add apps/api/src/env.ts
git commit -m "$(cat <<'EOF'
feat(api): Hono 用の Bindings / Variables / AppEnv 型を env.ts に集約

Better Auth の $Infer 型から SessionUser / SessionData を引いて、
Hono context に乗せる Variables 型を定義。以降の middleware と routes
で AppEnv を共有して型を統一する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `auth.handler` を `/api/auth/*` にマウント

**Files:**

- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/routes.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`apps/api/test/routes.test.ts` の末尾に追加:

```ts
describe("auth handler mount", () => {
  it("GET /api/auth/get-session responds 200 with null when no cookie", async () => {
    const { default: app } = await import("../src/index");
    const res = await app.request("/api/auth/get-session", {}, {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認**

Run: `pnpm test --run`
Expected: FAIL — `/api/auth/get-session` が 404、もしくは "auth handler not mounted"

- [ ] **Step 3: index.ts に auth handler をマウント**

`apps/api/src/index.ts` を以下に置き換え:

```ts
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
```

- [ ] **Step 4: テストを走らせて通ることを確認**

Run: `pnpm test --run`
Expected: PASS — 全テスト緑

- [ ] **Step 5: typecheck + lint 確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 通る

- [ ] **Step 6: commit**

```bash
git add apps/api/src/index.ts apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): Better Auth handler を /api/auth/* にマウント

Hono に createAuth(env) を request 毎に呼ぶハンドラを追加。
get-session が cookie 無しで null を返すことを integration test で確認。
sign-up / sign-in / passkey 系のエンドポイントは Better Auth が自動的に
/api/auth/* 配下に公開する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: session middleware

**Files:**

- Create: `apps/api/src/auth-middleware.ts`
- Modify: `apps/api/test/routes.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`apps/api/test/routes.test.ts` の末尾に追加:

```ts
describe("session middleware", () => {
  it("sets user/session to null when no cookie", async () => {
    const { Hono } = await import("hono");
    const { session } = await import("../src/auth-middleware");
    const app = new Hono();
    app.use("*", session);
    app.get("/probe", (c) =>
      c.json({ user: c.get("user"), session: c.get("session") }),
    );

    const res = await app.request("/probe", {}, {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認**

Run: `pnpm test --run`
Expected: FAIL — `Cannot find module "../src/auth-middleware"`

- [ ] **Step 3: auth-middleware.ts を作成**

`apps/api/src/auth-middleware.ts`:

```ts
import type { MiddlewareHandler } from "hono";

import { createAuth } from "./auth";
import type { AppEnv } from "./env";

export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = createAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", result?.user ?? null);
  c.set("session", result?.session ?? null);
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
};
```

- [ ] **Step 4: テストを走らせて通ることを確認**

Run: `pnpm test --run`
Expected: PASS

- [ ] **Step 5: typecheck + lint 確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 通る

- [ ] **Step 6: commit**

```bash
git add apps/api/src/auth-middleware.ts apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): session / requireAuth / requireAdmin middleware を実装

session middleware が cookie からセッションを復元し、user と session を
Hono context に乗せる。requireAuth は user 不在で 401、requireAdmin は
さらに role !== \"admin\" で 403 を返す。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `/v1/*` OpenAPIHono と `/me` エンドポイント

**Files:**

- Create: `apps/api/src/routes/v1.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/routes.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`apps/api/test/routes.test.ts` の末尾に追加:

```ts
describe("/v1/* routes", () => {
  it("GET /v1/me returns 401 when not authenticated", async () => {
    const { default: app } = await import("../src/index");
    const res = await app.request("/v1/me", {}, {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env);
    expect(res.status).toBe(401);
  });

  it("GET /v1/openapi.json returns the OpenAPI document", async () => {
    const { default: app } = await import("../src/index");
    const res = await app.request("/v1/openapi.json", {}, {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env);
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.info.title).toBe("evodo-sns v1 API");
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認**

Run: `pnpm test --run`
Expected: FAIL — `/v1/me` も `/v1/openapi.json` も 404

- [ ] **Step 3: routes/v1.ts を作成**

`apps/api/src/routes/v1.ts`:

```ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { requireAuth, session } from "../auth-middleware";
import type { AppEnv } from "../env";

const v1 = new OpenAPIHono<AppEnv>();

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

v1.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "evodo-sns v1 API", version: "0.1.0" },
});

export default v1;
```

- [ ] **Step 4: index.ts に v1 をマウント**

`apps/api/src/index.ts` を以下に更新:

```ts
import { Hono } from "hono";

import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import v1 from "./routes/v1";

const app = new Hono<AppEnv>();

app.get("/", (c) => c.text("OK"));

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

app.route("/v1", v1);

export default app;
```

- [ ] **Step 5: テストを走らせて通ることを確認**

Run: `pnpm test --run`
Expected: PASS

- [ ] **Step 6: typecheck + lint 確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 通る

- [ ] **Step 7: commit**

```bash
git add apps/api/src/routes/v1.ts apps/api/src/index.ts apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): /v1/* OpenAPIHono ルートと /me エンドポイントを追加

OpenAPIHono インスタンスを /v1 にマウント。session + requireAuth
middleware を全パスに適用し、/me で現在のユーザー情報を返す。
/v1/openapi.json で OpenAPI 仕様も自動生成される。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `/admin/v1/*` OpenAPIHono と `/users` エンドポイント

**Files:**

- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/routes.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`apps/api/test/routes.test.ts` の末尾に追加:

```ts
describe("/admin/v1/* routes", () => {
  it("GET /admin/v1/users returns 401 when not authenticated", async () => {
    const { default: app } = await import("../src/index");
    const res = await app.request("/admin/v1/users", {}, {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env);
    expect(res.status).toBe(401);
  });

  it("GET /admin/v1/openapi.json returns the admin OpenAPI document", async () => {
    const { default: app } = await import("../src/index");
    const res = await app.request("/admin/v1/openapi.json", {}, {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env);
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.info.title).toBe("evodo-sns admin API");
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認**

Run: `pnpm test --run`
Expected: FAIL — `/admin/v1/users` も `/admin/v1/openapi.json` も 404

- [ ] **Step 3: routes/admin.ts を作成**

`apps/api/src/routes/admin.ts`:

```ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";

import { requireAdmin, session } from "../auth-middleware";
import { user as userTable } from "../db/schema";
import type { AppEnv } from "../env";

const admin = new OpenAPIHono<AppEnv>();

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

admin.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "evodo-sns admin API", version: "0.1.0" },
});

export default admin;
```

- [ ] **Step 4: index.ts に admin をマウント**

`apps/api/src/index.ts` を以下に更新:

```ts
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
```

- [ ] **Step 5: テストを走らせて通ることを確認**

Run: `pnpm test --run`
Expected: PASS

- [ ] **Step 6: typecheck + lint 確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 通る

- [ ] **Step 7: commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/index.ts apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): /admin/v1/* OpenAPIHono ルートと /users エンドポイントを追加

session + requireAdmin middleware で role=admin を要求するルート群を
/admin/v1 にマウント。/users で全ユーザー一覧を返す（最大 100 件）。
/admin/v1/openapi.json で admin API の OpenAPI 仕様も自動生成。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 手動 E2E 確認（ローカル dev サーバで OTP サインアップ）

**Files:**

- なし（手動操作のみ）

このタスクはコードを書かない。dev サーバを立てて、API が想定通り動くことを確認する。

- [ ] **Step 1: BETTER_AUTH_SECRET を .dev.vars に書き込む（未設定なら）**

`apps/api/.dev.vars` が存在しなければ作成:

```bash
cd apps/api
test -f .dev.vars || {
  SECRET=$(openssl rand -base64 32)
  cat > .dev.vars <<EOF
BETTER_AUTH_SECRET=$SECRET
EOF
}
```

`ADMIN_USER_IDS` はまだ user が存在しないので空のままで OK。

- [ ] **Step 2: dev サーバを起動**

リポジトリルートで:

```bash
pnpm run dev
```

`tmp/dev.log` に出力される。`apps/api` 側は `http://localhost:8787`。

- [ ] **Step 3: ヘルスチェック**

```bash
curl -i http://localhost:8787/
```

Expected: `HTTP/1.1 200 OK` + body `OK`

- [ ] **Step 4: get-session（未ログイン）**

```bash
curl -i http://localhost:8787/api/auth/get-session
```

Expected: `200` + body `null`

- [ ] **Step 5: /v1/me（未ログイン）**

```bash
curl -i http://localhost:8787/v1/me
```

Expected: `401` + body `{"error":"unauthenticated"}`

- [ ] **Step 6: OTP サインアップ送信**

```bash
curl -i -X POST http://localhost:8787/api/auth/email-otp/send-verification-otp \
  -H "content-type: application/json" \
  -d '{"email":"test@example.com","type":"sign-in"}'
```

Expected: `200`。`tmp/dev.log` に `[OTP] type=sign-in email=test@example.com code=XXXXXX` のようなログが出る。

- [ ] **Step 7: OTP を tmp/dev.log から取得**

```bash
grep '\[OTP\]' tmp/dev.log | tail -1
```

出力例: `[OTP] type=sign-in email=test@example.com code=123456`
`code=` の後の 6 桁をコピーする。

- [ ] **Step 8: OTP で sign-in（cookie jar を使って session を持つ）**

```bash
curl -i -X POST http://localhost:8787/api/auth/sign-in/email-otp \
  -H "content-type: application/json" \
  -c /tmp/evodo-cookies.txt \
  -d '{"email":"test@example.com","otp":"<step 7 で取った 6 桁>"}'
```

Expected: `200` + body にユーザー情報。`/tmp/evodo-cookies.txt` に session cookie が保存される。

- [ ] **Step 9: cookie を使って /v1/me を取得**

```bash
curl -i -b /tmp/evodo-cookies.txt http://localhost:8787/v1/me
```

Expected: `200` + body に `id`, `email`, `name` などが含まれる。`role` は `"user"`、`username` は `null`。

- [ ] **Step 10: /admin/v1/users はまだ admin じゃないので拒否**

```bash
curl -i -b /tmp/evodo-cookies.txt http://localhost:8787/admin/v1/users
```

Expected: `403` + body `{"error":"forbidden"}`

- [ ] **Step 11: 確認できたら dev サーバを停止し、cookie jar とテストデータをクリーンアップ**

```bash
rm /tmp/evodo-cookies.txt
# (任意) ローカル D1 のテストユーザーを削除する場合
cd apps/api
pnpm exec wrangler d1 execute evodo-db --local \
  --command "DELETE FROM user WHERE email='test@example.com'"
```

このタスクで動作確認が取れれば、認証バックエンド HTTP マウントは完了。

---

## Self-Review メモ（プラン作成者向け、実装者は無視可）

- Spec coverage:
  - 認証手段 (Email OTP + Passkey): handler 経由で全エンドポイント公開済み（task 3）
  - middleware: session / requireAuth / requireAdmin 全て（task 4）
  - `/v1/*` / `/admin/v1/*` の境界: task 5, 6
  - rpID 設定など Better Auth 設定は既存の auth.ts に入っている（このプランでは触らない）
  - OpenAPI ドキュメント: task 5, 6 で各 `/openapi.json` を生成
- 未カバー（別プランへ送る）:
  - Resend 統合（spec 11 章 production）
  - フロント Better Auth クライアント（spec 6 章）
  - Safari ITP 用 reverse proxy（spec 9 章）
  - admin ブートストラップの手順（spec 7 章 — secret 設定は task 7 で言及済み）

- 型整合性:
  - `AppEnv` を全 middleware と routes で共有
  - `c.get("user")` の型は `AppEnv["Variables"]["user"]` 経由で `SessionUser | null`
  - `requireAuth` を通過した後の `c.get("user")` は実行時は non-null だが型上は null 可能。`!` で narrow している
