// Better Auth CLI（`better-auth generate` / `better-auth migrate`）専用。
// CLI が `auth` という静的 export を要求するが、Workers ランタイムでは
// D1 binding を module load 時に取れないため、ダミー env で `createAuth` を呼ぶ。
//
// このファイルは runtime からは絶対に import しない。スキーマ生成のときだけ:
//   pnpm exec better-auth generate --output src/db/schema.ts --config src/auth.cli.ts --yes
import { createAuth } from "./auth";

export const auth = createAuth({
  DB: {} as D1Database,
  ENVIRONMENT: "development",
});
