import React from 'react';
import { DraggablePanel } from './draggable-panel.jsx';
import { isDragScrollMove } from './cue-bar-scroll.js';

const { useEffect } = React;

// 「掴んで動かせる帯」の汎用枠（fork 追加）。演出アイコン帯（cue-bar.jsx）と下部の
// パネル表示トグル帯（camera-app.jsx の PanelToggles）で共有する土台。両者は「⠿ ハンドルで
// 移動でき位置を永続化」「↕/↔ で縦横を切り替え」「帯本体はスワイプ/ホイール/ドラッグで
// スライド」という同じ挙動なので、ここに一本化して重複を無くす（DRY）。
//
// 設計（お絵かきツールバー DrawToolbar とも共通）:
//   - DraggablePanel でマウス/タッチ/ペンで掴んで移動でき、位置は id ごとに永続化。
//     端寄せの帯なので anchorEdges を付け、位置は「近い端からの相対距離」で覚える
//     （下端寄りは下端から・右端寄りは右端から）。ブラウザをリサイズしても端に追従する。
//   - 左端(横)／上端(縦)に固定の ⠿ ドラッグハンドルを置き、そこだけが掴める領域。
//   - ハンドル以外（向き切替・任意の固定ノード headerNode・スクロール帯）は data-no-drag に
//     して、その上ではドラッグを開始しない（＝クリック/スクロールを通す）。
//   - スクロール帯はスワイプ／ホイール／スクロールバー／マウスドラッグでスライドできる。タッチは
//     touch-action のネイティブパンに任せ、マウスのみ手動で scrollLeft/Top を動かす。
//     少し動いたらドラッグ扱いにし、直後の click を 1 回だけ握りつぶす。
//   - 横帯では縦ホイールも横スクロールに変換する（SHIFT 無しで送れるように）。
//   - スクロールバーは表示する（cuebar-scroll--bar が .cuebar-scroll の非表示を上書き）。
//
// 呼び出し側は「向き(dir)」と、帯に流し込む中身(children)、固定ヘッダに置く任意ノード
// (headerNode)、スクロール要素の ref(scrollRef)、既定アンカー(defaultStyle) を渡す。
//
// 縦横フリップ時の注意（重要）:
//   resizable=false のパネルは中身サイズ変化での再クランプが効かないため、dir を
//   DraggablePanel の key に渡して「フリップ＝再マウント」させ、layout effect の
//   loadPanelAnchor→apply→setPos で画面内へ再フィットさせる。id も dir 別（`${id}-row` /
//   `${id}-column`）にして、縦・横それぞれが自分の最終位置（端からの相対）を独立に覚える。

const FONT_FAMILY = "'Zen Maru Gothic', sans-serif";

// 横帯（row）ヘッダの操作子（⠿ 移動 / ↕ 向き切替 ほか）の共通幅。細幅で縦に並べ、帯の
// 上下いっぱいに伸ばす。呼び出し側のヘッダ内ボタンもこの値で揃えられるよう export する。
export const SLIDEBAR_CTRL_W = 26;

// 縦帯（column）の操作子・ボタンの共通幅。↔ / 呼び出し側ボタン / 中身を同じ幅で揃える。
export const SLIDEBAR_COL_W = 36;

// 帯内の共通高さ。中身のボタンと、縦帯の ↔/⠿ をこの高さに揃える（位置ボタン＝⠿ 基準）。
export const SLIDEBAR_BTN_H = 24;

