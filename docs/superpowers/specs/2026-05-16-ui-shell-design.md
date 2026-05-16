# UI シェル設計

このドキュメントは `apps/web` と `apps/admin` に **shadcn/ui ベースのアプリシェル**を導入する設計。
全体設計は `2026-05-09-initial-design.md`、認証設計は `2026-05-11-auth-design.md` を参照。

## 目次

1. スコープと前提
2. shadcn セットアップ
3. レイアウト構造
4. ファイル構成
5. コンポーネント仕様
6. ダークモード対応
7. 動作確認
8. 拡張候補

---

## 1. スコープと前提

### 含めるもの

- 各 app（`apps/web` / `apps/admin`）への shadcn/ui 導入（Base UI 版、Mira スタイル）
- `__root.tsx` のレイアウト構造
- アプリヘッダー（共通）と admin のサイドバー
- 最低限の shadcn コンポーネント（Button / Avatar / DropdownMenu、admin のみ Sidebar）
- ダークモード対応（Light / Dark / System の 3 値、TanStack Start ネイティブな ScriptOnce 方式）
- 動作確認用の placeholder ページ

### 含めないもの（別 spec / plan）

- 認証 / Better Auth クライアントの組み込み
- API クライアント（orval 生成）
- 実機能ページ（タイムライン、投稿一覧、ユーザー管理など）
- `packages/` への UI 共通化（設計上「重複が痛くなってから」で OK）
- shared な design tokens の切り出し
- アクセシビリティの本格対応（shadcn / Base UI のデフォルト範囲を超える追加対応）

### 前提（`2026-05-09-initial-design.md` から継承）

- `apps/web` は TanStack Start SSR モード
- `apps/admin` は TanStack Start SPA モード
- shadcn コンポーネントは **各 app に直置き**、`packages/` には切り出さない
- 設計の `3. 技術選定` 通り Tailwind CSS v4、Lucide React、TanStack Router を採用

---

## 2. shadcn セットアップ

### CLI 実行

各 app のディレクトリで:

```bash
cd apps/web
pnpm dlx shadcn@latest init --base base
cd ../admin
pnpm dlx shadcn@latest init --base base
```

### `components.json` の設定値（両 app 共通）

| key            | value     | 備考                                                                              |
| -------------- | --------- | --------------------------------------------------------------------------------- |
| `style`        | `mira`    | コンパクト・productivity 寄り、TODO ベース SNS にフィット                         |
| `baseColor`    | `neutral` | 後で `globals.css` の HSL を tweak すれば全体に伝播                               |
| `cssVariables` | `true`    | `:root` と `.dark` の両方のテーマ変数が生成される                                 |
| `iconLibrary`  | `lucide`  | catalog 既定の lucide-react を使う                                                |
| `--base`       | `base`    | shadcn 4.7 から Base UI primitives に対応。`@base-ui-components/react@1.0.0-rc.0` |

### 追加するコンポーネント

| app   | コンポーネント                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------- |
| web   | `button`, `avatar`, `dropdown-menu`                                                                   |
| admin | `button`, `avatar`, `dropdown-menu`, `sidebar`（依存して `sheet` / `separator` / `tooltip` 等も入る） |

```bash
# 両 app 共通
pnpm dlx shadcn@latest add button avatar dropdown-menu

# admin のみ
pnpm dlx shadcn@latest add sidebar
```

---

## 3. レイアウト構造

### apps/web — ヘッダー + メイン

```
┌────────────────────────────────────────┐
│ AppHeader (evodo + theme toggle + user)│
├────────────────────────────────────────┤
│                                        │
│  main (Outlet)                         │
│                                        │
└────────────────────────────────────────┘
```

将来的に 3-column レイアウト（左=ナビ、中=タイムライン、右=自分のタスク）に進化する想定だが、シェル段階では単一カラムのみ。

### apps/admin — サイドバー + ヘッダー + メイン

```
┌──────────┬───────────────────────────────┐
│          │ AppHeader (sidebar trigger +  │
│          │ evodo admin + theme + user)   │
│ Sidebar  ├───────────────────────────────┤
│          │                               │
│ - Dashboard                              │
│ - Users  │   main (Outlet)               │
│ - Posts  │                               │
│          │                               │
└──────────┴───────────────────────────────┘
```

shadcn の `Sidebar` プリミティブを採用。モバイル幅では SidebarTrigger でドロワー開閉。

---

## 4. ファイル構成

