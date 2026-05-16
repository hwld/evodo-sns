import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";

// vitest.config.ts の miniflare.bindings.TEST_MIGRATIONS で注入される
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
