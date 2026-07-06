import React from 'react';
import {
  loadPanelPos, savePanelPos, clearPanelPos, clampPanelPos,
  loadPanelSize, savePanelSize, clearPanelSize, clampPanelSize,
  loadPanelAnchor, savePanelAnchor, clearPanelAnchor,
  resolvePanelAnchor, applyPanelAnchor,
} from './use-tweaks.js';

// fork: ドラッグで移動・リサイズできる汎用パネル枠（本家 scaffold には無い追加）。
// カメラ版の HUD（カメラプレビュー / デバッグ / 表情係数 / 向き校正）を掴んで動かし、
// 端をつまんでサイズを変え、✕で隠せるようにするために導入した。設計の要点:
//
//  - 操作: マウス・タッチ・ペンの全部対応（pointer events + touch-action:none）。
//  - 掴む面: パネル全体。[data-no-drag] を付けた要素（タイトル帯の✕や中のコントロール）
//    の上では開始しない。右下のリサイズグリップ上でもドラッグせず CSS resize に委ねる。
//  - タイトル帯: title を渡すと上部に「タイトル＋✕」の帯を出す（掴む手がかりにもなる）。
//  - ✕: onClose を呼ぶ。呼び出し側で該当トグルを false にして隠す想定。
//  - ダブルクリック: 既定の位置・サイズに戻す（localStorage の保存もクリア）。
//  - 永続化: 位置はドラッグ終了時、サイズはユーザーがグリップで変えたとき localStorage へ
//    （ページ × id 単位）。サイズは React 管理外（inline style）で持ち、毎フレーム再描画の
//    パネルでも上書きされないよう imperative に当てる（中身だけの再描画と競合させない）。
//  - リサイズ: 画面が縮んでパネルが外へ出たら内側へ再クランプ。
//
// anchorEdges: 端に寄せて置く帯（cuebar / パネル表示トグル帯）向けの位置モデル切替。
//   通常は位置を左上固定の {left, top} で覚えるが、これを true にすると「軸ごとに近い方の端
//   からの距離」で覚える（下端寄りは下端から、右端寄りは右端から一定距離）。ブラウザを
//   リサイズしても端からの距離を保って追従する（left/top 固定だと下/右へ寄せた帯がリサイズで
//   端から離れてしまう）。一度も動かしていない既定位置のうちは従来どおり（アンカー未設定）。
//
// 位置モデルは left/top（px・position:fixed）に統一する。初期位置は呼び出し側が
// defaultStyle（例 {top:16,left:16}）で“アンカー”を渡し、初回レンダーの実測矩形を
// left/top に変換して以降はそれを基準にする。初期サイズは defaultWidth（CSS 文字列か px）。
//
// disabled: カメラプレビューのように「映像は検出のため常時マウントしたいが、非表示のときは
// 枠を出したくない」ケース向け。disabled の間は位置・サイズ管理もドラッグも止め、呼び出し側
// style にそのまま委ねる。要素の同一性は保つので <video> のストリームは貼り直されない。

