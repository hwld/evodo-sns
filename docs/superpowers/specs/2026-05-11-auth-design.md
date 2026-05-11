# evodo-sns 認証設計

このドキュメントは evodo-sns の **認証・認可まわりの実装仕様**。
全体設計は `2026-05-09-initial-design.md` を参照し、本書はその `7. 認証認可` セクションの詳細化として位置づける。

## 目次

1. スコープと前提
2. 認証手段の選定
3. Better Auth プラグイン構成
4. アカウントモデル
5. サインアップ / サインイン フロー
6. ログイン UI の配置
7. admin の境界
8. Cookie / セッション ポリシー
9. Cross-subdomain と Safari ITP 対策
10. Passkey 設定
11. メール送信インフラ
12. 環境変数とシークレット
13. 開発フロー（CLI とスキーマ生成）
14. 拡張候補

---

## 1. スコープと前提

### 含めるもの

- 認証手段の選定理由
- Better Auth の構成（プラグイン、`additionalFields`、設定値）
- ユーザー登録 / ログイン / ログアウトのフロー
- admin 認可境界の設計
- Cookie / セッションのポリシー
- Cross-subdomain での運用
- Passkey の rpID 等の設定
- メール送信（Resend 採用、dev のモック）
- 開発フロー（CLI、スキーマ生成、マイグレーション）

### 含めないもの

- API エンドポイント全体の設計（別 spec）
- フロントエンドの UI モックや具体的な画面遷移（必要になれば別 spec）
- ドメイン機能の RBAC（v1 では `role: user | admin` の 2 階層のみ）

### 前提（`2026-05-09-initial-design.md` から継承）

- 3 Worker 構成（apps/web, apps/admin, apps/api）
- D1（SQLite）+ Drizzle ORM
- Better Auth（cookie ベース）
- サブドメイン: `app.evodo.hwld.dev` / `admin.evodo.hwld.dev` / `api.evodo.hwld.dev`

---

## 2. 認証手段の選定

### 採用：Email OTP + Passkey（パスワードレス）

| 手段               | 役割                                                  |
| ------------------ | ----------------------------------------------------- |
| Email OTP          | 初回登録、passkey 紛失時の復旧、メールで本人確認      |
| Passkey (WebAuthn) | 通常ログインのメイン手段。生体認証 / セキュリティキー |

**`emailAndPassword` プラグインは使わない**。パスワードを DB に持たない。

### SNS としての設計上の合理性

Mastodon / Discourse / Forem / Lemmy などの SNS 系 OSS は全て「ログイン UI 1 つ + role による認可」で組まれている（調査結果より）。同じ路線を取る。

---

## 3. Better Auth プラグイン構成

### 採用するプラグイン

| プラグイン   | パッケージ             | 役割                                                |
| ------------ | ---------------------- | --------------------------------------------------- |
| `passkey()`  | `@better-auth/passkey` | WebAuthn / passkey 認証                             |
| `emailOTP()` | `better-auth/plugins`  | メール OTP による登録 / ログイン                    |
| `username()` | `better-auth/plugins`  | ハンドル（unique なユーザー名）の管理               |
| `admin()`    | `better-auth/plugins`  | admin 機能（role / BAN / impersonate / list / ...） |

### 採用する設定値（要点）

```ts
betterAuth({
  baseURL: <env で導出>,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "sqlite" }),
  advanced: {
    crossSubDomainCookies: { enabled: true },
  },
  user: {
    additionalFields: {
      bio: { type: "string", required: false },
    },
  },
  trustedOrigins: [...],
  plugins: [
    passkey({ rpID: "evodo.hwld.dev", rpName: "evodo" }),
    emailOTP({ async sendVerificationOTP({ email, otp, type }) { ... } }),
    username({ minUsernameLength: 3, maxUsernameLength: 30 }),
    admin({ adminUserIds: env.ADMIN_USER_IDS?.split(",") ?? [] }),
  ],
})
```

`role` カラムは `admin()` プラグインが追加するため、`additionalFields` には書かない。

---

## 4. アカウントモデル

### テーブル構成（Better Auth が生成）

