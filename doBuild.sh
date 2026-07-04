#!/usr/bin/env bash
#
# 配布物（Electron デスクトップアプリ）を「ビルドするだけ」のスクリプト。
# GitHub へのアップロードはしない（それは ./doDeploy.sh app）。
#
#   - Windows: NSIS インストーラ + ポータブル exe（electron-builder --win。WSL では wine 必須）
#   - Linux  : AppImage（electron-builder --linux。この場で起動スモークテストまで行う）
#   - macOS  : 配布物なし。ビルドは macOS 実機でしかできず（electron-builder の制約）、
#              実機テストも署名・公証もできないため配布しない方針
#              （Web 版 か `npm run build:local && npm start` を案内する）。
#
# 旧 zip 配布（bun リレイサーバ + start スクリプト、win/linux/macos 3 種）は win-v1.10.0 で
# 廃止した。単体リレイバイナリが必要なら `npm run build:relay(:win|:linux|:macos)` を直接使う。
#
set -euo pipefail

usage() {
  cat <<'USAGE'
doBuild.sh — Electron アプリの配布物をビルド（アップロードはしない）

使い方:
  ./doBuild.sh [all]           Windows + Linux の配布物を dist-electron/ に生成（既定）
  ./doBuild.sh win             Windows のみ（NSIS インストーラ + ポータブル exe）
  ./doBuild.sh linux           Linux のみ（AppImage。起動スモークテスト付き）
  ./doBuild.sh smoke <file>    指定した AppImage の起動スモークテストだけを実行
  ./doBuild.sh -h|--help       このヘルプを表示

生成物:
  dist-electron/GuruguruAvatar-Setup-<version>.exe            (NSIS インストーラ)
  dist-electron/GuruguruAvatar-<version>-portable.exe         (ポータブル exe)
  dist-electron/GuruguruAvatar-<version>-linux-x86_64.AppImage (Linux AppImage)

前提:
  Windows ターゲットは wine が必要（WSL/Linux 上の NSIS ビルドで使う）。
  未導入なら: sudo dpkg --add-architecture i386 && sudo apt-get update &&
              sudo apt-get install wine wine32:i386

macOS 向けは配布しない（Web 版 か `npm run build:local && npm start` を案内）。

GitHub Release として配置するには:  ./doDeploy.sh app
USAGE
}

# スクリプトの場所（＝リポジトリ）へ移動。どこから実行しても効くように。
# （smoke の相対パス引数は呼び出し元の cwd 基準で解決するため先に控える）
ORIG_PWD="$PWD"
cd "$(dirname "$0")"

MIN_ARTIFACT_SIZE=$((100 * 1024 * 1024)) # Electron 同梱で 140MB 超になる。下回るのは壊れたビルド

# ── 成果物ゲート: バージョン付きの厳密名で存在＋サイズを検証する ─────────────
# dist-electron には旧バージョンが残留しうるので glob では拾わない。壊れた NSIS
# スタブ（数百 KB）を配布してしまう事故をここで止める。
check_artifact() {
  local f="$1" size
  [ -f "$f" ] || { echo "エラー: 成果物が見つかりません: $f"; exit 1; }
  size="$(stat -c%s "$f")"
  if [ "$size" -lt "$MIN_ARTIFACT_SIZE" ]; then
    echo "エラー: 成果物が小さすぎます（壊れたビルドの疑い）: $f (${size} bytes)"
    exit 1
  fi
  echo "  OK $f (size=$size)"
}

require_wine() {
  # Linux/WSL 上の NSIS ビルドはアンインストーラ抽出に wine が必須（回避設定なし）。
  command -v wine >/dev/null 2>&1 && return 0
  echo "エラー: wine が必要です（Linux/WSL 上の NSIS ビルドに使用）。"
  echo "  → sudo dpkg --add-architecture i386 && sudo apt-get update \\"
  echo "     && sudo apt-get install wine wine32:i386"
  exit 1
}

