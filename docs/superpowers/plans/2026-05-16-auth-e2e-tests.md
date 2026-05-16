# 認証フロー E2E テスト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手動 E2E（Task 7）で確認していた認証フロー（OTP 送信 → サインイン → `/v1/me` 取得、`/admin/v1/users` 認可境界）を vitest で自動化する。

**Architecture:**

- request-level testing via Hono の `app.request()`（`@cloudflare/vitest-pool-workers` の `env` を渡す）
- OTP は D1 `verification` テーブルから plaintext で読み取る（`value` カラムが `<otp>:<attempts>` 形式で plaintext 保存されている）
- 各テスト前に DB の auth 関連テーブルをクリーン
- 既存の `apps/api/test/routes.test.ts` に `describe("auth e2e", ...)` ブロックを追加

**Tech Stack:** vitest + `@cloudflare/vitest-pool-workers` + Hono + Better Auth + Drizzle ORM

**スコープ外（別プラン）:**

- Passkey の E2E（WebAuthn fake authenticator が必要、`vi.mock("@simplewebauthn/server")` 等の別パターン）
- `banned` enforcement の middleware 化と関連テスト（spec §7 で deferred）
- フロント（apps/web）の E2E

---

## File Structure

```
apps/api/
├── test/
│   ├── apply-migrations.ts       # existing — マイグレーション setup file
│   ├── helpers.ts                # NEW — OTP 取得 / DB クリーンアップ helper
│   └── routes.test.ts            # MODIFY — auth e2e describe ブロック追加
```

**Design decisions:**

- ヘルパーは **1 ファイル** `test/helpers.ts` に集約（YAGNI）
- E2E テストは既存の `routes.test.ts` に追記（小規模なので分離不要）
- OTP 取得は **D1 から SQL で直接読む**（`vi.spyOn(console)` は workers の console を捕えにくく不安定）
- Better Auth 本家 (`packages/better-auth/src/plugins/email-otp/email-otp.test.ts`) は closure 変数捕獲方式だが、我々の構成では `createAuth(env)` を runtime で呼ぶため、テストから callback を注入しにくい。SQL 直読が一番素直
- DB クリーン は `beforeEach` で `DELETE FROM ...` を発行（`reset()` だとマイグレーションも消えるので不採用）

---

## Task 1: テストヘルパーを実装

**Files:**

- Create: `apps/api/test/helpers.ts`

このヘルパー単体はまだテストが書けない（依存される側）。Task 2 のテストで間接的に検証される。

- [ ] **Step 1: helpers.ts を作成**

`apps/api/test/helpers.ts`:

```ts
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";

import * as schema from "../src/db/schema";

/**
 * Better Auth の verification テーブルから、指定 email と type の最新 OTP を取得する。
 * Better Auth は `<otp>:<attempts>` 形式で plaintext 保存している。
 */
export const getOtpForEmail = async (
  db: D1Database,
  email: string,
  type: "sign-in" | "email-verification" | "forget-password" = "sign-in",
): Promise<string> => {
  const drz = drizzle(db, { schema });
  const row = await drz
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, `${type}-otp-${email}`))
    .orderBy(desc(schema.verification.createdAt))
    .limit(1)
    .get();
  if (!row) throw new Error(`no verification row for ${email}`);
  const otp = row.value.split(":")[0];
  if (!/^\d+$/.test(otp))
    throw new Error(`OTP value not numeric: ${row.value}`);
  return otp;
};

/**
 * 各テスト前に auth 系テーブルを空にする。
 * 外部キーがあるので子テーブルから削除する。
 */
export const cleanAuthTables = async (db: D1Database): Promise<void> => {
  await db.batch([
    db.prepare("DELETE FROM passkey"),
    db.prepare("DELETE FROM session"),
    db.prepare("DELETE FROM account"),
    db.prepare("DELETE FROM verification"),
    db.prepare("DELETE FROM user"),
  ]);
};
```

- [ ] **Step 2: typecheck で参照が解決することを確認**

Run: `cd apps/api && pnpm typecheck`
Expected: 通る（このタスクではまだ使われてないが、import エラーなし）

- [ ] **Step 3: lint も通すことを確認**

Run: `pnpm lint`
Expected: 通る

- [ ] **Step 4: commit**