```
apps/web/
├── components.json                # shadcn 設定
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn の生成物
│   │   │   ├── button.tsx
│   │   │   ├── avatar.tsx
│   │   │   └── dropdown-menu.tsx
│   │   ├── app-header.tsx         # NEW
│   │   ├── theme-provider.tsx     # NEW
│   │   └── mode-toggle.tsx        # NEW
│   ├── lib/
│   │   └── utils.ts               # shadcn の cn ユーティリティ
│   ├── routes/
│   │   ├── __root.tsx             # MODIFY: ThemeProvider + AppHeader + Outlet
│   │   └── index.tsx              # MODIFY: placeholder コンテンツ
│   └── styles.css                 # MODIFY: shadcn の Tailwind 変数 + Mira スタイル
```

```
apps/admin/
├── components.json
├── src/
│   ├── components/
│   │   ├── ui/
│   │   │   ├── button.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── sidebar.tsx
│   │   │   ├── sheet.tsx
│   │   │   ├── separator.tsx
│   │   │   └── tooltip.tsx
│   │   ├── app-header.tsx         # NEW
│   │   ├── app-sidebar.tsx        # NEW
│   │   ├── theme-provider.tsx     # NEW
│   │   └── mode-toggle.tsx        # NEW
│   ├── lib/
│   │   └── utils.ts
│   ├── routes/
│   │   ├── __root.tsx             # MODIFY: ThemeProvider + SidebarProvider + ...
│   │   └── index.tsx              # MODIFY
│   └── styles.css                 # MODIFY
```

`theme-provider.tsx` と `mode-toggle.tsx` の中身は **両 app で完全同一**だが、コピペで持つ（spec の「shadcn 直置き、共通化は痛くなってから」方針に沿う）。

---

## 5. コンポーネント仕様

### AppHeader

両 app に置く。実装は別だが構造は近い。

**apps/web/components/app-header.tsx**:

- 左: `evodo` ブランディング（`<Link to="/">` でホームへ）
- 右: `<ModeToggle />` + ユーザーメニュー placeholder（`Avatar` + `DropdownMenu`、メニュー中身は `Sign in` のみ）

**apps/admin/components/app-header.tsx**:

- 左: `SidebarTrigger`（モバイル時用）+ `evodo admin` 表記
- 右: `<ModeToggle />` + ユーザーメニュー placeholder（中身同じ、`Sign in` のみ）

ユーザーメニューはまだ認証無しなので、`Avatar` のフォールバック（`?` または `U` の頭文字）を表示するのみ。

### AppSidebar（admin のみ）

shadcn の `Sidebar` プリミティブを使う:

```tsx
<Sidebar>
  <SidebarHeader>
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" asChild>
          <Link to="/">
            <span>evodo admin</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarHeader>
  <SidebarContent>
    <SidebarGroup>
      <SidebarGroupLabel>運用</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Dashboard / Users / Posts のリンク。href は "#" placeholder */}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  </SidebarContent>
</Sidebar>
```

メニュー項目（v1 では全部 placeholder）:

- `Dashboard`（home アイコン）
- `Users`（users アイコン）
- `Posts`（file-text アイコン）

active route のハイライトは TanStack Router の `<Link>` の active 状態を `data-active` 等で拾う。

### ThemeProvider

shadcn の TanStack Start 用ガイド（`apps/v4/content/docs/dark-mode/tanstack-start.mdx`）をそのまま採用。要点:

- `@tanstack/react-router` の `ScriptOnce` で hydration 前にテーマ適用スクリプトを実行
- light / dark / system の 3 値、localStorage `"theme"` キーで永続化
- system 選択時は `matchMedia('(prefers-color-scheme: dark)')` の変更を購読
- ~100 行、外部 lib 不要

### ModeToggle

3 値の DropdownMenu:

- Light（`<Sun>` アイコン、回転アニメーション）
- Dark（`<Moon>` アイコン、回転アニメーション）
- System

shadcn の TanStack Start ガイドの mode-toggle.tsx をそのままコピー。

### \_\_root.tsx の構造

**apps/web/src/routes/\_\_root.tsx**:

```tsx
<html lang="ja" suppressHydrationWarning>
  <head>
    <HeadContent />
  </head>
  <body>
    <ThemeProvider defaultTheme="system" storageKey="theme">
      <AppHeader />
      <main className="container mx-auto p-4">
        <Outlet />
      </main>
    </ThemeProvider>
    <Scripts />
  </body>
</html>
```

**apps/admin/src/routes/\_\_root.tsx**:

