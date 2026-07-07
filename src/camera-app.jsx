import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig, { avatars, getAvatar } from './character-config';
import { parseCameraParam, resolveCameraDevice, formatCameraLabel } from './camera-config';
import { useFacePose } from './face/use-face-pose';
import { useMouseTarget } from './face/use-mouse-target';
import { useMicLevel } from './face/use-mic-level';
import { composeSignals } from './face/compose-signals';
import { parseObsParams } from './obs-mode';
import { parseRelayMode } from './relay-mode';
import { parseDrawParams } from './draw-mode';
import { parseTickerParams } from './ticker-config';
import { parseClockParams } from './clock-config';
import { computeStateFrame, createExprState } from './face/avatar-state';
import { computeDirectionRange, rawDirForDisplay } from './face/direction-range';
import {
  computeSlidePoseCompX, computeSlidePoseCompY, computeZoomPitchComp,
} from './face/calibrate-comp';
import { compensateRollForYaw } from './face/compensate-roll-for-yaw';
import { compensateScaleForMouth } from './face/mouth-compensated-scale';
import { applyState, createSmoothState } from './face/apply-state';
import { encodeStateFrame, decodeStateFrame } from './face/state-codec';
import { useRelay } from './face/use-relay';
import { DraggablePanel } from './draggable-panel.jsx';
import { SpriteAvatar } from './sprite-avatar';
import { QRCodeSVG } from 'qrcode.react';
import { installMobileHardening } from './mobile-hardening.js';
import { applyThemeColor } from './theme-color.js';
import { createSoundboard } from './cue-audio.js';
import { createCueController, isTypingTarget, parseCueParam } from './cue-system.js';
import { CueStampLayer } from './cue-stamp.jsx';
import { DrawLayer } from './draw-layer.jsx';
import { TickerLayer } from './ticker-layer.jsx';
import { ClockLayer } from './clock-layer.jsx';
import { CueOffsetEditor } from './cue-offset-editor.jsx';
import { CueBar, CUEBAR_CTRL_W, CUEBAR_COL_W, CUEBAR_BTN_H } from './cue-bar.jsx';
import { SlideBar } from './slide-bar.jsx';
import {
  loadCueOffsets, saveCueOffsets, clampCueOffset,
  sanitizeCueOffsets, equalCueOffsetMaps,
  loadCueTexts, saveCueTexts, sanitizeCueTexts, MAX_CUE_TEXT_LEN,
  loadCueColors, saveCueColors, sanitizeCueColors, normalizeHexColor, DEFAULT_CUE_COLOR,
  loadCueSizes, saveCueSizes, sanitizeCueSizes, clampCueFontScale, DEFAULT_CUE_FONT_SCALE,
  loadCueShadows, saveCueShadows, sanitizeCueShadows, DEFAULT_CUE_SHADOW_COLOR,
  loadCueHolds, saveCueHolds, sanitizeCueHolds, clampCueHoldMs,
  loadCueAnims, saveCueAnims, sanitizeCueAnims, normalizeCueAnim,
  loadCueWeights, saveCueWeights, sanitizeCueWeights, clampCueFontWeight, DEFAULT_CUE_FONT_WEIGHT,
  loadCueStrokes, saveCueStrokes, sanitizeCueStrokes, clampCueStroke, DEFAULT_CUE_STROKE_EM,
  cueRotationStore, MAX_CUE_ROTATION, DEFAULT_CUE_ROTATION,
  cuePlaceStore, cueHaloStore, DEFAULT_CUE_HALO,
  cueGlowStore, MAX_CUE_GLOW, cueGlowColorStore, DEFAULT_CUE_GLOW_COLOR,
  cueGainStore, MAX_CUE_GAIN, DEFAULT_CUE_GAIN,
  cueSoundStore, MAX_CUE_SOUND_LEN,
  loadPanelPref, savePanelPref,
} from './use-tweaks.js';
import { GESTURES, sampleGesture, gestureTransform } from './gestures.js';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// バージョン表記。vite.fork.js の define でビルド時に静的置換される。
// build: "v1.0.0 · f7efa25 · 2026-06-17" / dev: "v1.0.0 · dev"。
// define が効かない環境（万一）でも落ちないよう typeof でガードする。
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const GIT_SHA = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'dev';
const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';
// 著作権年。本番は __BUILD_DATE__（YYYY-MM-DD）の年を、dev では実行時の現在年を使う（ビルド年から自動）。
const BUILD_YEAR = /^\d{4}-/.test(BUILD_DATE) ? BUILD_DATE.slice(0, 4) : String(new Date().getFullYear());
const VERSION_LABEL =
  GIT_SHA === 'dev'
    ? `v${APP_VERSION} · dev`
    : `v${APP_VERSION} · ${GIT_SHA} · ${BUILD_DATE}`;
// 狭い画面用の短縮版（日付を落としてビルド識別だけ残す）。右下に1行で収め、
// 左下のコントロール（チップ列・Tweaks ハンバーガー）に被らない長さにする。
const VERSION_LABEL_SHORT =
  GIT_SHA === 'dev' ? `v${APP_VERSION} · dev` : `v${APP_VERSION} · ${GIT_SHA}`;

// アプリ内 QR が指す iPhone(tx) URL。vite.fork.js が __TX_PUBLIC_ORIGIN__ に外部到達可能な
// 公開オリジン（tailscale 証明書名 → https://FQDN:5173）を注入する。無ければ現在開いている
// オリジン（tailscale URL で開いていればそれで正しい）。パスは BASE_URL を尊重するので
// GitHub Pages の /guruguru-avatar/ サブパスでも壊れない。
// Electron 窓は ?txorigin= でスマホ到達可能な公開オリジン(https FQDN)を渡す。これを最優先で
// QR に使う（窓自身は loopback を読むが、QR だけはスマホが開ける URL を指す）。dev サーバの
// __TX_PUBLIC_ORIGIN__（ビルド define）→ location.origin の順にフォールバック（従来動作）。
const TX_ORIGIN_OVERRIDE =
  (typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('txorigin')) || '';
const TX_PUBLIC_ORIGIN =
  TX_ORIGIN_OVERRIDE
  || (typeof __TX_PUBLIC_ORIGIN__ !== 'undefined' && __TX_PUBLIC_ORIGIN__)
  || (typeof location !== 'undefined' ? location.origin : '');
const TX_URL = `${TX_PUBLIC_ORIGIN}${import.meta.env.BASE_URL}index.html?tx`;

// 配布デフォルト値。旧 default-themes/camera.html.json の "01-for-PC(Default)" を
// 取り込んだもの（showDebug/showExpr のみ配信向けに OFF）。現行 index.html 構成では
// seed 用 JSON が無くてもこのハードコード値が初期テーマとして効く（iPhone 等の初回
// アクセスでもテーマが当たる）。配布テーマを足したい場合は public/default-themes/
// index.json を置けば上に重なる（fetchBuiltinPresets / 読込失敗は console に出る）。
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "avatarId": "06-elf01",
  "inputDirection": "face",
  "mouthSource": "camera",
  "cameraSourceMode": "pc",
  "followRange": 340,
  "micGain": 1.5,
  "smoothing": 0.3,
  "sensitivity": 1.3,
  "biasYawDeg": -8,
  "biasPitchDeg": -10,
  "rangeYawLeftDeg": 28.6,
  "rangeYawRightDeg": 28.6,
  "rangePitchUpDeg": 22.9,
  "rangePitchDownDeg": 22.9,
  "invertX": true,
  "invertY": false,
  "preview": true,
  "mouthGain": 1.8,
  "thHalf": 0.12,
  "thFull": 0.35,
  "release": 0.25,
  "blinkSync": true,
  "blinkSensitivity": 1.0,
  "eyesOpenBias": 0.44,
  "tiltEnabled": true,
  "tiltGain": 1.3,
  "tiltMax": 23,
  "tiltPivotY": 72,
  "invertTilt": false,
  "tiltYawComp": 0,
  "rollYawTiltB": 0,
  "biasRollDeg": 0,
  "slideEnabled": true,
  "slideGain": 12,
  "slideMax": 30,
  "invertSlide": true,
  "slideGainY": 8,
  "slideMaxY": 25,
  "invertSlideY": false,
  "slidePoseCompX": 0.6,
  "slidePoseCompY": 0.6,
  "zoomEnabled": true,
  "zoomGain": 1.4,
  "zoomMin": 0.35,
  "zoomMax": 1.5,
  "zoomPitchComp": 1.0,
  "zoomMouthComp": 0,
  "zoomBaseline": 0.387,
  "motionSmoothing": 0.2,
  "moveRatio": 1.0,
  "userZoomMin": 0.3,
  "userZoomMax": 4,
  "wheelZoomDial": 30,
  "charSize": 39,
  "shadow": 3,
  "bgColor": "#EEF4FB",
  "showDebug": false,
  "showExpr": false,
  "showCalib": false,
  "drawEnabled": true,
  "cursorEnabled": false,
  "cameraLabel": "",
  "facingMode": "user",
  "useWorker": true,
  "effGlow": false,
  "effGlowStrength": 3,
  "effGlowColor": "#9FD8FF",
  "effDissolve": false,
  "effDissolveAmount": 0,
  "effDissolveColor": "#7FE0FF",
  "sbGain": 1,
  "sbButtons": true,
  "sbMutedTx": false,
  "sbMutedRx": false
}/*EDITMODE-END*/;

// 表示する主な表情ブレンドシェイプ（MediaPipe FaceLandmarker のカテゴリ名）
const MAIN_BLENDSHAPES = [
  { key: 'jawOpen', label: '口の開き' },
  { key: 'mouthSmileLeft', label: '笑み左' },
  { key: 'mouthSmileRight', label: '笑み右' },
  { key: 'mouthPucker', label: '口すぼめ' },
  { key: 'browInnerUp', label: '眉内上げ' },
  { key: 'browDownLeft', label: '眉下げ左' },
  { key: 'browDownRight', label: '眉下げ右' },
  { key: 'eyeBlinkLeft', label: 'まばたき左' },
  { key: 'eyeBlinkRight', label: 'まばたき右' },
  { key: 'eyeWideLeft', label: '目見開き左' },
  { key: 'eyeWideRight', label: '目見開き右' },
  // cheekPuff(頬ふくらみ)は MediaPipe モデルがほぼ反応しないため、確実に動く
  // cheekSquint(笑う/目を細めると頬が上がる)に差し替え。
  { key: 'cheekSquintLeft', label: '頬上げ左' },
  { key: 'cheekSquintRight', label: '頬上げ右' },
];

// 顔推定ドライバが扱うグリッド（左右5×上下5＝25方向）。全アバター共通の表情グリッド。
const { rows: ROWS, cols: COLS } = charConfig;

// ?avatar=<id> を読む。未指定・未知 id は null（＝保存値/既定に従う）。
// OBS シーンごとにアバターを URL で固定したいとき用（セレクタより優先する）。
function parseAvatarParam(search) {
  try {
    const id = new URLSearchParams(search).get('avatar');
    return id && avatars.some((a) => a.id === id) ? id : null;
  } catch {
    return null;
  }
}

const BG_OPTIONS = ['#FFF8EE', '#FDEFEF', '#EEF4FB', '#2B2926'];
// エフェクトの色プリセット（発光／ディゾルブ縁）。
const GLOW_COLORS = ['#9FD8FF', '#FFD27A', '#FF8FB1', '#B6FF9F'];
const DISSOLVE_COLORS = ['#7FE0FF', '#FFB04D', '#C792FF', '#7CFFB0'];

// 影レベル(0~6, tweak `shadow`)→ CSS filter。大きいほど濃く広く広がる。0 は影なし。
// 高レベルでは「広いぼかし影＋細い輪郭影」を重ねて、透過背景でもはっきり立たせる。
// 4~6 は旧 ?shadow=3 より大きく広げた追加レンジ（Tweaks のスライダーで選ぶ）。
const SHADOW_FILTERS = [
  undefined,                                                                          // 0 なし
  'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',                                           // 1
  'drop-shadow(0 5px 13px rgba(0,0,0,0.45)) drop-shadow(0 0 2px rgba(0,0,0,0.4))',     // 2
  'drop-shadow(0 10px 24px rgba(0,0,0,0.62)) drop-shadow(0 0 5px rgba(0,0,0,0.55))',   // 3
  'drop-shadow(0 16px 36px rgba(0,0,0,0.66)) drop-shadow(0 0 8px rgba(0,0,0,0.6))',    // 4
  'drop-shadow(0 24px 52px rgba(0,0,0,0.7)) drop-shadow(0 0 12px rgba(0,0,0,0.62))',   // 5
  'drop-shadow(0 34px 72px rgba(0,0,0,0.74)) drop-shadow(0 0 18px rgba(0,0,0,0.66))',  // 6 最大幅
];
// 影レベルの最大値（SHADOW_FILTERS の最後のインデックス）。スライダー上限とクランプに使う。
const SHADOW_MAX = SHADOW_FILTERS.length - 1;

const DEG = Math.PI / 180;
// 方向校正(上下左右)で受け付ける最小の振り角(度・物理角)。これ未満や逆向きは
// 「ちゃんと振り向いていない」とみなして弾く（direction-range.js が判定）。
const CALIBRATE_MIN_SWING_DEG = 5;
// 向き校正を押してから、かしげ・スライド・ズームの平滑化を飛ばして即反映する時間(ms)。
// setTweak の反映(再レンダー→tweaksRef 更新)を跨いでも「すぐ垂直」に見えるよう少し長めに取る。
const SNAP_MOTION_MS = 350;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// デバッグHUDの数値表示用。毎フレーム値が変わっても小数点の位置がぶれないよう、
// 整数部（符号込み）を図表空白(U+2007・数字と同じ幅で HTML でも潰れない)で左パディングして
// 桁を固定する。intWidth は符号も含めた整数部の表示桁数（例: -45 は 3 桁）。
const FIGURE_SPACE = String.fromCharCode(0x2007); // 数字と同じ幅・HTML で潰れない空白
function fixDot(n, frac, intWidth) {
  const s = n.toFixed(frac);
  const intLen = s.indexOf('.'); // 小数点までの長さ（符号込み）。frac>=1 前提で常に '.' を含む。
  return FIGURE_SPACE.repeat(Math.max(0, intWidth - intLen)) + s;
}

// アバターのユーザー操作（ドラッグ移動・ホイール/ピンチでズーム）の範囲と感度。
// 顔追従とは独立した「表示上の」調整なので relay には送らずローカルのみで完結する。
// 実値は Tweaks（userZoomMin/userZoomMax/wheelZoomDial）から毎イベント読んでリアルタイムに
// 効かせる。以下の定数は保存値が無いとき／旧テーマ用の「フォールバック既定」として残す。
const USER_ZOOM_MIN = 0.3;
const USER_ZOOM_MAX = 4;
const DRAG_SQUISH_CANCEL_PX = 4;    // この距離以上動いたら押下スケールを解除しドラッグ扱い

// ホイール感度は UI 上「0〜100」のダイヤルで持ち、exp の係数へ線形変換する。
// ダイヤル100 で WHEEL_SENS_MAX、0 で 0（＝ホイールズーム無効）。既定30 ≒ 旧 0.0015。
const WHEEL_SENS_MAX = 0.005;
const WHEEL_SENS_DIAL_DEFAULT = 30;
function wheelSensFromDial(dial) {
  const d = Math.min(100, Math.max(0, dial));
  return (d / 100) * WHEEL_SENS_MAX;
}

// 十字校正ボタンを押した後、ボタン上に確認表示（✓ / ✗）を出す時間(ms)。
// 校正は値の変化が控えめで効いたか分かりにくいため、短く効果を知らせる。
const CALIBRATE_FEEDBACK_MS = 1400;

// 移動の tx→rx 比率（rx の移動量 = tx の移動量 × moveRatio）。スライダーの範囲。
const MOVE_RATIO_MIN = 0.1;
const MOVE_RATIO_MAX = 3.0;

// ユーザー操作2層（shared+local）→ userRef へ書く transform 文字列。
// 移動は加算(vw/vh)、ズームは乗算(倍率)。effect とボタンの両方から使う（式の一元化）。
function composeUserTransform(u) {
  const x = (u.shared.x + u.local.x).toFixed(2);
  const y = (u.shared.y + u.local.y).toFixed(2);
  const z = (u.shared.zoom * u.local.zoom).toFixed(3);
  return `translate(${x}vw, ${y}vh) scale(${z})`;
}

// 狭い画面（スマホのポートレイト）か。下部コントロールを小型化し、中央タイトル帯・
// 右下 Tweaks と重ならないレイアウトに切り替えるのに使う。Tweaks パネルの CSS と
// 同じ 480px をブレークポイントにする（tweaks-panel.jsx の @media と揃える）。
const NARROW_QUERY = '(max-width: 480px)';
function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

// アプリ内 QR ボタン。クリックで iPhone(tx) URL の QR をポップオーバー表示する。
// tailscale の長い URL を手入力せず、iPhone のカメラで読み取って tx を開けるようにする。
// 配信(obsMode)中は呼び出し側で隠す。url は外部端末から到達できる公開 URL（TX_URL）。
function TxQrButton({ url, subColor, inkColor, style }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'absolute', pointerEvents: 'auto', ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          font: 'inherit', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em',
          color: open ? inkColor : subColor,
        }}
      >{`QRコード ${open ? '▲' : '▼'}`}</button>
      {open && (
        <div style={{
          position: 'absolute', top: 24, right: 0, zIndex: 40,
          background: '#fff', borderRadius: 12, padding: 12, width: 256,
          boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <QRCodeSVG value={url} size={232} level="M" marginSize={2}
            bgColor="#ffffff" fgColor="#1a1410" />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3c3026', letterSpacing: '0.04em', textAlign: 'center' }}>
            iPhone のカメラで読み取り → tx を開く
          </div>
          <code style={{
            fontSize: 11, lineHeight: 1.4, color: '#6a5a48',
            wordBreak: 'break-all', textAlign: 'center', userSelect: 'all',
          }}>{url}</code>
        </div>
      )}
    </div>
  );
}

// 十字グリッドの横幅(px)。3列×44px + 2×4px gap = 140。パネルの内側コンテナにも
// 同じ幅を当て、＋で説明を開閉してもパネル幅＝十字幅で一定にする（中央寄せの十字が
// 横にずれないようにするため）。
const CALIB_CROSS_WIDTH = 140;

