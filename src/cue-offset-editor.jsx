import React from 'react';
import { DraggablePanel } from './draggable-panel.jsx';
import { stampFontSize } from './cue-stamp-geometry.js';
import {
  clampCueOffset, MAX_CUE_TEXT_LEN, DEFAULT_CUE_COLOR,
  DEFAULT_CUE_FONT_SCALE, MIN_CUE_FONT_SCALE, MAX_CUE_FONT_SCALE, clampCueFontScale,
  DEFAULT_CUE_SHADOW_COLOR,
  MIN_CUE_HOLD_MS, MAX_CUE_HOLD_MS, clampCueHoldMs,
  CUE_ANIMS,
  DEFAULT_CUE_FONT_WEIGHT, MIN_CUE_FONT_WEIGHT, MAX_CUE_FONT_WEIGHT, clampCueFontWeight,
  DEFAULT_CUE_STROKE_EM, MIN_CUE_STROKE_EM, MAX_CUE_STROKE_EM, clampCueStroke,
  MAX_CUE_ROTATION, DEFAULT_CUE_ROTATION,
  DEFAULT_CUE_HALO, MAX_CUE_GLOW, DEFAULT_CUE_GLOW_COLOR,
  MAX_CUE_GAIN, DEFAULT_CUE_GAIN,
} from './use-tweaks.js';

// アニメ種別の表示名（select 用）。
const ANIM_LABELS = { pop: 'ポン（pop）', rise: '上に昇る（rise）', shake: 'ぷるぷる（shake）' };
const clampNum = (v, lo, hi, def) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);

// 演出（スタンプ）のアバター相対オフセットをドラッグで調整するエディタ（camera 版専用）。
//
//  - 掴む面はアバター本体: 編集中だけ透明な全面オーバーレイを敷き、ドラッグ量(px)を em(=スタンプ
//    fontSize 比)へ換算する。fontSize はアバター幅基準なので、ズーム/charSize/解像度が変わっても
//    保存値はスケール不変（cue-stamp-geometry.js と同じ単位）。
//  - パネルは退避できるクローム（既存 DraggablePanel 流用）。保存/やめる/既定に戻す＋現在値を表示。
//  - ライブプレビュー: 編集中の cue を draft オフセットで holdMs 間隔に再 pop（本番と同一 placeNode）。
//  - 確定は常に明示。ドラッグでは自動保存しない（誤操作で保存値を壊さない）。
//  - 呼び出し側で !obsMode && !isRx ゲート済み前提。z 順: オーバーレイ(30) < サウンドボード(40) < パネル(50)。
//
// props:
//   cue         … 編集対象の cue（id, label, place, stamp, holdMs を使う）
//   anchorRef   … アバター本体要素の ref（getBoundingClientRect で幅を読む）
//   initial     … 現在の保存オフセット { x, y }（未保存なら undefined → {0,0}）
//   initialText … 現在の実効スタンプ文字（上書き優先・無ければ既定 stamp）。入力欄の初期値。
//   defaultText … cue の既定 stamp（↺既定の戻し先・placeholder）。
//   initialColor… 現在の実効文字色 '#rrggbb'（上書き優先・無ければ既定の赤）。色入力の初期値。
//   defaultColor… 既定の文字色 '#rrggbb'（赤）。↺既定の戻し先。
//   initialSize … 現在の実効フォント倍率（数値・既定 1.0）。サイズスライダの初期値。
//   defaultSize … 既定のフォント倍率（1.0）。↺既定の戻し先。
//   initialShadow… 現在の実効影色 '#rrggbb'（既定の濃茶）。影色入力の初期値。
//   defaultShadow… 既定の影色 '#rrggbb'（濃茶）。↺既定の戻し先。
//   initialHold / defaultHold   … 表示時間(ms)。既定は cue.holdMs。
//   initialAnim / defaultAnim   … アニメ種別（'pop'|'rise'|'shake'）。既定は cue.anim。
//   initialWeight / defaultWeight… フォント太さ(100..900)。既定は 800。
//   initialStroke / defaultStroke… 縁取り幅(em)。既定は 0.05。
//   dark        … パネル配色（テーマ追従）
//   onCommit(edit) … 保存ボタン。edit={offset,text,color,size,shadow,hold,anim,weight,stroke} を渡す
//   onClose()                     … やめる/✕。draft を破棄して閉じる
//   preview(cue)                  … スタンプを1回 pop する関数（ライブプレビュー用）

