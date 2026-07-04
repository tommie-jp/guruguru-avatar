#!/usr/bin/env bash
#
# デプロイ/リリースのエントリポイント。
#
#   ./doDeploy.sh [all]     Pages デプロイ → アプリ（Electron）リリースの両方（既定）
#   ./doDeploy.sh pages     GitHub Pages へデプロイのみ
#   ./doDeploy.sh app       アプリ（Electron）を GitHub Release として配置のみ
#                           （Windows: NSIS + ポータブル exe / Linux: AppImage を upload。
#                            公開後に Windows 実機 E2E と Linux 起動スモークまで実行）
#                           macOS 向けは配布しない（Web 版 か npm start を案内。doBuild.sh 参照）
#
# 注意: gh は --repo 無指定だと upstream(rotejin) を見て 403 になるので必ず --repo を付ける。
#
set -euo pipefail

REPO="tommie-jp/guruguru-avatar"
BRANCH="main"
WORKFLOW="pages.yml"
SITE_URL="https://tommie-jp.github.io/guruguru-avatar/"

# スクリプトの場所（＝リポジトリ）へ移動。どこから実行しても git コマンドが効くように。
cd "$(dirname "$0")"

# ── ヘルプ ───────────────────────────────────────────────────────────────
usage() {
  cat <<USAGE
doDeploy.sh — デプロイ/リリースのエントリポイント

使い方:
  ./doDeploy.sh [all]      Pages デプロイ → アプリリリースの両方（既定・引数なしと同じ）
  ./doDeploy.sh pages      GitHub Pages へデプロイのみ
  ./doDeploy.sh app        アプリ（Electron・Windows + Linux）を GitHub Release として配置のみ
  ./doDeploy.sh -h|--help  このヘルプを表示

サブコマンド:
  all     pages → app を続けて実行（既定）。途中で失敗したら止まる（set -e）。
  pages   origin/$BRANCH を対象に $WORKFLOW を workflow_dispatch で起動し、
          完了まで監視して $SITE_URL の反映を確認する。
  app     ./doBuild.sh で Windows（NSIS + ポータブル exe）と Linux（AppImage）を
          ビルドし、tag 'win-v<version>' の GitHub Release として upload する
          （既存リリースならアセットを --clobber で上書き）。公開後に Windows 実機
          E2E と、公開アセットをダウンロードしての Linux 起動スモークまで実行する。
          （'win' は互換のための別名）

前提:
  app は wine が必要（Linux/WSL 上の NSIS ビルドでアンインストーラ抽出に使う）。
  未導入なら: sudo dpkg --add-architecture i386 && sudo apt-get update &&
              sudo apt-get install wine wine32:i386
  macOS 向けバイナリは配布しない（ビルド・テストとも macOS 実機が必要なため。
  Web 版 か "npm run build:local && npm start" を案内する）。

環境変数:
  DEPLOY_SKIP_WIN_TEST=1     リリース後の Windows 実機 E2E をスキップする
  DEPLOY_SKIP_LINUX_TEST=1   リリース後の Linux 起動スモークをスキップする

関連:
  ./doBuild.sh             Electron 成果物をビルドするだけ（アップロードしない）
  対象リポジトリ           $REPO
USAGE
}

# ── 共通: gh の前提チェック ──────────────────────────────────────────────
require_gh() {
  command -v gh >/dev/null 2>&1 || { echo "エラー: gh CLI が必要です"; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "エラー: gh にログインしてください（gh auth login）"; exit 1; }
}

