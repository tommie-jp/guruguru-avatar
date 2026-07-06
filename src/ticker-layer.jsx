// CNN「BREAKING NEWS」風の下部テロップ（DOM/CSS・お絵かきとは完全に独立したレイヤー）。
//
// 役割は2つ（draw-layer.jsx と同じ edit/view 分割）:
//   - mode='edit'（操作側 tx/local）: 下部バーのプレビュー＋コントロールUI（文言・背景色・文字色・
//       速度・濃さ=不透明度・表示ON/OFF）＋バー左端の位置アイコン(⠿・お絵かきのハンドルと同じ見た目)を
//       ドラッグで上下位置を調整。設定が変わるたび onConfigChange(config) を呼ぶ → camera-app が relay で rx(OBS) へ送る。
//   - mode='view'（OBS 側 rx）: setConfig(data) で受信設定を反映し、下部バーを描くだけ（操作UI無し）。
//
// クロールのアニメは Web Animations API で rx がローカル駆動する（受信するのは設定だけ・毎フレームは
// 流れない）。テキストを2コピー並べ translateX(0→-50%) で継ぎ目なくループする。各コピーは
// 最低でもバー幅（100vw）を占めるので、短い文言でも隙間なくループする。
//
// レイヤー: 帯は z=4（DrawLayer=6 より下）＝お絵かきがテロップの上に乗る。帯は pointerEvents:none で
// アバター操作を邪魔しない。操作コントロールは別の最前面パネル（DraggablePanel z=9）として出す。
// 透過: バー以外は塗らない。既存の obsMode 透過にそのまま乗る。
// 検証: 受信値は ticker-config.js の normalizeTickerConfig で必ず正規化してから使う（無認証 WS）。
import React from 'react';
import { DraggablePanel } from './draggable-panel.jsx';
import {
  TICKER_DEFAULTS, OPACITY_MIN,
  normalizeTickerConfig, crawlDurationMs,
} from './ticker-config.js';

const { useState, useRef, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } = React;

const FONT_FAMILY = "'Zen Maru Gothic', sans-serif";
const SEND_DEBOUNCE_MS = 160;    // 設定変更→送信のまとめ送り
const POS_SEND_MS = 50;          // 上下ドラッグ中の位置送信の間引き（約20fps。末尾は pointerup で確定）
const GAP_VW = 6;                // 文言の繰り返し間隔（長文が続けて並ばないように）
// クロールの1周分（トラックの2コピーぶん＝ -50%）。Web Animations API で駆動する。
const CRAWL_KEYFRAMES = [{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }];

// 速度プリセット（px/秒）。SPEED_MIN..SPEED_MAX の範囲内。
const SPEED_PRESETS = [
  { label: 'ゆっくり', v: 45 },
  { label: '標準', v: 90 },
  { label: '速い', v: 160 },
  { label: '高速', v: 260 },
];

// 色/文言/速度/表示の簡易永続化（localStorage）。失敗は握りつぶす（本質ではない）。
const LS_KEY = 'guruguru-ticker';
function loadPrefs() {
  try { return normalizeTickerConfig(JSON.parse(localStorage.getItem(LS_KEY))); }
  catch { return { ...TICKER_DEFAULTS }; }
}
function savePrefs(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* noop */ }
}

// CSS の 100vh に一致するビューポート高(px)。window.innerHeight はモバイルの動的 URL バーで
// 100vh とズレるため、レイアウトビューポート＝documentElement.clientHeight を優先する。
function viewportHeightPx() {
  if (typeof document !== 'undefined' && document.documentElement?.clientHeight) return document.documentElement.clientHeight;
  if (typeof window !== 'undefined' && window.innerHeight) return window.innerHeight;
  return 1;
}