| テーブル       | 由来                | 主要カラム                                                                                                                                                                                                          |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`         | core + plugins      | `id`, `email`, `emailVerified`, `name`, `image`, `createdAt`, `updatedAt` + `username`, `displayUsername` (username plugin) + `role`, `banned`, `banReason`, `banExpires` (admin plugin) + `bio` (additionalFields) |
| `session`      | core + admin plugin | `id`, `token`, `userId`, `expiresAt`, `ipAddress`, `userAgent`, `createdAt`, `updatedAt` + `impersonatedBy` (admin plugin)                                                                                          |
| `account`      | core                | `id`, `userId`, `accountId`, `providerId`, `createdAt`, `updatedAt` ほか（password 列は使わない）                                                                                                                   |
| `verification` | core                | `id`, `identifier`, `value`, `expiresAt`. OTP コードもここに格納                                                                                                                                                    |
| `passkey`      | passkey plugin      | `id`, `userId`, `publicKey`, `credentialID`, `counter`, `deviceType`, `backedUp`, `transports`, `aaguid`                                                                                                            |

### `username` の意味論

- `username`（unique, lowercase 正規化）: URL パスや @mention に使う ASCII 識別子（例: `hwld`）
- `displayUsername`（case-preserved）: プロフィール表示用（例: `Hwld`）
- バリデーション: 英数字 + `_` + `.`、3-30 文字（Better Auth の username プラグインのデフォルト）
- 変更可能だが、SNS 文化では頻繁な変更を許容しない方針（v1 では制限せず、将来的に「過去 X 日に変更してたら不可」のような制約検討）

### `role` の意味論

- `user`（デフォルト）: 一般利用者。投稿、コメント、Cheer、フォロー
- `admin`: 全ユーザー閲覧、BAN、impersonate、ユーザー削除等の管理操作
- `additionalFields` ではなく `admin()` プラグインが提供する `role` カラムを使う
- `adminUserIds` 環境変数による上書き機構が `admin()` プラグインに組み込まれている（DB の role を見ずに常に admin 扱いする user.id リスト）

### `banned` の意味論（admin プラグイン由来）

- `banned: true` のユーザーは Better Auth がサインインを拒否
- `banReason`: BAN 理由（admin が記録）
- `banExpires`: 期限付き BAN（`null` で永久）
- `bannedUserMessage`: ログイン拒否時に表示するメッセージ（Better Auth の設定）

---

## 5. サインアップ / サインイン フロー

### サインアップ（初回登録）

```
1. ユーザーが app.evodo.hwld.dev/login にアクセス
2. メールアドレスを入力 → 「OTP を送信」
3. サーバ: User がまだ存在しないので「サインアップ扱い」として OTP 発行
   - dev: console.log → tmp/dev.log に出力
   - prod: Resend API でメール送信
4. ユーザーがメールから 6 桁 OTP を取得し、画面に入力
5. サーバ:
   - User レコードを作成（emailVerified: true、role: "user"）
   - Session 発行
   - cookie セット
6. クライアント: handle 入力画面（onboarding）にリダイレクト
   - username が未設定なので、ユーザーが入力
   - /is-username-available で重複チェック
   - updateUser で username をセット
7. handle 設定後、passkey 登録を促す（任意 / 強く推奨）
   - addPasskey() で passkey を登録
   - 以降のログインは passkey で 1 タップ
```

### サインイン（2 回目以降）

```
[Passkey でのログイン (デフォルト)]
1. app.evodo.hwld.dev/login にアクセス
2. autoFill 対応のメール入力フィールドに passkey の autofill が出る
3. クリック → 生体認証 → ログイン完了

