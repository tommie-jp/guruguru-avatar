# CLAUDE.md

このリポジトリ（ぐるぐるアバター本体）で作業するときのガイドです。

## 回答の言語

- ユーザーへの応答は**日本語**で書く（説明・要約・確認はすべて日本語）。
- コード・コマンド・識別子は原語のままでよい。

## プロジェクト概要

本プロジェクトの目的は tomari-guruguru を web カメラで顔の向きを推定し、tomari-guruguru の
顔の向きを同調させることです。

トマリぐるぐる / トマリトーク — マウスに追従して25方向に振り向き、音声に合わせて
口パク・まばたきするブラウザアバター。

- このディレクトリが**実体アプリ**（独立した git リポジトリ）。npm コマンドや `do*.sh` は
  すべてここで実行する。
- 技術スタック: Vite 8 + React 18 + @vitejs/plugin-react 6 / PixiJS（スプライト描画）/
  MediaPipe Tasks Vision（顔・手の推定）/ Vitest（テスト）/ ESLint（lint）。
- TODO・作業メモは外側 repo（親ディレクトリ `../`）の `README-ignore.md` を参照。
- 本プロジェクト: <https://github.com/tommie-jp/guruguru-avatar>
- フォーク元: <https://github.com/rotejin/tomari-guruguru>

## パッケージマネージャ

- **npm を使う**（`package-lock.json` で管理）。pnpm / yarn は使わない。
- Node.js は 20.19+ または 22.12+（22 LTS 推奨）。

## よく使うコマンド

### npm scripts

```bash
npm install              # 依存インストール
npm run dev              # 開発サーバー (127.0.0.1:5173)。WS 中継を同居するので npm run dev だけで tx/rx 可（別途 npm run relay は不要）
npm run build            # 本番ビルド (dist/ 出力。base=/guruguru-avatar/)
npm run build:local      # ローカル配信用ビルド (dist-local/ 出力。base=/)
npm run preview          # ビルド結果を確認 (127.0.0.1:4173/guruguru-avatar/)
npm run verify:pages     # GitHub Pages 向けビルドの検証
npm test                 # テスト実行 (Vitest, 1回)
npm run test:watch       # テスト watch
npm run lint             # ESLint
npm start                # dist-local を中継サーバ経由で配信 (server/relay.mjs --web-root dist-local)
npm run relay            # standalone WS 中継サーバ単体起動 (server/relay.mjs)
```

- `predev` / `prebuild` フックで `scripts/copy-mediapipe-assets.mjs` が走り、MediaPipe の
  wasm/モデルを `public/` へコピーする（手動なら `npm run setup:mediapipe`）。
- `npm run build:relay`（`:win` / `:linux` / `:macos`）は bun で中継サーバを単体実行ファイルに
  コンパイルし `dist-exe/` へ出力する（開発・特殊用途。配布は Electron に一本化済み）。
- `npm run dist:win`（NSIS+portable）/ `dist:linux`（AppImage）/ `dist:app`（両方）は
  electron-builder でデスクトップアプリを `dist-electron/` へ出力する。macOS 向けは
  配布しない（Web 版 か `npm start` を案内）。

### 補助スクリプト（`do*.sh`）

実作業はこれらのラッパー経由が多い。`-h` / `--help` で各 usage を表示できる。

| スクリプト | 役割 |
| --- | --- |
| `doStartDev.sh` | vite dev(5173) を起動。残プロセスでポートが埋まっていたら先に解放する |
| `doTest.sh` | テストを実行する（Vitest） |
| `doBuild.sh` | Electron アプリ（Windows NSIS+portable / Linux AppImage）を「ビルドするだけ」。AppImage 起動スモーク付き |
| `doDeploy.sh` | デプロイ/リリースのエントリポイント |
| `doServer.sh` | standalone・別マシン用の WS 中継サーバ（`server/relay.mjs`, 既定 :8787）を起動 |
| `doAvatarConfig.sh` | `assets/<id>/config.js`（`AVATAR_DEFS` 用オブジェクトリテラル）を生成 |
| `doAvatarConvert.sh` | 生5×5シート（A〜F.png/.webp）を camera が読む `slices2` 形式へ変換 |
| `doVerifySlice.sh` | 生成AIを使わず0円で `slice_character_sheets.py` の配管を検証する |
| `doVersionUp.sh` | バージョンを上げる（`package.json` / `package-lock.json` を更新） |
| `doGenGptImage.sh` | gpt-image でキャラ参照画像から A〜F(5×5)シートを生成する |
| `doGenPollinations.sh` | 無料 Pollinations で実生成→背景除去→slice を通す |

## 構成

### エントリ（Vite マルチエントリ）

- `index.html` — **カメラ版（主役）**。`src/camera-app.jsx`。Web カメラで顔の向き・口に同調し、
  PixiJS スプライトで描画。複数アバター選択に対応（旧 `camera2.html`）。
- `talk.html` — トーク版（`src/talk-app.jsx`。マイク／音声ファイルで口パク）。
- `guruguru.html` — ぐるぐる版（`src/app.jsx`。マウス追従で25方向に振り向く）。
- `tracking.html` — トラッキング版（`src/tracking-app.jsx`。手・体ポーズの可視化デモ）。
- `index_old.html` / `camera2.html` — `index.html` へ自動転送（旧トップ・OGP/旧共有リンク対策）。

