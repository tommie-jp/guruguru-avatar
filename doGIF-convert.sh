#!/usr/bin/env bash
# doGIF-convert.sh — スクリーンショット動画(画面録画)から README ヒーロー用 GIF を作る。
#
# ヒーロー GIF の推奨設定(既定値に採用):
#   - 秒数   : 5〜8秒に切り出す(--start/--duration)。ループ前提で「見どころ一巡」だけ
#   - fps    : 12 (GIF は 20ms 未満の遅延を指定するとブラウザが 10fps に落とすため高fpsは逆効果)
#   - 幅     : 640px (README 本文カラムは約880px。640で十分シャープ)
#   - 色数   : 128色 + palettegen/paletteuse (アニメ調ならほぼ劣化なしでサイズ半減)
#   - ループ : 無限 (-loop 0)。始点と終点を同じポーズにすると継ぎ目が消える
#   - サイズ : 目標 2〜3MB、上限 5MB(超えたら警告を出す)
#
# 使い方:
#   ./doGIF-convert.sh <入力動画> [出力.gif] [オプション]
#
# 例:
#   ./doGIF-convert.sh rec.mp4                          # rec.gif を生成(既定設定)
#   ./doGIF-convert.sh rec.mp4 assets/hero.gif --start 3 --duration 6
#   ./doGIF-convert.sh rec.mp4 --crop 960:540:0:120     # 画面録画から必要領域だけ切り抜き
#
# 依存: ffmpeg
set -euo pipefail

usage() {
  cat <<'USAGE'
doGIF-convert.sh — 画面録画の動画から README ヒーロー用 GIF を作る

使い方:
  ./doGIF-convert.sh <入力動画> [出力.gif] [オプション]

引数:
  <入力動画>   mp4 / mkv / webm / mov など ffmpeg が読める動画
  [出力.gif]   省略時は <入力動画の拡張子を .gif に変えたパス>

オプション:
  --start <秒>      切り出し開始位置 (例: 3 / 0:05)
  --duration <秒>   切り出す長さ。ヒーロー用は 5〜8 秒推奨 (例: 6)
  --fps <N>         フレームレート (既定: 12)
  --width <px>      出力幅。高さはアスペクト比維持で自動 (既定: 640)
  --colors <N>      パレット色数 (既定: 128)
  --crop <W:H:X:Y>  先に切り抜く領域 (ffmpeg crop 形式。省略時は切り抜きなし)
  -h|--help         このヘルプ

ヒント:
  - 5MB を超えたら --duration を短く / --width 480 / --colors 64 を試す
  - ループの継ぎ目を消すには、始点と終点が同じ絵になる区間を切り出す
USAGE
}

command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg が見つかりません" >&2; exit 1; }

IN=""
OUT=""
START=""
DURATION=""
FPS=12
WIDTH=640
COLORS=128
CROP=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
    --start)    START="${2:?--start に値がありません}"; shift 2 ;;
    --duration) DURATION="${2:?--duration に値がありません}"; shift 2 ;;
    --fps)      FPS="${2:?--fps に値がありません}"; shift 2 ;;
    --width)    WIDTH="${2:?--width に値がありません}"; shift 2 ;;
    --colors)   COLORS="${2:?--colors に値がありません}"; shift 2 ;;
    --crop)     CROP="${2:?--crop に値がありません}"; shift 2 ;;
    -*)         echo "ERROR: 不明なオプション: $1" >&2; usage >&2; exit 1 ;;
    *)
      if [ -z "$IN" ]; then IN="$1"
      elif [ -z "$OUT" ]; then OUT="$1"
      else echo "ERROR: 引数が多すぎます: $1" >&2; usage >&2; exit 1
      fi
      shift ;;
  esac
done

[ -n "$IN" ] || { usage >&2; exit 1; }
[ -f "$IN" ] || { echo "ERROR: 入力が見つかりません: $IN" >&2; exit 1; }
[ -n "$OUT" ] || OUT="${IN%.*}.gif"
[ "$IN" != "$OUT" ] || { echo "ERROR: 入力と出力が同じです: $OUT" >&2; exit 1; }

# フィルタ: fps 間引き → (任意)crop → 縮小 → 2パス相当のパレット生成+適用を1コマンドで
VF="fps=${FPS}"
[ -n "$CROP" ] && VF="${VF},crop=${CROP}"
VF="${VF},scale=${WIDTH}:-1:flags=lanczos"
VF="${VF},split[a][b];[a]palettegen=max_colors=${COLORS}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5"

echo "変換中: $IN → $OUT (fps=${FPS} width=${WIDTH} colors=${COLORS}${START:+ start=${START}}${DURATION:+ duration=${DURATION}}${CROP:+ crop=${CROP}})"
ffmpeg -hide_banner -loglevel error -y \
  ${START:+-ss "$START"} -i "$IN" ${DURATION:+-t "$DURATION"} \
  -vf "$VF" -loop 0 "$OUT"

BYTES=$(stat -c %s "$OUT")
MB=$(awk "BEGIN{printf \"%.2f\", ${BYTES}/1024/1024}")
echo "完了: $OUT (${MB} MB)"
if [ "$BYTES" -gt $((5 * 1024 * 1024)) ]; then
  echo "WARN: 5MB 超え。--duration を短く / --width 480 / --colors 64 を検討してください" >&2
fi
