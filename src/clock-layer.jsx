// 日付時刻テロップ（画面右上に出る時計・DOM/CSS・お絵かき/テロップとは独立したレイヤー）。
//
// 役割は2つ（ticker-layer.jsx と同じ edit/view 分割）:
//   - mode='edit'（操作側 tx/local）: 時計のプレビュー＋コントロールUI（表示ON/OFF・文字色・背景色・
//       文字サイズ）。設定が変わるたび onConfigChange(config) を呼ぶ → camera-app が relay で rx へ送る。
//   - mode='view'（OBS 側 rx）: setConfig(data) で受信設定を反映し、時計を描くだけ（操作UI無し）。
//
// 時刻そのものは同期しない＝各端末が自分のローカル時刻を毎秒更新して描く（毎フレームは流れない）。
// レイヤー: 時計は z=4（DrawLayer=6 より下）＝お絵かきが時計の上に乗る。pointerEvents:none で
// アバター操作を邪魔しない。操作コントロールは最前面パネル（z=9）。
// 検証: 受信値は clock-config.js の normalizeClockConfig で必ず正規化してから使う（無認証 WS）。
import React from 'react';
import { DraggablePanel } from './draggable-panel.jsx';
import {
  CLOCK_DEFAULTS, FONT_MIN, FONT_MAX,
  normalizeClockConfig, formatClockTime,
} from './clock-config.js';

const { useState, useRef, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } = React;

const FONT_FAMILY = "'Zen Maru Gothic', sans-serif";
const SEND_DEBOUNCE_MS = 160;   // 設定変更→送信のまとめ送り
const TICK_MS = 1000;           // ローカル時刻の更新間隔

// 設定の簡易永続化（localStorage）。失敗は握りつぶす。
const LS_KEY = 'guruguru-clock';
function loadPrefs() {
  try { return normalizeClockConfig(JSON.parse(localStorage.getItem(LS_KEY))); }
  catch { return { ...CLOCK_DEFAULTS }; }
}
function savePrefs(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* noop */ }
}