# ── pages: GitHub Pages へデプロイ（従来の doDeploy.sh の中身） ───────────
deploy_pages() {
  require_gh

  # ブランチ確認（対象は origin/$BRANCH）
  cur=$(git rev-parse --abbrev-ref HEAD)
  if [ "$cur" != "$BRANCH" ]; then
    echo "警告: 現在のブランチは '$cur'。デプロイ対象は origin/$BRANCH です。"
  fi

  # 未 push の確認（ローカルの未 push コミットは CI に反映されない）
  git fetch origin "$BRANCH" --quiet || true
  local_sha=$(git rev-parse "$BRANCH" 2>/dev/null || echo "")
  remote_sha=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
  if [ -n "$local_sha" ] && [ "$local_sha" != "$remote_sha" ]; then
    echo "エラー: ローカル $BRANCH と origin/$BRANCH が一致しません。"
    echo "  local : $local_sha"
    echo "  origin: $remote_sha"
    echo "  → 先に 'git push origin $BRANCH' してください（未 push のコミットはデプロイされません）。"
    exit 1
  fi

  # 起動前の最新 run id を控える（新しく起動した run を特定するため）
  before=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit 1 \
    --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")

  echo "デプロイを起動: $REPO ($WORKFLOW @ $BRANCH)"
  gh workflow run "$WORKFLOW" --repo "$REPO" --ref "$BRANCH"

  # 新しい run が登録されるまで待ってから監視する（最大 ~60 秒）
  echo "run の起動を待っています..."
  rid=""
  for _ in $(seq 1 30); do
    rid=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit 1 \
      --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
    if [ -n "$rid" ] && [ "$rid" != "$before" ]; then break; fi
    sleep 2
    rid=""
  done
  if [ -z "$rid" ]; then
    echo "エラー: 新しい run を特定できませんでした。Actions を確認してください。"
    echo "  gh run list --repo $REPO --workflow=$WORKFLOW"
    exit 1
  fi

  echo "run $rid を監視します..."
  gh run watch "$rid" --repo "$REPO" --exit-status

  # 反映確認（CDN 反映に数秒かかることがあるので非致命的）
  echo "反映を確認中..."
  # フォーク版のトップ（index.html＝カメラ/Pixi 版）で反映を確認する。
  # camera.html は廃止済み（現行のエントリは index.html / camera2.html / tracking.html）。
  # -f は付けない: 付けると 4xx でも非ゼロ終了し、-w の出力と '000' が連結して
  # "404000" のような誤解を招く表示になるため。終了コードは || で個別に処理する。
  code=$(curl -sS -o /dev/null -w '%{http_code}' "${SITE_URL}index.html" 2>/dev/null) || code="000"
  echo "index.html: HTTP $code"

  echo "✓ デプロイ完了: $SITE_URL"
}

