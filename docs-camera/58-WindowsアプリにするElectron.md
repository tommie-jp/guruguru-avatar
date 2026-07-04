# デスクトップアプリにする（Electron + electron-builder・Windows / Linux）

スマホ(tx)＋PC(rx)の「PC 側」を 1 つのデスクトップアプリにまとめて配る方法。Electron で
内蔵 HTTP サーバ（中継 + 静的配信）を起動し、ウィンドウに既存の `index.html?tx` を開く。
配布先には Node.js も Bun も不要。Windows は `.exe`（インストーラ or ポータブル）、
Linux は AppImage を起動するだけ。macOS 向けは配布しない（electron-builder の制約で
ビルドは macOS 実機でしかできず、実機テストも署名・公証もできないため。
Web 版 か `npm run build:local && npm start` を案内する）。

`53-単体EXEにする.md` の Bun バイナリ版は「中継サーバだけ」を配るのに対し、こちらは
**カメラ UI 付きのアプリ窓ごと**配る。OBS は同一機の透過 URL を見るだけでよい。

通常運用（開発機で Node を入れて使う）は `14-Windowsで動かす.md` を参照。
Electron 化は「配布先にランタイムを入れずにアプリとして配る」ときに使う。

## 前提

- ビルドは **Windows でも WSL でも**できる（electron-builder が NSIS / portable を生成）。
  ただし **WSL/Linux では wine が必須**（NSIS のアンインストーラ抽出にインストーラスタブを
  wine で実行するため。回避設定は無い。portable だけなら wine 不要）:

  ```bash
  sudo dpkg --add-architecture i386 && sudo apt-get update
  sudo apt-get install wine wine32:i386
  ```

- Node.js は 20.19+ または 22.12+（22 LTS 推奨）。
- `dist:win` 系スクリプトは `VITE_NO_PWA=1` で `build:local` を実行するため、
  **配布物に PWA（Service Worker / manifest）は入らない**。内蔵サーバはローカル配信で
  SW キャッシュの利点が無く、更新後も旧アセットが最長 30 日残る害だけがあるため
  （GitHub Pages 版の PWA は従来どおり SW 込み）。
- 先に `dist-local/`（base=/ の配信物）を作る。`dist:win*` スクリプトが
  `npm run build:local` を内部で呼ぶので、手動ビルドは不要。
- アイコン `build/icon.ico` を 1 度だけ生成しておく（後述）。`build/` は
  electron-builder の `buildResources` ディレクトリでもある。
- Linux（AppImage）ターゲットは wine 不要。アイコンは `build/icon.png`
  （`public/pwa-512x512.png` のコピー）を使う。

## package.json への追加

`guruguru-avatar/package.json` に次を足す。`main` と `type:module` は既存。

- `devDependencies` に `electron-builder` を 1 行追加する。
- `scripts` に 3 つ追加する。
- トップレベルに `build` ブロックを追加する。

具体的な値は本リポジトリの `package.json` に反映済み（同梱する `files` は
main プロセスの import 閉包＝6 ファイル + `package.json` だけ。`ws` は本番依存なので
electron-builder が自動で asar 内へ同梱する。`dist-local/` は `extraResources` で
asar の外＝`resources/dist-local` に置き、内蔵サーバが実ファイルとして配信する）。

## アイコンを作る

`public/pwa-512x512.png`（512×512 RGBA・透過あり）を `.ico` に変換する。
`pwa-maskable-512x512.png` は RGB で透過が無く safe-zone 余白付きなので使わない。
`build/` は無ければ作る。

```bash
mkdir -p build
# ImageMagick v6（convert）
convert public/pwa-512x512.png -background none \
  -define icon:auto-resize=256,128,64,48,32,16 \
  build/icon.ico
```

ImageMagick v7 が入っている環境なら `convert` を `magick` に置き換える。

```bash
mkdir -p build
magick public/pwa-512x512.png -background none \
  -define icon:auto-resize=256,128,64,48,32,16 \
  build/icon.ico
```

## ビルドする

`guruguru-avatar/` で次のいずれか。各スクリプトが先に `npm run build:local` を走らせる。

```bash
./doBuild.sh              # Windows + Linux 全部（サイズゲート＋AppImage 起動スモーク付き）
npm run dist:app          # Windows + Linux 全部（electron-builder 直呼び）
npm run dist:win          # NSIS インストーラ + ポータブルの両方
npm run dist:win:nsis     # NSIS インストーラだけ
npm run dist:win:portable # ポータブル .exe だけ
npm run dist:linux        # Linux AppImage だけ（wine 不要）
```

初回は `npm install` で `electron` と `electron-builder` を入れておく。
出力は `dist-electron/` に揃う（アセット名は GitHub Releases の空白→ドット置換を
避けるため空白なしにしている）。