```bash
git add apps/api/test/helpers.ts
git commit -m "$(cat <<'EOF'
test(api): 認証 E2E 用ヘルパー（OTP 取得 / DB クリーン）を追加

Better Auth の verification テーブルから OTP を plaintext で取得する
getOtpForEmail と、各テスト前に auth 系テーブルを空にする
cleanAuthTables を提供。後続の e2e テストで使用する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ハッピーパス E2E — OTP サインアップ → /v1/me 200

**Files:**

- Modify: `apps/api/test/routes.test.ts`

- [ ] **Step 1: routes.test.ts の末尾にテストを追加**

`apps/api/test/routes.test.ts` の末尾に追加:

```ts
import { beforeEach } from "vitest";

import { cleanAuthTables, getOtpForEmail } from "./helpers";

describe("auth e2e", () => {
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
});
```

- [ ] **Step 2: テストを走らせて通ることを確認**

Run: `cd apps/api && pnpm test --run`
Expected: PASS — 既存テスト 7 件 + 新規 e2e 1 件で **計 8 件 passing**

- [ ] **Step 3: typecheck + lint 確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 通る

- [ ] **Step 4: commit**

```bash
git add apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
test(api): 認証ハッピーパス E2E (OTP サインアップ → /v1/me 200) を追加

D1 verification テーブルから OTP を直接取得することで、メール送信を
モックすることなく実際のサインインフローを request-level で自動化。
beforeEach で auth 系テーブルをクリーンしてテスト間の干渉を防ぐ。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 認可境界 E2E — 通常 user は /admin/v1/users で 403

**Files:**

- Modify: `apps/api/test/routes.test.ts`

- [ ] **Step 1: 既存の `describe("auth e2e", ...)` ブロックの中にテストを追加**

Task 2 で作った `describe("auth e2e", ...)` の末尾（最後の `});` の直前）に追加:

```ts
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
  const cookie = signInRes.headers.get("set-cookie") ?? "";

  // /admin/v1/users は role=user なので 403
  const adminRes = await app.request(
    "/admin/v1/users",
    { headers: { cookie } },
    testEnv,
  );
  expect(adminRes.status).toBe(403);
});
```

- [ ] **Step 2: テストを走らせて通ることを確認**

Run: `pnpm test --run`
Expected: PASS — 計 9 件 passing

- [ ] **Step 3: typecheck + lint 確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 通る

- [ ] **Step 4: commit**

```bash
git add apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
test(api): 通常 user が /admin/v1/users にアクセスして 403 を E2E で検証

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: admin 昇格 E2E — role='admin' UPDATE 後に /admin/v1/users 200

**Files:**

- Modify: `apps/api/test/routes.test.ts`

- [ ] **Step 1: 既存の `describe("auth e2e", ...)` ブロックの末尾に追加**

```ts
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
```

- [ ] **Step 2: テストを走らせて通ることを確認**

Run: `pnpm test --run`
Expected: PASS — 計 10 件 passing

- [ ] **Step 3: typecheck + lint 確認**

Run: `pnpm typecheck && pnpm lint`
Expected: 通る

- [ ] **Step 4: commit**

```bash
git add apps/api/test/routes.test.ts
git commit -m "$(cat <<'EOF'
test(api): role='admin' 昇格後に /admin/v1/users が 200 を返すことを E2E で検証

SQL 直接更新で role を admin に変更すれば即座に admin 扱いになる
（session 中の user.role はリクエスト毎に DB から引き直されるため）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review メモ（プラン作成者向け）

- **Spec coverage:** Task 7（手動 E2E）の手順 1〜10 をすべてカバー
- **Placeholder:** なし
- **型整合性:** `getOtpForEmail` の戻り値は `string`、`cleanAuthTables` は `void` を返す Promise。全タスクで一貫
- **YAGNI:** Passkey や banned 系は別プランに送った。helpers.ts は 2 関数のみ
- **TDD:** 各タスクで「テストを書く → 走らせて通ることを確認 → typecheck/lint → commit」のサイクル。本プランでは「失敗するテストを書く」段階を省略（リファクタリング的でなく、新規機能ではないため）。仕様の自動化が目的なので赤緑サイクルは厳格に適用しない
- **副作用注意:**
  - `beforeEach` で auth 系テーブル全削除するので、`apply-migrations.ts` で適用されたスキーマは保たれるがデータは毎回空になる
  - 既存の 7 件のテストは `user` テーブル等を読み書きしないので、`describe("auth e2e", ...)` 内の `beforeEach` の影響は受けない（vitest の `beforeEach` は describe スコープ）
- **再現性:** OTP 取得を D1 から直読する方式は、Better Auth が verification table の保存形式を将来変更した場合に壊れる可能性あり。壊れた時の修正コストは小さい（helpers.ts 数行）
