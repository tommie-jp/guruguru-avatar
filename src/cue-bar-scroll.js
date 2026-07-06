// 演出アイコン帯（cuebar）のマウス・ドラッグスクロール用の純粋ロジック。
// DOM 非依存でテスト容易にするため、クリック/ドラッグの判定だけを切り出す。
// 実際のスクロール（scrollLeft/Top 操作）は cue-bar.jsx が担う。

// マウスのドラッグ・スクロールで「クリック」と「ドラッグ」を分ける閾値(px)。これ未満の移動は
// クリック（cue 発火）として通し、超えたらドラッグ（＝スクロール）とみなす。
export const DRAG_SCROLL_THRESHOLD_PX = 4;

// 押下点からの移動量が閾値を超えたか（いずれかの軸で超えればドラッグ扱い）。
export function isDragScrollMove(dx, dy, threshold = DRAG_SCROLL_THRESHOLD_PX) {
  return Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
}