```tsx
<html lang="ja" suppressHydrationWarning>
  <head>
    <HeadContent />
  </head>
  <body>
    <ThemeProvider defaultTheme="system" storageKey="theme">
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <main className="p-4">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
    <Scripts />
  </body>
</html>
```

### index.tsx の中身

両 app とも、シェルが見えていることを確認する用の placeholder:

```tsx
export const Route = createFileRoute("/")({
  component: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">evodo</h1>
      <p className="text-muted-foreground">
        1 投稿 = 1 TODO リスト の SNS（実装中）
      </p>
    </div>
  ),
});
```

admin 側は `evodo admin` / 「管理画面のシェル」など適宜変更。

---

## 6. ダークモード対応

### 方針: shadcn の TanStack Start 公式パターンに準拠

外部 lib（next-themes 等）は使わず、`@tanstack/react-router` の `ScriptOnce` を利用した自前 ThemeProvider。

理由:

- shadcn の `tanstack-start.mdx` がこの方式を採用
- TanStack Start ネイティブな API（ScriptOnce）で SSR の FOUC をクリーンに防げる
- 外部依存ゼロ
- next-themes でも動く可能性はあるが、shadcn 用意のサンプルコードをコピペできる方が確実 & 検証コストゼロ

### 実装ポイント

- `<html suppressHydrationWarning>` を `__root.tsx` で付ける（next-themes と同じ理由）
- `defaultTheme="system"`、`storageKey="theme"`
- `ScriptOnce` は hydration の **直前**に走る、`document.documentElement.classList.add(...)` で `<html>` にクラスを設定
- React state は mounted 後に localStorage の値で同期、その後の操作で setTheme → localStorage 書き込み + html クラス更新

### 動作

- 初回訪問: OS の `prefers-color-scheme` に従う
- ユーザー操作（ModeToggle）: 選択値を localStorage に書き、html クラスを即時切り替え
- OS のテーマ設定変更: `theme === "system"` のときだけ追従する

---

## 7. 動作確認

### `pnpm run dev` で両 app 起動

- `apps/web` → `http://localhost:3000`
  - ヘッダーに `evodo` + ModeToggle + Avatar が表示される
  - main 領域に placeholder テキスト
  - ModeToggle で Light / Dark / System を切り替えると即時にテーマが変わる
  - リロード時に flash が起きない（SSR）
- `apps/admin` → `http://localhost:3001`
  - 左サイドバーに `evodo admin` ヘッダー + Dashboard / Users / Posts のメニュー
  - 上部ヘッダーに SidebarTrigger + 右側 ModeToggle + Avatar
  - サイドバー項目は href が `#` なのでクリックしてもページ遷移しない（v1 では OK）
  - モバイル幅で SidebarTrigger を押すとドロワーが開く
  - ダークモード切り替え動作確認

### typecheck / lint

- `pnpm typecheck` 通過
- `pnpm lint` 通過

### スクリーンショット等

不要。目視確認のみ。

---

## 8. 拡張候補

このシェルの上に積み上げる将来作業:

| 候補                                | 内容                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **認証クライアント組み込み**        | Better Auth の `createAuthClient` + `useSession`、ヘッダーのユーザーメニューを実装、apps/web のログインページ、apps/admin のガード |
| **API クライアント**                | orval を `/v1/openapi.json` / `/admin/v1/openapi.json` に向けて hooks 生成、各 app の `src/api-client/` に配置                     |
| **apps/web の 3-column レイアウト** | 左ナビ / 中タイムライン / 右タスク。route 単位での layout 適用                                                                     |
| **admin の実機能ページ**            | Users 一覧、BAN、Posts モデレーション                                                                                              |
| **shared design tokens**            | `--primary` 等の値を `packages/ui-tokens` で共通化（重複が痛くなってから）                                                         |
| **Tailwind theme のカスタマイズ**   | Mira ベースから色・角丸・フォントを evodo ブランドに寄せる                                                                         |
| **アクセシビリティの本格対応**      | フォーカスインジケータ、ランドマーク、スキップリンク等                                                                             |

---

## 関連ドキュメント

- `docs/superpowers/specs/2026-05-09-initial-design.md` — 全体設計
- `docs/superpowers/specs/2026-05-11-auth-design.md` — 認証設計
- shadcn TanStack Start ダークモードガイド: `~/work/clone/shadcn-ui/apps/v4/content/docs/dark-mode/tanstack-start.mdx`
- shadcn CLI v4 changelog（`--base` フラグ、`--preset` 等）: `~/work/clone/shadcn-ui/apps/v4/content/docs/changelog/2026-03-cli-v4.mdx`
