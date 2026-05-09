# evodo-sns

## 初期設計

実装前の全体方針は `docs/superpowers/specs/2026-05-09-initial-design.md` を参照。
実装が落ち着いたら別途 `docs/architecture.md` を作る予定。

## Dev server logs

`pnpm run dev` のログは `tmp/dev.log` に追記される。
画面エラーやサーバー側エラーの調査時はまずこのファイルを `tail` / `grep` で確認する。

- 直近のログ: `tail -200 tmp/dev.log`
- エラーだけ抽出: `grep -i 'error\|warn' tmp/dev.log | tail -50`