const { useState, useRef, useEffect, useCallback } = React;

const OVERLAY_Z = 30;
const PANEL_Z = 50;
const MOVE_LIMIT = 1.5; // em。clampCueOffset の既定と揃える（画面外へ飛ばさない）。

function btnStyle(dark, primary) {
  return {
    flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 700, lineHeight: 1,
    borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.14)'}`,
    background: primary
      ? (dark ? '#5B8DEF' : '#3B74E8')
      : (dark ? 'rgba(70,66,60,0.9)' : 'rgba(255,255,255,0.92)'),
    color: primary ? '#fff' : (dark ? '#F7F1E8' : '#3C3026'),
    fontFamily: "'Zen Maru Gothic', sans-serif",
  };
}

function CueOffsetEditor({
  cue, anchorRef, initial, initialText, defaultText, initialColor, defaultColor,
  initialSize, defaultSize, initialShadow, defaultShadow,
  initialHold, defaultHold, initialAnim, defaultAnim,
  initialWeight, defaultWeight, initialStroke, defaultStroke,
  initialRotation, defaultRotation, initialPlace, defaultPlace,
  initialHalo, defaultHalo, initialGlow, defaultGlow, initialGlowColor, defaultGlowColor,
  initialGain, defaultGain, initialSound, maxSoundLen = 262144,
  dark = false, onCommit, onClose, preview,
}) {
  const draftRef = useRef(clampCueOffset(initial, -MOVE_LIMIT, MOVE_LIMIT));
  const [draft, setDraft] = useState(draftRef.current);
  // カスタム文字の draft。ref を持つのは preview interval / 保存が最新値を同期で読むため（draft と同じ理由）。
  const initText = typeof initialText === 'string' ? initialText : (cue.stamp || '');
  const textDraftRef = useRef(initText);
  const [textDraft, setTextDraft] = useState(initText);
  // カスタム文字色の draft（'#rrggbb'）。同じく ref で最新値を同期読みする。
  const initColor = typeof initialColor === 'string' ? initialColor : (defaultColor || DEFAULT_CUE_COLOR);
  const colorDraftRef = useRef(initColor);
  const [colorDraft, setColorDraft] = useState(initColor);
  // フォント倍率の draft（数値）。
  const initSize = Number.isFinite(initialSize) ? initialSize : (defaultSize || DEFAULT_CUE_FONT_SCALE);
  const sizeDraftRef = useRef(initSize);
  const [sizeDraft, setSizeDraft] = useState(initSize);
  // 影色の draft（'#rrggbb'）。
  const initShadow = typeof initialShadow === 'string' ? initialShadow : (defaultShadow || DEFAULT_CUE_SHADOW_COLOR);
  const shadowDraftRef = useRef(initShadow);
  const [shadowDraft, setShadowDraft] = useState(initShadow);
  // 表示時間(ms) / アニメ / 太さ / 縁取り の draft。
  const initHold = Number.isFinite(initialHold) ? initialHold : (defaultHold || 1100);
  const holdDraftRef = useRef(initHold);
  const [holdDraft, setHoldDraft] = useState(initHold);
  const initAnim = CUE_ANIMS.includes(initialAnim) ? initialAnim : (CUE_ANIMS.includes(defaultAnim) ? defaultAnim : 'pop');
  const animDraftRef = useRef(initAnim);
  const [animDraft, setAnimDraft] = useState(initAnim);
  const initWeight = Number.isFinite(initialWeight) ? initialWeight : (defaultWeight || DEFAULT_CUE_FONT_WEIGHT);
  const weightDraftRef = useRef(initWeight);
  const [weightDraft, setWeightDraft] = useState(initWeight);
  const initStroke = Number.isFinite(initialStroke) ? initialStroke : (Number.isFinite(defaultStroke) ? defaultStroke : DEFAULT_CUE_STROKE_EM);
  const strokeDraftRef = useRef(initStroke);
  const [strokeDraft, setStrokeDraft] = useState(initStroke);
  // 回転 / 表示位置 / 白フチ / 発光強さ / 発光色 / 音量 / 効果音 の draft。
  const initRot = Number.isFinite(initialRotation) ? initialRotation : (defaultRotation || DEFAULT_CUE_ROTATION);
  const rotDraftRef = useRef(initRot);
  const [rotDraft, setRotDraft] = useState(initRot);
  const initPlace = (initialPlace === 'above' || initialPlace === 'over') ? initialPlace : (defaultPlace || 'over');
  const placeDraftRef = useRef(initPlace);
  const [placeDraft, setPlaceDraft] = useState(initPlace);
  const initHalo = Number.isFinite(initialHalo) ? initialHalo : (Number.isFinite(defaultHalo) ? defaultHalo : DEFAULT_CUE_HALO);
  const haloDraftRef = useRef(initHalo);
  const [haloDraft, setHaloDraft] = useState(initHalo);
  const initGlow = Number.isFinite(initialGlow) ? initialGlow : (Number.isFinite(defaultGlow) ? defaultGlow : 0);
  const glowDraftRef = useRef(initGlow);
  const [glowDraft, setGlowDraft] = useState(initGlow);
  const initGlowCol = typeof initialGlowColor === 'string' ? initialGlowColor : (defaultGlowColor || DEFAULT_CUE_GLOW_COLOR);
  const glowColDraftRef = useRef(initGlowCol);
  const [glowColDraft, setGlowColDraft] = useState(initGlowCol);
  const initGain = Number.isFinite(initialGain) ? initialGain : (Number.isFinite(defaultGain) ? defaultGain : DEFAULT_CUE_GAIN);
  const gainDraftRef = useRef(initGain);
  const [gainDraft, setGainDraft] = useState(initGain);
  // 効果音は data URL 文字列。'' は「既定（合成音）」。
  const initSound = typeof initialSound === 'string' ? initialSound : '';
  const soundDraftRef = useRef(initSound);
  const [soundLabel, setSoundLabel] = useState(initSound ? '設定済み' : '');
  // ドラッグ開始時の指位置とオフセットを覚える（move ハンドラが基準にする）。
  const startRef = useRef({ x: 0, y: 0, ox: 0, oy: 0, active: false });
  // 最新の cue を interval から参照する（cue 差し替え時の stale 回避）。
  const cueRef = useRef(cue);
  cueRef.current = cue;

  const setDraftBoth = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const setTextBoth = useCallback((s) => {
    textDraftRef.current = s;
    setTextDraft(s);
  }, []);
  const setColorBoth = useCallback((s) => {
    colorDraftRef.current = s;
    setColorDraft(s);
  }, []);
  const setSizeBoth = useCallback((v) => {
    sizeDraftRef.current = v;
    setSizeDraft(v);
  }, []);
  const setShadowBoth = useCallback((s) => {
    shadowDraftRef.current = s;
    setShadowDraft(s);
  }, []);
  const setHoldBoth = useCallback((v) => { holdDraftRef.current = v; setHoldDraft(v); }, []);
  const setAnimBoth = useCallback((v) => { animDraftRef.current = v; setAnimDraft(v); }, []);
  const setWeightBoth = useCallback((v) => { weightDraftRef.current = v; setWeightDraft(v); }, []);
  const setStrokeBoth = useCallback((v) => { strokeDraftRef.current = v; setStrokeDraft(v); }, []);
  const setRotBoth = useCallback((v) => { rotDraftRef.current = v; setRotDraft(v); }, []);
  const setPlaceBoth = useCallback((v) => { placeDraftRef.current = v; setPlaceDraft(v); }, []);
  const setHaloBoth = useCallback((v) => { haloDraftRef.current = v; setHaloDraft(v); }, []);
  const setGlowBoth = useCallback((v) => { glowDraftRef.current = v; setGlowDraft(v); }, []);
  const setGlowColBoth = useCallback((v) => { glowColDraftRef.current = v; setGlowColDraft(v); }, []);
  const setGainBoth = useCallback((v) => { gainDraftRef.current = v; setGainDraft(v); }, []);
  const setSoundBoth = useCallback((url, label) => { soundDraftRef.current = url; setSoundLabel(label); }, []);

  // cue を選び直したら draft（位置・文字・色・倍率・影色）を保存値で初期化する。
  useEffect(() => {
    const init = clampCueOffset(initial, -MOVE_LIMIT, MOVE_LIMIT);
    draftRef.current = init;
    setDraft(init);
    const it = typeof initialText === 'string' ? initialText : (cue.stamp || '');
    textDraftRef.current = it;
    setTextDraft(it);
    const ic = typeof initialColor === 'string' ? initialColor : (defaultColor || DEFAULT_CUE_COLOR);
    colorDraftRef.current = ic;
    setColorDraft(ic);
    const is = Number.isFinite(initialSize) ? initialSize : (defaultSize || DEFAULT_CUE_FONT_SCALE);
    sizeDraftRef.current = is;
    setSizeDraft(is);
    const ish = typeof initialShadow === 'string' ? initialShadow : (defaultShadow || DEFAULT_CUE_SHADOW_COLOR);
    shadowDraftRef.current = ish;
    setShadowDraft(ish);
    const ih = Number.isFinite(initialHold) ? initialHold : (defaultHold || 1100);
    holdDraftRef.current = ih; setHoldDraft(ih);
    const ia = CUE_ANIMS.includes(initialAnim) ? initialAnim : (CUE_ANIMS.includes(defaultAnim) ? defaultAnim : 'pop');
    animDraftRef.current = ia; setAnimDraft(ia);
    const iw = Number.isFinite(initialWeight) ? initialWeight : (defaultWeight || DEFAULT_CUE_FONT_WEIGHT);
    weightDraftRef.current = iw; setWeightDraft(iw);
    const ist = Number.isFinite(initialStroke) ? initialStroke : (Number.isFinite(defaultStroke) ? defaultStroke : DEFAULT_CUE_STROKE_EM);
    strokeDraftRef.current = ist; setStrokeDraft(ist);
    const ir = Number.isFinite(initialRotation) ? initialRotation : (defaultRotation || DEFAULT_CUE_ROTATION);
    rotDraftRef.current = ir; setRotDraft(ir);
    const ipl = (initialPlace === 'above' || initialPlace === 'over') ? initialPlace : (defaultPlace || 'over');
    placeDraftRef.current = ipl; setPlaceDraft(ipl);
    const iha = Number.isFinite(initialHalo) ? initialHalo : (Number.isFinite(defaultHalo) ? defaultHalo : DEFAULT_CUE_HALO);
    haloDraftRef.current = iha; setHaloDraft(iha);
    const igl = Number.isFinite(initialGlow) ? initialGlow : (Number.isFinite(defaultGlow) ? defaultGlow : 0);
    glowDraftRef.current = igl; setGlowDraft(igl);
    const igc = typeof initialGlowColor === 'string' ? initialGlowColor : (defaultGlowColor || DEFAULT_CUE_GLOW_COLOR);
    glowColDraftRef.current = igc; setGlowColDraft(igc);
    const ign = Number.isFinite(initialGain) ? initialGain : (Number.isFinite(defaultGain) ? defaultGain : DEFAULT_CUE_GAIN);
    gainDraftRef.current = ign; setGainDraft(ign);
    const isnd = typeof initialSound === 'string' ? initialSound : '';
    soundDraftRef.current = isnd; setSoundLabel(isnd ? '設定済み' : '');
    startRef.current.active = false;
    // initial* は cue 切替時にしか変えない前提。cue.id を依存にして初期化を1回に絞る
    // （依存に入れると入力中の親再描画で操作が巻き戻る）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue.id]);

  // ライブプレビュー: 実スタンプを draft の全パラメータで定期 pop（本番経路と同一の placeNode で描く）。
  useEffect(() => {
    if (!cue.stamp || typeof preview !== 'function') return undefined;
    const fire = () => preview({
      ...cueRef.current,
      stamp: textDraftRef.current || cueRef.current.stamp,
      stampColor: colorDraftRef.current,
      fontScale: sizeDraftRef.current,
      shadowColor: shadowDraftRef.current,
      holdMs: holdDraftRef.current,
      anim: animDraftRef.current,
      fontWeight: weightDraftRef.current,
      strokeEm: strokeDraftRef.current,
      rotation: rotDraftRef.current,
      place: placeDraftRef.current,
      haloStrength: haloDraftRef.current,
      __offset: draftRef.current,
    });
    fire(); // 開始時に即1回
    const ms = (Number.isFinite(cue.holdMs) ? cue.holdMs : 1100) + 150;
    const timer = setInterval(fire, ms);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue.id, cue.stamp, cue.holdMs, preview]);

  const onPointerDown = (e) => {
    const el = e.currentTarget;
    e.preventDefault();
    startRef.current = {
      x: e.clientX, y: e.clientY,
      ox: draftRef.current.x, oy: draftRef.current.y, active: true,
    };
    try { el.setPointerCapture(e.pointerId); } catch { /* 古い環境では無視 */ }
  };
  const onPointerMove = (e) => {
    const s = startRef.current;
    if (!s.active) return;
    const node = anchorRef && anchorRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const fs = stampFontSize(r.width, placeDraftRef.current) || 1; // 0除算ガード（draft の表示位置基準）
    setDraftBoth(clampCueOffset({
      x: s.ox + (e.clientX - s.x) / fs,
      y: s.oy + (e.clientY - s.y) / fs,
    }, -MOVE_LIMIT, MOVE_LIMIT));
  };
  const endDrag = () => { startRef.current.active = false; };

  const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

  // 効果音ファイル選択 → data URL 化。サイズ上限超過は弾く（localStorage 圧迫防止）。
  const onSoundFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 同じファイルを連続選択できるようにリセット
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      if (url.startsWith('data:audio') && url.length <= maxSoundLen) setSoundBoth(url, file.name);
      else setSoundBoth('', `大きすぎ/非対応（上限${Math.round(maxSoundLen / 1024)}KB）`);
    };
    reader.onerror = () => setSoundBoth('', '読み込み失敗');
    reader.readAsDataURL(file);
  };

  return (
    <>
      {/* ドラッグ面（アバター全面）。アバターより上・パネル/サウンドボードより下。 */}
      <div
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'fixed', inset: 0, zIndex: OVERLAY_Z,
          cursor: 'move', touchAction: 'none', background: 'transparent',
        }}
      />
      <DraggablePanel
        id="cueoffset-editor"
        title={`設定: ${cue.label || cue.id}`}
        onClose={onClose}
        closeLabel="設定をやめる"
        resizable={false}
        defaultStyle={{ left: 16, bottom: 16, top: 'auto' }}
        style={{
          zIndex: PANEL_Z, borderRadius: 12, padding: '10px 12px 12px', minWidth: 210,
          background: dark ? 'rgba(40,38,35,0.94)' : 'rgba(255,255,255,0.96)',
          color: dark ? '#F7F1E8' : '#3C3026',
          boxShadow: '0 8px 28px rgba(60,48,38,0.22)',
          border: `1.5px solid ${dark ? 'rgba(255,248,238,0.16)' : 'rgba(60,48,38,0.12)'}`,
          fontFamily: "'Zen Maru Gothic', sans-serif",
        }}
      >
        {/* 本文はドラッグ非対象（パネルはタイトル帯で動かす）。項目が多いので縦スクロール可。 */}
        <div data-no-drag style={{ fontSize: 12, lineHeight: 1.5, maxHeight: '64vh', overflowY: 'auto', overflowX: 'hidden' }}>
          {/* 表示文字: 任意の文字列に上書き（空＝既定に戻る）。cue-stamp は nowrap なので maxLength で横溢れを抑える。 */}
          <div style={{ marginBottom: 9 }}>
            <div style={{ opacity: 0.82, marginBottom: 4 }}>表示する文字</div>
            <input
              type="text"
              data-no-drag
              value={textDraft}
              maxLength={MAX_CUE_TEXT_LEN}
              placeholder={defaultText || cue.stamp || ''}
              onChange={(e) => setTextBoth(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '5px 8px',
                fontSize: 13, lineHeight: 1.3, borderRadius: 8,
                border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.18)'}`,
                background: dark ? 'rgba(70,66,60,0.55)' : 'rgba(255,255,255,0.95)',
                color: dark ? '#F7F1E8' : '#3C3026',
                fontFamily: "'Zen Maru Gothic', sans-serif",
              }}
            />
          </div>
          {/* 文字色: 既定（赤）に戻すには ↺既定。<input type="color"> は常に #rrggbb を返す。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82 }}>文字の色</span>
            <input
              type="color"
              data-no-drag
              value={colorDraft}
              onChange={(e) => setColorBoth(e.target.value)}
              style={{
                width: 40, height: 26, padding: 0, cursor: 'pointer',
                border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.18)'}`,
                borderRadius: 7, background: 'transparent',
              }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{colorDraft}</span>
          </div>
          {/* フォントサイズ: 自動算出サイズへの倍率（既定 1.0=100%）。スライダで 30%〜300%。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>サイズ</span>
            <input
              type="range"
              data-no-drag
              min={MIN_CUE_FONT_SCALE}
              max={MAX_CUE_FONT_SCALE}
              step={0.05}
              value={sizeDraft}
              onChange={(e) => setSizeBoth(clampCueFontScale(Number(e.target.value)))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right' }}>
              {Math.round(sizeDraft * 100)}%
            </span>
          </div>
          {/* 影の色: 縁取り/影の色。既定（濃茶）に戻すには ↺既定。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>影の色</span>
            <input
              type="color"
              data-no-drag
              value={shadowDraft}
              onChange={(e) => setShadowBoth(e.target.value)}
              style={{
                width: 40, height: 26, padding: 0, cursor: 'pointer',
                border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.18)'}`,
                borderRadius: 7, background: 'transparent',
              }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{shadowDraft}</span>
          </div>
          {/* 表示時間: スタンプが出ている長さ（ms）。0.2〜6.0秒。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>表示時間</span>
            <input
              type="range"
              data-no-drag
              min={MIN_CUE_HOLD_MS}
              max={MAX_CUE_HOLD_MS}
              step={100}
              value={holdDraft}
              onChange={(e) => setHoldBoth(clampCueHoldMs(Number(e.target.value)) ?? holdDraft)}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
              {(holdDraft / 1000).toFixed(1)}秒
            </span>
          </div>
          {/* アニメ: pop / rise / shake。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>アニメ</span>
            <select
              data-no-drag
              value={animDraft}
              onChange={(e) => setAnimBoth(e.target.value)}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: 7, cursor: 'pointer',
                border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.18)'}`,
                background: dark ? 'rgba(70,66,60,0.55)' : 'rgba(255,255,255,0.95)',
                color: dark ? '#F7F1E8' : '#3C3026',
                fontFamily: "'Zen Maru Gothic', sans-serif", fontSize: 12,
              }}
            >
              {CUE_ANIMS.map((a) => (<option key={a} value={a}>{ANIM_LABELS[a] || a}</option>))}
            </select>
          </div>
          {/* 文字の太さ: 100〜900（100刻み）。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>太さ</span>
            <input
              type="range"
              data-no-drag
              min={MIN_CUE_FONT_WEIGHT}
              max={MAX_CUE_FONT_WEIGHT}
              step={100}
              value={weightDraft}
              onChange={(e) => setWeightBoth(clampCueFontWeight(Number(e.target.value)))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
              {weightDraft}
            </span>
          </div>
          {/* 縁取りの太さ: 0〜0.2em。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>縁取り</span>
            <input
              type="range"
              data-no-drag
              min={MIN_CUE_STROKE_EM}
              max={MAX_CUE_STROKE_EM}
              step={0.01}
              value={strokeDraft}
              onChange={(e) => setStrokeBoth(clampCueStroke(Number(e.target.value)))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
              {strokeDraft.toFixed(2)}em
            </span>
          </div>
          {/* 回転: スタンプの傾き（±45°）。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>回転</span>
            <input
              type="range" data-no-drag
              min={-MAX_CUE_ROTATION} max={MAX_CUE_ROTATION} step={1}
              value={rotDraft}
              onChange={(e) => setRotBoth(clampNum(Number(e.target.value), -MAX_CUE_ROTATION, MAX_CUE_ROTATION, 0))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right' }}>{Math.round(rotDraft)}°</span>
          </div>
          {/* 表示位置: 頭の上 / 重ねる。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>表示位置</span>
            <select
              data-no-drag value={placeDraft}
              onChange={(e) => setPlaceBoth(e.target.value === 'above' ? 'above' : 'over')}
              style={{
                flex: 1, padding: '4px 6px', borderRadius: 7, cursor: 'pointer',
                border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.18)'}`,
                background: dark ? 'rgba(70,66,60,0.55)' : 'rgba(255,255,255,0.95)',
                color: dark ? '#F7F1E8' : '#3C3026', fontFamily: "'Zen Maru Gothic', sans-serif", fontSize: 12,
              }}
            >
              <option value="above">頭の上</option>
              <option value="over">重ねる</option>
            </select>
          </div>
          {/* 白フチ（白いハロー）の強さ 0〜100%。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>白フチ</span>
            <input
              type="range" data-no-drag min={0} max={1} step={0.05}
              value={haloDraft}
              onChange={(e) => setHaloBoth(clampNum(Number(e.target.value), 0, 1, DEFAULT_CUE_HALO))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right' }}>{Math.round(haloDraft * 100)}%</span>
          </div>
          {/* 発光フラッシュ: 強さ（0=off）＋色。アバター全体のグロー演出。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>発光</span>
            <input
              type="range" data-no-drag min={0} max={MAX_CUE_GLOW} step={0.5}
              value={glowDraft}
              onChange={(e) => setGlowBoth(clampNum(Number(e.target.value), 0, MAX_CUE_GLOW, 0))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <input
              type="color" data-no-drag value={glowColDraft}
              onChange={(e) => setGlowColBoth(e.target.value)}
              style={{
                width: 34, height: 24, padding: 0, cursor: 'pointer',
                border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.18)'}`,
                borderRadius: 6, background: 'transparent',
              }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 24, textAlign: 'right' }}>{glowDraft.toFixed(1)}</span>
          </div>
          {/* 効果音の音量 0〜300%。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>音量</span>
            <input
              type="range" data-no-drag min={0} max={MAX_CUE_GAIN} step={0.05}
              value={gainDraft}
              onChange={(e) => setGainBoth(clampNum(Number(e.target.value), 0, MAX_CUE_GAIN, DEFAULT_CUE_GAIN))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right' }}>{Math.round(gainDraft * 100)}%</span>
          </div>
          {/* 効果音の差し替え（ローカルのみ・relay しない）。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ opacity: 0.82, whiteSpace: 'nowrap' }}>効果音</span>
            <label data-no-drag style={{ ...btnStyle(dark), flex: 1, textAlign: 'center', padding: '5px 8px' }}>
              ファイル選択
              <input type="file" accept="audio/*" data-no-drag onChange={onSoundFile} style={{ display: 'none' }} />
            </label>
            <button type="button" data-no-drag onClick={() => setSoundBoth('', '')} style={btnStyle(dark)}>クリア</button>
          </div>
          <div style={{ opacity: 0.7, marginBottom: 9, fontSize: 11 }}>
            {soundLabel || '既定（合成音）'}
          </div>
          <div style={{ opacity: 0.82, marginBottom: 7 }}>
            アバターをドラッグして位置を調整
          </div>
          <div style={{
            display: 'flex', gap: 14, marginBottom: 9,
            fontVariantNumeric: 'tabular-nums', fontWeight: 700,
          }}>
            <span>左右 {pct(draft.x)}</span>
            <span>上下 {pct(draft.y)}</span>
          </div>
        </div>
        {/* 操作ボタンはスクロール対象外の固定フッタ。項目が多くても 保存/やめる/既定 が常に押せるように。 */}
        <div data-no-drag style={{
          display: 'flex', gap: 6, marginTop: 10, paddingTop: 10,
          borderTop: `1px solid ${dark ? 'rgba(255,248,238,0.14)' : 'rgba(60,48,38,0.12)'}`,
        }}>
            <button
              type="button"
              data-no-drag
              onClick={() => onCommit({
                offset: draftRef.current,
                text: textDraftRef.current,
                color: colorDraftRef.current,
                size: sizeDraftRef.current,
                shadow: shadowDraftRef.current,
                hold: holdDraftRef.current,
                anim: animDraftRef.current,
                weight: weightDraftRef.current,
                stroke: strokeDraftRef.current,
                rotation: rotDraftRef.current,
                place: placeDraftRef.current,
                halo: haloDraftRef.current,
                glow: glowDraftRef.current,
                glowColor: glowColDraftRef.current,
                gain: gainDraftRef.current,
                sound: soundDraftRef.current,
              })}
              style={btnStyle(dark, true)}
            >✓ 保存</button>
            <button type="button" data-no-drag onClick={onClose} style={btnStyle(dark)}>✕ やめる</button>
            <button
              type="button"
              data-no-drag
              onClick={() => {
                setDraftBoth({ x: 0, y: 0 });
                setTextBoth(defaultText || cue.stamp || '');
                setColorBoth(defaultColor || DEFAULT_CUE_COLOR);
                setSizeBoth(defaultSize || DEFAULT_CUE_FONT_SCALE);
                setShadowBoth(defaultShadow || DEFAULT_CUE_SHADOW_COLOR);
                setHoldBoth(Number.isFinite(defaultHold) ? defaultHold : 1100);
                setAnimBoth(CUE_ANIMS.includes(defaultAnim) ? defaultAnim : 'pop');
                setWeightBoth(defaultWeight || DEFAULT_CUE_FONT_WEIGHT);
                setStrokeBoth(Number.isFinite(defaultStroke) ? defaultStroke : DEFAULT_CUE_STROKE_EM);
                setRotBoth(Number.isFinite(defaultRotation) ? defaultRotation : DEFAULT_CUE_ROTATION);
                setPlaceBoth(defaultPlace === 'above' ? 'above' : 'over');
                setHaloBoth(Number.isFinite(defaultHalo) ? defaultHalo : DEFAULT_CUE_HALO);
                setGlowBoth(Number.isFinite(defaultGlow) ? defaultGlow : 0);
                setGlowColBoth(defaultGlowColor || DEFAULT_CUE_GLOW_COLOR);
                setGainBoth(Number.isFinite(defaultGain) ? defaultGain : DEFAULT_CUE_GAIN);
                setSoundBoth('', '');
              }}
              style={btnStyle(dark)}
            >↺ 既定</button>
          </div>
      </DraggablePanel>
    </>
  );
}

export { CueOffsetEditor };