// 上下左右＋正面の十字校正ボタン。各方向に顔を振り切って押すと、その向きの
// 振り幅を校正する（中央=正面）。flash[dir] が 'ok'/'err' のときボタン上に ✓/✗ を出す。
// スマホでも押しやすいよう各マスは最小 56px、文字は clamp で可変にする。
function DirectionCross({ flash = {}, onDir, onCenter, onToggleDetail, detailOpen }) {
  // デバッグHUDのグリッド風セル。通常は半透明、中央「正」は橙ハイライト、ok/err は緑/赤。
  const CELL = {
    border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, cursor: 'pointer',
    color: '#fff', fontWeight: 700, letterSpacing: '0.04em', fontFamily: 'inherit',
    fontSize: 'clamp(13px, 3.6vmin, 16px)', minHeight: 40, padding: '7px 0',
    transition: 'background 0.15s ease',
  };
  const bgFor = (st, center) => (
    st === 'ok' ? '#46C26A' : st === 'err' ? '#D9534F'
      : center ? 'rgba(255,177,61,0.85)' : 'rgba(255,255,255,0.16)'
  );
  const textFor = (st, label) => (st === 'ok' ? '✓' : st === 'err' ? '✗' : label);
  const cell = (dir, label, area, onClick, title, center = false) => {
    const st = flash[dir];
    return (
      <button type="button" onClick={onClick} title={title}
        style={{ ...CELL, gridArea: area, background: bgFor(st, center) }}>{textFor(st, label)}</button>
    );
  };
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 4,
      gridTemplateAreas: '". up ." "left center right" "plus down ."',
      width: CALIB_CROSS_WIDTH, margin: '0 auto',
    }}>
      {cell('up', '上', 'up', () => onDir('up'), '顔を上に向け切って押す（上端に校正）')}
      {cell('left', '左', 'left', () => onDir('left'), '顔を左に向け切って押す（左端に校正）')}
      {cell('center', '正', 'center', onCenter, '向き・距離・目・かしげをまとめて校正', true)}
      {cell('right', '右', 'right', () => onDir('right'), '顔を右に向け切って押す（右端に校正）')}
      {cell('down', '下', 'down', () => onDir('down'), '顔を下に向け切って押す（下端に校正）')}
      {/* 左下の空セルに説明トグル（＋/－）を入れる。 */}
      <button type="button" onClick={onToggleDetail} title={detailOpen ? '説明を隠す' : '説明を表示'}
        style={{ ...CELL, gridArea: 'plus', background: 'rgba(255,255,255,0.10)', fontSize: 15 }}>
        {detailOpen ? '－' : '＋'}
      </button>
    </div>
  );
}

// パネルの表示/非表示をワンタップで切り替えるチップ帯（Tweaks を開かずに各 HUD を出せる）。
// on のチップは緑枠で強調。items=[{ key, label, on, toggle }]。
// 演出アイコン帯（cuebar）と同じ SlideBar に載せ、⠿ で掴んで移動でき、↕/↔ で縦横を切り替え、
// はみ出しはスワイプ/ホイール/ドラッグでスライドできる。左下のハンバーガー(twk-fab)は別扱いで
// 固定位置のまま（この帯だけを可動にする）。スクロールバー表示は index.html の .cuebar-scroll に依存。
function PanelToggles({ items, inkColor, subColor, dark, dir, onToggleDir, scrollRef, zIndex, defaultStyle, children }) {
  return (
    <SlideBar
      id="toggles"
      dir={dir}
      onToggleDir={onToggleDir}
      dark={dark}
      zIndex={zIndex}
      scrollRef={scrollRef}
      defaultStyle={defaultStyle}
    >
      {items.map(({ key, label, on, toggle, title }) => (
        <button
          key={key}
          type="button"
          onClick={toggle}
          aria-pressed={on}
          title={title || `${label}を${on ? '隠す' : '表示'}`}
          style={{
            flex: '0 0 auto', // 縮めず一定サイズを保ち、はみ出しは帯スクロールへ
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            padding: '4px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${on ? '#46C26A' : 'rgba(127,127,127,0.45)'}`,
            background: on ? 'rgba(70,194,106,0.16)' : 'transparent',
            color: on ? inkColor : subColor, fontSize: 13, fontWeight: 700, letterSpacing: '0.03em',
          }}
        >{label}</button>
      ))}
      {children}
    </SlideBar>
  );
}

// パネル表示トグル帯（SlideBar）の初期アンカー。row=画面下・ハンバーガーの右、column=左下
// （ハンバーガーの上）。帯は可動なので、これは「既定レイアウトのヒント」で保証ではない。
const TOGGLES_DEFAULT_STYLE = {
  row: { left: 'calc(60px + var(--sal))', bottom: 'calc(28px + var(--sab))' },
  column: { left: 'calc(14px + var(--sal))', bottom: 'calc(120px + var(--sab))' },
};

// 演出キュー: 音(tone は合成音フォールバック / sound にパスがあればそれを再生)とスタンプを束ねる。
// 発火経路は 右端ボタン / 数字キー / ?cue= の3つ共通。後で effect/expression も同じ cue に足せる。
const DEFAULT_CUES = [
  { id: 'hello',    label: 'こんにちは', key: '1', tone: 660, stamp: 'こんにちは！', anim: 'pop', icon: '👋', effect: { glow: 4, glowColor: '#9FD8FF', ms: 600 }, gesture: 'nod', place: 'above' },
  { id: 'clap',     label: '拍手',       key: '2', tone: 520, stamp: '👏', anim: 'pop' },
  { id: 'laugh',    label: 'わらい',     key: '3', tone: 720, stamp: '😆', anim: 'rise' },
  { id: 'sweat',    label: 'あせ',       key: '4', tone: 430, stamp: '💦', anim: 'rise' },
  { id: 'anger',    label: 'いかり',     key: '5', tone: 300, stamp: '💢', anim: 'shake', effect: { glow: 5, glowColor: '#FF6B6B', ms: 500 } },
  { id: 'sparkle',  label: 'キラキラ',   key: '6', tone: 880, stamp: '✨', anim: 'rise', effect: { glow: 7, glowColor: '#FFE9A8', ms: 850 }, gesture: 'spin' },
  { id: 'question', label: 'はてな',     key: '7', tone: 600, stamp: '！？', anim: 'pop', gesture: 'shake' },
  // おまけ: 音・スタンプ無しの「動きだけ」キュー（gesture のみ）。rx/OBS にも転送される。
  { id: 'tilt',     label: '傾げる',     key: '8', icon: '🤔', gesture: 'tilt' },
  { id: 'shiver',   label: 'ぷるぷる',   key: '9', icon: '😖', gesture: 'shiver' },
  { id: 'look',     label: '見回す',     key: '0', icon: '🔭', gesture: 'lookAround' },
  { id: 'glance',   label: 'きょろきょろ',         icon: '👀', gesture: 'glance' },
  { id: 'surprise', label: 'びっくり',             icon: '😲', gesture: 'surprise' },
];

// rx(OBS) へ同期しない「ページごとローカル」の設定キー。
//  - sbMutedTx … 手元(tx)モニタのミュート。tx 自身だけ黙らせる（rx に影響させない）→ 非同期。
//  - sbMutedRx … 配信(rx)のミュート。rx に UI が無いので tx から同期して遠隔操作 → 同期する(除外しない)。
//  - sbGain/sbButtons … 各ページのローカル音量/UI（rx 全体音量は OBS ミキサーで調整）→ 非同期。
// cameraSourceMode は「PC のカメラを使うか／スマホ(tx)に渡すか」という tx ローカルの運用切替で、
// rx(OBS) には無関係なので同期対象から外す（rx 側の保存 tweaks を汚さない）。
const LOCAL_ONLY_TWEAKS = ['sbMutedTx', 'sbGain', 'sbButtons', 'drawEnabled', 'cursorEnabled', 'cameraSourceMode'];
function syncableTweaks(tw) {
  const out = { ...tw };
  for (const k of LOCAL_ONLY_TWEAKS) delete out[k];
  return out;
}

// 単一値マップ store（makeCueValueMap 産）を React 状態に載せる小ヘルパー。
// [map, ref, apply] を返す。ref は useMemo 化された cueController から最新値を同期で読むため。
function useCueMap(store) {
  const [map, setMap] = useState(() => store.load());
  const ref = useRef(map);
  useEffect(() => { ref.current = map; }, [map]);
  const apply = useCallback((m) => { const n = store.sanitize(m); setMap(n); store.save(n); }, [store]);
  return [map, ref, apply];
}