### src の主要モジュール

- `src/face/` — 顔推定・向き校正（`avatar-state.js` / `apply-state.js` / `calibrate-comp.js` /
  `calibration-pipeline` / `camera-diagnostics.js`）。
- `src/sprite-avatar/` — PixiJS スプライト描画（`renderer.js` / `SpriteAvatar.jsx` / `effects/`）。
- `src/tracking/` — 手・体ポーズ認識（`recognizers.js` / `use-hand-pose.js`）。
- `src/audio/` — マイク入力（`mic-engine.js`）。
- `src/cue-system.js` / `src/cue-audio.js` / `src/cue-stamp.jsx` / `src/cue-offset-editor.jsx` —
  サウンドボード／キュー（演出の発火・位置調整）。
- `src/gestures.js` — ジェスチャー演出（回転・うなずく・No ほか。今は camera 版のみ）。
- `src/obs-mode.js` — OBS 透過オーバーレイモード（`?obs=1`）。
- `src/relay-mode.js` — WS 中継の送受信（`?tx` / `?rx`）モード。
- `src/tweaks-panel.jsx` / `src/draggable-panel.jsx` / `src/use-tweaks.js` — 調整パネル（タブ UI・ドラッグ移動）。
- `src/character-config.js` / `src/camera-config.js` / `src/theme-color.js` — キャラ参照先・カメラ・テーマ設定。
- `src/mobile-hardening.js` — スマホ向けのピンチズーム抑止など。

### サーバ・ビルド・ツール

- `server/relay.mjs` / `server/relay-core.mjs` — WS 中継。`relay-core.mjs` は共有実装で
  `server/relay.mjs` と `vite-plugin-relay.mjs` が共用。
- `vite-plugin-relay.mjs` — dev / preview に WS 中継を同居させる Vite プラグイン（専用パス `/__relay`）。
- `vite.config.js` / `vite.fork.js` — ビルド設定。`build` 時のみ base を `/guruguru-avatar/` にする
  （本家ミラーの `vite.config.js` は据え置き、`vite.fork.js` で上書き）。
- `scripts/copy-mediapipe-assets.mjs` / `scripts/verify-pages-build.mjs` — MediaPipe アセット配置・Pages 検証。
- `tools/slice_character_sheets.py` — 角度シートからスライス画像を生成する Python ツール。
- `public/slices2/` — スライス済みキャラ画像（git 追跡対象）。

## フレーム画像の仕組み

向きと表情に応じて `public/slices2/<状態>/r<行>c<列>.webp` を1枚ずつ切り替える。

- 列 `c0`〜`c4`: 左向き → 正面 → 右向き
- 行 `r0`〜`r4`: 上 → 水平 → 下
- 状態 `A`〜`F`: 目の開閉 × 口の開き（`A`=目開け口とじ … `F`=目閉じ口開け）

例: `slices2/A/r2c2.webp`（正面・目開け・口とじ）。

## テスト

- Vitest を使う（`npm test` / `npm run test:watch`、または `./doTest.sh`）。
- テストは `src/*.test.js` と各サブモジュール（`src/face/` ほか）に同居。純関数・状態遷移・
  各種モード判定が対象で、カメラ推論そのものはテストしない。

## ドキュメント

- `docs-camera/` — カメラ版の利用・配信手順（OBS でライブ配信・WS 中継の接続手順・カメラ切替・
  URL パラメータ一覧・localhost と tailscale 併用 など）。
- `docs/` — キャラ画像の生成テンプレ・新キャラ差し替え手順。
- `README.md` — 公開向けの概要・クイックスタート・デプロイ。
- `ASSET_LICENSE.md` — キャラ画像・音声のライセンス（MIT 対象外、商用利用禁止）。

`*.md` を編集したら `npx markdownlint-cli '<対象>'` で lint を通す
（このリポジトリの設定は `.markdownlint.jsonc`）。

## 注意点

- マイク・カメラ入力は `localhost` または HTTPS でのみ動く。`127.0.0.1` 経由で起動する。
- Google Fonts を CDN から読み込むため、初回表示にはネット接続が必要。
- `preview` は GitHub Pages と同じ `/guruguru-avatar/` ベースパスで動く。
- WS 中継 URL の既定はページと同一オリジン（同じ host=hostname:port）＋専用パス `/__relay`。
  別マシン/別ポートの中継は `?relay=<完全な ws(s) URL>` で明示する。`server/relay.mjs` /
  `npm run relay` / `doServer.sh` は standalone・別マシン用として存続。
- dev 同居の中継は既定 loopback 限定（Vite が WSL や `VITE_HOST=1` で 0.0.0.0 でも中継だけは
  loopback のみ）。LAN 公開は `RELAY_EXPOSE=1` で明示オプトイン（無認証 WS なので信頼できる
  私設網のみ。流れるのは数値 pose だけで RCE は無いが、偽フレーム注入・盗聴は可能）。
- プログラムは MIT。キャラ画像・音声は MIT 対象外（`ASSET_LICENSE.md` 参照、商用利用禁止）。
