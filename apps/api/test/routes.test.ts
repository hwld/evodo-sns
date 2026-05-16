import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../src/env";

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