[OTP でのログイン (passkey 紛失時のフォールバック)]
1. app.evodo.hwld.dev/login で「Passkey が使えない」リンクをクリック
2. メール入力 → OTP 送信
3. OTP 入力 → ログイン完了
4. ログイン後、新しい passkey の登録を強く促す
```

### サインアウト

- `authClient.signOut()` で session を破棄、cookie をクリア
- 全デバイスログアウト（admin が他人のセッションを切る）は `admin()` プラグインの `revokeAllSessions` を使用

### 退会

- v1 では UI 提供無し
- 必要になれば admin プラグインの `removeUser` を経由する自セルフ退会フローを追加（Post / Comment / Cheer / Follow の整合性は cascade delete でカバー）

---

## 6. ログイン UI の配置

### 採用：apps/web のみがログイン UI を持つ

```
app.evodo.hwld.dev/login            ← ログイン UI（OTP / passkey 入力）
app.evodo.hwld.dev/signup           ← app.evodo.hwld.dev/login と統合する想定（差別化しない）
app.evodo.hwld.dev/onboarding       ← 初回 handle 入力画面
admin.evodo.hwld.dev                 ← ログイン UI を持たない（後述）
```

### admin の挙動

```
1. ユーザーが admin.evodo.hwld.dev/* にアクセス
2. apps/admin が getSession でセッションを確認
3a. セッション無し → app.evodo.hwld.dev/login?redirect=https://admin.evodo.hwld.dev/... にリダイレクト
3b. セッション有り、role !== "admin" → app.evodo.hwld.dev/ にリダイレクト（403 メッセージ表示）
3c. セッション有り、role === "admin" → admin 画面表示
4. admin で何かを操作 → apps/api の /admin/v1/* にリクエスト
5. apps/api 側 middleware で role=admin を二重チェック（フロント側ガードはあくまで UX 用）
```

### この設計の根拠

調査結果（`2026-05-10` の OSS / 業界サーベイ）より:

- Mastodon / Discourse / Forem / Lemmy / Outline / Plane / Cal.com / Plausible — いずれも単一ログイン UI + role gate
- 「分離した admin ログイン」を採用してるのは Ghost のみで、これは「staff vs members が別プロダクト」という特殊事情
- AWS root vs IAM のような完全分離は、コンプライアンス / 億単位の損害が出る環境向け
- evodo-sns（学習プロジェクト、admin 1 名、SNS）の規模では Mastodon と同じ路線が最適

---

## 7. admin の境界

### 二段の認可ガード

```
[フロント側ガード（UX 用）]
apps/admin の TanStack Router beforeLoad で getSession → role を確認
  - 無ければ web にリダイレクト

[サーバ側ガード（本物の境界）]
apps/api の /admin/v1/* に middleware
  - cookie からセッション復元
  - user.role !== "admin" なら 403
  - banned なら 401
```

サーバ側ガードがホンモノ。フロント側ガードはバイパス可能なので過信しない。

---

## 8. Cookie / セッション ポリシー

### 設定値

| 設定                  | 値                                 | 備考                                                                                                                       |
| --------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `session.expiresIn`   | **365 日（1 年）**                 | Mastodon の `remember_for: 1.year` に倣う。SNS は長期ログイン維持が UX 標準（Discourse 60 日、Forem 26 週、Mastodon 1 年） |
| `session.updateAge`   | **1 日**（Better Auth デフォルト） | アクティブなユーザーは 1 日活動するたびに expiry が `now + 365日` にリフレッシュ（rolling）                                |
| `session.cookieCache` | **無効**（Better Auth デフォルト） | リクエスト毎に DB lookup。性能問題が出るまで触らない                                                                       |
| Cookie `httpOnly`     | true                               | XSS 対策                                                                                                                   |
| Cookie `secure`       | true（production）                 | HTTPS のみ送信                                                                                                             |
| Cookie `sameSite`     | `"lax"`                            | CSRF 対策。subdomain 共有なので `"lax"` で十分                                                                             |
| Cookie domain         | `.evodo.hwld.dev`                  | subdomain 共有のため                                                                                                       |
| Cookie prefix         | `"evodo"`                          | デフォルトの `"better-auth"` から変更                                                                                      |

```ts
session: {
  expiresIn: 60 * 60 * 24 * 365, // 365 days
  updateAge: 60 * 60 * 24,       // 1 day
}
```

### Session の revoke

- 自分のセッション: `signOut()` で破棄
- 他人のセッション: `admin()` プラグインの `revokeUserSession` / `revokeUserSessions`
- 全セッション一括破棄: `session.cookieCache.version` を上げて再デプロイ（cookieCache 有効時のみ）

---

## 9. Cross-subdomain と Safari ITP 対策

### 設定

```ts
advanced: {
  crossSubDomainCookies: { enabled: true },
  // domain 自動設定。明示する場合は ".evodo.hwld.dev"
},
trustedOrigins: [
  // production
  "https://app.evodo.hwld.dev",
  "https://admin.evodo.hwld.dev",
  // development
  "http://localhost:3000",
  "http://localhost:3001",
],
```

### Safari ITP の対策

Safari の Intelligent Tracking Prevention は、`app.evodo.hwld.dev` から `api.evodo.hwld.dev` への `credentials: "include"` リクエストを **third-party 扱い**して cookie を落とすことがある（同じ親ドメインでも）。

**対策**: `apps/web` と `apps/admin` の Worker で `/api/auth/*` を `apps/api` に reverse proxy する。

```
[ユーザーから見ると]
fetch("/api/auth/sign-in/email-otp")  ← 同一オリジン

[実際の処理]
app.evodo.hwld.dev/api/auth/* (apps/web Worker)
  → fetch を api.evodo.hwld.dev に転送（または直接ルーティング）
  → cookie は app.evodo.hwld.dev が一手に管理（ITP に first-party と認識される）
```

この proxy は Workers のルーティング設定で完結し、app.evodo.hwld.dev/api/auth/\* と admin.evodo.hwld.dev/api/auth/\* の両方が必要。
詳細は `2026-05-09-initial-design.md` の `9. 環境とサブドメイン構成` の運用に追記する。

---

## 10. Passkey 設定

### 設定

```ts
passkey({
  rpID: "evodo.hwld.dev",
  rpName: "evodo",
  authenticatorSelection: {
    residentKey: "preferred",
    userVerification: "preferred",
    // authenticatorAttachment は未指定（platform / cross-platform 両方を許容）
  },
});
```

### `rpID` を親ドメインにする理由

`rpID` は WebAuthn の Relying Party Identifier。passkey は登録時の `rpID` でスコープされる。

- `rpID = "evodo.hwld.dev"` → apps / admin / api 全部で使える 1 つの passkey
- `rpID = "app.evodo.hwld.dev"` → web 専用の passkey、admin で使えない

我々は subdomain 跨いで使い回したいので **親ドメインにする**。

### Conditional UI（autoFill）

ログイン画面のメール入力欄に passkey の自動補完を出す:

```html
<input autocomplete="username webauthn" />
```

```ts
useEffect(() => {
  if (PublicKeyCredential.isConditionalMediationAvailable?.()) {
    authClient.signIn.passkey({ autoFill: true });
  }
}, []);
```

### 複数 passkey 登録

- ユーザーは 2 つ以上の passkey を登録可能（Better Auth の `passkey` テーブルは複数行を許容）
- v1 では UI で「セキュリティキー / デバイスを追加」を提供
- 推奨: 「**普段使うデバイスとは別に、もう 1 つどこかに passkey を登録してください**」とオンボーディングで案内（紛失リカバリ用）

---

## 11. メール送信インフラ

### Production: Resend

| 項目           | 値                                                                              |
| -------------- | ------------------------------------------------------------------------------- |
| 送信元ドメイン | `evodo.hwld.dev`（または `mail.evodo.hwld.dev`、後者なら apex 評価分離可）      |
| 送信元アドレス | `noreply@evodo.hwld.dev`                                                        |
| API 経由       | `https://api.resend.com/emails` を Workers から fetch                           |
| API key        | `RESEND_API_KEY`（Workers secret）                                              |
| DNS            | Cloudflare DNS に SPF / DKIM レコードを追加。DMARC は `p=none` から開始して観測 |

### Development: console.log

```ts
emailOTP({
  async sendVerificationOTP({ email, otp, type }) {
    if (env.ENVIRONMENT === "development") {
      console.log(`[OTP] type=${type} email=${email} code=${otp}`);
      return;
    }
    await sendViaResend({ to: email, otp, type });
  },
});
```

OTP は `tmp/dev.log` から `grep '\[OTP\]'` で拾う。

### 業界標準を踏襲（dev での logging）

Django / Laravel / Rails / Auth.js / Supabase いずれも「dev では console / log にメール内容を吐く」を built-in 対応。我々もこれに従う。production で console.log するのは厳禁（OTP がログに永続化されるため）。

---

## 12. 環境変数とシークレット

### 必須

| 名前                 | 種類                      | 用途                       |
| -------------------- | ------------------------- | -------------------------- |
| `BETTER_AUTH_SECRET` | secret                    | session 署名 / cookie 署名 |
| `RESEND_API_KEY`     | secret（production のみ） | メール送信 API             |

### 設定

| 名前              | 種類                   | 用途                            | 値                               |
| ----------------- | ---------------------- | ------------------------------- | -------------------------------- |
| `ENVIRONMENT`     | var                    | 環境分岐                        | `"development"` / `"production"` |
| `BETTER_AUTH_URL` | var（任意）            | baseURL の上書き                | 通常は ENVIRONMENT から自動導出  |
| `ADMIN_USER_IDS`  | secret（カンマ区切り） | admin として扱う user.id リスト | 例: `<user_id_1>,<user_id_2>`    |

### 設定方法

```bash
# secret
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put ADMIN_USER_IDS

# 開発時
echo 'BETTER_AUTH_SECRET=...' >> apps/api/.dev.vars
echo 'ADMIN_USER_IDS=...' >> apps/api/.dev.vars
```

`.dev.vars.example` をリポジトリに含めて、必要な変数を明示する。

---

## 13. 開発フロー（CLI とスキーマ生成）

### ファイル分離

| ファイル                    | 役割                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `apps/api/src/auth.ts`      | runtime 用。`createAuth(env)` factory のみ                                 |
| `apps/api/src/auth.cli.ts`  | Better Auth CLI 用スタブ。`createAuth` をダミー env で呼んで static export |
| `apps/api/src/db/schema.ts` | Drizzle schema（`auth generate` の出力）                                   |

### スキーマ再生成が必要なタイミング

- Better Auth プラグインを追加 / 削除した
- `additionalFields` を編集した
- Better Auth のメジャーバージョンを上げて core schema が変わった

### 再生成コマンド

```bash
cd apps/api
pnpm exec better-auth generate --output src/db/schema.ts --config src/auth.cli.ts --yes
pnpm exec drizzle-kit generate
pnpm exec wrangler d1 migrations apply evodo-db --local
```

`package.json` への script 化はしない（頻度が低く、覚えれば十分）。

### `auth.cli.ts` が必要な理由

Better Auth CLI は `auth` という名前の static export を要求する。Workers ランタイムでは D1 binding が module load 時に存在せず env 経由でしか取れないため、`createAuth(env)` factory が runtime コードの正解になる。これが衝突するため、CLI 専用にダミー env で `createAuth` を呼んだスタブを別ファイルに隔離して使う。

`auth.ts` 自体は runtime 用に純粋に保つことで、誤って runtime コードがダミー env のスタブを使う事故を防ぐ。

---

## 14. 拡張候補

将来的に admin 機能が高リスク化したり、ユーザー規模が拡大したときに検討するもの。

### admin の権限強化

| 候補                           | 内容                                                                                            | きっかけ                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Sentry 流 elevation cookie** | `/admin/v1/destructive/*` への進入時に passkey 再認証 → 短期 cookie（4h max / 15 min idle）発行 | BAN や user 削除など破壊的操作を実装するとき                                  |
| **GitHub 流 sudo mode**        | session に「直近 X 分以内に再認証」スタンプを乗せて、stepped-up auth を表現                     | 同上、より軽量に始めるなら                                                    |
| **Cloudflare Access 前段**     | admin.evodo.hwld.dev を Zero Trust ポリシーで保護                                               | 管理者が複数になり、コードレベルの防御以上に perimeter 防御が必要になったとき |

### 監査と運用

| 候補                             | 内容                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| **audit_log テーブル**           | 破壊的 admin 操作（BAN、削除、role 変更、impersonate）を全記録。SNS 系 OSS では universal な機構 |
| **admin 操作通知**               | 自分以外の admin が重大操作を行ったらメールで通知                                                |
| **`session.cookieCache` 有効化** | D1 read コストが問題になってから。`compact` 戦略推奨                                             |

### 認証手段の追加

| 候補                        | 内容                                                   |
| --------------------------- | ------------------------------------------------------ |
| **Magic Link**              | OTP コード入力に代わるリンクログイン。UX 向上          |
| **OIDC（Google / GitHub）** | サインアップのフリクション低減。学習目的とトレードオフ |
| **TOTP 2FA**                | パスワードレスでも、追加要素として欲しい場合           |

### その他

| 候補                                        | 内容                                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| **Better Auth `organization()` プラグイン** | グループ機能を入れるとき                                      |
| **RBAC（細かい権限）**                      | モデレーター（投稿削除可、user 管理不可）等の役割を増やすとき |
| **退会フロー**                              | self-service の account deletion                              |
| **メール変更フロー**                        | UI から email を変える機能。両方のメールに verify を要求      |
| **スパム対策（Turnstile）**                 | OTP 送信エンドポイントに Cloudflare Turnstile を当てる        |

---

## 関連ドキュメント

- `docs/superpowers/specs/2026-05-09-initial-design.md` — 全体設計（本書はその `7. 認証認可` の詳細）
- Better Auth 公式: <https://www.better-auth.com/docs>
- WebAuthn 仕様: <https://www.w3.org/TR/webauthn-3/>
- 調査結果（2026-05-10）: SNS 系 OSS の認証パターン調査 — Mastodon, Discourse, Forem, Lemmy ほか 13 システム
