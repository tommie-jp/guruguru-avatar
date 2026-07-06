import React from 'react';
import { SlideBar, SLIDEBAR_CTRL_W, SLIDEBAR_COL_W, SLIDEBAR_BTN_H } from './slide-bar.jsx';

// 演出アイコン帯（cuebar）の「枠」だけを担う表示専用コンポーネント（fork 追加）。
// 掴んで動かす／縦横切替／帯スクロールという汎用挙動は SlideBar（slide-bar.jsx）に集約し、
// ここは cuebar 固有の配線（id・既定アンカー・「編集」トグルをヘッダに載せる）だけを担う。
// 同じ SlideBar を下部のパネル表示トグル帯（camera-app.jsx の PanelToggles）も使う。
//
// 状態・ハンドラ（editMode / 長押し / cueController 等）は呼び出し側に残し、ここは
// 組み立て済みの「編集トグル」ノード(toggleNode)と「cue ボタン列」ノード(buttons)、
// および向き(dir)だけを受け取る。cue-stamp.jsx / cue-offset-editor.jsx と同じく
// cue-* 系の独立ファイルに揃える。

// 帯ヘッダ操作子・ボタンの共通寸法。camera-app の「編集」トグル・cue ボタンもこれで揃える。
// 実体は SlideBar 側の定数（従来の export 名を維持して再輸出）。
export const CUEBAR_CTRL_W = SLIDEBAR_CTRL_W; // 横帯の細幅（⠿ / ↕ / 編集）
export const CUEBAR_COL_W = SLIDEBAR_COL_W;   // 縦帯の共通幅（↔ / 編集 / cue）
export const CUEBAR_BTN_H = SLIDEBAR_BTN_H;   // 帯内の共通高さ（cue ボタン基準）

// 初期アンカー。row=画面下の中央、column=左上（従来の固定配置の見た目を踏襲）。
// DraggablePanel が初回レンダーの実測矩形を left/top に変換するので bottom/transform でよい。
const DEFAULT_STYLE = {
  row: { left: '50%', transform: 'translateX(-50%)', bottom: 'calc(78px + var(--sab))' },
  column: { top: 'calc(12px + var(--sat))', left: 'calc(14px + var(--sal))' },
};

function CueBar({
  dir,               // 'row'（横帯）| 'column'（縦帯）
  onToggleDir,       // 向き切替（呼び出し側で保存）
  dark,
  zIndex,
  cueScrollRef,      // cue 帯のスクロール要素の ref（ドラッグ/ホイールの対象）
  toggleNode,        // 「編集」トグルの組み立て済みノード
  buttons,           // cue ボタン列の組み立て済みノード
}) {
  return (
    <SlideBar
      id="cuebar"
      dir={dir}
      onToggleDir={onToggleDir}
      dark={dark}
      zIndex={zIndex}
      scrollRef={cueScrollRef}
      defaultStyle={DEFAULT_STYLE}
      headerNode={toggleNode}
    >
      {buttons}
    </SlideBar>
  );
}

export { CueBar };