const PAD = 8;
const GRIP = 20; // 右下のリサイズグリップとみなす範囲(px)。ここではドラッグを開始しない。
const MIN_PANEL = { width: 100, height: 48 }; // リサイズ最小サイズ。clampPanelSize と CSS の両方で使う。

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function DraggablePanel({
  id,
  onClose,
  closeLabel = 'このパネルを隠す',
  title,
  resizable = true,
  anchorEdges = false,
  defaultWidth,
  className,
  style,
  defaultStyle,
  disabled = false,
  children,
}) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null); // {left, top}。null=既定アンカーで配置中
  const posRef = React.useRef(null);          // 最新位置（move ハンドラから参照）
  const defaultRef = React.useRef(null);       // 初回実測の既定位置（ダブルクリック復帰用）
  const anchorRef = React.useRef(null);        // 端からの相対アンカー（anchorEdges 時のみ。未設定=既定）
  const userResizedRef = React.useRef(false);  // グリップを掴んだら true（以降サイズを保存）

  const sizeOf = React.useCallback(() => {
    const el = ref.current;
    return { width: el ? el.offsetWidth : 0, height: el ? el.offsetHeight : 0 };
  }, []);

  const clamp = React.useCallback(
    (p) => clampPanelPos(p, viewport(), sizeOf(), PAD),
    [sizeOf],
  );

  // 初期サイズ＆位置。サイズは inline style に imperative で当てる（React 管理外）。
  React.useLayoutEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    // サイズ: 保存があれば画面内に収めて適用、無ければ defaultWidth を初期幅に（高さは中身なり）。
    // 既に inline サイズがある（適用済み／ユーザーがリサイズ済み）ときは触らない＝再描画で巻き戻さない。
    if (resizable && !el.style.width && !el.style.height) {
      const saved = loadPanelSize(id);
      if (saved) {
        const s = clampPanelSize(saved, viewport(), PAD, MIN_PANEL);
        el.style.width = `${s.width}px`;
        el.style.height = `${s.height}px`;
      } else if (defaultWidth) {
        el.style.width = defaultWidth;
      }
    }
    // 位置
    if (posRef.current) { setPos(posRef.current); return; }
    const r = el.getBoundingClientRect();
    const def = clamp({ left: r.left, top: r.top });
    defaultRef.current = def;
    let init;
    if (anchorEdges) {
      // 端からの相対アンカーで復元。保存アンカー → 旧 {left,top} からの移行 → 既定、の順。
      // 既定（未ドラッグ）のうちはアンカー未設定のまま従来挙動にする（中央寄せ帯などを端へ寄せない）。
      const vp = viewport();
      const size = sizeOf();
      const savedAnchor = loadPanelAnchor(id);
      if (savedAnchor) {
        anchorRef.current = savedAnchor;
        init = applyPanelAnchor(savedAnchor, vp, size, PAD);
      } else {
        const legacy = loadPanelPos(id);
        if (legacy) {
          init = clamp(legacy);
          anchorRef.current = resolvePanelAnchor(init, vp, size);
        } else {
          init = def; // 未ドラッグ＝アンカー未設定（リサイズは従来の再クランプに委ねる）
        }
      }
    } else {
      const saved = loadPanelPos(id);
      init = saved ? clamp(saved) : def;
    }
    posRef.current = init;
    setPos(init);
  }, [disabled, id, resizable, anchorEdges, defaultWidth, clamp, sizeOf]);

  // リサイズ永続化。ユーザーが右下グリップを掴んだ後だけ保存する（中身だけの再描画では保存しない）。
  React.useEffect(() => {
    if (disabled || !resizable) return undefined;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let timer;
    const ro = new ResizeObserver(() => {
      if (!userResizedRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w > 0 && h > 0) savePanelSize(id, { width: w, height: h });
      }, 250);
    });
    ro.observe(el);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, [disabled, resizable, id]);

  // リサイズ追従。anchorEdges でアンカーがあれば「端からの距離」を保って再配置し、
  // それ以外は画面外に出た分だけ内側へ再クランプする。
  React.useEffect(() => {
    const onResize = () => {
      if (disabled || !posRef.current) return;
      const next = (anchorEdges && anchorRef.current)
        ? applyPanelAnchor(anchorRef.current, viewport(), sizeOf(), PAD)
        : clamp(posRef.current);
      posRef.current = next;
      setPos(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [disabled, anchorEdges, clamp, sizeOf]);

  const onPointerDown = (e) => {
    // ✕・中のコントロールなどドラッグさせたくない要素の上では開始しない。
    if (e.target.closest && e.target.closest('[data-no-drag]')) return;
    const el = ref.current;
    if (!el) return;
    // 右下のリサイズグリップ上ではドラッグせず、CSS resize に委ねる。掴んでいる間だけ
    // サイズ保存を有効化し、離したら最終サイズを確定保存して latch を外す（以降の中身
    // リフローで勝手にサイズを上書き保存しないため）。
    if (resizable && !disabled) {
      const r = el.getBoundingClientRect();
      if (e.clientX > r.right - GRIP && e.clientY > r.bottom - GRIP) {
        userResizedRef.current = true;
        const onUp = () => {
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (w > 0 && h > 0) savePanelSize(id, { width: w, height: h });
          userResizedRef.current = false;
        };
        window.addEventListener('pointerup', onUp, { once: true });
        return;
      }
    }
    e.preventDefault();
    const start = posRef.current || { left: el.offsetLeft, top: el.offsetTop };
    const sx = e.clientX, sy = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch { /* 古い環境では無視 */ }
    const move = (ev) => {
      const next = clamp({ left: start.left + (ev.clientX - sx), top: start.top + (ev.clientY - sy) });
      posRef.current = next;
      setPos(next);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!posRef.current) return;
      if (anchorEdges) {
        // 落とした場所の「近い端からの距離」を覚える（以降リサイズはこれに追従）。
        const a = resolvePanelAnchor(posRef.current, viewport(), sizeOf());
        anchorRef.current = a;
        savePanelAnchor(id, a);
      } else {
        savePanelPos(id, posRef.current);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // 既定の位置・サイズへ戻す（保存もクリア）。
  const onResetPos = () => {
    clearPanelPos(id);
    clearPanelSize(id);
    clearPanelAnchor(id);
    anchorRef.current = null;
    userResizedRef.current = false;
    const el = ref.current;
    if (el) { el.style.width = ''; el.style.height = ''; }
    const def = defaultRef.current;
    if (def) { posRef.current = def; setPos(def); }
  };

  // disabled のときは呼び出し側 style にそのまま委ね、枠を出さない。
  const place = disabled
    ? null
    : (pos
      ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' }
      : defaultStyle);
  // resizable: CSS resize を有効化。overflow は呼び出し側指定があれば尊重（無ければ auto）。
  // 幅・高さは inline(imperative)で管理するので React の style には含めない。
  const resizeStyle = (resizable && !disabled)
    ? { resize: 'both', overflow: (style && style.overflow) || 'auto', minWidth: MIN_PANEL.width, minHeight: MIN_PANEL.height }
    : {};
  const finalStyle = disabled
    ? style
    : { position: 'fixed', cursor: 'move', touchAction: 'none', ...style, ...resizeStyle, ...place };

  const showHeader = !disabled && (title || onClose);

  return (
    <div
      ref={ref}
      className={className}
      style={finalStyle}
      onPointerDown={disabled ? undefined : onPointerDown}
      onDoubleClick={disabled ? undefined : onResetPos}
    >
      {/* タイトル帯（掴む手がかり＋✕）。disabled 時は出さない。 */}
      {showHeader && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 6, marginBottom: title ? 5 : 0, cursor: 'move',
        }}>
          <span style={{
            fontWeight: 700, fontSize: 11, letterSpacing: '0.05em',
            opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{title || ''}</span>
          {onClose && (
            <button
              type="button"
              data-no-drag
              aria-label={closeLabel}
              title={closeLabel}
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{
                flexShrink: 0, width: 18, height: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, border: 0, borderRadius: '50%', cursor: 'pointer',
                background: 'rgba(127,127,127,0.28)', color: 'inherit', fontSize: 11, lineHeight: 1,
              }}
            >✕</button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export { DraggablePanel };