# ── AppImage の起動スモークテスト ────────────────────────────────────────────
# 実際に起動し、内蔵サーバ（既定 5179・使用中なら ephemeral へフォールバック）の
# 実ポートを起動ログから拾って HTTP 200 を確認する。固定ポート決め打ちはしない。
smoke_appimage() {
  local appimage="$1"
  [ -f "$appimage" ] || { echo "エラー: AppImage が見つかりません: $appimage"; return 1; }

  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "（情報）ディスプレイが無いため AppImage の起動スモークをスキップします。"
    return 0
  fi

  echo "== AppImage 起動スモーク: $appimage =="
  local log pid port body extracted rc=1
  log="$(mktemp)"

  # - env -u ELECTRON_RUN_AS_NODE: これが残っていると Electron が素の Node として起動し
  #   無言で即終了する（VSCode 拡張配下のシェルに多い）。
  # - --appimage-extract-and-run: libfuse2 が無い環境（WSL 等）でも動かすため。
  # - setsid: ランチャーと Electron 子プロセスをまとめて kill できるようにする。
  setsid env -u ELECTRON_RUN_AS_NODE "$appimage" --appimage-extract-and-run >"$log" 2>&1 &
  pid=$!

  # --appimage-extract-and-run は起動前に全展開（190MB 超）するため、遅いディスク
  # （/mnt の 9p 等）も考えて長めに待つ。プロセスが先に死んだら即打ち切る。
  port=""
  for _ in $(seq 1 60); do
    port=$(grep -aoP 'serving .* at http://127\.0\.0\.1:\K[0-9]+' "$log" | head -1 || true)
    [ -n "$port" ] && break
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done

  if [ -n "$port" ]; then
    body=$(curl -fsS --max-time 10 "http://127.0.0.1:$port/index.html" 2>/dev/null || echo "")
    if printf '%s' "$body" | grep -q '<html'; then
      echo "  OK 内蔵サーバ応答 (port=$port, index.html に <html)"
      if curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:$port/index.html?rx&obs" 2>/dev/null; then
        echo "  OK rx ページ応答 (?rx&obs)"
        rc=0
      else
        echo "エラー: rx ページ (?rx&obs) が応答しません。"
      fi
    else
      echo "エラー: index.html の応答が不正です（<html が含まれない）。"
    fi
  else
    echo "エラー: 起動ログに内蔵サーバの listen 行が現れませんでした。"
    echo "  よくある原因: アプリが既に起動中（単一インスタンスロックで即終了）／"
    echo "  ELECTRON_RUN_AS_NODE が環境に残っている／ディスプレイに接続できない。"
    echo "  --- 起動ログ末尾 ---"
    tail -5 "$log" | sed 's/^/  /'
  fi

  # プロセスグループごと停止し、--appimage-extract-and-run の展開物を片付ける。
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 1
  extracted=$(grep -aom1 '/tmp/appimage_extracted_[0-9a-f]*' "$log" || true)
  [ -n "$extracted" ] && rm -rf "$extracted"
  rm -f "$log"
  return "$rc"
}

# ── ビルド本体 ───────────────────────────────────────────────────────────────
build() {
  local target="$1"
  command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です"; exit 1; }

  local VERSION SETUP_EXE PORTABLE_EXE APPIMAGE
  VERSION="$(node -p "require('./package.json').version")"
  SETUP_EXE="dist-electron/GuruguruAvatar-Setup-${VERSION}.exe"
  PORTABLE_EXE="dist-electron/GuruguruAvatar-${VERSION}-portable.exe"
  APPIMAGE="dist-electron/GuruguruAvatar-${VERSION}-linux-x86_64.AppImage"
  echo "[info] version=$VERSION target=$target"

  case "$target" in
    win)   require_wine; npm run dist:win ;;
    linux) npm run dist:linux ;;
    all)   require_wine; npm run dist:app ;;
  esac

  echo "== 成果物の検証 =="
  if [ "$target" != "linux" ]; then
    check_artifact "$SETUP_EXE"
    check_artifact "$PORTABLE_EXE"
  fi
  if [ "$target" != "win" ]; then
    check_artifact "$APPIMAGE"
    smoke_appimage "$APPIMAGE"
  fi

  echo "✓ ビルド完了（dist-electron/ に出力）"
}

TARGET="${1:-all}"
case "$TARGET" in
  -h|--help|help) usage ;;
  all|win|linux)  build "$TARGET" ;;
  smoke)
    [ -n "${2:-}" ] || { echo "エラー: smoke には AppImage のパスを指定してください。"; echo; usage; exit 2; }
    APPIMAGE_ARG="$2"
    case "$APPIMAGE_ARG" in /*) ;; *) APPIMAGE_ARG="$ORIG_PWD/$APPIMAGE_ARG" ;; esac
    smoke_appimage "$APPIMAGE_ARG"
    ;;
  *) echo "不明な引数: $1"; echo; usage; exit 2 ;;
esac