# ── app: アプリ（Electron・Windows + Linux）を GitHub Release として配置 ────
# ビルドは ./doBuild.sh（build:local を内包。VITE_NO_PWA=1 で SW を除外。成果物の
# サイズゲートと AppImage の起動スモークも doBuild 側で行う）。生成された NSIS
# インストーラ・ポータブル exe・AppImage を tag 'win-v<version>' の Release へ
# 同時添付でアップロードし、取得可能になるのを待って公開後テストまで行う。
# タグの 'win-v' プレフィックスは旧リリースからの継続（リンク互換のため据え置き）。
release_app() {
  require_gh

  local VERSION TAG SETUP_EXE PORTABLE_EXE APPIMAGE notes
  VERSION="$(node -p "require('./package.json').version")"
  TAG="win-v${VERSION}"
  SETUP_EXE="dist-electron/GuruguruAvatar-Setup-${VERSION}.exe"
  PORTABLE_EXE="dist-electron/GuruguruAvatar-${VERSION}-portable.exe"
  APPIMAGE="dist-electron/GuruguruAvatar-${VERSION}-linux-x86_64.AppImage"

  echo "== ビルド (./doBuild.sh) =="
  ./doBuild.sh

  # アップロード直前の存在確認。バージョン付きの厳密名で見る（dist-electron には
  # 旧バージョンが残留しうるので glob では拾わない）。サイズゲート（>100MB）と
  # AppImage 起動スモークは直前の ./doBuild.sh 側で実施済み（閾値は一元管理）。
  local f
  for f in "$SETUP_EXE" "$PORTABLE_EXE" "$APPIMAGE"; do
    [ -f "$f" ] || { echo "エラー: 成果物が見つかりません: $f"; exit 1; }
  done

  # アップロード対象は 3 アセットのみ（latest.yml / .blockmap は自動更新を
  # 使わないため配布しない）。
  local assets=("$SETUP_EXE" "$PORTABLE_EXE" "$APPIMAGE")

  echo "== GitHub Release にアップロード (tag=$TAG, assets=${#assets[@]}) =="
  notes="$(cat <<NOTES
デスクトップアプリ（Electron）です。WS 中継サーバ内蔵・Node も Bun も不要。
起動するだけで、Web カメラ（またはスマホ）の顔の動きに同調するアバターを
OBS に透過オーバーレイ表示できます。

アセット（使う OS のものを 1 つでよい）:
- GuruguruAvatar-Setup-${VERSION}.exe … Windows インストーラ（デスクトップショートカット作成）
- GuruguruAvatar-${VERSION}-portable.exe … Windows インストール不要の単体 exe
- GuruguruAvatar-${VERSION}-linux-x86_64.AppImage … Linux 用（x86_64）

使い方（Windows・実行確認は Windows 11）:
1. exe をダウンロードして実行（「発行元不明」が出たら「詳細情報」→「実行」）。
2. アプリ窓に送信側(tx)＝カメラ画面が開く。カメラを許可する。
3. OBS の「ブラウザ」ソースに http://127.0.0.1:5179/index.html?rx&obs を入れる（背景透過）。

使い方（Linux・起動確認は WSL2/WSLg のみ）:
1. \`chmod +x GuruguruAvatar-${VERSION}-linux-x86_64.AppImage\` して実行。以降は Windows と同じ。
2. 「AppImages require FUSE」と出る環境では \`--appimage-extract-and-run\` を付けて実行するか、libfuse2 を導入する。

macOS: バイナリ配布はありません（ビルド・動作確認とも macOS 実機が必要なため）。
[Web 版](https://tommie-jp.github.io/guruguru-avatar/) を使うか、ソースから
\`npm run build:local && npm start\`（127.0.0.1:8787）で同等に動きます。

詳しくは [12-Windowsアプリの使い方](https://github.com/$REPO/blob/$BRANCH/docs-camera/12-Windowsアプリの使い方.md)（Linux / macOS の節あり）を参照。

---

**旧 zip 配布（win-v1.9.x 以前）からの移行**

- 配布物は Electron アプリのみです（guruguru-relay + start スクリプトの zip 配布は終了）。
- OBS の URL はポートが変わります: \`http://localhost:8787/?rx\` → \`http://127.0.0.1:5179/index.html?rx&obs\`
- 旧 zip はそのまま使い続けられます（最終版: [win-v1.9.3](https://github.com/$REPO/releases/tag/win-v1.9.3) のアセット）。

開発者向けのビルド手順: [58-WindowsアプリにするElectron](https://github.com/$REPO/blob/$BRANCH/docs-camera/58-WindowsアプリにするElectron.md)
NOTES
)"
  if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    echo "  既存 Release にアセットを上書きアップロード..."
    gh release upload "$TAG" "${assets[@]}" --repo "$REPO" --clobber
    echo "  Release のタイトルと説明を更新..."
    gh release edit "$TAG" --repo "$REPO" --title "Guruguru Avatar v${VERSION}" --notes "$notes"
  else
    echo "  新規 Release を作成（アセット同時添付）..."
    gh release create "$TAG" "${assets[@]}" --repo "$REPO" --target "$BRANCH" \
      --title "Guruguru Avatar v${VERSION}" --notes "$notes"
  fi
  echo "✓ Release: https://github.com/$REPO/releases/tag/$TAG"

  # リリース直後は CDN 反映待ちがあるので、全アセットが実際に取得可能になるまで
  # 待ってから公開後テストをする（Windows E2E は portable を落とすが、ユーザーは
  # Setup を落とすので 3 アセットすべての到達を確認する）。
  local NAME LOCAL_SIZE
  for f in "${assets[@]}"; do
    NAME="$(basename "$f")"
    LOCAL_SIZE="$(stat -c%s "$f")"
    if ! wait_release_asset_ready "$TAG" "$NAME" "$LOCAL_SIZE"; then
      echo "エラー: リリースアセットが取得可能になりませんでした: $NAME"
      exit 1
    fi
  done
  run_win_test "$TAG"
  run_linux_test "$TAG" "$(basename "$APPIMAGE")"
}

# ── リリースアセットが GitHub 上でダウンロード可能になるまで待つ ────────────
# API 上でアセットが state=uploaded かつローカルと同サイズで載り、実ダウンロード
# （先頭 1 バイトの range GET）が 200/206 を返したら「取得可能」とみなす。
wait_release_asset_ready() {
  local TAG="$1" NAME="$2" SIZE="$3"
  local url="https://github.com/$REPO/releases/download/$TAG/$NAME"
  echo "== リリースアセットが取得可能になるまで待機: $NAME =="
  local line asize astate code
  for _ in $(seq 1 60); do
    line=$(gh release view "$TAG" --repo "$REPO" --json assets \
      --jq ".assets[] | select(.name==\"$NAME\") | [.size, .state] | @tsv" 2>/dev/null || echo "")
    asize=$(printf '%s' "$line" | cut -f1)
    astate=$(printf '%s' "$line" | cut -f2)
    if [ "$asize" = "$SIZE" ] && [ "$astate" = "uploaded" ]; then
      # 実ダウンロードで到達確認（range GET で先頭だけ）。
      code=$(curl -fsSL -r 0-0 --max-time 30 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")
      if [ "$code" = "200" ] || [ "$code" = "206" ]; then
        echo "✓ アセット取得可能: $url (size=$asize, http=$code)"
        return 0
      fi
    fi
    printf '.'
    sleep 3
  done
  echo
  echo "  最後の状態: size=$asize state=$astate http=${code:-未取得}  url=$url"
  return 1
}

# ── 公開済み zip を実機 Windows で E2E テスト（powershell.exe 経由）─────────
# WSL/Windows の interop で test-release-win11.ps1 を実行する。powershell.exe が
# 無い環境（素の Linux 等）ではスキップする。DEPLOY_SKIP_WIN_TEST=1 でも無効化可。
run_win_test() {
  local TAG="$1"
  local ps1="windows/test-release-win11.ps1"

  if [ "${DEPLOY_SKIP_WIN_TEST:-0}" = "1" ]; then
    echo "（情報）DEPLOY_SKIP_WIN_TEST=1 のため実機テストをスキップします。"
    return 0
  fi
  if ! command -v powershell.exe >/dev/null 2>&1; then
    echo "（情報）powershell.exe が見つからないため実機テストをスキップします（Windows/WSL 上で実行してください）。"
    echo "  手動実行: powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"$(wslpath -w "$PWD/$ps1" 2>/dev/null || echo "$PWD/$ps1")\" -Tag $TAG"
    return 0
  fi
  [ -f "$ps1" ] || { echo "エラー: $ps1 が見つかりません。"; return 1; }

  local winps1 rc
  winps1="$(wslpath -w "$PWD/$ps1")"
  echo "== 実機テスト: test-release-win11.ps1 -Tag $TAG =="
  if powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$winps1" -Tag "$TAG"; then
    rc=0
  else
    rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    echo "✓ 実機テスト PASS"
  else
    echo "✗ 実機テスト FAIL (exit $rc)"
  fi
  return $rc
}

# ── 公開済み AppImage をダウンロードして起動スモーク ─────────────────────────
# アップロード前に doBuild.sh がローカル成果物をスモーク済みだが、ここでは
# 「実際に公開された（＝ユーザーが落とす）バイト列」が起動することを確認する。
# スモーク本体（ポート検出・HTTP 200 確認）は doBuild.sh smoke と共有。
run_linux_test() {
  local TAG="$1" NAME="$2"
  if [ "${DEPLOY_SKIP_LINUX_TEST:-0}" = "1" ]; then
    echo "（情報）DEPLOY_SKIP_LINUX_TEST=1 のため Linux 起動スモークをスキップします。"
    return 0
  fi
  # ディスプレイ無しでは doBuild.sh smoke が何もせず成功を返すため、誤って
  # 「PASS」と表示しないよう先にスキップを明示する（ダウンロードも省く）。
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "（情報）ディスプレイが無いため Linux 起動スモークをスキップします（公開アセットは未検証）。"
    return 0
  fi

  local url tmpdir rc=0
  url="https://github.com/$REPO/releases/download/$TAG/$NAME"
  tmpdir="$(mktemp -d)"
  echo "== Linux 起動スモーク: 公開アセットをダウンロードして実行 =="
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$tmpdir/$NAME" "$url"; then
    echo "✗ ダウンロード失敗: $url"
    rm -rf "$tmpdir"
    return 1
  fi
  chmod +x "$tmpdir/$NAME"
  if ./doBuild.sh smoke "$tmpdir/$NAME"; then
    echo "✓ Linux 起動スモーク PASS"
  else
    rc=$?
    echo "✗ Linux 起動スモーク FAIL (exit $rc)"
  fi
  rm -rf "$tmpdir"
  return "$rc"
}

# ── ディスパッチ ─────────────────────────────────────────────────────────
case "${1:-all}" in
  -h|--help|help)              usage ;;
  pages)                       deploy_pages ;;
  app|win|windows|release-win) release_app ;;
  all)                         deploy_pages; release_app ;;
  *) echo "不明な引数: $1"; echo; usage; exit 2 ;;
esac