function SlideBar({
  id,                // 位置永続化キーの接頭辞（`${id}-row` / `${id}-column`）
  dir,               // 'row'（横帯）| 'column'（縦帯）
  onToggleDir,       // 向き切替（呼び出し側で保存）。無ければ切替ボタンを出さない
  dark,
  zIndex,
  scrollRef,         // スクロール帯要素の ref（ドラッグ/ホイールの対象）
  defaultStyle,      // { row: {...}, column: {...} } 初期アンカー
  headerNode,        // 固定ヘッダに置く任意ノード（例: cuebar の「編集」トグル）
  handleTitle = 'ドラッグで移動（ダブルクリックで位置を戻す）',
  children,          // スクロール帯に流し込む中身（ボタン列など）
}) {
  const isRow = dir === 'row';

  const panelBg = dark ? 'rgba(43,41,38,0.90)' : 'rgba(255,255,255,0.92)';
  const panelBorder = dark ? '1px solid rgba(255,248,238,0.16)' : '1px solid rgba(60,48,38,0.12)';
  const handleBg = dark ? 'rgba(255,248,238,0.14)' : 'rgba(60,48,38,0.10)';
  const handleColor = dark ? 'rgba(255,248,238,0.6)' : 'rgba(60,48,38,0.5)';

  // 向き切替ボタン: 切替後（ターゲット）の向きを矢印で示す。row→↕(縦にする) / column→↔(横にする)。
  const toggleIcon = isRow ? '↕' : '↔';
  const toggleTitle = isRow ? '縦帯に切り替え' : '横帯に切り替え';

  // マウスのドラッグでスクロール帯を送る（掴んで送る）。タッチ/ペンは touch-action の
  // ネイティブパンに任せ、ここは左ボタンのマウスのみ。dir 変更でパネルは再マウントされ
  // scrollRef.current が差し替わるので、dir を deps に入れて新しい要素へ張り直す。
  useEffect(() => {
    const el = scrollRef && scrollRef.current;
    if (!el) return undefined;
    let active = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0, pid = null;
    el.style.cursor = 'grab';
    const onDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return; // 左クリックのマウスのみ
      active = true; moved = false; pid = e.pointerId;
      sx = e.clientX; sy = e.clientY; sl = el.scrollLeft; st = el.scrollTop;
    };
    const onMove = (e) => {
      if (!active) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved) {
        if (!isDragScrollMove(dx, dy)) return; // 小さな動きは click として通す
        moved = true;
        el.style.cursor = 'grabbing';
        try { el.setPointerCapture(pid); } catch { /* 古い環境は無視 */ }
      }
      el.scrollLeft = sl - dx;
      el.scrollTop = st - dy;
      e.preventDefault();
    };
    const onUp = () => {
      if (!active) return;
      active = false;
      try { el.releasePointerCapture(pid); } catch { /* noop */ }
      if (moved) {
        el.style.cursor = 'grab';
        // ドラッグ直後の click を 1 回だけ capture 段で握りつぶす。
        const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', kill, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', kill, { capture: true }), 0);
      }
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [scrollRef, dir]);

  // 横帯では縦ホイール(deltaY)も横スクロールに変換する（SHIFT 無しでスライドできるように）。
  // 縦帯はネイティブの縦スクロールでよいので対象外。React の onWheel は passive で
  // preventDefault 不可なので、非 passive で直接張る（ドラッグ効果と同じ理由）。
  useEffect(() => {
    const el = scrollRef && scrollRef.current;
    if (!el || !isRow) return undefined;
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth) return; // 横に溢れていなければ何もしない
      const scale = e.deltaMode === 1 ? 16 : 1;     // 行モードは概算で px 化
      const dx = e.deltaX * scale, dy = e.deltaY * scale;
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy; // 支配的な軸を横送りに使う
      if (!delta) return;
      el.scrollLeft += delta;
      e.preventDefault(); // ネイティブの二重スクロールを防ぐ（アプリは全画面固定でページは動かない）
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollRef, isRow]);

  const showHeader = !!onToggleDir || headerNode != null;

  return (
    <DraggablePanel
      id={`${id}-${dir}`}
      key={dir}
      resizable={false}
      anchorEdges
      defaultStyle={defaultStyle[dir]}
      style={{
        zIndex,
        // 親（ステージ）の touch-action:none を解除。中の帯を指でスクロールできるように。
        // ハンドルだけ個別に touchAction:'none' にして移動用ジェスチャーを確保する。
        touchAction: 'auto',
        display: 'flex', flexDirection: isRow ? 'row' : 'column', alignItems: 'stretch', gap: 6,
        padding: 5, background: panelBg, border: panelBorder,
        color: dark ? '#F7F1E8' : '#3C3026',
        borderRadius: 12, fontFamily: FONT_FAMILY, userSelect: 'none',
        boxShadow: '0 6px 18px rgba(60,48,38,0.18)', boxSizing: 'border-box',
        // 見切れ防止: 画面内に収め、溢れる中身は帯を（横=横／縦=縦に）スクロールさせる。
        ...(isRow
          ? { maxWidth: 'calc(100vw - 16px)' }
          : { maxHeight: 'calc(100dvh - 96px - var(--sat) - var(--sab))' }),
      }}
    >
      {/* ドラッグ専用ハンドル（固定）。data-no-drag を付けない＝ここだけで掴める。 */}
      <div
        title={handleTitle}
        style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'move', touchAction: 'none',
          // 横帯は共通幅の細い縦バー（高さは帯いっぱいに伸びる）。縦帯は横バー。
          ...(isRow ? { width: SLIDEBAR_CTRL_W } : { padding: '5px 0' }),
          borderRadius: 8, background: handleBg, color: handleColor,
          fontSize: 15, lineHeight: 1, letterSpacing: isRow ? 1 : 3,
          // 縦帯ではハンドルを横棒にして上端でつかみやすくする。
          writingMode: isRow ? 'horizontal-tb' : 'vertical-rl',
        }}
      >⠿</div>

      {/* 固定ヘッダ: 向き切替＋任意の headerNode。data-no-drag（掴まない）＋ダブルクリックで
          位置リセットが暴発しないよう stopPropagation（リセットはハンドルのみ）。 */}
      {showHeader && (
        <div
          data-no-drag
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            flex: '0 0 auto',
            display: 'flex', flexDirection: isRow ? 'row' : 'column', alignItems: 'center', gap: 6,
          }}
        >
          {onToggleDir && (
            <button
              type="button"
              onClick={onToggleDir}
              title={toggleTitle}
              aria-label={toggleTitle}
              style={{
                flex: '0 0 auto',
                // 横帯は移動アイコンと同じ細幅・全高（alignSelf:stretch で帯の上下いっぱいに）。
                // 縦帯は共通幅・位置ボタン(⠿)と同じ高さに揃える。
                ...(isRow ? { width: SLIDEBAR_CTRL_W, alignSelf: 'stretch' } : { width: SLIDEBAR_COL_W, height: SLIDEBAR_BTN_H }),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, lineHeight: 1, cursor: 'pointer',
                borderRadius: 9, border: panelBorder,
                background: dark ? 'rgba(48,45,42,0.92)' : 'rgba(255,255,255,0.9)',
                color: dark ? '#F7F1E8' : '#3C3026',
              }}
            >{toggleIcon}</button>
          )}
          {headerNode}
        </div>
      )}

      {/* スクロール帯: ドラッグ対象外(data-no-drag)で、スワイプ/ホイール/ドラッグでスクロールする。
          横帯=横スクロール／縦帯=縦スクロール。 */}
      <div
        ref={scrollRef}
        className="cuebar-scroll cuebar-scroll--bar"
        data-no-drag
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', flexDirection: isRow ? 'row' : 'column', alignItems: 'center', gap: 6,
          flexWrap: 'nowrap',
          ...(isRow
            ? {
                flex: '1 1 auto', minWidth: 0,
                overflowX: 'auto', overflowY: 'hidden', touchAction: 'pan-x',
              }
            : {
                flex: '0 1 auto', minHeight: 0,
                overflowY: 'auto', overflowX: 'hidden', touchAction: 'pan-y',
              }),
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorX: 'contain', overscrollBehaviorY: 'none',
          padding: isRow ? '2px 4px' : '4px 2px', // boxShadow/枠が切れない内側余白
        }}
      >
        {children}
      </div>
    </DraggablePanel>
  );
}

export { SlideBar };