function TickerLayerImpl(props, ref) {
  const { mode, showControls = false, controlsDefaultStyle } = props;
  const isEdit = mode === 'edit';

  // 最新の onConfigChange を ref で持つ（再購読せずに中身だけ差し替え）。
  const onConfigChangeRef = useRef(props.onConfigChange);
  onConfigChangeRef.current = props.onConfigChange;

  // edit は前回の保存値から、view は既定（非表示）から始める。
  // state setter は setCfg。命令的 API の公開名 setConfig と衝突させない。
  const [config, setCfg] = useState(() => (isEdit ? loadPrefs() : { ...TICKER_DEFAULTS }));
  // getConfig（命令的 API）が最新値を返せるよう ref に写す。
  const configRef = useRef(config);
  configRef.current = config;

  const sendTimerRef = useRef(0);
  const measureRef = useRef(null);           // 1コピー目の実幅（クロール時間の算出用）
  const trackRef = useRef(null);             // クロールするトラック（WAAP を当てる要素）
  const animRef = useRef(null);              // 実行中の Animation（durMs 変更時に timing だけ差し替える）
  const [durMs, setDurMs] = useState(crawlDurationMs(0, config.speed));

  // --- tx: 設定変更を relay で rx へ送る -----------------------------------
  // 送信境界で normalizeTickerConfig を通し「送るのは常に正規化済み」を保証する（防御）。
  const sendNow = useCallback((cfg) => {
    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = 0;
    onConfigChangeRef.current?.(normalizeTickerConfig(cfg));
  }, []);
  const scheduleSend = useCallback((cfg) => {
    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => sendNow(cfg), SEND_DEBOUNCE_MS);
  }, [sendNow]);

  // ローカル状態を確定する（正規化→ref即反映→setCfg）。保存/送信は呼び出し側が足す。
  // 副作用を setCfg の updater 外で行う（StrictMode の updater 二重実行で多重送信しないため）。
  const commitLocal = useCallback((patch) => {
    const next = normalizeTickerConfig({ ...configRef.current, ...patch });
    configRef.current = next; // 同一tick内の連続更新が正しく積み上がるよう即反映
    setCfg(next);
    return next;
  }, []);

  // edit: 1フィールド更新して保存＋送信。文字/色/速度/濃さはデバウンス、表示ON/OFFは即時送信
  // （消し忘れ防止＝トグル直後にタブを閉じても rx へ確実に届く）。
  const updateField = useCallback((patch, immediate = false) => {
    if (!isEdit) return;
    const next = commitLocal(patch);
    savePrefs(next);
    if (immediate) sendNow(next); else scheduleSend(next);
  }, [isEdit, commitLocal, sendNow, scheduleSend]);

  // --- tx: 位置アイコンで上下ドラッグ（上下のみ・左右は動かさない） --------------
  const barRef = useRef(null);        // バー本体（高さ計測＝画面内クランプ用）
  const posThrottleRef = useRef(0);   // ドラッグ中送信の間引きタイマー
  const posCleanupRef = useRef(null); // 実行中ドラッグの後始末（アンマウント時にも呼ぶ）

  // ドラッグ中: 位置をローカル即反映（プレビュー）＋送信は間引く（保存/確定は pointerup）。
  const updatePosLive = useCallback((posY) => {
    commitLocal({ posY });
    if (!posThrottleRef.current) {
      posThrottleRef.current = setTimeout(() => { posThrottleRef.current = 0; sendNow(configRef.current); }, POS_SEND_MS);
    }
  }, [commitLocal, sendNow]);

  const onPosPointerDown = useCallback((e) => {
    if (!isEdit) return;
    e.preventDefault();
    const el = e.currentTarget;
    // 描画は bottom:posY*100vh（CSS vh）。ドラッグ計算も vh に一致させるため clientHeight を使う
    // （window.innerHeight はモバイルの動的URLバーで 100vh とズレて追従倍率が狂う）。
    const vh = viewportHeightPx();
    const startY = e.clientY;
    const startBottomPx = (configRef.current.posY || 0) * vh;
    const barH = barRef.current?.offsetHeight || 0;
    try { el.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
    const move = (ev) => {
      const deltaY = ev.clientY - startY;                                     // 上へ動かすと負
      const maxBottom = Math.max(0, vh - barH);                               // 画面内に収まる上限
      const bottomPx = Math.min(maxBottom, Math.max(0, startBottomPx - deltaY)); // 上ドラッグ→上昇
      updatePosLive(vh > 0 ? bottomPx / vh : 0);
    };
    // pointerup / pointercancel いずれでも必ず後始末する（タッチの OS ジェスチャ横取り＝
    // pointercancel でもリスナ/状態を残さない。capture したハンドル要素に張るので確実に届く）。
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      clearTimeout(posThrottleRef.current); posThrottleRef.current = 0;
      posCleanupRef.current = null;
      savePrefs(configRef.current);  // 最終位置を保存
      sendNow(configRef.current);    // 最終位置を確定送信
    };
    posCleanupRef.current = () => { // アンマウント時は後始末のみ（保存/送信はしない）
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      clearTimeout(posThrottleRef.current); posThrottleRef.current = 0;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }, [isEdit, updatePosLive, sendNow]);

  // アンマウント時に実行中ドラッグのリスナ/タイマーを掃除。
  useEffect(() => () => {
    clearTimeout(posThrottleRef.current);
    if (posCleanupRef.current) posCleanupRef.current();
  }, []);

  // --- クロール時間の算出（幅 / 速度）。文言・速度・表示・リサイズで測り直す。 ----
  useLayoutEffect(() => {
    function measure() {
      const el = measureRef.current;
      if (!el) return;
      setDurMs(crawlDurationMs(el.offsetWidth, config.speed));
    }
    measure();
    window.addEventListener('resize', measure);
    // Web フォント確定後に幅が変わるので測り直す（初回のガタつき防止）。
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => { if (!cancelled) measure(); }).catch(() => {});
    }
    return () => { cancelled = true; window.removeEventListener('resize', measure); };
  }, [config.text, config.speed, config.visible]);

  // クロールを Web Animations API で駆動する。durMs（幅/速度）が変わっても新規アニメを作らず
  // timing だけ差し替え、進捗(0..1)を比例保存する。これで「速度変更・文言編集・リサイズ・
  // フォント確定」で duration が変わっても、走行位置が不連続に横飛びしない（CSS animation-duration
  // を走行中に差し替えると frac(currentTime/newDur) 再計算で飛ぶ問題を回避）。
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) { // 非表示 → アニメ破棄
      if (animRef.current) { animRef.current.cancel(); animRef.current = null; }
      return;
    }
    if (!animRef.current) {
      animRef.current = track.animate(CRAWL_KEYFRAMES, { duration: durMs, iterations: Infinity, easing: 'linear' });
      return;
    }
    const anim = animRef.current;
    const oldDur = anim.effect.getComputedTiming().duration || durMs;
    const ct = Number(anim.currentTime) || 0;
    const frac = oldDur > 0 ? (ct % oldDur) / oldDur : 0; // 現在の周内進捗
    anim.effect.updateTiming({ duration: durMs });
    anim.currentTime = frac * durMs;                      // 視覚位置を保つ（横飛び防止）
  }, [durMs, config.visible, config.text]);

  // アンマウント時にクロールアニメを破棄。
  useEffect(() => () => { if (animRef.current) { animRef.current.cancel(); animRef.current = null; } }, []);

  // アンマウント時: 保留中の送信があれば破棄せず flush する（最終状態＝特に visible:false を
  // 取りこぼさない。tickerMode 切替でのアンマウント時に有効。タブ完全終了時はベストエフォート）。
  useEffect(() => () => {
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = 0;
      if (isEdit) onConfigChangeRef.current?.(normalizeTickerConfig(configRef.current));
    }
  }, [isEdit]);

  // --- 命令的 API（camera-app から呼ぶ） ---------------------------------
  useImperativeHandle(ref, () => ({
    // rx: 受信設定を検証して反映する（無認証 WS 前提）。
    setConfig(data) {
      if (isEdit) return; // 操作側は自分の入力を正とする（受信で上書きしない）
      setCfg(normalizeTickerConfig(data));
    },
    // tx: 後着 OBS への再送用。表示中かつ文言があるときだけ返す（無ければ null＝送らない）。
    getConfig() {
      const c = configRef.current;
      return (c.visible && c.text) ? normalizeTickerConfig(c) : null;
    },
  }), [isEdit]);

  const showBar = config.visible && !!config.text;

  return (
    <>
      {/* テロップ帯。z=4 は DrawLayer(z=6) より下＝お絵かきがテロップの上に乗る（tx の要望）。
          帯自体は入力を受けない（pointerEvents:none）ので下のアバター操作を邪魔しない。
          下端からの距離 posY（ビューポート高の割合）で上下に配置。左右は全幅固定。 */}
      {showBar ? (
        <div
          ref={barRef}
          aria-hidden={!isEdit}
          style={{
            position: 'fixed', left: 0, right: 0, bottom: `${config.posY * 100}vh`,
            zIndex: 4, pointerEvents: 'none',
          }}
        >
          <div
            // バー本体。全幅＋背景色＋不透明度。はみ出す文言はクリップしてクロールで見せる。
            style={{
              width: '100%', overflow: 'hidden', boxSizing: 'border-box',
              background: config.bgColor, opacity: config.opacity,
              boxShadow: '0 -2px 8px rgba(0,0,0,0.25)',
            }}
          >
            <div
              ref={trackRef}
              // クロールするトラック（2コピー）。-50% で継ぎ目なくループ。動きは WAAP（上の effect）が当てる。
              style={{
                display: 'inline-flex', flexWrap: 'nowrap', whiteSpace: 'nowrap',
                willChange: 'transform',
              }}
            >
              {[0, 1].map((i) => (
                <span
                  key={i}
                  ref={i === 0 ? measureRef : undefined}
                  aria-hidden={i === 1 ? 'true' : undefined}
                  style={{
                    display: 'inline-block', boxSizing: 'border-box',
                    minWidth: '100vw',            // 短文でも最低バー幅＝隙間なくループ
                    paddingRight: `${GAP_VW}vw`,  // 長文の繰り返し間隔
                    color: config.textColor,
                    fontFamily: FONT_FAMILY, fontWeight: 800,
                    fontSize: 'clamp(16px, 3.4vmin, 30px)', lineHeight: 1.7,
                    letterSpacing: '0.02em',
                  }}
                >
                  {config.text}
                </span>
              ))}
            </div>
          </div>

          {/* 位置アイコン。tx(操作側)のバー左端にだけ出す。お絵かきツールのドラッグハンドルと同じ ⠿ 見た目。
              ドラッグで上下だけ移動する（ダブルクリックで最下部へ）。帯は pointerEvents:none だがここは auto。 */}
          {isEdit ? (
            <div
              onPointerDown={onPosPointerDown}
              onDoubleClick={() => updateField({ posY: 0 }, true)}
              title="ドラッグで上下に移動（ダブルクリックで最下部へ）"
              aria-label="テロップの上下位置"
              style={{
                position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                pointerEvents: 'auto', cursor: 'ns-resize', touchAction: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '6px 8px', borderRadius: 7,
                background: 'rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.85)',
                fontSize: 16, lineHeight: 1, letterSpacing: 1, userSelect: 'none',
              }}
            >⠿</div>
          ) : null}
        </div>
      ) : null}

      {showControls ? (
        <TickerControls
          config={config}
          onText={(v) => updateField({ text: v })}
          onBgColor={(v) => updateField({ bgColor: v })}
          onTextColor={(v) => updateField({ textColor: v })}
          onSpeed={(v) => updateField({ speed: v })}
          onOpacity={(v) => updateField({ opacity: v })}
          onToggleVisible={() => updateField({ visible: !config.visible }, true)}
          defaultStyle={controlsDefaultStyle}
        />
      ) : null}
    </>
  );
}

