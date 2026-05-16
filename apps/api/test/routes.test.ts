import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../src/env";

import { cleanAuthTables, getOtpForEmail } from "./helpers";

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

describe("session middleware", () => {
  it("sets user/session to null when no cookie", async () => {
    const { Hono } = await import("hono");
    const { session } = await import("../src/auth-middleware");
    const app = new Hono<AppEnv>();
    app.use("*", session);
    app.get("/probe", (c) =>
      c.json({ user: c.get("user"), session: c.get("session") }),
    );

    const res = await app.request("/probe", {}, {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; session: unknown };
    expect(body.user).toBeNull();
    expect(body.session).toBeNull();
  });
});

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
    const doc = (await res.json()) as { info: { title: string } };
    expect(doc.info.title).toBe("evodo-sns v1 API");
  });
});

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
    const doc = (await res.json()) as { info: { title: string } };
    expect(doc.info.title).toBe("evodo-sns admin API");
  });
});

describe("auth integration", () => {
  beforeEach(async () => {
    await cleanAuthTables(env.DB);
  });

  it("OTP サインアップ → /v1/me で本人情報が取れる", async () => {
    const { default: app } = await import("../src/index");
    const testEnv = {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env;
    const email = "alice@example.com";

    // 1. OTP 送信
    const sendRes = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, type: "sign-in" }),
      },
      testEnv,
    );
    expect(sendRes.status).toBe(200);

    // 2. D1 から OTP を取得
    const otp = await getOtpForEmail(env.DB, email);
    expect(otp).toMatch(/^\d{6}$/);

    // 3. OTP でサインイン
    const signInRes = await app.request(
      "/api/auth/sign-in/email-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp }),
      },
      testEnv,
    );
    expect(signInRes.status).toBe(200);
    const cookie = signInRes.headers.get("set-cookie");
    expect(cookie).toContain("better-auth.session_token");

    // 4. cookie 付きで /v1/me が取れる
    const meRes = await app.request(
      "/v1/me",
      { headers: { cookie: cookie ?? "" } },
      testEnv,
    );
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as {
      email: string;
      role: string;
    };
    expect(me.email).toBe(email);
    expect(me.role).toBe("user");
  });

  it("通常 user は /admin/v1/users で 403", async () => {
    const { default: app } = await import("../src/index");
    const testEnv = {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env;
    const email = "bob@example.com";

    // サインアップ → サインイン
    await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, type: "sign-in" }),
      },
      testEnv,
    );
    const otp = await getOtpForEmail(env.DB, email);
    const signInRes = await app.request(
      "/api/auth/sign-in/email-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp }),
      },
      testEnv,
    );
    expect(signInRes.status).toBe(200);
    const cookie = signInRes.headers.get("set-cookie") ?? "";

    // /admin/v1/users は role=user なので 403
    const adminRes = await app.request(
      "/admin/v1/users",
      { headers: { cookie } },
      testEnv,
    );
    expect(adminRes.status).toBe(403);
  });

  it("role='admin' に昇格した user は /admin/v1/users で 200", async () => {
    const { default: app } = await import("../src/index");
    const testEnv = {
      DB: env.DB,
      ENVIRONMENT: "development",
    } as Cloudflare.Env;
    const email = "carol@example.com";

    // サインアップ → サインイン
    await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, type: "sign-in" }),
      },
      testEnv,
    );
    const otp = await getOtpForEmail(env.DB, email);
    const signInRes = await app.request(
      "/api/auth/sign-in/email-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp }),
      },
      testEnv,
    );
    expect(signInRes.status).toBe(200);
    const cookie = signInRes.headers.get("set-cookie") ?? "";
    const signInBody = (await signInRes.json()) as { user: { id: string } };

    // DB で role を admin に更新
    await env.DB.prepare("UPDATE user SET role = 'admin' WHERE id = ?")
      .bind(signInBody.user.id)
      .run();

    // /admin/v1/users が 200 で users 配列を返す
    const adminRes = await app.request(
      "/admin/v1/users",
      { headers: { cookie } },
      testEnv,
    );
    expect(adminRes.status).toBe(200);
    const body = (await adminRes.json()) as {
      users: Array<{ id: string; email: string; role: string }>;
    };
    expect(body.users.length).toBeGreaterThanOrEqual(1);
    const me = body.users.find((u) => u.id === signInBody.user.id);
    expect(me).toBeDefined();
    expect(me?.email).toBe(email);
    expect(me?.role).toBe("admin");
  });
});