function ClockLayerImpl(props, ref) {
  const { mode, showControls = false, controlsDefaultStyle } = props;
  const isEdit = mode === 'edit';

  const onConfigChangeRef = useRef(props.onConfigChange);
  onConfigChangeRef.current = props.onConfigChange;

  // edit は前回の保存値から、view は既定（非表示）から始める。
  const [config, setCfg] = useState(() => (isEdit ? loadPrefs() : { ...CLOCK_DEFAULTS }));
  const configRef = useRef(config);
  configRef.current = config;

  const sendTimerRef = useRef(0);
  // 表示する時刻文字列。初期値は現在時刻（初回フレームでも空にしない）。
  const [nowStr, setNowStr] = useState(() => formatClockTime(new Date()));

  // 表示中のみ、ローカル時刻を毎秒更新する。
  // useLayoutEffect にして、非表示→表示の切替時に paint 前へ時刻を更新する（古い凍結時刻が
  // 1フレーム焼き込まれるのを防ぐ。非表示中は nowStr がマウント時刻のまま止まるため）。
  useLayoutEffect(() => {
    if (!config.visible) return undefined;
    const update = () => setNowStr(formatClockTime(new Date()));
    update();
    const id = setInterval(update, TICK_MS);
    return () => clearInterval(id);
  }, [config.visible]);

  // --- tx: 設定変更を relay で rx へ送る -----------------------------------
  const sendNow = useCallback((cfg) => {
    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = 0;
    onConfigChangeRef.current?.(normalizeClockConfig(cfg));
  }, []);
  const scheduleSend = useCallback((cfg) => {
    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => sendNow(cfg), SEND_DEBOUNCE_MS);
  }, [sendNow]);

  // edit: 1フィールド更新して保存＋送信。表示ON/OFFは即時、文字色/背景色/サイズはデバウンス。
  // 副作用は setCfg の updater 外（StrictMode の二重実行で多重送信しないため）。
  const updateField = useCallback((patch, immediate = false) => {
    if (!isEdit) return;
    const next = normalizeClockConfig({ ...configRef.current, ...patch });
    configRef.current = next;
    setCfg(next);
    savePrefs(next);
    if (immediate) sendNow(next); else scheduleSend(next);
  }, [isEdit, sendNow, scheduleSend]);

  // アンマウント時: 保留中の送信があれば破棄せず flush（visible:false 等を取りこぼさない）。
  useEffect(() => () => {
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = 0;
      if (isEdit) onConfigChangeRef.current?.(normalizeClockConfig(configRef.current));
    }
  }, [isEdit]);

  // --- 命令的 API（camera-app から呼ぶ） ---------------------------------
  useImperativeHandle(ref, () => ({
    setConfig(data) {
      if (isEdit) return; // 操作側は自分の入力を正とする
      setCfg(normalizeClockConfig(data));
    },
    // tx: 後着 OBS への再送用。表示中のときだけ返す（無ければ null＝送らない）。
    getConfig() {
      const c = configRef.current;
      return c.visible ? normalizeClockConfig(c) : null;
    },
  }), [isEdit]);

  return (
    <>
      {/* 時計。既定は画面の右上。z=4 は DrawLayer(6) より下＝お絵かきが時計の上に乗る。
          pointerEvents:none で下のアバター操作を邪魔しない。 */}
      {config.visible ? (
        <div
          aria-hidden={!isEdit}
          style={{
            position: 'fixed',
            top: 'calc(12px + env(safe-area-inset-top))',
            right: 'calc(12px + env(safe-area-inset-right))',
            zIndex: 4, pointerEvents: 'none',
          }}
        >
          <div
            style={{
              background: config.bgColor, color: config.textColor,
              fontFamily: FONT_FAMILY, fontWeight: 800,
              fontSize: config.fontSize, lineHeight: 1.2, letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
              padding: '0.24em 0.6em', borderRadius: 8, whiteSpace: 'nowrap',
              boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
            }}
          >{nowStr}</div>
        </div>
      ) : null}

      {showControls ? (
        <ClockControls
          config={config}
          onToggleVisible={() => updateField({ visible: !config.visible }, true)}
          onTextColor={(v) => updateField({ textColor: v })}
          onBgColor={(v) => updateField({ bgColor: v })}
          onFontSize={(v) => updateField({ fontSize: v })}
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

function ClockControls({ config, onToggleVisible, onTextColor, onBgColor, onFontSize, defaultStyle }) {
  // ticker/draw のツールバーと同じ作り: 左端ドラッグハンドル＋右に操作子の横スクロール帯。
  return (
    <DraggablePanel
      id="clock-controls"
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
          title={config.visible ? '時計を隠す' : '時計を表示'}
        >{config.visible ? '表示中' : '非表示'}</button>
        <span style={{ flex: '0 0 auto', opacity: 0.85 }}>時計</span>
        <label style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 3 }} title="文字色">
          <span style={{ opacity: 0.8 }}>文字</span>
          <input
            type="color" value={config.textColor} onChange={(e) => onTextColor(e.target.value)}
            aria-label="時計の文字色"
            style={{ width: 28, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          />
        </label>
        <label style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 3 }} title="背景色">
          <span style={{ opacity: 0.8 }}>背景</span>
          <input
            type="color" value={config.bgColor} onChange={(e) => onBgColor(e.target.value)}
            aria-label="時計の背景色"
            style={{ width: 28, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          />
        </label>
        <label style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4 }} title="文字の大きさ">
          <span style={{ opacity: 0.8 }}>サイズ</span>
          <input
            type="range" min={FONT_MIN} max={FONT_MAX} step={2}
            value={config.fontSize}
            onChange={(e) => onFontSize(Number(e.target.value))}
            aria-label="時計の文字サイズ"
            style={{ flex: '0 0 auto', width: 84, cursor: 'pointer' }}
          />
        </label>
      </div>
    </DraggablePanel>
  );
}

export const ClockLayer = forwardRef(ClockLayerImpl);