const CTRLBTN_STYLE = (on) => ({
  flex: '0 0 auto',
  border: 'none', borderRadius: 7, cursor: 'pointer',
  padding: '5px 10px', fontSize: 12, fontWeight: 700,
  background: on ? '#e5484d' : 'rgba(255,255,255,0.14)', color: '#fff',
});

const DEFAULT_CTRL_POS = { top: 10, left: '50%', transform: 'translateX(-50%)' };

function TickerControls({ config, onText, onBgColor, onTextColor, onSpeed, onOpacity, onToggleVisible, defaultStyle }) {
  // DrawToolbar と同じ作り: 左端に固定ドラッグハンドル＋右に操作子の横スクロール帯。
  return (
    <DraggablePanel
      id="ticker-controls"
      resizable={false}
      defaultStyle={defaultStyle || DEFAULT_CTRL_POS}
      style={{
        zIndex: 9, pointerEvents: 'auto', touchAction: 'auto',
        display: 'flex', gap: 6, alignItems: 'stretch',
        padding: 5, background: 'rgba(30,30,34,0.9)', color: '#fff',
        borderRadius: 10, fontSize: 12, fontFamily: FONT_FAMILY,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)', userSelect: 'none',
        maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box',
      }}
    >
      <div
        title="ドラッグで移動（ダブルクリックで位置を戻す）"
        style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'move', touchAction: 'none', padding: '0 8px',
          borderRadius: 7, background: 'rgba(255,255,255,0.16)',
          fontSize: 16, lineHeight: 1, letterSpacing: 1, color: 'rgba(255,255,255,0.85)',
        }}
      >⠿</div>
      <div
        className="cuebar-scroll"
        data-no-drag
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          flex: '1 1 auto', minWidth: 0,
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap',
          overflowX: 'auto', overflowY: 'hidden', touchAction: 'pan-x',
          WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain', overscrollBehaviorY: 'none',
          padding: '1px 2px',
        }}
      >
        <button
          onClick={onToggleVisible}
          style={CTRLBTN_STYLE(config.visible)}
          title={config.visible ? 'テロップを隠す' : 'テロップを表示'}
        >{config.visible ? '表示中' : '非表示'}</button>
        <input
          type="text" value={config.text}
          onChange={(e) => onText(e.target.value)}
          placeholder="速報テロップの文言…"
          aria-label="テロップの文言"
          style={{
            flex: '1 1 160px', minWidth: 120, height: 26, borderRadius: 7,
            border: 'none', padding: '0 8px', fontSize: 13,
            background: 'rgba(255,255,255,0.92)', color: '#111',
          }}
        />
        <label style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 3 }} title="背景色">
          <span style={{ opacity: 0.8 }}>背景</span>
          <input
            type="color" value={config.bgColor} onChange={(e) => onBgColor(e.target.value)}
            aria-label="背景色"
            style={{ width: 28, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          />
        </label>
        <label style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 3 }} title="文字色">
          <span style={{ opacity: 0.8 }}>文字</span>
          <input
            type="color" value={config.textColor} onChange={(e) => onTextColor(e.target.value)}
            aria-label="文字色"
            style={{ width: 28, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          />
        </label>
        <select
          value={nearestPreset(config.speed)}
          onChange={(e) => onSpeed(Number(e.target.value))}
          title="流れる速さ" aria-label="流れる速さ"
          style={{
            flex: '0 0 auto', height: 28, borderRadius: 7, cursor: 'pointer',
            border: 'none', padding: '0 6px', fontSize: 12, fontWeight: 700,
            background: 'rgba(255,255,255,0.16)', color: '#fff',
          }}
        >
          {SPEED_PRESETS.map((p) => (
            <option key={p.v} value={p.v} style={{ color: '#000', background: '#fff' }}>速さ: {p.label}</option>
          ))}
        </select>
        <label
          style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4 }}
          title="テロップの濃さ（右=不透明 / 左=透明）"
        >
          <span style={{ opacity: 0.8 }}>濃さ</span>
          <input
            type="range" min={OPACITY_MIN} max={1} step={0.05}
            value={config.opacity}
            onChange={(e) => onOpacity(Number(e.target.value))}
            aria-label="テロップの濃さ（不透明度）"
            style={{ flex: '0 0 auto', width: 80, cursor: 'pointer' }}
          />
        </label>
      </div>
    </DraggablePanel>
  );
}

// 現在速度に最も近いプリセット値を返す（select の選択表示用）。
// config.speed は normalizeTickerConfig 済み（SPEED_MIN..SPEED_MAX の整数）なのでそのまま使う。
function nearestPreset(speed) {
  let best = SPEED_PRESETS[0].v;
  let bestD = Infinity;
  for (const p of SPEED_PRESETS) {
    const d = Math.abs(p.v - speed);
    if (d < bestD) { bestD = d; best = p.v; }
  }
  return best;
}

export const TickerLayer = forwardRef(TickerLayerImpl);
