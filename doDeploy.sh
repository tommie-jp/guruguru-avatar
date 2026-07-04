#!/usr/bin/env bash
#
# デプロイ/リリースのエントリポイント。
#
#   ./doDeploy.sh [all]     Pages デプロイ → Windows アプリ（Electron）リリースの両方（既定）
#   ./doDeploy.sh pages     GitHub Pages へデプロイのみ
#   ./doDeploy.sh win       Windows アプリ（Electron）を GitHub Release として配置のみ
#                           （NSIS インストーラ + ポータブル exe を upload。実機 E2E まで実行）
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
  ./doDeploy.sh [all]      Pages デプロイ → Windows アプリリリースの両方（既定・引数なしと同じ）
  ./doDeploy.sh pages      GitHub Pages へデプロイのみ
  ./doDeploy.sh win        Windows アプリ（Electron）を GitHub Release として配置のみ
  ./doDeploy.sh -h|--help  このヘルプを表示

サブコマンド:
  all     pages → win を続けて実行（既定）。途中で失敗したら止まる（set -e）。
  pages   origin/$BRANCH を対象に $WORKFLOW を workflow_dispatch で起動し、
          完了まで監視して $SITE_URL の反映を確認する。
  win     npm run dist:win で NSIS インストーラ + ポータブル exe をビルドし、
          tag 'win-v<version>' の GitHub Release として upload する（既存リリースなら
          アセットを --clobber で上書き）。公開後に実機 E2E（Windows）まで実行する。

前提:
  win は wine が必要（Linux/WSL 上の NSIS ビルドでアンインストーラ抽出に使う）。
  未導入なら: sudo dpkg --add-architecture i386 && sudo apt-get update &&
              sudo apt-get install wine wine32:i386

環境変数:
  DEPLOY_SKIP_WIN_TEST=1   リリース後の実機 E2E をスキップする

関連:
  npm run dist:win         Electron 成果物をビルドするだけ（アップロードしない）
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

# ── win: Windows アプリ（Electron）を GitHub Release として配置 ────────────
# ビルドは npm run dist:win（build:local を内包。VITE_NO_PWA=1 で SW を除外）。
# 生成された NSIS インストーラとポータブル exe を tag 'win-v<version>' の Release へ
# 同時添付でアップロードし、取得可能になるのを待って実機 E2E まで行う。
release_windows() {
  require_gh

  # Linux/WSL 上の NSIS ビルドはアンインストーラ抽出に wine が必須（回避設定なし）。
  if ! command -v wine >/dev/null 2>&1; then
    echo "エラー: wine が必要です（Linux/WSL 上の NSIS ビルドに使用）。"
    echo "  → sudo dpkg --add-architecture i386 && sudo apt-get update \\"
    echo "     && sudo apt-get install wine wine32:i386"
    exit 1
  fi

  local VERSION TAG SETUP_EXE PORTABLE_EXE notes
  VERSION="$(node -p "require('./package.json').version")"
  TAG="win-v${VERSION}"
  SETUP_EXE="dist-electron/GuruguruAvatar-Setup-${VERSION}.exe"
  PORTABLE_EXE="dist-electron/GuruguruAvatar-${VERSION}-portable.exe"

  echo "== ビルド (npm run dist:win) =="
  npm run dist:win

  # 成果物ゲート: バージョン付きの厳密名で存在＋サイズ(>100MB)を検証する。
  # dist-electron には旧バージョンが残留しうるので glob では拾わない。壊れた NSIS
  # スタブ（数百 KB）を公開してしまう事故をここで止める。
  local f size
  for f in "$SETUP_EXE" "$PORTABLE_EXE"; do
    [ -f "$f" ] || { echo "エラー: 成果物が見つかりません: $f"; exit 1; }
    size="$(stat -c%s "$f")"
    if [ "$size" -lt $((100 * 1024 * 1024)) ]; then
      echo "エラー: 成果物が小さすぎます（壊れたビルドの疑い）: $f (${size} bytes)"
      exit 1
    fi
  done

  # アップロード対象は 2 アセットのみ（latest.yml / .blockmap は自動更新を
  # 使わないため配布しない）。
  local assets=("$SETUP_EXE" "$PORTABLE_EXE")

  echo "== GitHub Release にアップロード (tag=$TAG, assets=${#assets[@]}) =="
  notes="$(cat <<NOTES
Windows 用アプリ（Electron）です。WS 中継サーバ内蔵・Node も Bun も不要。
起動するだけで、Web カメラ（またはスマホ）の顔の動きに同調するアバターを
OBS に透過オーバーレイ表示できます。実行確認は Windows 11 のみ。

アセット（どちらか一方でよい）:
- GuruguruAvatar-Setup-${VERSION}.exe … インストーラ（デスクトップショートカット作成）
- GuruguruAvatar-${VERSION}-portable.exe … インストール不要の単体 exe

使い方:
1. exe をダウンロードして実行（「発行元不明」が出たら「詳細情報」→「実行」）。
2. アプリ窓に送信側(tx)＝カメラ画面が開く。カメラを許可する。
3. OBS の「ブラウザ」ソースに http://127.0.0.1:5179/index.html?rx&obs を入れる（背景透過）。

詳しくは [12-Windowsアプリの使い方](https://github.com/$REPO/blob/$BRANCH/docs-camera/12-Windowsアプリの使い方.md) を参照。

---

**旧 zip 配布（win-v1.9.x 以前）からの移行**

- 本リリースから配布物は Electron アプリのみです（guruguru-relay.exe + start.bat の zip 配布は終了）。
- OBS の URL はポートが変わります: \`http://localhost:8787/?rx\` → \`http://127.0.0.1:5179/index.html?rx&obs\`
- 旧 zip はそのまま使い続けられます（最終版: [win-v1.9.3](https://github.com/$REPO/releases/tag/win-v1.9.3) のアセット）。
- Linux / macOS 向け zip は廃止しました。ソースから \`npm run build:local && npm start\`（127.0.0.1:8787）で同等に動きます（[14-Windowsで動かす](https://github.com/$REPO/blob/$BRANCH/docs-camera/14-Windowsで動かす.md) 参照。手順の要点は OS 共通）。

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
  # 待ってから test-release-win11.ps1 で実機テストする（E2E は portable を落とすが、
  # ユーザーは Setup を落とすので両方の到達を確認する）。
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
}

# ── リリースアセットが GitHub 上でダウンロード可能になるまで待つ ────────────
# API 上でアセットが state=uploaded かつローカルと同サイズで載り、実ダウンロード
# （先頭 1 バイトの range GET）が 200/206 を返したら「取得可能」とみなす。
wait_release_asset_ready() {
  local TAG="$1" NAME="$2" SIZE="$3"
  local url="https://github.com/$REPO/releases/download/$TAG/$NAME"
  echo "== リリースアセットが取得可能になるまで待機: $NAME =="
  local i line asize astate code
  for i in $(seq 1 60); do
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

# ── ディスパッチ ─────────────────────────────────────────────────────────
case "${1:-all}" in
  -h|--help|help)          usage ;;
  pages)                   deploy_pages ;;
  win|windows|release-win) release_windows ;;
  all)                     deploy_pages; release_windows ;;
  *) echo "不明な引数: $1"; echo; usage; exit 2 ;;
esac
