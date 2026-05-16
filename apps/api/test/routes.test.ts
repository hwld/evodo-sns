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