- `GuruguruAvatar-Setup-<version>.exe` … NSIS インストーラ（インストール先変更可・
  デスクトップショートカット作成）
- `GuruguruAvatar-<version>-portable.exe` … ポータブル（インストール不要・単体起動。
  `%TEMP%\guruguru-avatar-portable` へ自己展開して起動する）
- `GuruguruAvatar-<version>-linux-x86_64.AppImage` … Linux 用単体アプリ
  （`executableName` は `guruguru-avatar`。ユーザーデータは `~/.config/Guruguru Avatar/`）
- `latest.yml` / `*.blockmap` … electron-updater 用のメタファイル。自動更新は
  使わないためリリースには載せない。

## 起動と接続

アプリを起動すると内蔵サーバが `http://127.0.0.1:5179` で立ち上がり、
ウィンドウに `index.html?tx`（PC カメラ + QR + UI）が開く。中継は 127.0.0.1 限定。

- ウィンドウ内の「カメラ源トグル」で **PC カメラ / スマホ** を切り替える。
- OBS 受信側(rx): ブラウザソースに `http://127.0.0.1:5179/index.html?rx&obs` を入れる
  （透過 + UI 非表示）。
- ポート 5179 は vite(5173) / standalone relay(8787) と重複しない既定。

## スマホ(tx)を使う（Tailscale）

スマホのカメラを tx に使うには HTTPS が要る。Tailscale を入れておくと、アプリ起動時に
FQDN を検出して QR をその https に向ける。TLS 終端は **この PC で 1 度だけ**次を実行する
（`<port>` は 5179）。

```bash
tailscale serve --bg --https=443 http://127.0.0.1:5179
```

検出できないときは QR は loopback の http のままになる（同一機ブラウザでの tx 用）。
詳しくは `17-localhostとtailscaleを同時に使う.md` を参照。

## 動作確認チェックリスト（iPhone tx）

初回や配布先で、スマホ(tx) → OBS(rx) が通るかを順に確認する。

1. PC で Tailscale が起動・ログイン済み（管理コンソールで MagicDNS と HTTPS Certificates が ON）。
2. アプリ起動ログに `[guru] tailscale FQDN: <fqdn>` と `スマホtx URL` が出る
   （出ないときは Tailscale を起動して再起動）。
3. PC で 1 度だけ `tailscale serve --bg --https=443 http://127.0.0.1:5179` を実行し、
   `tailscale serve status` が `https://<fqdn>` → `http://127.0.0.1:5179` を示す。
4. 窓の「カメラ源トグル」を **スマホ(QR)** にすると、PC カメラが止まり QR が前面に出る。
5. iPhone（同一 tailnet・Tailscale ON）で QR を読み、Safari で
   `https://<fqdn>/index.html?tx` が開く。
6. カメラ許可 → 自分の顔が映る（映らないときは手順 1・3 と MagicDNS + HTTPS を再確認）。
7. OBS のブラウザソースに `http://127.0.0.1:5179/index.html?rx&obs` を入れ、
   アバターが透過で出る。
8. 顔の向き・口の動きが OBS のアバターに同調する。
9. 1〜2 分放置しても切断しない（切れる場合は `tailscale serve` の既知 idle-drop の可能性。
   Tailscale を更新するか、再接続で復帰する）。

## 注意

- **SmartScreen 警告**: コード署名をしていないため、初回起動で「発行元不明」が出る。
  「詳細情報」→「実行」で起動できる（社内 / 個人配布なら通常これで十分）。
- **getUserMedia**: アプリは内蔵サーバの自オリジン（`http://127.0.0.1:5179`）にだけ
  カメラ / マイク許可を出す。`file://` では secure context にならないため内蔵 HTTP を使う。
- **更新時**: コードや配信物を変えたら `./doBuild.sh`（または `npm run dist:*`）を再実行して
  `dist-electron/` を作り直す。`dist-local/` も `build:local` で更新される。
- **単一インスタンス**: 2 個目を起動しても既存ウィンドウが前面化するだけ（ポート二重
  bind を防ぐ）。
- **Linux（AppImage）の実行**: libfuse2 が無い環境（Ubuntu 22.04+ / WSL 等）では
  「AppImages require FUSE」で起動できない。`--appimage-extract-and-run` を付けて実行するか
  `libfuse2` を導入する。起動確認は WSL2/WSLg のみ。
- **ELECTRON_RUN_AS_NODE の罠**: この環境変数が残っていると（VSCode 拡張配下のシェルに
  多い）、Electron が素の Node.js として起動し**無言で即終了**する。`doBuild.sh` の
  スモークテストは `env -u ELECTRON_RUN_AS_NODE` で回避している。手動起動で
  「何も起きない」ときはまずこれを疑う。