function App() {
  // 演出（スタンプ）の cue 毎アバター相対オフセット { [cueId]: {x,y} }（em）。発火時に tx→rx へ relay する
  // （文字/色/倍率/影色と同様、OBS のスタンプ位置も揃える）。ただし保存はテーマ・サイドカーとして持ち運ぶ。
  // テーマと一緒に持ち運ぶ「サイドカー」として useTweaks に渡す（保存/適用/書き出し/読み込みで連動）。
  // useTweaks より前で宣言する必要があるため、cueController 周りより手前に置く。
  // 発火は useMemo 化された cueController を通るので、最新値は ref 経由で読む（クロージャの陳腐化回避）。
  const [cueOffsets, setCueOffsets] = useState(() => loadCueOffsets());
  const cueOffsetsRef = useRef(cueOffsets);
  useEffect(() => { cueOffsetsRef.current = cueOffsets; }, [cueOffsets]);
  // テーマ適用/リセット/シード時にサイドカー値を書き戻す唯一の口。state と :cueoffset を同期する
  // （ライブのドラッグ保存 commitCueEdit と同じ保存先・正規化を共有）。
  const applyCueOffsets = useCallback((map) => {
    const next = sanitizeCueOffsets(map);
    setCueOffsets(next);
    saveCueOffsets(next);
  }, []);
  // 演出（スタンプ）の cue 毎カスタム文字列 { [cueId]: string }。:cueoffset と同じくローカル限定だが、
  // テーマには載せない独立キー（:cuetext）。発火は ref 経由で最新値を読む（クロージャ陳腐化回避）。
  const [cueTexts, setCueTexts] = useState(() => loadCueTexts());
  const cueTextsRef = useRef(cueTexts);
  useEffect(() => { cueTextsRef.current = cueTexts; }, [cueTexts]);
  const applyCueTexts = useCallback((map) => {
    const next = sanitizeCueTexts(map);
    setCueTexts(next);
    saveCueTexts(next);
  }, []);
  // 演出（スタンプ）の cue 毎カスタム文字色 { [cueId]: '#rrggbb' }。:cuetext と同型のローカル限定・テーマ非連携。
  const [cueColors, setCueColors] = useState(() => loadCueColors());
  const cueColorsRef = useRef(cueColors);
  useEffect(() => { cueColorsRef.current = cueColors; }, [cueColors]);
  const applyCueColors = useCallback((map) => {
    const next = sanitizeCueColors(map);
    setCueColors(next);
    saveCueColors(next);
  }, []);
  // 演出（スタンプ）の cue 毎フォント倍率 { [cueId]: number }。:cuecolor と同型のローカル限定・テーマ非連携。
  const [cueSizes, setCueSizes] = useState(() => loadCueSizes());
  const cueSizesRef = useRef(cueSizes);
  useEffect(() => { cueSizesRef.current = cueSizes; }, [cueSizes]);
  const applyCueSizes = useCallback((map) => {
    const next = sanitizeCueSizes(map);
    setCueSizes(next);
    saveCueSizes(next);
  }, []);
  // 演出（スタンプ）の cue 毎影色 { [cueId]: '#rrggbb' }。同上。
  const [cueShadows, setCueShadows] = useState(() => loadCueShadows());
  const cueShadowsRef = useRef(cueShadows);
  useEffect(() => { cueShadowsRef.current = cueShadows; }, [cueShadows]);
  const applyCueShadows = useCallback((map) => {
    const next = sanitizeCueShadows(map);
    setCueShadows(next);
    saveCueShadows(next);
  }, []);
  // 演出（スタンプ）の cue 毎: 表示時間(ms) / アニメ / フォント太さ / 縁取り幅(em)。いずれもローカル限定・テーマ非連携。
  const [cueHolds, setCueHolds] = useState(() => loadCueHolds());
  const cueHoldsRef = useRef(cueHolds);
  useEffect(() => { cueHoldsRef.current = cueHolds; }, [cueHolds]);
  const applyCueHolds = useCallback((map) => { const n = sanitizeCueHolds(map); setCueHolds(n); saveCueHolds(n); }, []);
  const [cueAnims, setCueAnims] = useState(() => loadCueAnims());
  const cueAnimsRef = useRef(cueAnims);
  useEffect(() => { cueAnimsRef.current = cueAnims; }, [cueAnims]);
  const applyCueAnims = useCallback((map) => { const n = sanitizeCueAnims(map); setCueAnims(n); saveCueAnims(n); }, []);
  const [cueWeights, setCueWeights] = useState(() => loadCueWeights());
  const cueWeightsRef = useRef(cueWeights);
  useEffect(() => { cueWeightsRef.current = cueWeights; }, [cueWeights]);
  const applyCueWeights = useCallback((map) => { const n = sanitizeCueWeights(map); setCueWeights(n); saveCueWeights(n); }, []);
  const [cueStrokes, setCueStrokes] = useState(() => loadCueStrokes());
  const cueStrokesRef = useRef(cueStrokes);
  useEffect(() => { cueStrokesRef.current = cueStrokes; }, [cueStrokes]);
  const applyCueStrokes = useCallback((map) => { const n = sanitizeCueStrokes(map); setCueStrokes(n); saveCueStrokes(n); }, []);
  // 追加カスタム（回転 / 表示位置 / 白フチ / 発光強さ / 発光色 / 音量 / 効果音）。useCueMap で簡潔に。
  const [cueRotations, cueRotationsRef, applyCueRotations] = useCueMap(cueRotationStore);
  const [cuePlaces, cuePlacesRef, applyCuePlaces] = useCueMap(cuePlaceStore);
  const [cueHalos, cueHalosRef, applyCueHalos] = useCueMap(cueHaloStore);
  const [cueGlows, cueGlowsRef, applyCueGlows] = useCueMap(cueGlowStore);
  const [cueGlowColors, cueGlowColorsRef, applyCueGlowColors] = useCueMap(cueGlowColorStore);
  const [cueGains, cueGainsRef, applyCueGains] = useCueMap(cueGainStore);
  const [cueSounds, cueSoundsRef, applyCueSounds] = useCueMap(cueSoundStore);
  // useTweaks に渡す汎用サイドカー { key, value, write, equal }。識別を安定させるため
  // cueOffsets が変わったときだけ作り直す（テーマの dirty 再計算のトリガにもなる）。
  const themeSidecar = useMemo(
    () => ({ key: '__cueOffsets', value: cueOffsets, write: applyCueOffsets, equal: equalCueOffsetMaps }),
    [cueOffsets, applyCueOffsets],
  );
  const [t, setTweak, resetTweaks, themes] = useTweaks(TWEAK_DEFAULTS, undefined, themeSidecar);
  // OBS ブラウザソース用ステージモード（背景透過＋UI 非表示）。
  // URL は起動時に固定なので一度だけ解析する。
  const stage = useMemo(
    () => parseObsParams(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  // WS 中継の役割（local / tx=送信側 / rx=受信側）。URL は起動時固定なので一度だけ解析。
  const relay = useMemo(
    () => parseRelayMode(
      typeof window !== 'undefined' ? window.location.search : '',
      typeof window !== 'undefined' ? window.location : {},
    ),
    [],
  );
  const mode = relay.mode;
  const isRx = mode === 'rx';
  // ステージモードの既定: obs 未指定なら rx のときだけ ON（rx=OBS の CEF 用なので透過が既定）。
  // ?obs=1 で常時 ON、?obs=0 で常時 OFF（rx をブラウザのタブでデバッグするとき用）。
  const obsMode = stage.obs ?? isRx;
  // お絵かきオーバーレイのモード。rx(OBS)は受信して常に表示(view)、tx/local は既定で操作可能(edit)。
  // ?draw=0 のときだけ off（レイヤー自体を出さない）。URL は起動時固定なので一度だけ解析。
  // 実際にツールバーを出す/入力を受けるかは drawEnabled トグル(下部ボタン列)で切替える。
  const drawParam = useMemo(
    () => parseDrawParams(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  const drawMode = isRx ? 'view' : (drawParam.draw === false ? 'off' : 'edit');
  const drawLayerRef = useRef(null);
  const drawSendRef = useRef(null); // relayApi.sendDrawScene を後で差す（render 末で代入）
  const drawLiveSendRef = useRef(null); // relayApi.sendDrawLive を後で差す（描画途中のライブ）
  const cursorSendRef = useRef(null); // relayApi.sendCursor を後で差す
  // tx: お絵かきが確定したら relay で rx へ送る。relayApi は毎レンダー変わるので ref 越しに呼ぶ。
  const handleDrawSceneChange = useCallback((payload) => { drawSendRef.current?.(payload); }, []);
  // tx: 描画途中のライブストロークを relay で rx(OBS) へ送る（ephemeral・確定は scene が担う）。
  const handleDrawLive = useCallback((data) => { drawLiveSendRef.current?.(data); }, []);
  // tx: マウスカーソル位置を relay で rx(OBS) へ送る。
  const handleCursorMove = useCallback((data) => { cursorSendRef.current?.(data); }, []);
  // テロップ（CNN 風・下部クロール）。お絵かきとは独立。rx(OBS)は受信表示(view)、tx/local は操作(edit)。
  // ?ticker=0 のときだけ off（レイヤー自体を出さない）。URL は起動時固定なので一度だけ解析。
  const tickerParam = useMemo(
    () => parseTickerParams(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  const tickerMode = isRx ? 'view' : (tickerParam.ticker === false ? 'off' : 'edit');
  const tickerLayerRef = useRef(null);
  const tickerSendRef = useRef(null); // relayApi.sendTicker を後で差す（render 末で代入）
  // tx: テロップ設定が変わったら relay で rx(OBS) へ送る。relayApi は毎レンダー変わるので ref 越しに呼ぶ。
  const handleTickerChange = useCallback((cfg) => { tickerSendRef.current?.(cfg); }, []);
  // 日付時刻テロップ（右上の時計）。お絵かき/テロップとは独立。rx は受信表示(view)、tx/local は操作(edit)。
  // ?clock=0 のときだけ off。URL は起動時固定なので一度だけ解析。
  const clockParam = useMemo(
    () => parseClockParams(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  const clockMode = isRx ? 'view' : (clockParam.clock === false ? 'off' : 'edit');
  const clockLayerRef = useRef(null);
  const clockSendRef = useRef(null); // relayApi.sendClock を後で差す（render 末で代入）
  const handleClockChange = useCallback((cfg) => { clockSendRef.current?.(cfg); }, []);
  const [panelOpen, setPanelOpen] = useState(false); // obsMode 中に T キーで Tweaks を開閉
  // rx は受信した設定で描画し、それ以外はローカルの tweaks を使う。
  const [rxConfig, setRxConfig] = useState(TWEAK_DEFAULTS);
  // 接続中のカメラ一覧（[{deviceId,label}]）。カメラ許可後に列挙して埋める（下の effect）。
  const [cameras, setCameras] = useState([]);
  const view = isRx ? rxConfig : t;
  // 演出（サウンドボード＋リアクションスタンプ）。発火は ボタン/数字キー/?cue= 共通。
  // tx では発火を relay 経由で rx(OBS) にも転送し、本番オーバーレイに演出を出す。
  const cueBoard = useMemo(() => createSoundboard(), []);
  const cueStampRef = useRef(null);
  const cueSendRef = useRef(null); // relayApi.sendCue を後で差す（render 末で代入）
  // rx: tx から来たカスタム文字/色を発火直前に差し込む一時オーバーライド { stamp?, color? }。
  // cueController.run は同期実行なので、run の前後で set/clear すれば pop コールバックが拾える。
  const relayCueOverrideRef = useRef(null);
  const [cueFx, setCueFx] = useState(null); // 演出の一時エフェクト（グローのフラッシュ）
  const cueFxTimerRef = useRef(0);
  const gesturePlayRef = useRef(null); // 再生中ジェスチャー { name, start, base }（描画ループが読む）
  const gestureFxRef = useRef(null);   // 回転/拡縮を当てる中心原点ラッパー（顔追従と別レイヤー）
  // cueOffsets / cueOffsetsRef / applyCueOffsets は useTweaks 連携のため App 冒頭で宣言済み。
  const cueController = useMemo(
    () => createCueController(DEFAULT_CUES, (cue) => {
      // 優先順位は全項目共通: rx の relay オーバーライド（tx から届いた値）＞ ローカル保存値 ＞ 既定。
      // これで tx 側の全カスタムが OBS(rx/CEF) にも反映される（効果音の差し替えだけは relay 非対象）。
      const relayOv = relayCueOverrideRef.current;
      const num = (a, b) => (Number.isFinite(a) ? a : b); // relay 優先で有限なら採用
      // 効果音の音量を上書きして再生（差し替え音源は cue.id 鍵のバッファを cueBoard 側が持つ）。
      const gain = num(relayOv && relayOv.gain, cueGainsRef.current[cue.id] ?? cue.gain);
      cueBoard.play({ ...cue, gain });
      // スタンプ各パラメータ。未設定は undefined → スタンプ側で従来既定。
      const stamp = (relayOv && relayOv.stamp) || cueTextsRef.current[cue.id] || cue.stamp;
      const stampColor = (relayOv && relayOv.color) || cueColorsRef.current[cue.id];
      const fontScale = num(relayOv && relayOv.size, cueSizesRef.current[cue.id]);
      const shadowColor = (relayOv && relayOv.shadow) || cueShadowsRef.current[cue.id];
      const offset = (relayOv && relayOv.offset) || cueOffsetsRef.current[cue.id];
      const holdMs = num(relayOv && relayOv.hold, cueHoldsRef.current[cue.id] || cue.holdMs);
      const anim = (relayOv && relayOv.anim) || cueAnimsRef.current[cue.id] || cue.anim;
      const fontWeight = num(relayOv && relayOv.weight, cueWeightsRef.current[cue.id]);
      const strokeEm = num(relayOv && relayOv.stroke, cueStrokesRef.current[cue.id]);
      const rotation = num(relayOv && relayOv.rotation, cueRotationsRef.current[cue.id]);
      const place = (relayOv && relayOv.place) || cuePlacesRef.current[cue.id] || cue.place;
      const haloStrength = num(relayOv && relayOv.halo, cueHalosRef.current[cue.id]);
      if (cueStampRef.current) cueStampRef.current.pop({ ...cue, stamp, stampColor, fontScale, shadowColor, holdMs, anim, fontWeight, strokeEm, rotation, place, haloStrength, __offset: offset });
      // 発光フラッシュ（アバターのグロー）。強さ・色を cue 毎に上書き。強さ>0 のときだけ出す。
      const glowStr = num(relayOv && relayOv.glow, cueGlowsRef.current[cue.id] ?? (cue.effect ? cue.effect.glow : 0));
      const glowCol = (relayOv && relayOv.glowColor) || cueGlowColorsRef.current[cue.id] || (cue.effect ? cue.effect.glowColor : undefined);
      const glowMs = (cue.effect && cue.effect.ms) || 700;
      if (Number.isFinite(glowStr) && glowStr > 0) {
        clearTimeout(cueFxTimerRef.current);
        setCueFx({ glow: glowStr, glowColor: glowCol, ms: glowMs });
        cueFxTimerRef.current = setTimeout(() => setCueFx(null), glowMs);
      }
      // gesture 付きキューは うなずき/回転/いやいや を再生（描画ループが顔追従を一時上書き）。
      if (cue.gesture && GESTURES[cue.gesture]) {
        gesturePlayRef.current = { name: cue.gesture, start: performance.now(), base: null };
      }
      // tx → rx 転送。カスタム文字/色を持つ cue は一緒に送り、OBS 側でも同じ見た目にする。
      if (mode === 'tx' && cueSendRef.current) {
        cueSendRef.current(cue.id, {
          stamp: cueTextsRef.current[cue.id] || undefined,
          color: cueColorsRef.current[cue.id] || undefined,
          size: cueSizesRef.current[cue.id] || undefined,
          shadow: cueShadowsRef.current[cue.id] || undefined,
          offset: cueOffsetsRef.current[cue.id] || undefined,
          // 数値は 0 もあり得る（stroke=0 等）ので直接渡す（undefined はそのまま未送信になる）。
          hold: cueHoldsRef.current[cue.id],
          anim: cueAnimsRef.current[cue.id],
          weight: cueWeightsRef.current[cue.id],
          stroke: cueStrokesRef.current[cue.id],
          rotation: cueRotationsRef.current[cue.id],
          place: cuePlacesRef.current[cue.id],
          halo: cueHalosRef.current[cue.id],
          glow: cueGlowsRef.current[cue.id],
          glowColor: cueGlowColorsRef.current[cue.id],
          gain: cueGainsRef.current[cue.id],
          // 効果音(差し替え)は relay しない（pose フレームと同じ WS を圧迫しないため・ローカル限定）。
        });
      }
    }),
    // 全 cue* 値は ref 経由で読むので deps は [cueBoard, mode] のみ。useCueMap 産の ref は
    // 配列分割代入のため linter が安定参照と判定できないが実体は useRef で安定（誤検知を抑制）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cueBoard, mode],
  );
  useEffect(() => () => clearTimeout(cueFxTimerRef.current), []); // アンマウント時にタイマ掃除
  // 起動時: 保存済みのカスタム効果音(data URL)を cueBoard へ読み込む（cue.id 鍵のバッファ）。
  useEffect(() => {
    for (const [id, url] of Object.entries(cueSoundsRef.current)) cueBoard.loadUrl(id, url);
    // 起動時1回だけ。以降の差し替えは commit 内で loadUrl/unassign 済み。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cueBoard]);

  // ── 演出の位置調整（編集モード）─────────────────────────────────────────────
  // トリガーは2経路: 可視トグルで編集モードに入り cue ボタンで対象を選ぶ／PC 右クリック・
  // モバイル長押しでその cue を直接開く。スタンプ無し（動きだけ）の cue は調整対象外。
  const [editMode, setEditMode] = useState(false);     // 可視トグルの ON/OFF
  const [editingCueId, setEditingCueId] = useState(null); // 調整中の cue id（null=未選択）
  const lpTimerRef = useRef(0);          // 長押しタイマー
  const lpStartRef = useRef({ x: 0, y: 0 }); // 長押し開始座標（移動でキャンセル判定）
  const lpJustOpenedRef = useRef(false); // 長押しで開いた直後の click を握りつぶすフラグ
  useEffect(() => () => clearTimeout(lpTimerRef.current), []);

  const openCueEditor = (c) => {
    if (!c || !c.stamp) return false; // 動かすスタンプが無い cue は対象外
    setEditMode(true);
    setEditingCueId(c.id);
    return true;
  };
  const onCueButtonClick = (c) => {
    if (lpJustOpenedRef.current) { lpJustOpenedRef.current = false; return; } // 長押しで開いた直後
    if (editMode && c.stamp) { setEditingCueId(c.id); return; } // 編集モード中は対象選択
    cueController.run(c.id);
  };
  const onCueButtonContextMenu = (e, c) => {
    e.preventDefault();                     // ブラウザメニュー抑制
    clearTimeout(lpTimerRef.current);       // 長押しタイマーの二重発火を防ぐ（タッチの合成 contextmenu 対策）
    if (openCueEditor(c)) lpJustOpenedRef.current = true; // 直後の click を握りつぶす。run は呼ばない
  };
  // 長押し（タッチ/ペンのみ。マウスは右クリックで開く）。移動 8px・非プライマリ・離脱でキャンセル。
  const onCueButtonPointerDown = (e, c) => {
    lpJustOpenedRef.current = false; // 新しい操作の開始: 前回の残留抑制フラグを必ず解除（誤抑制防止）
    if (e.pointerType === 'mouse') return;
    if (!e.isPrimary) { clearTimeout(lpTimerRef.current); return; } // 2本指(ピンチ)では発火しない
    lpStartRef.current = { x: e.clientX, y: e.clientY };
    clearTimeout(lpTimerRef.current);
    lpTimerRef.current = setTimeout(() => {
      if (openCueEditor(c)) lpJustOpenedRef.current = true;
    }, 500);
  };
  const onCueButtonPointerMove = (e) => {
    const s = lpStartRef.current;
    if (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8) clearTimeout(lpTimerRef.current);
  };
  const cancelCueLongPress = () => clearTimeout(lpTimerRef.current);
  const toggleEditMode = () => {
    setEditMode((v) => {
      if (v) setEditingCueId(null); // OFF にしたら選択も解除
      return !v;
    });
  };
  // 保存: パネルの全パラメータを 1 つの edit オブジェクトで受け、各サイドカーへ同時確定する（保存ボタンは1つ）。
  // 各項目とも「既定（cue 由来 or 定数）と同一なら map から削除」＝既定フォールバック（offset の {0,0} と同じ思想）。
  // 永続化は apply*（state＋localStorage 同期）に委譲。edit = { offset, text, color, size, shadow, hold, anim, weight, stroke }。
  const commitCueEdit = (edit) => {
    if (!editingCueId) return;
    const e = edit || {};
    const cue = cueController.cues.find((c) => c.id === editingCueId);

    const o = clampCueOffset(e.offset);
    const nextOff = { ...cueOffsets };
    if (o.x === 0 && o.y === 0) delete nextOff[editingCueId];
    else nextOff[editingCueId] = o;
    applyCueOffsets(nextOff);

    const norm = (typeof e.text === 'string' ? e.text : '').trim().slice(0, MAX_CUE_TEXT_LEN);
    const nextText = { ...cueTexts };
    if (!norm || norm === (cue && cue.stamp ? cue.stamp : '')) delete nextText[editingCueId];
    else nextText[editingCueId] = norm;
    applyCueTexts(nextText);

    const col = normalizeHexColor(e.color);
    const nextColor = { ...cueColors };
    if (!col || col === DEFAULT_CUE_COLOR) delete nextColor[editingCueId];
    else nextColor[editingCueId] = col;
    applyCueColors(nextColor);

    // フォント倍率: clamp。既定(1.0)と同一なら削除。
    const sz = clampCueFontScale(e.size);
    const nextSize = { ...cueSizes };
    if (sz === DEFAULT_CUE_FONT_SCALE) delete nextSize[editingCueId];
    else nextSize[editingCueId] = sz;
    applyCueSizes(nextSize);

    // 影色: 正規化。不正または既定(濃茶)と同一なら削除。
    const sh = normalizeHexColor(e.shadow);
    const nextShadow = { ...cueShadows };
    if (!sh || sh === DEFAULT_CUE_SHADOW_COLOR) delete nextShadow[editingCueId];
    else nextShadow[editingCueId] = sh;
    applyCueShadows(nextShadow);

    // 表示時間: clamp。cue 既定(holdMs)と同一/無効なら削除。
    const hd = clampCueHoldMs(e.hold);
    const nextHold = { ...cueHolds };
    if (hd == null || hd === (cue ? cue.holdMs : null)) delete nextHold[editingCueId];
    else nextHold[editingCueId] = hd;
    applyCueHolds(nextHold);

    // アニメ: 検証。cue 既定 anim と同一/無効なら削除。
    const an = normalizeCueAnim(e.anim);
    const nextAnim = { ...cueAnims };
    if (!an || an === (cue ? cue.anim : null)) delete nextAnim[editingCueId];
    else nextAnim[editingCueId] = an;
    applyCueAnims(nextAnim);

    // フォント太さ: clamp。既定(800)と同一なら削除。
    const wt = clampCueFontWeight(e.weight);
    const nextWeight = { ...cueWeights };
    if (wt === DEFAULT_CUE_FONT_WEIGHT) delete nextWeight[editingCueId];
    else nextWeight[editingCueId] = wt;
    applyCueWeights(nextWeight);

    // 縁取り幅: clamp。既定(0.05em)と同一なら削除。
    const st = clampCueStroke(e.stroke);
    const nextStroke = { ...cueStrokes };
    if (st === DEFAULT_CUE_STROKE_EM) delete nextStroke[editingCueId];
    else nextStroke[editingCueId] = st;
    applyCueStrokes(nextStroke);

    // 1 件分の値を store の sanitize で正規化する小道具（不正は undefined）。
    const one = (store, v) => store.sanitize({ v }).v;

    // 回転: 既定(0)と同一なら削除。
    const rot = one(cueRotationStore, e.rotation) ?? DEFAULT_CUE_ROTATION;
    const nextRot = { ...cueRotations };
    if (rot === DEFAULT_CUE_ROTATION) delete nextRot[editingCueId]; else nextRot[editingCueId] = rot;
    applyCueRotations(nextRot);

    // 表示位置: cue 既定(place)と同一/無効なら削除。
    const pl = one(cuePlaceStore, e.place);
    const nextPlace = { ...cuePlaces };
    if (!pl || pl === (cue ? cue.place : 'over')) delete nextPlace[editingCueId]; else nextPlace[editingCueId] = pl;
    applyCuePlaces(nextPlace);

    // 白フチ強さ: 既定(0.55)と同一なら削除。
    const ha = one(cueHaloStore, e.halo) ?? DEFAULT_CUE_HALO;
    const nextHalo = { ...cueHalos };
    if (ha === DEFAULT_CUE_HALO) delete nextHalo[editingCueId]; else nextHalo[editingCueId] = ha;
    applyCueHalos(nextHalo);

    // 発光強さ: cue 既定(effect.glow か 0)と同一なら削除。
    const defGlow = (cue && cue.effect && Number.isFinite(cue.effect.glow)) ? cue.effect.glow : 0;
    const gl = one(cueGlowStore, e.glow) ?? defGlow;
    const nextGlow = { ...cueGlows };
    if (gl === defGlow) delete nextGlow[editingCueId]; else nextGlow[editingCueId] = gl;
    applyCueGlows(nextGlow);

    // 発光色: cue 既定(effect.glowColor か DEFAULT)と同一/無効なら削除。
    const defGlowCol = (cue && cue.effect && cue.effect.glowColor)
      ? normalizeHexColor(cue.effect.glowColor) : DEFAULT_CUE_GLOW_COLOR;
    const gc = one(cueGlowColorStore, e.glowColor);
    const nextGlowCol = { ...cueGlowColors };
    if (!gc || gc === defGlowCol) delete nextGlowCol[editingCueId]; else nextGlowCol[editingCueId] = gc;
    applyCueGlowColors(nextGlowCol);

    // 音量: 既定(1.0)と同一なら削除。
    const gn = one(cueGainStore, e.gain) ?? DEFAULT_CUE_GAIN;
    const nextGain = { ...cueGains };
    if (gn === DEFAULT_CUE_GAIN) delete nextGain[editingCueId]; else nextGain[editingCueId] = gn;
    applyCueGains(nextGain);

    // 効果音(差し替え): data:audio の data URL は保存＋ライブ読込。空なら削除＋バッファ解放。
    const snd = typeof e.sound === 'string' ? e.sound : '';
    const nextSound = { ...cueSounds };
    if (snd.startsWith('data:audio') && snd.length <= MAX_CUE_SOUND_LEN) {
      nextSound[editingCueId] = snd;
      cueBoard.loadUrl(editingCueId, snd);
    } else {
      delete nextSound[editingCueId];
      cueBoard.unassign(editingCueId);
    }
    applyCueSounds(nextSound);

    setEditingCueId(null); // 編集モードは維持（別 cue を続けて調整できる）
  };
  const previewCueStamp = (c) => { if (cueStampRef.current) cueStampRef.current.pop(c); };
  const editingCue = editingCueId ? (cueController.cues.find((c) => c.id === editingCueId) || null) : null;
  // 表示アバター。?avatar=<id> があれば最優先（OBS シーン固定）、無ければ tweaks の値。
  // URL は起動時固定なので一度だけ解析する。未知 id は getAvatar が既定へフォールバック。
  const avatarParam = useMemo(
    () => parseAvatarParam(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  const avatar = getAvatar(avatarParam ?? view.avatarId);
  const avatarId = avatar.id;
  // 使用カメラ。?camera=<ラベル|番号> があれば最優先（OBS シーン固定）、無ければ保存値 t.cameraLabel。
  // 一覧(cameras)はカメラ許可後に列挙する（下の effect）。deviceId はそこから純関数で解決する。
  const cameraParam = useMemo(
    () => parseCameraParam(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  // 前面/背面トグルを出すかの判定（モバイルのみ）。タッチ可 or モバイル UA。
  const isMobile = useMemo(
    () => typeof navigator !== 'undefined'
      && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 0),
    [],
  );
  const cameraLabelEff = cameraParam ?? t.cameraLabel;
  // 解決済み deviceId（文字列 or null）。値が変わったときだけ useFacePose がカメラを取り直す。
  const deviceId = useMemo(
    () => resolveCameraDevice(cameras, cameraLabelEff),
    [cameras, cameraLabelEff],
  );
  // セレクタの選択肢（参照安定のため memo 化）。ラベルが取れたカメラのみ。
  const cameraOptions = useMemo(
    () => [
      { value: '', label: '自動（既定）' },
      ...cameras
        .filter((d) => d.label)
        .map((d, i) => ({ value: d.label, label: formatCameraLabel(d.label, i) })),
    ],
    [cameras],
  );
  // 保存ラベルのカメラが今は無い（消失・名前変更）ときは、表示上「自動（既定）」に落として
  // select が空欄にならないようにする（実際の解決は cameraLabelEff→deviceId が担う）。
  const cameraSelectValue = cameras.some((d) => d.label === t.cameraLabel) ? t.cameraLabel : '';
  // A〜F の6シートURL。アバターが変わったときだけ作り直す（参照安定＝再マウントのキーに使う）。
  const sheetUrls = useMemo(() => avatar.sheetUrls(), [avatarId]);
  // rx はカメラを持たないのでプレビュー無し。実際にプレビューを出すかは camEnabled も見て
  // 後段で確定する（マウス追従でカメラ停止中は空のカメラ枠を出さない）。
  const previewWanted = view.preview && !obsMode && !isRx; // 配信にカメラ枠を出さない
  const [cell, setCell] = useState({ r: 2, c: 2 });
  const [pressed, setPressed] = useState(false);
  // 十字（上/左/正/右/下）の校正ボタンごとのフィードバック。成功は 'ok'、振り不足や
  // 逆向きは 'err' を一定時間出す。方向ごとに別タイマーで消す。
  const [dirFlash, setDirFlash] = useState({});
  const dirFlashTimersRef = useRef({});
  // アバターのダブルクリック校正のとき、正ボタンが隠れていても効いたと分かるよう
  // アバター上に短く出すピル。猶予は十字校正と同じ CALIBRATE_FEEDBACK_MS。
  const [centerCalibFlash, setCenterCalibFlash] = useState(false);
  const centerCalibFlashTimerRef = useRef(null);
  const [showCalibDetail, setShowCalibDetail] = useState(false); // 向き校正パネルの説明を展開するか
  const [showDebugDetail, setShowDebugDetail] = useState(false); // デバッグパネルの数値を展開するか
  // スマホ用「反映先」トグル。ON のとき操作は local 層（この端末だけ・CEF へ送らない）。
  // PC は Shift キーでも同じ層に切り替わる（layerFor が OR で見る）。ref は effect から参照。
  const [localMode, setLocalMode] = useState(false);
  const localModeRef = useRef(false);
  localModeRef.current = localMode;
  const [sheet, setSheet] = useState(0);    // 表示シート(0..5 = A..F)。apply-state が決める
  const [exprValues, setExprValues] = useState([]); // 表情係数パネル表示用
  const [cueAssigned, setCueAssigned] = useState(() => new Set()); // 音割当済みキューid
  const stageRef = useRef(null);
  const charRef = useRef(null);
  const motionRef = useRef(null);           // 首かしげ・スライド(translate)を直書きするラッパー
  const zoomRef = useRef(null);             // ズーム(scale)を直書きする外側ラッパー
  const userRef = useRef(null);             // ユーザー操作(ドラッグ移動・ズーム)を直書きする最外ラッパー
  // ユーザー操作は2層。shared は CEF(rx) へ送って同調させる分、local は Shift 併用で
  // 「この端末の見え方」だけ変える分（送らない）。表示は両者の合成（移動=加算/ズーム=乗算）。
  const userTransform = useRef({
    shared: { x: 0, y: 0, zoom: 1 }, // CEF へ送る（vw/vh + 倍率）
    local: { x: 0, y: 0, zoom: 1 },  // この端末だけ（送らない）
  });
  const target = useRef({ x: 0, y: 0 });   // -1..1（顔 or マウスの「向き」所有者が書き込む）
  // 描画ループ(readSignals)が参照する実効ソースと、マイクの生レベル。値は毎レンダー更新する。
  const directionRef = useRef('face');     // 実効「向き」ソース（'face' | 'mouse'）
  const mouthSrcRef = useRef('camera');    // 実効「口」ソース（'camera' | 'mic' | 'none'）
  const micLevelRef = useRef(0);           // マイクの生 RMS（use-mic-level が書く）
  const effBlinkSyncRef = useRef(false);   // 実効まばたき同調（カメラで目が取れるときのみ true）
  // カメラ不可時に顔追従→マウス追従へ自動フォールバックしたか（セッション限定・非永続）。
  const [autoMouseFallback, setAutoMouseFallback] = useState(false);
  // 時間方向の状態（口エンベロープ・まばたきヒステリシス・ズーム自動基準）→ avatar-state が更新。
  const exprStateRef = useRef(createExprState());
  // 平滑化エンベロープ（向き・かしげ・スライド・ズーム）→ apply-state が更新。
  const smoothStateRef = useRef(createSmoothState());
  // 校正直後の一定時間、かしげ・スライド・ズームの平滑化を飛ばしてターゲットへ即スナップする
  // 期限(performance.now ベース ms)。向き校正の右/左等を押した瞬間に「すぐ垂直」に見せるため。
  const snapMotionUntilRef = useRef(0);
  const autoBlinkRef = useRef(false);       // blinkSync OFF 時の自動まばたき状態（computeStateFrame に渡す）
  const latestFrameRef = useRef(null);      // rx: 最後に受信した状態フレーム
  const tweaksRef = useRef(t);
  tweaksRef.current = t;
  // 描画ループが参照する「実効 tweaks」。rx は受信した config、それ以外はローカル t。
  const viewRef = useRef(view);
  viewRef.current = view;

  // スマホでのページズーム（背景ピンチ・ダブルタップ）を抑止。1本指スクロールや、アバターの
  // pointer ピンチ（userRef）は温存する。obs/tx/rx いずれのモードでも誤ズームは困るので常時。
  useEffect(() => installMobileHardening(), []);
  // 背景色に合わせて theme-color を追従させる。obs は背景 transparent（無効値）なので更新しない。
  useEffect(() => { if (!obsMode) applyThemeColor(view.bgColor); }, [obsMode, view.bgColor]);

  // 顔向き → target への注入（マウス版の pointermove ハンドラの代わり）。
  // 上下左右で別々の振り幅（方向校正で得た rangeXxxDeg）を rad に直し、感度で割る。
  // 感度が高いほど少ない首振りで端まで届く（= maxXxx が小さくなる）。
  const sens = t.sensitivity;
  const poseOptions = {
    maxYawRight: (t.rangeYawRightDeg * DEG) / sens,
    maxYawLeft: (t.rangeYawLeftDeg * DEG) / sens,
    maxPitchUp: (t.rangePitchUpDeg * DEG) / sens,
    maxPitchDown: (t.rangePitchDownDeg * DEG) / sens,
    biasYaw: t.biasYawDeg * DEG,
    biasPitch: t.biasPitchDeg * DEG,
    invertX: t.invertX,
    invertY: t.invertY,
  };
  // 立ち位置（左右・上下）。invert は pose と同じく source 側(純関数)で適用する。
  const positionOptions = { invertX: t.invertSlide, invertY: t.invertSlideY };

  // 入力ソース（向き=顔/マウス × 口=カメラ/マイク/なし）。カメラ不可時は顔→マウスへ自動フォールバック。
  const effDirection = (t.inputDirection === 'face' && autoMouseFallback) ? 'mouse' : t.inputDirection;
  // フォールバック中(カメラ不可)に口=カメラのままは成立しないので閉じへ寄せる（mic は手動で選ぶ）。
  const effMouthSrc = (autoMouseFallback && t.mouthSource === 'camera') ? 'none' : t.mouthSource;
  // 各ソースの有効/無効。3フックは常に呼び、この enabled だけで切替える（Rules of Hooks）。
  // tx で「カメラ源=スマホ」を選ぶと PC カメラを止める（スマホが tx になって pose を送る）。
  // tx 以外（local / rx）では cameraSourceMode を無視して従来どおり（local 起動でカメラが
  // 止まったまま戻せなくなるのを防ぐ。トグル UI も tx のときだけ出す）。
  const pcCamActive = mode !== 'tx' || t.cameraSourceMode === 'pc';
  const camEnabled = !isRx && pcCamActive && (effDirection === 'face' || effMouthSrc === 'camera');
  const mouseEnabled = !isRx && effDirection === 'mouse';
  const micEnabled = !isRx && effMouthSrc === 'mic';
  // カメラで実まばたきが取れるのは口=カメラのときだけ。それ以外は自動まばたきに委譲する。
  const eyesFromCamera = effMouthSrc === 'camera' && camEnabled;
  const effBlinkSync = !!t.blinkSync && eyesFromCamera;
  // readSignals / 描画ループが ref 経由で最新の実効値を読めるようにする。
  directionRef.current = effDirection;
  mouthSrcRef.current = effMouthSrc;
  effBlinkSyncRef.current = effBlinkSync;

  const { videoRef, poseRef, rollRef, posRef, faceScaleRef, mouthRef, eyesClosedRef, blendshapesRef, status } = useFacePose(target, { enabled: camEnabled, writeXY: effDirection === 'face', poseOptions, positionOptions, preferWorker: t.useWorker, deviceId, facingMode: t.facingMode });
  // マウス追従ソース。アンカーは画面固定の stageRef（charRef は毎フレーム transform されるため不可）。
  useMouseTarget(target, stageRef, { enabled: mouseEnabled, followRange: t.followRange });
  // マイク口パクソース。生 RMS を micLevelRef に書き、readSignals が micGain で前段スケールする。
  const micLevelApi = useMicLevel(micLevelRef, { enabled: micEnabled });
  // カメラが実際に動くときだけプレビューを出す（マウス追従でカメラ停止中は空枠を出さない）。
  const showPreview = previewWanted && camEnabled;

  // カメラ許可後（status.phase==='running'）に videoinput を列挙して選択肢を更新する。
  // 許可前はラベルが空なので必ず起動後に列挙する。rx はカメラ無しなので対象外。
  useEffect(() => {
    if (isRx || status.phase !== 'running') return undefined;
    let cancelled = false;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devs) => {
        if (cancelled) return;
        setCameras(
          devs
            .filter((d) => d.kind === 'videoinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label })),
        );
      })
      .catch(() => { /* 列挙失敗は無視（選択肢が空＝自動のまま） */ });
    return () => { cancelled = true; };
  }, [isRx, status.phase]);

  // カメラ起動に失敗（不許可・デバイス無し等）したら、顔追従のときだけ自動でマウス追従へ。
  // 保存設定(inputDirection)は書き換えない＝カメラ復旧後の再読込で顔に戻る。手動で別ソースを
  // 選ぶ（inputDirection が変わる）と false に戻し、次の起動を顔で再試行できるようにする。
  useEffect(() => {
    if (isRx || t.inputDirection !== 'face') { setAutoMouseFallback(false); return; }
    if (status.phase === 'error') setAutoMouseFallback(true);
  }, [isRx, t.inputDirection, status.phase]);

  // 各 ref の最新値を「signals」へ合成する（avatar-state の入力）。向き=顔/マウス、
  // 口=カメラ/マイク/なし のチャンネル別合成は純関数 composeSignals に集約（テスト済み）。
  function readSignals() {
    return composeSignals(
      {
        target: target.current,
        pose: poseRef.current,
        roll: rollRef.current,
        posX: posRef.current.x,
        posY: posRef.current.y,
        faceScale: faceScaleRef.current,
        mouth: mouthRef.current,
        eyesClosed: eyesClosedRef.current,
      },
      {
        direction: directionRef.current,
        mouthSource: mouthSrcRef.current,
        micGain: tweaksRef.current.micGain,
        micLevel: micLevelRef.current,
      },
    );
  }

  // WS 中継。tx は config 要求に応答し CEF 接続を表示、rx は state/config を受信。
  const relayApi = useRelay(mode, {
    relayUrl: relay.relayUrl,
    getConfig: () => syncableTweaks(tweaksRef.current),
    // tx: 後着 OBS(rx) へ現在のお絵かきシーンを再送する（空なら null）。
    getDrawScene: () => drawLayerRef.current?.getScene() ?? null,
    // tx: 後着 OBS(rx) へ現在のテロップ設定を再送する（非表示・空なら null）。
    getTicker: () => tickerLayerRef.current?.getConfig() ?? null,
    // tx: 後着 OBS(rx) へ現在の時計設定を再送する（非表示なら null）。
    getClock: () => clockLayerRef.current?.getConfig() ?? null,
    onState: (arr) => { latestFrameRef.current = decodeStateFrame(arr); },
    onConfig: (cfg) => setRxConfig((prev) => ({ ...prev, ...cfg })),
    // rx: 受信したお絵かきシーンを再描画（DrawLayer 側で件数・サイズを検証）。
    onDrawScene: (data) => drawLayerRef.current?.loadScene(data),
    // rx: 描画途中のライブストロークを一時表示（DrawLayer 側で点列・色・太さを検証）。
    onDrawLive: (data) => drawLayerRef.current?.setLive(data),
    // rx: 受信したマウスカーソルを表示（DrawLayer 側で座標を検証）。
    onCursor: (data) => drawLayerRef.current?.setCursor(data),
    // rx: 受信したテロップ設定を反映（TickerLayer 側で文言・色・速度を検証）。
    onTicker: (data) => tickerLayerRef.current?.setConfig(data),
    // rx: 受信した時計設定を反映（ClockLayer 側で色・サイズを検証）。
    onClock: (data) => clockLayerRef.current?.setConfig(data),
    // rx: tx から来た演出をこの端末(OBS)で再生。カスタム文字/色が同梱されていれば一時オーバーライドに
    // 積んで run（同期）→ pop コールバックが拾う→直後に clear。relay 値は信頼私設網前提だが念のため検証する。
    onCue: (id, over) => {
      relayCueOverrideRef.current = over ? {
        stamp: typeof over.stamp === 'string' && over.stamp.trim()
          ? over.stamp.trim().slice(0, MAX_CUE_TEXT_LEN) : undefined,
        color: normalizeHexColor(over.color) || undefined,
        size: Number.isFinite(over.size) ? clampCueFontScale(over.size) : undefined,
        shadow: normalizeHexColor(over.shadow) || undefined,
        offset: over.offset && Number.isFinite(over.offset.x) && Number.isFinite(over.offset.y)
          ? clampCueOffset(over.offset) : undefined,
        hold: Number.isFinite(over.hold) ? clampCueHoldMs(over.hold) : undefined,
        anim: normalizeCueAnim(over.anim) || undefined,
        weight: Number.isFinite(over.weight) ? clampCueFontWeight(over.weight) : undefined,
        stroke: Number.isFinite(over.stroke) ? clampCueStroke(over.stroke) : undefined,
        // 追加分（store の sanitize を 1 件分流用して検証）。
        rotation: cueRotationStore.sanitize({ v: over.rotation }).v,
        place: cuePlaceStore.sanitize({ v: over.place }).v,
        halo: cueHaloStore.sanitize({ v: over.halo }).v,
        glow: cueGlowStore.sanitize({ v: over.glow }).v,
        glowColor: cueGlowColorStore.sanitize({ v: over.glowColor }).v,
        gain: cueGainStore.sanitize({ v: over.gain }).v,
      } : null;
      cueController.run(id);
      relayCueOverrideRef.current = null;
    },
  });
  // tx の発火を rx へ転送するための送信口。毎レンダー最新の sendCue を ref に差す。
  cueSendRef.current = relayApi.sendCue;
  // お絵かきシーン・ライブストローク・カーソルの送信口も同様に毎レンダー差し替える。
  drawSendRef.current = relayApi.sendDrawScene;
  drawLiveSendRef.current = relayApi.sendDrawLive;
  cursorSendRef.current = relayApi.sendCursor;
  // テロップ設定の送信口も毎レンダー差し替える。
  tickerSendRef.current = relayApi.sendTicker;
  // 時計設定の送信口も毎レンダー差し替える。
  clockSendRef.current = relayApi.sendClock;

  // tx: 設定が変わったら CEF へ config を送る（数秒ごとの再送はしない＝変更時のみ）。
  useEffect(() => {
    if (mode !== 'tx') return;
    relayApi.sendConfig(syncableTweaks(t));
    // relayApi.sendConfig は clientRef を見るので、依存は mode と t だけでよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, t]);

  // いまの顔向き（生角度）を「正面」として記録する。少し下や横を向いた
  // 自然な姿勢を中立にしたいとき用。
  function calibrateCenter() {
    setTweak('biasYawDeg', Math.round(poseRef.current.yaw / DEG));
    setTweak('biasPitchDeg', Math.round(poseRef.current.pitch / DEG));
  }
  function resetCenter() {
    setTweak('biasYawDeg', 0);
    setTweak('biasPitchDeg', 0);
  }

  // 十字校正ボタンのフィードバック（'ok' | 'err'）を方向ごとに一定時間出す。
  function flashDir(dir, ok) {
    setDirFlash((prev) => ({ ...prev, [dir]: ok ? 'ok' : 'err' }));
    clearTimeout(dirFlashTimersRef.current[dir]);
    dirFlashTimersRef.current[dir] = setTimeout(() => {
      setDirFlash((prev) => {
        const next = { ...prev };
        delete next[dir];
        return next;
      });
    }, CALIBRATE_FEEDBACK_MS);
  }

  // アバターのダブルクリック校正用フィードバック。十字「正」ボタンは校正パネルを
  // 開いていないと見えないため、アバター上に短くピルを出して効いたことを知らせる。
  function flashCenterCalib() {
    setCenterCalibFlash(true);
    clearTimeout(centerCalibFlashTimerRef.current);
    centerCalibFlashTimerRef.current = setTimeout(() => setCenterCalibFlash(false), CALIBRATE_FEEDBACK_MS);
  }

  // 十字の「正」ボタン: 旧「校正」ボタンと同じ＝今の向き＝正面・距離＝基準・目＝まばたき
  // なし・かしげ＝0 をまとめて取り直す。フィードバックは中央ボタン上に ✓ を出す。
  function calibrateCenterCross() {
    calibrateAll();
    flashDir('center', true);
  }

  // 上下左右の校正: その向きに顔を振り切った姿勢で押す。1回の押下で
  //   ① 振り幅（片側レンジ rangeXxxDeg）が画面端(±1)に来るよう校正、
  //   ② その向きでの「見かけ上のズレ」を打ち消す＝アバターに余計な変化を出さない:
  //      左右 → 位置ズレ(slidePoseCompX)・かしげ混入(tiltYawComp)、
  //      上下 → ズーム変化(zoomPitchComp)・位置ズレ(slidePoseCompY)、
  //      共通 → 目（向いて目が閉じたと誤検出しないよう開眼基準を必要なら引き上げる）。
  //   （距離は左右では不変＝faceScale は高さ基準で yaw に強い。かしげは上下では混入しない。）
  // 顔の向きだけ変えて（平行移動せず・距離を変えず）押す前提。逆向き・振り不足は
  // computeDirectionRange が null を返すので ✗ を出して何も書かない。
  //
  // 表示(グリッド/アバター)は invertX/invertY で左右・上下が反転する（head-pose の x=-x / y=-y）。
  // ボタンはユーザーが見ている「表示の向き」なので、生 yaw/pitch 空間での向き(rawDir)へ写してから
  // 校正する。invertX(=既定 true)のとき「右ボタン」は生 yaw が負の側＝raw 'left' に対応する。
  // これを写さないと、顔を右に向けて右を押しても「逆向き」と判定されて常に ✗ になる。
  function calibrateDirection(uiDir) {
    const dir = rawDirForDisplay(uiDir, { invertX: t.invertX, invertY: t.invertY }); // 生 yaw/pitch 空間の向き
    const yaw = poseRef.current.yaw;
    const pitch = poseRef.current.pitch;
    const res = computeDirectionRange({
      yawRad: yaw,
      pitchRad: pitch,
      biasYawDeg: t.biasYawDeg,
      biasPitchDeg: t.biasPitchDeg,
      dir,
      sensitivity: t.sensitivity,
      minDeg: CALIBRATE_MIN_SWING_DEG,
    });
    if (!res) {
      flashDir(uiDir, false); // フィードバックは押したボタン(表示向き)に出す
      return;
    }
    const edits = { [res.key]: res.deg };
    // 左右: 位置ズレ(slidePoseCompX) と かしげ差(b) を、押した姿勢で 0 になるよう記録する。
    if (dir === 'left' || dir === 'right') {
      const compX = computeSlidePoseCompX({ posX: posRef.current.x, yaw, invertSlide: t.invertSlide });
      if (compX != null) edits.slidePoseCompX = compX; // 逆符号・振り不足は据え置き
      // かしげ差 b = 「いま実際に表示されているかしげ（= a と幾何補正 tiltYawComp を通した後の roll）」。
      // 右なら +b、左なら -b を覚え、実行時は右向きで rollGeo-b、左向きで rollGeo+b になるので、押した
      // 向きの姿勢でちょうど 0（垂直）になる。tiltYawComp が 0 でなくても（手動で動かしても）、その幾何項
      // 由来のかしげごと打ち消せるのがポイント（生 roll から取ると幾何項が残り、垂直にならない）。
      // 「正」を先に押して a を決めておく前提（パネルの案内通り）。0.1°刻みで保持。
      const rawRoll = rollRef.current - t.biasRollDeg * DEG;
      const rollGeo = compensateRollForYaw(rawRoll, yaw, t.tiltYawComp, pitch); // 表示中のかしげ(rad)
      const rollShownDeg = rollGeo / DEG;
      const b = dir === 'right' ? rollShownDeg : -rollShownDeg;
      edits.rollYawTiltB = Math.round(b * 10) / 10;
    }
    // 上下: ズーム変化(zoomPitchComp) と 位置ズレ(slidePoseCompY) を打ち消す。
    // ズームは実行時パイプラインに合わせ、口開き補正(zoomMouthComp)を先に通したサイズで逆算
    // （既定 zoomMouthComp=0 なら素通し）。基準サイズは手動較正優先・無ければ自動基準。
    if (dir === 'up' || dir === 'down') {
      const baseline = t.zoomBaseline > 0 ? t.zoomBaseline : exprStateRef.current.autoBaseline;
      const szMouth = compensateScaleForMouth(faceScaleRef.current, mouthRef.current, t.zoomMouthComp);
      const compZ = computeZoomPitchComp({ faceScale: szMouth, pitch, baseline });
      if (compZ != null) edits.zoomPitchComp = compZ;
      const compY = computeSlidePoseCompY({ posY: posRef.current.y, pitch, invertSlideY: t.invertSlideY });
      if (compY != null) edits.slidePoseCompY = compY;
    }
    // 目: 向いた姿勢で目が閉じたと誤検出しないよう、開眼基準を今の値まで引き上げる（下げない）。
    // 方向ごとに押すと積み上がるので、まばたき検出が潰れない範囲(0.9)で頭打ちにする。
    const ec = eyesClosedRef.current;
    if (Number.isFinite(ec) && ec > t.eyesOpenBias) {
      edits.eyesOpenBias = Math.min(0.9, Math.round(ec * 100) / 100);
    }
    setTweak(edits);
    // 押した瞬間に平滑化のランプを飛ばし、新しい補正へ即スナップさせる（「すぐ垂直」を保証）。
    snapMotionUntilRef.current = performance.now() + SNAP_MOTION_MS;
    flashDir(uiDir, true); // フィードバックは押したボタン(表示向き)に出す
  }
  // 上下左右の振り幅を既定（≒従来の対称レンジ）へ戻す。1回の setTweak でまとめて反映する。
  function resetRanges() {
    setTweak({
      rangeYawLeftDeg: TWEAK_DEFAULTS.rangeYawLeftDeg,
      rangeYawRightDeg: TWEAK_DEFAULTS.rangeYawRightDeg,
      rangePitchUpDeg: TWEAK_DEFAULTS.rangePitchUpDeg,
      rangePitchDownDeg: TWEAK_DEFAULTS.rangePitchDownDeg,
    });
  }

  // 今の首かしげ(roll)を「正面のかしげ(0)」として記録する。常に少し傾いて
  // 写ってしまう人向け。以降はこの中立からのズレ分だけアバターがかしげる。
  // 0.1°刻みで保持（整数度の丸めだと正面で最大 ~0.5°×ゲインの傾きが残るのを防ぐ）。
  function calibrateTilt() {
    setTweak('biasRollDeg', Math.round((rollRef.current / DEG) * 10) / 10);
  }
  function resetTilt() {
    // 自動校正するかしげ値（正面中立 a=biasRoll・左右のかしげ差 b）を 0 に戻す。
    // 左右向き補正 tiltYawComp は手動スライダー（既定 0）なのでここでは触らない。
    setTweak({ biasRollDeg: 0, rollYawTiltB: 0 });
  }

  // いまの目の状態（開いている想定）を「まばたきなし」の基準にする。
  // 細目やカメラ角度で eyeBlink が開眼時でも高めに出る人向け。現在の値を
  // オフセットとして記録し、以降はこれを差し引いて閉じ具合を判定する。
  function calibrateEyesOpen() {
    setTweak('eyesOpenBias', Math.round(eyesClosedRef.current * 100) / 100);
  }
  function resetEyesOpen() {
    setTweak('eyesOpenBias', 0);
  }

  // いまのカメラとの距離（顔の見かけサイズ）を「等倍(ズーム1)」の基準にする。
  // 以降はこのサイズとの比がズーム率になる（近づくと拡大・離れると縮小）。
  function calibrateZoom() {
    if (faceScaleRef.current > 0) {
      setTweak('zoomBaseline', Math.round(faceScaleRef.current * 1000) / 1000);
    }
  }
  function resetZoom() {
    setTweak('zoomBaseline', 0);
    exprStateRef.current.autoBaseline = 0; // 自動基準も捨てて次の検出で取り直す
  }

  // 今の向き＝正面・今の距離＝等倍の基準・今の目の大きさ＝まばたきなし・今のかしげ＝正面(a) を
  // まとめて取り直す。個別校正をそのまま順に呼ぶだけ（計算を重複させない）。setTweak は関数更新で
  // マージするので、続けて呼んでも取りこぼさず同フレームに反映される。
  // 注: 左右のかしげ差(b=rollYawTiltB)と左右向き補正(tiltYawComp)はここでは変更しない
  // （「正」は a の取り直しのみ。b は右/左ボタンで別途記録する）。
  function calibrateAll() {
    calibrateCenter();      // 今の向きを正面に
    calibrateZoom();        // 今の距離を等倍の基準に
    calibrateEyesOpen();    // 今の目の大きさをまばたきなしに
    calibrateTilt();        // 今のかしげを正面(a)に（biasRollDeg を記録）
  }
  // アンマウント時にフィードバック用タイマーを後始末する（解除後の setState を避ける）。
  useEffect(() => () => {
    Object.values(dirFlashTimersRef.current).forEach(clearTimeout);
    clearTimeout(centerCalibFlashTimerRef.current);
  }, []);

  // ユーザー操作（移動・ズーム）2層の現在値を userRef に反映。操作 effect とボタンの共通経路。
  function applyUserTransform() {
    const el = userRef.current;
    if (el) el.style.transform = composeUserTransform(userTransform.current);
  }
  // 移動・ズームを両層とも初期化（位置中央・等倍）。リセットボタン/ダブルクリック用。
  function resetUserTransform() {
    const u = userTransform.current;
    u.shared.x = 0; u.shared.y = 0; u.shared.zoom = 1;
    u.local.x = 0; u.local.y = 0; u.local.zoom = 1;
    applyUserTransform();
  }

  // アバターのダブルクリックで「表示（移動・ズーム）リセット＋向き校正（正）」をまとめて行う。
  // 操作 effect は [] 依存でマウント時固定のため、最新クロージャを ref 経由で呼んで陳腐化を避ける
  // （毎レンダー張り替え。calibrateAll の入力は ref 主体だが setTweak 等もあるので安全側に倒す）。
  const dblRecenterRef = useRef(null);
  useEffect(() => {
    dblRecenterRef.current = () => {
      resetUserTransform();   // 手動の移動・ズームを中央・等倍へ
      calibrateCenterCross(); // 今の向き・距離・目・かしげを正面基準に取り直す
      flashCenterCalib();     // アバター上に「✓ 正面を校正」ピルを短く出す
    };
  });

  // ユーザーズームの上下限(Tweaks)を変えたら、現在のズーム値を新範囲へ即クランプし直して
  // 表示へ反映する。スライダー操作だけで最小/最大が「今すぐ」効くようにする（次のホイール
  // 操作を待たない）。rx は受信値を commit が当てるので対象外。
  useEffect(() => {
    if (isRx) return;
    const lo = t.userZoomMin ?? USER_ZOOM_MIN;
    const hi = t.userZoomMax ?? USER_ZOOM_MAX;
    const u = userTransform.current;
    u.shared.zoom = clamp(u.shared.zoom, lo, hi);
    u.local.zoom = clamp(u.local.zoom, lo, hi);
    applyUserTransform();
    // applyUserTransform/clamp は安定参照。上下限と rx 切替のみで張り直せばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.userZoomMin, t.userZoomMax, isRx]);

  // メインループ。3モード共通で「状態フレーム → 平滑化 → 描画」を回す。
  //   local/tx: signals から computeStateFrame（口/まばたき/補正を確定）→ applyState。
  //             tx はさらに状態フレームを ~30Hz 上限で送信。
  //   rx:       受信済みの状態フレームを applyState（平滑化＝ジッタ吸収）。カメラ無し。
  useEffect(() => {
    let raf;
    let lastCell = { r: 2, c: 2 };
    let lastSheet = -1;
    let lastSent = 0;
    const SEND_INTERVAL_MS = 33; // 送信レート上限（~30Hz）

    // apply-state の結果を画面へ反映（セル/シートは変化時のみ setState、transform は直書き）。
    function commit(out) {
      if (out.cell.r !== lastCell.r || out.cell.c !== lastCell.c) {
        lastCell = out.cell;
        setCell(lastCell);
      }
      if (out.sheet !== lastSheet) {
        lastSheet = out.sheet;
        setSheet(out.sheet);
      }
      const mEl = motionRef.current;
      if (mEl) mEl.style.transform = out.motionTransform;
      const zEl = zoomRef.current;
      if (zEl) zEl.style.transform = out.zoomTransform;
      // rx（CEF）はユーザー操作も受信値に同調させる。tx/local は userRef をローカル操作が
      // 直接握るので、ここでは触らない（commit が毎フレーム上書きするのを避ける）。
      if (mode === 'rx') {
        const uEl = userRef.current;
        if (uEl) uEl.style.transform = out.userTransform;
      }
    }

    // ジェスチャー再生中は顔追従ポーズを一時上書き: セルを差し替え、回転/拡縮を専用ラッパーへ。
    // 終了(null)で解放→ライブ追従へ戻る。送信フレームには触れない（rx へは cue id を別途転送）。
    function applyGesture(out, now) {
      const g = gesturePlayRef.current;
      if (!g) return out;
      if (g.base == null) g.base = out.cell;
      const s = sampleGesture(GESTURES[g.name], now - g.start, g.base, { rows: ROWS, cols: COLS });
      if (!s) {
        gesturePlayRef.current = null;
        if (gestureFxRef.current) gestureFxRef.current.style.transform = '';
        return out;
      }
      if (gestureFxRef.current) gestureFxRef.current.style.transform = gestureTransform(s);
      return { ...out, cell: s.cell };
    }

    function tick(now) {
      let out = null;
      if (mode === 'rx') {
        const frame = latestFrameRef.current;
        if (frame) out = applyState(frame, viewRef.current, smoothStateRef.current);
      } else {
        const tw = tweaksRef.current;
        // 送信する移動量だけ moveRatio 倍（rx が tx の比率倍動く）。tx 自身の表示は
        // userRef 直書きのまま 1:1 で、ここでは送信値だけ拡縮する。ズームは対象外。
        const sh = userTransform.current.shared;
        const ratio = tw.moveRatio == null ? 1 : tw.moveRatio;
        const sentUser = { x: sh.x * ratio, y: sh.y * ratio, zoom: sh.zoom };
        // カメラで実まばたきが取れないソース（マウス/マイク/なし・フォールバック）では
        // blinkSync を実効 OFF にして、computeStateFrame を自動まばたき(blinkOverride)経路へ倒す。
        const twFrame = effBlinkSyncRef.current ? tw : { ...tw, blinkSync: false };
        const frame = computeStateFrame(
          readSignals(), twFrame, exprStateRef.current, now,
          { blinkOverride: autoBlinkRef.current, user: sentUser },
        );
        // カメラ源=スマホ のときは PC からは送らない（PC の neutral フレームがスマホ tx と
        // 競合してアバターがブレるのを防ぐ＝同時に有効な tx は 1 つ）。
        if (mode === 'tx' && tw.cameraSourceMode === 'pc' && now - lastSent >= SEND_INTERVAL_MS) {
          lastSent = now;
          relayApi.sendState(encodeStateFrame(frame));
        }
        // 校正直後はかしげ・スライド・ズームの平滑化を飛ばし、ターゲットへ即スナップさせる。
        // setTweak の反映が次レンダーなので、数フレームぶん（SNAP_MOTION_MS）スナップし続ける。
        if (now < snapMotionUntilRef.current) {
          const sm = smoothStateRef.current;
          sm.tilt = frame.tilt;
          sm.slideX = frame.slideX;
          sm.slideY = frame.slideY;
          sm.zoom = frame.zoom;
        }
        out = applyState(frame, tw, smoothStateRef.current);
      }
      if (out) commit(applyGesture(out, now));
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // mode が変われば張り直す。relayApi.sendState は clientRef 参照なので依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // アバターをドラッグで移動、ホイール/ピンチでズーム（ユーザー操作分）。
  // 顔追従(motionRef/zoomRef)とは別の最外ラッパー(userRef)へ直書きするので互いに干渉しない。
  // 操作は2層: 通常は shared（CEF へ送り rx も同調）、Shift 併用は local（この端末だけ・送らない）。
  // 表示は両者の合成（移動=加算 vw/vh / ズーム=乗算）。rx 自身は受信値を commit が当てるので無効化。
  // ダブルクリックで「両層リセット＋向き校正（正）」をまとめて実行（dblRecenterRef 経由）。
  useEffect(() => {
    if (isRx) return undefined;   // rx は受信した userTransform を commit が反映するので操作は受けない
    const el = userRef.current;
    if (!el) return undefined;
    const u = userTransform.current;   // { shared, local }
    const pointers = new Map();   // pointerId → { x, y }
    let drag = null;              // { px, py, ox, oy, layer } 1本指/マウスの移動（px=生座標, ox/oy=vw/vh）
    let pinch = null;             // { dist, zoom, layer } 2本指の拡縮
    let movedFar = false;         // 押下スケールを解除済みか

    // どの層を操作するか。Shift キー（PC）または「反映先」トグル ON（スマホ）= local（この端末
    // だけ）、いずれも無ければ shared（CEF へ送る）。
    const layerFor = (e) => ((e.shiftKey || localModeRef.current) ? u.local : u.shared);

    // 表示は shared+local の合成。送信されるのは shared だけ（composeUserTransform に式を集約）。
    const apply = () => { el.style.transform = composeUserTransform(u); };
    // pointers が2点あるときの指間距離。pinch 中のみ呼ぶ前提。
    const dist = () => {
      const [a, b] = pointers.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const layer = layerFor(e);
        drag = { px: e.clientX, py: e.clientY, ox: layer.x, oy: layer.y, layer };
        movedFar = false;
        el.style.cursor = 'grabbing';
      } else if (pointers.size === 2) {
        const layer = drag ? drag.layer : layerFor(e); // 1本目で決めた層を維持
        drag = null;                       // 2本指はピンチ優先
        pinch = { dist: dist() || 1, zoom: layer.zoom, layer };
      }
    };
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const tw = tweaksRef.current;        // 上下限は Tweaks から毎回読む（リロード不要で即反映）
        pinch.layer.zoom = clamp(pinch.zoom * (dist() / pinch.dist),
          tw.userZoomMin ?? USER_ZOOM_MIN, tw.userZoomMax ?? USER_ZOOM_MAX);
        apply();
      } else if (drag) {
        // px の移動量を vw/vh へ変換（解像度差を吸収して CEF にも比例反映させる）。
        drag.layer.x = drag.ox + (e.clientX - drag.px) / window.innerWidth * 100;
        drag.layer.y = drag.oy + (e.clientY - drag.py) / window.innerHeight * 100;
        if (!movedFar &&
            Math.hypot(e.clientX - drag.px, e.clientY - drag.py) > DRAG_SQUISH_CANCEL_PX) {
          movedFar = true;
          setPressed(false);               // ドラッグ中は押下スケールを解除
        }
        apply();
      }
    };
    const onUp = (e) => {
      pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
      // ピンチ→1本指に戻るときに層を引き継ぐため、消す前に layer を控える。
      const prevLayer = (pinch && pinch.layer) || (drag && drag.layer) || u.shared;
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        // 残った指で取り直してジャンプを防ぐ（層は維持・squish は不要）。
        const [p] = pointers.values();
        drag = { px: p.x, py: p.y, ox: prevLayer.x, oy: prevLayer.y, layer: prevLayer };
        movedFar = true;
      } else if (pointers.size === 0) {
        drag = null;
        setPressed(false);                 // capture で charRef の up が来ないため明示解除
        el.style.cursor = 'grab';
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      const tw = tweaksRef.current;        // 感度・上下限は Tweaks から毎回読む（リロード不要で即反映）
      const layer = layerFor(e);           // Shift+ホイール = local（この端末だけ）
      const sens = wheelSensFromDial(tw.wheelZoomDial ?? WHEEL_SENS_DIAL_DEFAULT);
      layer.zoom = clamp(layer.zoom * Math.exp(-e.deltaY * sens),
        tw.userZoomMin ?? USER_ZOOM_MIN, tw.userZoomMax ?? USER_ZOOM_MAX);
      apply();
    };
    // ダブルクリック: 表示（移動・ズーム）リセット＋向き校正（正）をまとめて実行。
    // 最新クロージャを ref 経由で呼ぶ（この effect は [] 依存でマウント時固定のため）。
    const onReset = () => dblRecenterRef.current?.();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onReset);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onReset);
    };
    // setPressed は安定参照。userRef はマウント後固定なので初回のみ張ればよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自動まばたき（まばたき同調OFFのときだけ動作。ONのときは computeStateFrame が実眼に追従）。
  // 結果は autoBlinkRef に書き、メインループが blinkOverride として computeStateFrame に渡す。
  // rx は sheet を受信するので自動まばたきは動かさない。
  useEffect(() => {
    if (isRx || effBlinkSync) return undefined;
    let alive = true;
    let timer;
    const rand = (a, b) => a + Math.random() * (b - a);
    function blinkOnce(dur, after) {
      autoBlinkRef.current = true;
      timer = setTimeout(() => {
        if (!alive) return;
        autoBlinkRef.current = false;
        timer = setTimeout(after, rand(120, 220));
      }, dur);
    }
    function doBlink() {
      if (!alive) return;
      const roll = Math.random();
      if (roll < 0.22) {
        blinkOnce(rand(80, 120), () => { if (alive) blinkOnce(rand(70, 110), schedule); });
      } else if (roll < 0.28) {
        blinkOnce(rand(260, 420), schedule);
      } else {
        blinkOnce(rand(90, 150), schedule);
      }
    }
    function schedule() {
      if (!alive) return;
      const u = Math.random();
      let wait;
      if (u < 0.12) wait = rand(700, 1500);
      else if (u < 0.82) wait = rand(1800, 4500);
      else wait = rand(4500, 9000);
      timer = setTimeout(doBlink, wait);
    }
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, [effBlinkSync, isRx]);

  // 表情係数パネルの更新（表示ONのときだけ ~10fps で ref → state にコピー）。
  // OFF時はインターバルを張らないので毎フレーム再描画のコストはゼロ。
  useEffect(() => {
    if (!t.showExpr) return undefined;
    const id = setInterval(() => {
      const cats = blendshapesRef.current || [];
      const scoreByName = new Map(cats.map((c) => [c.categoryName, c.score]));
      setExprValues(MAIN_BLENDSHAPES.map(({ key, label }) => ({
        label, value: scoreByName.get(key) || 0,
      })));
    }, 100);
    return () => clearInterval(id);
  }, [t.showExpr, blendshapesRef]);

  // ステージモード中だけ T キーで Tweaks パネルを開閉できる（OBS の「対話」で較正する用）。
  // 通常モードでは常時パネルがあるのでフックを張らない。
  useEffect(() => {
    if (!obsMode) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // 入力中は無視
      if (e.key === 't' || e.key === 'T') setPanelOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [obsMode]);

  // 演出: 全体音量を反映。
  // 出力ミュート: rx は同期された sbMutedRx を、それ以外(tx/local)はローカルの sbMutedTx を見る。
  // → 手元(tx)と配信(rx)を別々にミュートできる。音量(sbGain)は各ページのローカル値。
  useEffect(() => {
    const muted = isRx ? !!view.sbMutedRx : !!t.sbMutedTx;
    cueBoard.setMasterGain(muted ? 0 : view.sbGain);
  }, [cueBoard, isRx, view.sbMutedRx, t.sbMutedTx, view.sbGain]);
  // iOS(WebKit=iPhone の Chrome/Safari) 自動再生対策: 最初のユーザー操作で音声をアンロック。
  // pointerdown は click より前に発火するので、ボタンを押し切る前に AudioContext が起きる。
  useEffect(() => {
    const unlock = () => { cueBoard.unlock(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchend', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchend', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [cueBoard]);
  // sound にパス/URL があるキューを先読み（無ければ tone で鳴るので 0 アセットでも可）。
  useEffect(() => {
    cueController.cues.forEach((c) => { if (c.sound) cueBoard.loadUrl(c.id, c.sound); });
  }, [cueBoard, cueController]);
  // 数字キーでキュー発火（入力中・修飾キー併用は無視）。obsMode でも有効。
  useEffect(() => {
    const onCueKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      cueController.runByKey(e.key);
    };
    window.addEventListener('keydown', onCueKey);
    return () => window.removeEventListener('keydown', onCueKey);
  }, [cueController]);
  // ?cue=hello,clap で読み込み時に自動発火（OBS の CEF は自動再生が許可されている）。
  useEffect(() => {
    const { cues } = parseCueParam(typeof window !== 'undefined' ? window.location.search : '');
    if (!cues.length) return;
    cueBoard.resume();
    cues.forEach((id) => cueController.run(id));
  }, [cueBoard, cueController]);

  // 特定の音（例: こんにちは.mp3）をキューに割り当てる。その場限り（再読込で消える）。
  async function assignCueFile(id, file) {
    const ok = await cueBoard.assignFile(id, file);
    if (ok) setCueAssigned((s) => new Set(s).add(id));
  }

  const frames = useMemo(() => {
    const arr = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arr.push({ r, c });
    return arr;
  }, []);

  // エフェクト設定（view 由来）→ SpriteAvatar へ。値が変わったときだけ新オブジェクトを作り
  // 参照を安定させる（毎レンダーで setEffect が走るのを防ぐ）。
  const effects = useMemo(() => ({
    // cueFx 中はグローを一時的に上書き（発火フラッシュ）。通常時は view の設定を使う。
    glow: cueFx && cueFx.glow
      ? { enabled: true, strength: cueFx.glow, color: cueFx.glowColor || view.effGlowColor }
      : { enabled: view.effGlow, strength: view.effGlowStrength, color: view.effGlowColor },
    dissolve: { enabled: view.effDissolve, amount: view.effDissolveAmount, color: view.effDissolveColor },
  }), [
    view.effGlow, view.effGlowStrength, view.effGlowColor,
    view.effDissolve, view.effDissolveAmount, view.effDissolveColor,
    cueFx,
  ]);

  const dark = view.bgColor === '#2B2926';
  const inkColor = dark ? 'rgba(255,248,238,0.85)' : 'rgba(60,48,38,0.8)';
  const subColor = dark ? 'rgba(255,248,238,0.45)' : 'rgba(60,48,38,0.45)';

  // 右下 Tweaks ボタンの幅ぶんを空け、中央タイトル帯は少し上へ逃がすのに使う。
  const isNarrow = useIsNarrow();

  // 状態表示。rx は中継リンクの接続有無、マウス追従は追従中＋口ソース、顔追従はカメラ/顔検出。
  const micStatus = micLevelApi.status;
  let statusText;
  let statusColor;
  if (isRx) {
    statusText = relayApi.linkUp ? '中継に接続中（受信）' : '中継に未接続';
    statusColor = relayApi.linkUp ? '#46C26A' : '#E5A23D';
  } else if (effDirection === 'mouse') {
    const mouthNote = effMouthSrc === 'mic'
      ? (micStatus.phase === 'error' ? '・マイク使用不可'
        : micStatus.phase === 'running' ? '・マイク口パク' : '・マイク準備中')
      : effMouthSrc === 'camera' ? '・カメラ口パク' : '';
    statusText = (autoMouseFallback ? 'カメラ不可→マウス追従' : 'マウス追従中') + mouthNote;
    statusColor = (effMouthSrc === 'mic' && micStatus.phase === 'error') ? '#E5A23D' : '#46C26A';
  } else {
    statusText = ({
      idle: 'カメラ停止中',
      loading: 'カメラ起動中…',
      error: `エラー: ${status.error || ''}`,
    }[status.phase] || (status.faceDetected ? '顔を検出中' : '顔が見つかりません'));
    statusColor = status.phase === 'error' ? '#E5484D'
      : status.phase === 'running' && status.faceDetected ? '#46C26A'
      : '#E5A23D';
  }

  // 実際の推論先（worker を希望しても dev・非対応・フォールバック時は main）。
  const engineLabel = status.engine === 'worker' ? 'Web Worker'
    : status.engine === 'main' ? 'メインスレッド' : '—';
  const engineNote = t.useWorker && status.engine === 'main' ? '（フォールバック）' : '';
  const onWorker = status.engine === 'worker';

  // 演出アイコン帯（cuebar）の向き。横帯(row)＝下、縦帯(column)＝左が既定だが、ユーザーが
  // ⇄/⇅ で切り替えられる。既定はデバイス連動（スマホ→row / PC→column）で従来の見た目を踏襲。
  // 保存は :panelpref sidecar（テーマ export を汚さない・resetTweaks でも消えない）。
  const [cueDir, setCueDir] = useState(() => {
    const saved = loadPanelPref('cuebar');
    return (saved === 'row' || saved === 'column') ? saved : (isNarrow ? 'row' : 'column');
  });
  const toggleCueDir = useCallback(() => {
    setCueDir((d) => {
      const next = d === 'row' ? 'column' : 'row';
      savePanelPref('cuebar', next);
      return next;
    });
  }, []);

  // cue 帯のスクロール要素の ref（CueBar 内のマウスドラッグ／ホイール処理が参照する）。
  const cueScrollRef = useRef(null);

  // パネル表示トグル帯（カメラ/デバッグ…）の向き。cuebar と同じ SlideBar に載せ、↕/↔ で
  // 縦横を切り替える。既定は横帯(row)＝ワイドなテキストチップの帯なので横並びが自然。
  // 保存は cuebar と別キーの :panelpref sidecar（'toggles'）。
  const [togglesDir, setTogglesDir] = useState(() => {
    const saved = loadPanelPref('toggles');
    return (saved === 'row' || saved === 'column') ? saved : 'row';
  });
  const toggleTogglesDir = useCallback(() => {
    setTogglesDir((d) => {
      const next = d === 'row' ? 'column' : 'row';
      savePanelPref('toggles', next);
      return next;
    });
  }, []);
  // トグル帯のスクロール要素の ref（SlideBar 内のマウスドラッグ／ホイール処理が参照する）。
  const togglesScrollRef = useRef(null);

  // 演出ボタン帯の中身。「編集」トグルは固定（スマホ/PC とも常時表示）、cue 列だけをスクロールさせる
  // ため、トグルと cue 列を別々に組めるよう変数化する。
  const cueToggleButton = (
    <button type="button" onClick={toggleEditMode}
      title="演出を編集（位置・色・音などを調整。cue を右クリック／長押しでも個別に開く）"
      style={{
        flex: '0 0 auto', // 帯では縮ませない（PC では常時表示の要）。
        // 横帯は移動アイコン/向き切替と同じ細幅・全高（テキストは 編/集 に折返し）。
        // 縦帯はスリムな縦ストリップに合わせて幅を詰め、高さは位置ボタン(⠿)＝cue と揃える。
        ...(cueDir === 'row'
          ? { width: CUEBAR_CTRL_W, alignSelf: 'stretch' }
          : { width: CUEBAR_COL_W, height: CUEBAR_BTN_H }),
        fontSize: isNarrow ? 9 : 10,
        fontWeight: 800, lineHeight: 1.15, padding: '3px 2px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        background: editMode ? (dark ? '#5B8DEF' : '#3B74E8') : (dark ? 'rgba(48,45,42,0.92)' : 'rgba(255,255,255,0.9)'),
        color: editMode ? '#fff' : (dark ? '#F7F1E8' : '#3C3026'),
        border: `1.5px solid ${editMode ? 'transparent' : (dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.14)')}`,
        borderRadius: 11, cursor: 'pointer', whiteSpace: 'normal',
        boxShadow: '0 4px 14px rgba(60,48,38,0.08)', userSelect: 'none', touchAction: 'manipulation'
      }}>
      {editMode ? '編集中' : '編集'}
    </button>
  );
  const cueButtonList = cueController.cues.map((c) => {
    const editable = !!c.stamp;
    const active = editMode && c.id === editingCueId;
    const ring = active
      ? `2px solid ${dark ? '#7FB0FF' : '#3B74E8'}`
      : (editMode && editable
        ? `1.5px dashed ${dark ? 'rgba(127,176,255,0.7)' : 'rgba(59,116,232,0.6)'}`
        : `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.14)'}`);
    return (
      <button key={c.id}
        onClick={() => onCueButtonClick(c)}
        onContextMenu={(e) => onCueButtonContextMenu(e, c)}
        onPointerDown={(e) => onCueButtonPointerDown(e, c)}
        onPointerMove={onCueButtonPointerMove}
        onPointerUp={cancelCueLongPress}
        onPointerLeave={cancelCueLongPress}
        onPointerCancel={cancelCueLongPress}
        title={editMode
          ? (editable ? `${c.label}: ドラッグで位置を調整` : `${c.label}: 設定なし（スタンプ無し）`)
          : `${c.label}（キー: ${c.key || '-'}）`}
        style={{
          position: 'relative',
          // 帯では縮ませず溢れさせる＝スクロールの肝（スワイプ/ホイール/ドラッグで自由スクロール）。
          flex: '0 0 auto',
          // 高さはお絵かきツールバーと揃える（帯全体で ~40px）。絵文字も小さめに。
          // 縦帯（column）は幅を詰めてスリムな縦ストリップにする。
          width: cueDir === 'column' ? CUEBAR_COL_W : (isNarrow ? 40 : 50), height: CUEBAR_BTN_H, fontSize: 17, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: dark ? 'rgba(48,45,42,0.92)' : 'rgba(255,255,255,0.9)',
          border: ring,
          opacity: editMode && !editable ? 0.5 : 1,
          borderRadius: 11, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap',
          boxShadow: active ? `0 0 0 3px ${dark ? 'rgba(127,176,255,0.25)' : 'rgba(59,116,232,0.2)'}` : '0 4px 14px rgba(60,48,38,0.08)',
          userSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation'
        }}>
        {c.icon || c.stamp || c.label}
        {c.key ? (
          <span style={{ position: 'absolute', right: 3, bottom: 2, fontSize: 9, fontWeight: 700, color: subColor }}>{c.key}</span>
        ) : null}
      </button>
    );
  });

  return (
    <div
      ref={stageRef}
      style={{
        position: 'fixed', inset: 0, background: obsMode ? 'transparent' : view.bgColor,
        overflow: 'hidden', transition: 'background 0.4s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column',
        fontFamily: "'Zen Maru Gothic', sans-serif"
      }}
    >
      {/* 顔向き推定の入力。プレビューOFFでも検出のため要素自体は残し、画面外に逃がす。
          プレビュー時は DraggablePanel で掴んで移動でき、✕で隠せる（= preview を OFF）。
          disabled の間も <video> は同一要素のままなのでカメラ映像は貼り直されない。 */}
      <DraggablePanel
        id="preview"
        title="カメラ"
        disabled={!showPreview}
        onClose={() => setTweak('preview', false)}
        closeLabel="カメラ映像を隠す"
        // 演出ボタン列を左端へ移したので、PC ではカメラ枠を右側（上部リンク群の下）へ逃がして
        // 列と重ならないようにする。スマホは演出が画面下の横帯なので従来どおり左上で干渉しない。
        defaultStyle={isNarrow ? { top: 16, left: 16 } : { top: 160, right: 16 }}
        defaultWidth="min(160px, 34vw)"
        style={showPreview ? {
          zIndex: 5, borderRadius: 10, overflow: 'hidden', background: '#000', color: '#fff',
          padding: '4px 5px 5px', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        } : {
          position: 'absolute', width: 1, height: 1, opacity: 0,
          pointerEvents: 'none', overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={showPreview ? {
            display: 'block', width: '100%', height: 'auto', borderRadius: 6,
            transform: 'scaleX(-1)', // 鏡像（自撮り表示）
          } : {
            width: '100%', height: '100%',
          }}
        ></video>
      </DraggablePanel>

      {/* zoomRef: カメラ距離→ズーム(scale)を中央基準で当てる外側ラッパー。
          motionRef: 首かしげ(rotate)・左右上下スライド(translate)を当てる内側ラッパー。
          内側の charRef は既存の bob アニメ＋押下スケールを保持し、関心を分離する。
          かしげは「首元」を支点にする → 回転原点を下部中央(横50%・縦 tiltPivotY%)に置く。
          translate は transform-origin の影響を受けないのでスライドは不変。
          ズームは別ラッパー(原点=中央)に分けることで、かしげの支点と干渉させない。 */}
      {/* userRef: ドラッグ移動・ホイール/ピンチズーム（ユーザー操作）を当てる最外ラッパー。
          顔追従の zoomRef/motionRef より外側なので、画面座標での平行移動＋全体スケールになる。 */}
      <div
        ref={userRef}
        style={{ position: 'relative', zIndex: 1, willChange: 'transform', touchAction: 'none', cursor: isRx ? 'default' : 'grab' }}
      >
      <div ref={zoomRef} style={{ willChange: 'transform' }}>
       <div ref={motionRef} style={{ willChange: 'transform', transformOrigin: `50% ${view.tiltPivotY}%` }}>
        {/* ジェスチャー(回転/拡縮)用ラッパー。中心原点なので spin が中心で回る。顔追従(首元原点の tilt)とは別レイヤー。 */}
        <div ref={gestureFxRef} style={{ willChange: 'transform' }}>
        <div
          ref={charRef}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerLeave={() => setPressed(false)}
          className="bob"
          style={{
            position: 'relative',
            width: `${view.charSize * 4 / 3}vmin`, height: `${view.charSize * 4 / 3}vmin`,
            maxWidth: 1200, maxHeight: 1200,
            transform: pressed ? 'scale(0.94)' : 'scale(1)',
            transition: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
            // tweak `shadow` (0~6)。大きいほど濃い影で透過背景上の輪郭を立たせる（0 は無し）。
            // view = rx は同期値・それ以外はローカル値。範囲外/未設定は 0(なし) にクランプ。
            filter: SHADOW_FILTERS[clamp(Math.round(view.shadow ?? 0), 0, SHADOW_MAX)],
            userSelect: 'none', touchAction: 'none'
          }}
        >
          {/* PixiJS スプライト描画。150枚の img スタックを1枚の canvas に置き換える。
              顔推定が決めた sheet(0..5)/cell をそのまま渡し、コアが該当セルを描く。
              key にアバターIDを使い、切替時は Pixi を dispose→再生成する（sheets は初期化時固定）。 */}
          <SpriteAvatar
            key={avatarId}
            sheets={sheetUrls}
            rows={avatar.rows}
            cols={avatar.cols}
            sheetIndex={sheet}
            cell={cell}
            effects={effects}
          ></SpriteAvatar>
        </div>
        </div>
       </div>
      </div>
      </div>

      {/* ダブルクリック校正のフィードバック。正ボタン(校正パネル)が隠れていても効いたと分かるよう
          画面中央上に短く出す。配信(OBS)へは焼き込まないよう !obsMode のときだけ表示。 */}
      {centerCalibFlash && !obsMode ? (
        <div
          aria-live="polite"
          style={{
            position: 'absolute', top: '14%', left: '50%', transform: 'translateX(-50%)',
            zIndex: 6, pointerEvents: 'none',
            padding: '6px 14px', borderRadius: 999,
            background: 'rgba(35,46,38,0.86)', color: '#fff',
            fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}
        >✓ 正面を校正</div>
      ) : null}

      {/* リアクション・スタンプ。アバター本体(charRef)の実位置・サイズに毎フレーム追従
          （顔追従/ドラッグ/ズームに連動）。place で 頭の上/頭にオーバーレイ を切替。obs でも表示。 */}
      <CueStampLayer ref={cueStampRef} anchorRef={charRef}></CueStampLayer>

      {/* お絵かきオーバーレイ（fabric）。tx/local は ?draw で操作(edit)、rx(OBS)は受信表示(view)。
          透過のまま重なり、操作UIは edit かつ非配信(!obsMode)のときだけ出す。off ではマウントしない。 */}
      {drawMode !== 'off' ? (
        <DrawLayer
          ref={drawLayerRef}
          mode={drawMode}
          active={t.drawEnabled}
          showToolbar={drawMode === 'edit' && !obsMode && t.drawEnabled}
          onSceneChange={handleDrawSceneChange}
          onDrawLive={handleDrawLive}
          cursorOn={t.cursorEnabled}
          onCursorMove={handleCursorMove}
          // 既定位置は演出アイコン帯の上（narrow=下帯の上、wide=下部の操作群の上）。中央寄せ。
          toolbarDefaultStyle={{
            left: '50%', transform: 'translateX(-50%)',
            bottom: isNarrow ? 'calc(122px + var(--sab))' : 'calc(96px + var(--sab))',
          }}
        ></DrawLayer>
      ) : null}

      {/* CNN 風の下部テロップ（お絵かきとは独立）。tx/local は ?ticker で操作(edit)、rx(OBS)は受信表示(view)。
          バーは透過ルートに乗り、コントロールUIは edit かつ非配信(!obsMode)のときだけ出す。 */}
      {tickerMode !== 'off' ? (
        <TickerLayer
          ref={tickerLayerRef}
          mode={tickerMode}
          showControls={tickerMode === 'edit' && !obsMode}
          onConfigChange={handleTickerChange}
          // 既定位置はお絵かきツールバーの少し上（下部の操作群と重ならないように）。中央寄せ。
          controlsDefaultStyle={{
            left: '50%', transform: 'translateX(-50%)',
            bottom: isNarrow ? 'calc(164px + var(--sab))' : 'calc(138px + var(--sab))',
          }}
        ></TickerLayer>
      ) : null}

      {/* 日付時刻テロップ（右上の時計・お絵かき/テロップとは独立）。tx/local は操作(edit)、rx(OBS)は受信表示(view)。
          時刻は各端末がローカルで毎秒更新。コントロールUIは edit かつ非配信(!obsMode)のときだけ出す。 */}
      {clockMode !== 'off' ? (
        <ClockLayer
          ref={clockLayerRef}
          mode={clockMode}
          showControls={clockMode === 'edit' && !obsMode}
          onConfigChange={handleClockChange}
          // 既定位置は上部中央（右上の時計とは別の場所）。中央寄せ。
          controlsDefaultStyle={{
            left: '50%', transform: 'translateX(-50%)',
            top: 'calc(10px + var(--sat))',
          }}
        ></ClockLayer>
      ) : null}

      {/* 演出アイコン帯（cuebar）。お絵かきツールバーと同じ DraggablePanel でマウス移動でき、
          ⇄/⇅ で縦横を切り替えられる。配信(obsMode)/受信(rx)では非表示。設定詳細で表示トグル可。
          編集モード中はオーバーレイ(z30)より上へ出して対象を選べるよう z を上げる。 */}
      {!obsMode && !isRx && t.sbButtons ? (
        <CueBar
          dir={cueDir}
          onToggleDir={toggleCueDir}
          dark={dark}
          zIndex={editMode ? 40 : 6}
          cueScrollRef={cueScrollRef}
          toggleNode={cueToggleButton}
          buttons={cueButtonList}
        ></CueBar>
      ) : null}

      {/* 演出の位置調整エディタ（編集中の cue のみマウント）。配信/受信では出さない。 */}
      {!obsMode && !isRx && editingCue ? (
        <CueOffsetEditor
          cue={editingCue}
          anchorRef={charRef}
          initial={cueOffsets[editingCue.id]}
          initialText={cueTexts[editingCue.id] ?? editingCue.stamp}
          defaultText={editingCue.stamp}
          initialColor={cueColors[editingCue.id] ?? DEFAULT_CUE_COLOR}
          defaultColor={DEFAULT_CUE_COLOR}
          initialSize={cueSizes[editingCue.id] ?? DEFAULT_CUE_FONT_SCALE}
          defaultSize={DEFAULT_CUE_FONT_SCALE}
          initialShadow={cueShadows[editingCue.id] ?? DEFAULT_CUE_SHADOW_COLOR}
          defaultShadow={DEFAULT_CUE_SHADOW_COLOR}
          initialHold={cueHolds[editingCue.id] ?? editingCue.holdMs}
          defaultHold={editingCue.holdMs}
          initialAnim={cueAnims[editingCue.id] ?? editingCue.anim}
          defaultAnim={editingCue.anim}
          initialWeight={cueWeights[editingCue.id] ?? DEFAULT_CUE_FONT_WEIGHT}
          defaultWeight={DEFAULT_CUE_FONT_WEIGHT}
          initialStroke={cueStrokes[editingCue.id] ?? DEFAULT_CUE_STROKE_EM}
          defaultStroke={DEFAULT_CUE_STROKE_EM}
          initialRotation={cueRotations[editingCue.id] ?? DEFAULT_CUE_ROTATION}
          defaultRotation={DEFAULT_CUE_ROTATION}
          initialPlace={cuePlaces[editingCue.id] ?? editingCue.place}
          defaultPlace={editingCue.place}
          initialHalo={cueHalos[editingCue.id] ?? DEFAULT_CUE_HALO}
          defaultHalo={DEFAULT_CUE_HALO}
          initialGlow={cueGlows[editingCue.id] ?? ((editingCue.effect && Number.isFinite(editingCue.effect.glow)) ? editingCue.effect.glow : 0)}
          defaultGlow={(editingCue.effect && Number.isFinite(editingCue.effect.glow)) ? editingCue.effect.glow : 0}
          initialGlowColor={cueGlowColors[editingCue.id] ?? ((editingCue.effect && editingCue.effect.glowColor) || DEFAULT_CUE_GLOW_COLOR)}
          defaultGlowColor={(editingCue.effect && editingCue.effect.glowColor) || DEFAULT_CUE_GLOW_COLOR}
          initialGain={cueGains[editingCue.id] ?? DEFAULT_CUE_GAIN}
          defaultGain={DEFAULT_CUE_GAIN}
          initialSound={cueSounds[editingCue.id] ?? ''}
          maxSoundLen={MAX_CUE_SOUND_LEN}
          dark={dark}
          onCommit={commitCueEdit}
          onClose={() => setEditingCueId(null)}
          preview={previewCueStamp}
        ></CueOffsetEditor>
      ) : null}

      {!obsMode && (
      <div style={{
        position: 'absolute',
        top: 'calc(8px + var(--sat))',
        // PC の既定では演出アイコン帯(縦帯)が左端に出るので、その分だけ右へ寄せて重ねない。
        // 帯は今や可動なので、これは「既定レイアウトのヒント」であり保証ではない（帯を動かすと
        // 多少重なりうるが、このリンク帯は pointerEvents:none のテキストなので実害は無い）。
        // スマホ(帯は既定で画面下)や rx/帯非表示のときは従来どおり左端に置く。
        left: (!isNarrow && !isRx && t.sbButtons) ? 'calc(76px + var(--sal))' : 'calc(12px + var(--sal))',
        right: 'auto',
        textAlign: 'left', pointerEvents: 'none', whiteSpace: 'nowrap'
      }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 28px)', fontWeight: 700, color: inkColor, letterSpacing: '0.06em' }}>ぐるぐるアバター カメラ版</div>
        <div style={{ fontSize: 'clamp(13px, 1.7vmin, 16px)', color: subColor, marginTop: 6, letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
          {statusText}
        </div>
        {/* 実際にどのエンジンで推論しているか（Worker / メインスレッド）を常時表示。rx は推論なし。 */}
        {!isRx && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(12px, 1.5vmin, 14px)', color: subColor, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: onWorker ? '#46C26A' : 'rgba(120,120,120,0.55)', display: 'inline-block' }}></span>
            推論: {engineLabel}{engineNote}
          </span>
        </div>
        )}
        {/* tx（iPhone）: 中継リンクと CEF（受信側）の接続状況を表示する。 */}
        {mode === 'tx' && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(12px, 1.5vmin, 14px)', color: subColor, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: relayApi.peer.connected ? '#46C26A' : 'rgba(120,120,120,0.55)', display: 'inline-block' }}></span>
            {relayApi.linkUp
              ? (relayApi.peer.connected ? `OBS接続中（${relayApi.peer.count}）` : 'OBS未接続')
              : '中継に未接続'}
          </span>
        </div>
        )}
      </div>
      )}

      {!obsMode && (
      <a href="talk.html" style={{
        position: 'absolute', top: 'calc(18px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>口パク版 →</a>
      )}

      {!obsMode && (
      <a href="tracking.html" style={{
        position: 'absolute', top: 'calc(40px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>手・ポーズ →</a>
      )}

      {/* iPhone(tx) を開くための QR。tailscale の長い URL を手入力せず読み取れる。
          公開オリジンは vite.fork.js が __TX_PUBLIC_ORIGIN__ に注入（無ければ現在のオリジン）。
          配信(obsMode)には出さない。 */}
      {!obsMode && (
        <TxQrButton url={TX_URL} subColor={subColor} inkColor={inkColor}
          style={{ top: 'calc(62px + var(--sat))', right: 'calc(18px + var(--sar))' }} />
      )}

      {/* GitHub リポジトリへのリンク（外部・別タブ）。配信には映さない。 */}
      {!obsMode && (
      <a href="https://github.com/tommie-jp/guruguru-avatar" target="_blank" rel="noopener noreferrer" style={{
        position: 'absolute', top: 'calc(84px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>GitHub ↗</a>
      )}

      {/* WS 中継の役割切替リンク。相対パスなので開いているホスト（localhost / Tailscale 等）を
          そのまま引き継ぐ。現在のモードを太字＋色で強調する。配信には映さない。 */}
      {!obsMode && (
      <a href="index.html?tx" style={{
        position: 'absolute', top: 'calc(106px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14,
        fontWeight: mode === 'tx' ? 900 : 700,
        color: mode === 'tx' ? inkColor : subColor,
        textDecoration: 'none', letterSpacing: '0.06em'
      }}>OBS送信側tx →</a>
      )}

      {!obsMode && (
      // rx は既定で透過＋UI 非表示なので、ブラウザのタブで確認できるよう ?obs=0 を付ける。
      <a href="index.html?rx&obs=0" style={{
        position: 'absolute', top: 'calc(128px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14,
        fontWeight: mode === 'rx' ? 900 : 700,
        color: mode === 'rx' ? inkColor : subColor,
        textDecoration: 'none', letterSpacing: '0.06em'
      }}>OBS受信側rx →</a>
      )}

      {/* 下部コントロール（左下）: 各 HUD のワンタップ表示トグル＋「反映先(OBS/ローカル)」を
          cuebar と同じ SlideBar に載せ、⠿ で掴んで移動でき ↕/↔ で縦横切替。既定は横帯で
          左下のハンバーガー(twk-fab・固定位置)の右に置く。配信(obs)・rx では非表示。 */}
      {!obsMode && !isRx && (
      <PanelToggles
        inkColor={inkColor}
        subColor={subColor}
        dark={dark}
        dir={togglesDir}
        onToggleDir={toggleTogglesDir}
        scrollRef={togglesScrollRef}
        zIndex={6}
        defaultStyle={TOGGLES_DEFAULT_STYLE}
        items={[
          { key: 'preview', label: 'カメラ', on: t.preview, toggle: () => setTweak('preview', !t.preview) },
          { key: 'debug', label: 'デバッグ', on: t.showDebug, toggle: () => setTweak('showDebug', !t.showDebug) },
          { key: 'expr', label: '表情', on: t.showExpr, toggle: () => setTweak('showExpr', !t.showExpr) },
          // お絵かきツール（ツールバー表示＋描画入力）の ON/OFF。描いた線は OFF にしても配信に残る。
          { key: 'draw', label: 'お絵かき', on: t.drawEnabled, toggle: () => setTweak('drawEnabled', !t.drawEnabled),
            title: 'お絵かきツールバーの表示と描画入力の ON/OFF（描いた線は OFF にしても残る）' },
          // OBS(配信)にマウスカーソルを表示する ON/OFF。操作側の手元カーソルを rx へ送る。
          { key: 'cursor', label: 'カーソル', on: t.cursorEnabled, toggle: () => setTweak('cursorEnabled', !t.cursorEnabled),
            title: 'OBS(配信)に操作側のマウスカーソルを表示する ON/OFF' },
          // 向き校正は顔追従(カメラ)専用。マウス追従では pose が無いので出さない。
          ...(effDirection === 'face' ? [{ key: 'calib', label: '向き校正', on: t.showCalib, toggle: () => setTweak('showCalib', !t.showCalib) }] : []),
          // 手元(tx/local)の演出音。ローカルなので rx には影響しない。
          { key: 'soundTx', label: (t.sbMutedTx ? '🔇 ' : '🔊 ') + (mode === 'tx' ? '手元' : '音'),
            on: !t.sbMutedTx, toggle: () => setTweak('sbMutedTx', !t.sbMutedTx),
            title: 'この端末で鳴らす演出音（tx=手元モニタ）の ON/OFF。rx(配信)には影響しない' },
          // 配信(rx/OBS)の演出音。rx は UI が無いので tx から同期して遠隔ミュート。relay(tx) のときだけ表示。
          ...(mode === 'tx' ? [{ key: 'soundRx', label: (t.sbMutedRx ? '🔇 ' : '🔊 ') + '配信',
            on: !t.sbMutedRx, toggle: () => setTweak('sbMutedRx', !t.sbMutedRx),
            title: '配信(rx=OBS)で鳴らす演出音の ON/OFF（tx から遠隔操作）' }] : []),
        ]}
      >
        <button
          type="button"
          onClick={() => setLocalMode((v) => !v)}
          title="ドラッグ移動・ズームの反映先（OBS=rxへ送る / ローカル=この端末だけ。PC は Shift 併用でも『ローカル』）"
          style={{
            flex: '0 0 auto', // 帯では縮ませず一定サイズを保つ（はみ出しは帯スクロールへ）
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, lineHeight: 1,
            padding: '4px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${localMode ? '#E8923C' : '#46C26A'}`,
            background: localMode ? 'rgba(232,146,60,0.14)' : 'rgba(70,194,106,0.12)',
            color: inkColor, fontSize: 13, fontWeight: 700, letterSpacing: '0.03em',
          }}
        >
          <span style={{
            width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
            background: localMode ? '#E8923C' : '#46C26A',
          }}></span>
          {localMode ? 'ローカル' : 'OBS'}
        </button>
      </PanelToggles>
      )}

      {/* 著作権＋バージョン表記（右下隅に控えめに）。配信に映らないよう obsMode では非表示。
          下部のチップ列＋ハンバーガーは 1 段上げてあるので、その下（最下段）に置いて重ねない。
          tommie.jp は GitHub プロフィールへの外部リンク（リンクだけクリック可）。
          ビルド識別（sha/日付）はホバーの title に逃がす。 */}
      {!obsMode && (
      <div
        title={isNarrow ? VERSION_LABEL_SHORT : VERSION_LABEL}
        style={{
          position: 'absolute', bottom: 'calc(8px + var(--sab))',
          right: isNarrow ? 'calc(12px + var(--sar))' : 'calc(16px + var(--sar))', fontSize: 12,
          color: inkColor, letterSpacing: '0.04em', whiteSpace: 'nowrap',
          textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none', userSelect: 'none'
        }}
      >
        {BUILD_YEAR}(C) <a
          href="https://github.com/tommie-jp"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline', pointerEvents: 'auto' }}
        >tommie.jp</a> ver{APP_VERSION}
      </div>
      )}

      {/* （旧「校正」ボタンは廃止。同機能は向き校正パネルの十字「正」ボタンに統合した。） */}

      {/* カメラ起動エラーの詳細。原因切り分け用に obsMode でも常に表示する
          （OBS ブラウザソース内で ?obs=1 のまま読めるように）。ただしマウス追従へ
          自動フォールバック済み（effDirection==='mouse'）なら、動いているアバターを
          塞がない＝大きな詳細は出さず、状態バッジの「カメラ不可→マウス追従」に委ねる。 */}
      {status.phase === 'error' && effDirection === 'face' ? (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          maxWidth: 'min(92vw, 560px)', maxHeight: '80vh', overflow: 'auto',
          background: 'rgba(20,16,14,0.92)', color: '#fff', borderRadius: 12,
          padding: '14px 16px', fontFamily: 'ui-monospace, monospace', fontSize: 13,
          lineHeight: 1.65, zIndex: 20, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          border: '1px solid rgba(229,72,77,0.6)', boxShadow: '0 8px 28px rgba(0,0,0,0.4)'
        }}>
          <div style={{ fontWeight: 700, color: '#E5484D', marginBottom: 8, letterSpacing: '0.04em' }}>カメラエラー詳細</div>
          {/* 原因切り分け用の診断詳細を表示する。 */}
          <div style={{ marginTop: 4 }}>
            {(status.errorDetail && status.errorDetail.length ? status.errorDetail : [status.error || 'unknown']).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 主な表情係数（MediaPipe blendshapes）パネル。Tweaks のトグルで表示切替。
          DraggablePanel で掴んで移動でき、✕で隠せる（= showExpr を OFF）。 */}
      {!obsMode && t.showExpr ? (
        <DraggablePanel
          id="expr"
          title="表情係数"
          onClose={() => setTweak('showExpr', false)}
          closeLabel="表情係数パネルを隠す"
          defaultStyle={{ top: 68, right: 12 }}
          defaultWidth="min(200px, 50vw)"
          style={{
            background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 10,
            padding: '7px 9px', fontSize: 11, fontFamily: 'ui-monospace, monospace',
            zIndex: 6, lineHeight: 1.35,
            maxHeight: 'calc(100vh - 84px)', overflow: 'auto',
          }}
        >
          {exprValues.length === 0 ? (
            <div style={{ opacity: 0.6 }}>顔を検出すると表示</div>
          ) : exprValues.map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ width: '5.5em', flexShrink: 0, opacity: 0.85, whiteSpace: 'nowrap' }}>{label}</span>
              <span style={{ position: 'relative', flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.18)' }}>
                <span style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${Math.round(clamp(value, 0, 1) * 100)}%`, borderRadius: 3,
                  background: value >= 0.5 ? '#E5A23D' : '#46C26A'
                }}></span>
              </span>
              <span style={{ width: '2.4em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</span>
            </div>
          ))}
        </DraggablePanel>
      ) : null}

      {/* デバッグHUD（向き/口/まばたき/姿勢などの生値とグリッド）。Tweaks で表示切替。
          DraggablePanel で掴んで移動でき、✕で隠せる（= showDebug を OFF）。 */}
      {!obsMode && t.showDebug ? (
        <DraggablePanel
          id="debug"
          title="デバッグ"
          onClose={() => setTweak('showDebug', false)}
          closeLabel="デバッグ表示を隠す"
          resizable={false}
          defaultStyle={{ top: 16, left: showPreview ? 'calc(min(160px, 34vw) + 30px)' : 16 }}
          style={{
            background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 10,
            padding: '7px 9px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
            lineHeight: 1.45, whiteSpace: 'nowrap', width: 'max-content',
            fontVariantNumeric: 'tabular-nums', // 桁が変わっても幅が動かないよう等幅数字
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 14px)', gap: 3, marginBottom: 6 }}>
            {frames.map(({ r, c }) => (
              <div key={`d${r}-${c}`} style={{
                width: 14, height: 14, borderRadius: 3,
                background: r === cell.r && c === cell.c ? '#FFB13D' : 'rgba(255,255,255,0.22)'
              }}></div>
            ))}
          </div>
          {/* 既定はグリッドのみ。＋で row などの数値を展開（向き校正パネルと同様）。
              data-no-drag を付けないと DraggablePanel が pointer をキャプチャして click が消える。 */}
          <button type="button" data-no-drag onClick={() => setShowDebugDetail((v) => !v)} title={showDebugDetail ? '値を隠す' : '値を表示'}
            style={{
              minWidth: 28, height: 20, padding: '0 8px', border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 4, background: 'rgba(255,255,255,0.10)', color: '#fff',
              fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', lineHeight: 1,
            }}>{showDebugDetail ? '－' : '＋'}</button>
          {showDebugDetail ? (
            <div style={{ marginTop: 4 }}>
              <div>row {cell.r} / col {cell.c}</div>
              <div>x {fixDot(target.current.x, 2, 2)} / y {fixDot(target.current.y, 2, 2)}</div>
              <div>mouth {['とじ', 'はんびらき', 'ぜんかい'][sheet % 3]}</div>
              <div>blink {sheet >= 3 ? '閉' : '開'} {effBlinkSync ? '(同調)' : '(自動)'}</div>
              <div>roll {fixDot(rollRef.current / DEG, 1, 3)}°</div>
              <div>slide {fixDot(posRef.current.x, 2, 2)},{fixDot(posRef.current.y, 2, 2)}</div>
              <div>size {fixDot(faceScaleRef.current, 3, 1)} / zoom {fixDot(smoothStateRef.current.zoom, 2, 1)}x</div>
            </div>
          ) : null}
        </DraggablePanel>
      ) : null}

      {/* 向き校正パネル（顔追従専用。マウス追従では pose が無いので出さない）。
          独立した浮動パネル。デバッグHUDと同じく Tweaks のトグルで表示切替）。
          掴んで移動でき、✕で隠せる（= showCalib を OFF）。カメラ前提なので rx/obs では出さない。
          コントロールは [data-no-drag] でドラッグ開始を抑止し、タイトル帯だけで掴む。 */}
      {!obsMode && !isRx && t.showCalib && effDirection === 'face' ? (
        <DraggablePanel
          id="calib"
          title="向き校正"
          onClose={() => setTweak('showCalib', false)}
          closeLabel="向き校正パネルを隠す"
          resizable={false}
          defaultStyle={{ top: 68, left: showPreview ? 'calc(min(160px, 34vw) + 30px)' : 16 }}
          style={{
            zIndex: 6,
            background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 10,
            padding: '7px 9px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
            lineHeight: 1.45, maxWidth: 'min(220px, 82vw)',
          }}
        >
          {/* 内側コンテナを十字と同じ幅に固定し、＋で説明を開閉してもパネル幅が変わらない
              ようにする（パネル左端は固定なので、幅が変わると中央寄せの十字が横にずれる）。
              説明文はこの幅の中で折り返す。 */}
          <div data-no-drag style={{ display: 'flex', flexDirection: 'column', gap: 6, width: CALIB_CROSS_WIDTH }}>
            {/* ＋は十字グリッドの左下セルに統合（押すと説明を展開／－で隠す）。 */}
            <DirectionCross flash={dirFlash} onDir={calibrateDirection} onCenter={calibrateCenterCross}
              onToggleDetail={() => setShowCalibDetail((v) => !v)} detailOpen={showCalibDetail} />
            {showCalibDetail ? (
              <div style={{ fontSize: 11, lineHeight: 1.55, color: 'rgba(255,255,255,0.82)' }}>
                「正」でまとめて校正（向き・距離・目・かしげ）→ 各方向へ顔を振り切って 上/左/右/下 を押す。
                体は動かさず顔の向きだけ変えて押すと、その向きでの 位置ズレ・かしげ・ズーム・目 も
                同時に補正します。デバッグの「グリッド表示」で到達点を見ながら調整できます。
                細かな数値調整は Tweaks「向き校正」から。
              </div>
            ) : null}
          </div>
        </DraggablePanel>
      ) : null}

      {!isRx && (!obsMode || panelOpen) && (
      <TweaksPanel title="設定詳細" closeOnOutsideClick={false}>
        {/* fork:sections — よく触る3つを上に集約し初期展開。残りは折りたたみ
            （開閉は localStorage に永続化）。各セクションはコントロールを内側に
            入れ子にする（兄弟並びは折りたたみ対象にならない）。 */}
        <TweakSection label="入力ソース" collapsible defaultOpen>
          {/* カメラ源: PC の Web カメラ / スマホ(QR で ?tx を渡す)。tx のときだけ意味を持つ。
              スマホを選ぶと PC カメラと送信を止め、右上の QR からスマホが tx を引き継ぐ。
              （スマホ実機が中継へ届くのは wss フェーズ。同一機なら別タブ ?tx で擬似確認可） */}
          {mode === 'tx' && (
            <TweakRadio label="カメラ入力源" value={t.cameraSourceMode}
              options={[{ value: 'pc', label: 'PCカメラ' }, { value: 'phone', label: 'スマホ(QR)' }]}
              onChange={(v) => setTweak('cameraSourceMode', v)}></TweakRadio>
          )}
          <TweakRadio label="向きの入力" value={t.inputDirection}
            options={[{ value: 'face', label: 'カメラ' }, { value: 'mouse', label: 'マウス' }]}
            onChange={(v) => {
              // 向きを変えたら口も既定へ寄せる（マウス→マイク / カメラ→カメラ）。
              // 以後はユーザーが口を上書き選択でき、ハイブリッド（マウス＋カメラ口）も可。
              setTweak('inputDirection', v);
              setTweak('mouthSource', v === 'mouse' ? 'mic' : 'camera');
            }}></TweakRadio>
          <TweakRadio label="口の入力" value={t.mouthSource}
            options={[{ value: 'camera', label: 'カメラ' }, { value: 'mic', label: 'マイク' }, { value: 'none', label: 'なし' }]}
            onChange={(v) => setTweak('mouthSource', v)}></TweakRadio>
          {effDirection === 'mouse' ? (
            <TweakSlider label="追従範囲" value={t.followRange} min={120} max={1200} step={10} unit="px"
              onChange={(v) => setTweak('followRange', v)}></TweakSlider>
          ) : null}
          {effMouthSrc === 'mic' ? (
            <TweakSlider label="マイク感度" value={t.micGain} min={0.3} max={6} step={0.1}
              onChange={(v) => setTweak('micGain', v)}></TweakSlider>
          ) : null}
          {effMouthSrc === 'mic' && micStatus.phase === 'error' ? (
            <TweakRow label="マイク">
              <span style={{ fontSize: 12, color: '#E5484D' }}>使用不可（権限を確認）</span>
            </TweakRow>
          ) : null}
        </TweakSection>
        <TweakSection label="顔追従" collapsible defaultOpen>
          <TweakSlider label="感度" value={t.sensitivity} min={0.4} max={2.5} step={0.1}
            onChange={(v) => setTweak('sensitivity', v)}></TweakSlider>
          <TweakSlider label="追従速度" value={t.smoothing} min={0.04} max={0.5} step={0.01}
            onChange={(v) => setTweak('smoothing', v)}></TweakSlider>
          <TweakToggle label="まばたき同調" value={t.blinkSync}
            onChange={(v) => setTweak('blinkSync', v)}></TweakToggle>
          <TweakSlider label="まばたき感度" value={t.blinkSensitivity} min={0.5} max={2.5} step={0.1}
            onChange={(v) => setTweak('blinkSensitivity', v)}></TweakSlider>
          <TweakButton label="今の目の大きさを まばたきなし にする" onClick={calibrateEyesOpen}></TweakButton>
          <TweakButton label="まばたき基準をリセット" secondary onClick={resetEyesOpen}></TweakButton>
        </TweakSection>
        <TweakSection label="口パク" collapsible defaultOpen>
          <TweakSlider label="口の感度" value={t.mouthGain} min={0.3} max={4} step={0.1}
            onChange={(v) => setTweak('mouthGain', v)}></TweakSlider>
          <TweakSlider label="しきい値（はんびらき）" value={t.thHalf} min={0.02} max={0.5} step={0.01}
            onChange={(v) => setTweak('thHalf', v)}></TweakSlider>
          <TweakSlider label="しきい値（ぜんかい）" value={t.thFull} min={0.05} max={0.8} step={0.01}
            onChange={(v) => setTweak('thFull', v)}></TweakSlider>
          <TweakSlider label="口を閉じる速さ" value={t.release} min={0.05} max={0.5} step={0.01}
            onChange={(v) => setTweak('release', v)}></TweakSlider>
        </TweakSection>
        <TweakSection label="見た目" collapsible defaultOpen>
          <TweakSlider label="キャラサイズ" value={t.charSize} min={30} max={92} unit="vmin"
            onChange={(v) => setTweak('charSize', v)}></TweakSlider>
          <TweakColor label="背景色" value={t.bgColor} options={BG_OPTIONS}
            onChange={(v) => setTweak('bgColor', v)}></TweakColor>
          <TweakSlider label="影の濃さ" value={t.shadow} min={0} max={SHADOW_MAX} step={1}
            onChange={(v) => setTweak('shadow', v)}></TweakSlider>
        </TweakSection>
        <TweakSection label="エフェクト" collapsible>
          <TweakToggle label="発光（グロー）" value={t.effGlow}
            onChange={(v) => setTweak('effGlow', v)}></TweakToggle>
          <TweakSlider label="発光の強さ" value={t.effGlowStrength} min={0} max={8} step={0.1}
            onChange={(v) => setTweak('effGlowStrength', v)}></TweakSlider>
          <TweakColor label="発光色" value={t.effGlowColor} options={GLOW_COLORS}
            onChange={(v) => setTweak('effGlowColor', v)}></TweakColor>
          <TweakToggle label="ディゾルブ" value={t.effDissolve}
            onChange={(v) => setTweak('effDissolve', v)}></TweakToggle>
          <TweakSlider label="ディゾルブ量" value={t.effDissolveAmount} min={0} max={1} step={0.01}
            onChange={(v) => setTweak('effDissolveAmount', v)}></TweakSlider>
          <TweakColor label="ディゾルブ縁色" value={t.effDissolveColor} options={DISSOLVE_COLORS}
            onChange={(v) => setTweak('effDissolveColor', v)}></TweakColor>
        </TweakSection>
        <TweakSection label="演出（サウンドボード）" collapsible>
          <TweakToggle label="手元(tx)の音を出す" value={!t.sbMutedTx}
            onChange={(v) => setTweak('sbMutedTx', !v)}></TweakToggle>
          <TweakToggle label="配信(rx/OBS)の音を出す" value={!t.sbMutedRx}
            onChange={(v) => setTweak('sbMutedRx', !v)}></TweakToggle>
          <TweakSlider label="演出の音量" value={t.sbGain} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('sbGain', v)}></TweakSlider>
          <TweakToggle label="ボタンを表示" value={t.sbButtons}
            onChange={(v) => setTweak('sbButtons', v)}></TweakToggle>
          {cueController.cues.map((c) => (
            <label key={c.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, fontSize: 12, padding: '4px 0', cursor: 'pointer'
            }}>
              <span>{c.icon || c.stamp} {c.label} {c.key ? `(${c.key})` : ''} {cueAssigned.has(c.id) ? '🔊' : ''}</span>
              <span style={{ opacity: 0.55 }}>音を割当…</span>
              <input type="file" accept="audio/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) assignCueFile(c.id, f); }} />
            </label>
          ))}
        </TweakSection>
        <TweakSection label="アバター" collapsible>
          {avatarParam ? (
            <TweakRow label="キャラ" value="URL固定">
              <span style={{ fontSize: 14, opacity: 0.8 }}>{avatar.displayName}</span>
            </TweakRow>
          ) : (
            <TweakSelect label="キャラ" value={avatar.id}
              options={avatars.map((a) => ({ value: a.id, label: a.displayName }))}
              onChange={(v) => setTweak('avatarId', v)}></TweakSelect>
          )}
          <TweakRow label="クレジット">
            <span style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.4 }}>{avatar.credit}</span>
          </TweakRow>
        </TweakSection>
        <TweakSection label="カメラ" collapsible>
          {cameraParam ? (
            <TweakRow label="カメラ" value="URL固定">
              <span style={{ fontSize: 14, opacity: 0.8 }}>{cameraLabelEff}</span>
            </TweakRow>
          ) : (
            <TweakSelect label="カメラ" value={cameraSelectValue}
              options={cameraOptions}
              onChange={(v) => setTweak('cameraLabel', v)}></TweakSelect>
          )}
          {!cameraParam && t.cameraLabel === '' && isMobile ? (
            <TweakToggle label="背面カメラ" value={t.facingMode === 'environment'}
              onChange={(v) => setTweak('facingMode', v ? 'environment' : 'user')}></TweakToggle>
          ) : null}
        </TweakSection>
        <TweakSection label="向き校正" collapsible>
          <TweakToggle label="向き校正パネルを表示" value={t.showCalib}
            onChange={(v) => setTweak('showCalib', v)}></TweakToggle>
          <TweakSlider label="左右バイアス" value={t.biasYawDeg} min={-45} max={45} step={1} unit="°"
            onChange={(v) => setTweak('biasYawDeg', v)}></TweakSlider>
          <TweakSlider label="上下バイアス" value={t.biasPitchDeg} min={-45} max={45} step={1} unit="°"
            onChange={(v) => setTweak('biasPitchDeg', v)}></TweakSlider>
          <TweakButton label="上下左右の範囲をリセット" secondary onClick={resetRanges}></TweakButton>
          <TweakButton label="正面をリセット" secondary onClick={resetCenter}></TweakButton>
        </TweakSection>
        <TweakSection label="反転" collapsible>
          <TweakToggle label="左右反転" value={t.invertX}
            onChange={(v) => setTweak('invertX', v)}></TweakToggle>
          <TweakToggle label="上下反転" value={t.invertY}
            onChange={(v) => setTweak('invertY', v)}></TweakToggle>
          <TweakToggle label="カメラ映像を表示" value={t.preview}
            onChange={(v) => setTweak('preview', v)}></TweakToggle>
        </TweakSection>
        <TweakSection label="首かしげ" collapsible>
          <TweakToggle label="首かしげ" value={t.tiltEnabled}
            onChange={(v) => setTweak('tiltEnabled', v)}></TweakToggle>
          <TweakSlider label="かしげ量" value={t.tiltGain} min={0} max={2.5} step={0.1}
            onChange={(v) => setTweak('tiltGain', v)}></TweakSlider>
          <TweakSlider label="かしげ上限" value={t.tiltMax} min={0} max={45} step={1} unit="°"
            onChange={(v) => setTweak('tiltMax', v)}></TweakSlider>
          <TweakSlider label="かしげ支点（高さ）" value={t.tiltPivotY} min={40} max={100} step={1} unit="%"
            onChange={(v) => setTweak('tiltPivotY', v)}></TweakSlider>
          <TweakToggle label="かしげ反転" value={t.invertTilt}
            onChange={(v) => setTweak('invertTilt', v)}></TweakToggle>
          {/* 左右のかしげ差(b): 右を向いたとき roll-a-b、左で roll-a+b になる単一係数。
              向き校正の右/左ボタンが押した姿勢から自動記録する（手動微調整も可）。 */}
          <TweakSlider label="左右のかしげ差(b)" value={t.rollYawTiltB} min={-30} max={30} step={0.1} unit="°"
            onChange={(v) => setTweak('rollYawTiltB', v)}></TweakSlider>
          {/* 左右向き補正(tiltYawComp): yaw×pitch 幾何モデルの手動スライダー（既定 0 で素通し）。
              「正」ボタンでは変更しない。上下も向いて振る人向けの上級者向け微調整。 */}
          <TweakSlider label="左右向き補正" value={t.tiltYawComp} min={-4} max={4} step={0.05}
            onChange={(v) => setTweak('tiltYawComp', v)}></TweakSlider>
          <TweakSlider label="かしげバイアス(a)" value={t.biasRollDeg} min={-30} max={30} step={1} unit="°"
            onChange={(v) => setTweak('biasRollDeg', v)}></TweakSlider>
          <TweakButton label="今のかしげを正面(a)にする" onClick={calibrateTilt}></TweakButton>
          <TweakButton label="かしげをリセット" secondary onClick={resetTilt}></TweakButton>
        </TweakSection>
        <TweakSection label="スライド" collapsible>
          <TweakToggle label="スライド追従（左右・上下）" value={t.slideEnabled}
            onChange={(v) => setTweak('slideEnabled', v)}></TweakToggle>
          <TweakSlider label="左右の量" value={t.slideGain} min={0} max={40} step={1} unit="vw"
            onChange={(v) => setTweak('slideGain', v)}></TweakSlider>
          <TweakSlider label="左右の上限" value={t.slideMax} min={0} max={50} step={1} unit="vw"
            onChange={(v) => setTweak('slideMax', v)}></TweakSlider>
          <TweakToggle label="左右反転" value={t.invertSlide}
            onChange={(v) => setTweak('invertSlide', v)}></TweakToggle>
          <TweakSlider label="左右向き補正" value={t.slidePoseCompX} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('slidePoseCompX', v)}></TweakSlider>
          <TweakSlider label="上下の量" value={t.slideGainY} min={0} max={40} step={1} unit="vh"
            onChange={(v) => setTweak('slideGainY', v)}></TweakSlider>
          <TweakSlider label="上下の上限" value={t.slideMaxY} min={0} max={50} step={1} unit="vh"
            onChange={(v) => setTweak('slideMaxY', v)}></TweakSlider>
          <TweakToggle label="上下反転" value={t.invertSlideY}
            onChange={(v) => setTweak('invertSlideY', v)}></TweakToggle>
          <TweakSlider label="上下向き補正" value={t.slidePoseCompY} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('slidePoseCompY', v)}></TweakSlider>
          <TweakSlider label="動きの滑らかさ" value={t.motionSmoothing} min={0.04} max={0.5} step={0.01}
            onChange={(v) => setTweak('motionSmoothing', v)}></TweakSlider>
        </TweakSection>
        <TweakSection label="ズーム（カメラ距離）" collapsible>
          <TweakToggle label="距離でズーム" value={t.zoomEnabled}
            onChange={(v) => setTweak('zoomEnabled', v)}></TweakToggle>
          <TweakSlider label="ズーム量" value={t.zoomGain} min={0} max={3} step={0.1}
            onChange={(v) => setTweak('zoomGain', v)}></TweakSlider>
          <TweakSlider label="ズーム下限" value={t.zoomMin} min={0.3} max={1} step={0.05}
            onChange={(v) => setTweak('zoomMin', v)}></TweakSlider>
          <TweakSlider label="ズーム上限" value={t.zoomMax} min={1} max={3} step={0.1}
            onChange={(v) => setTweak('zoomMax', v)}></TweakSlider>
          <TweakSlider label="下向き補正" value={t.zoomPitchComp} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('zoomPitchComp', v)}></TweakSlider>
          <TweakSlider label="口開き補正" value={t.zoomMouthComp} min={0} max={1} step={0.05}
            onChange={(v) => setTweak('zoomMouthComp', v)}></TweakSlider>
          <TweakButton label="今の距離を基準にする" onClick={calibrateZoom}></TweakButton>
          <TweakButton label="距離基準をリセット" secondary onClick={resetZoom}></TweakButton>
        </TweakSection>
        <TweakSection label="ズーム（ホイール/ピンチ）" collapsible>
          <TweakSlider label="最小（縮小の下限）" value={t.userZoomMin} min={0.05} max={1} step={0.05}
            onChange={(v) => setTweak('userZoomMin', v)}></TweakSlider>
          <TweakSlider label="最大（拡大の上限）" value={t.userZoomMax} min={1} max={8} step={0.5}
            onChange={(v) => setTweak('userZoomMax', v)}></TweakSlider>
          <TweakSlider label="ホイール感度" value={t.wheelZoomDial} min={0} max={100} step={1}
            onChange={(v) => setTweak('wheelZoomDial', v)}></TweakSlider>
          <TweakSlider label="移動比率（tx→rx）" value={t.moveRatio ?? 1} min={MOVE_RATIO_MIN} max={MOVE_RATIO_MAX} step={0.1} unit="×"
            onChange={(v) => setTweak('moveRatio', v)}></TweakSlider>
          <TweakButton label="表示（移動・ズーム）をリセット" secondary onClick={resetUserTransform}></TweakButton>
        </TweakSection>
        <TweakSection label="推論エンジン" collapsible>
          <TweakToggle label="Web Worker を使う" value={t.useWorker}
            onChange={(v) => setTweak('useWorker', v)}></TweakToggle>
          <TweakRow label="実行先" value={`${engineLabel}${engineNote}`}></TweakRow>
        </TweakSection>
        <TweakSection label="デバッグ" collapsible>
          <TweakToggle label="グリッド表示" value={t.showDebug}
            onChange={(v) => setTweak('showDebug', v)}></TweakToggle>
          <TweakToggle label="表情係数を表示" value={t.showExpr}
            onChange={(v) => setTweak('showExpr', v)}></TweakToggle>
        </TweakSection>
        <TweakSection label="テーマ" collapsible>
          <TweakPresets themes={themes}></TweakPresets>
        </TweakSection>
        {/* リセットはアコーディオン外。常時フッターとして見せる。 */}
        <TweakSection label="リセット"></TweakSection>
        <TweakButton label="設定をデフォルトに戻す" secondary onClick={resetTweaks}></TweakButton>
      </TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App></App>);
