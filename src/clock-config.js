// 日付時刻テロップ（画面隅に出す時計）の設定を正規化・検証する純関数群と URL パラメータ解析。
//
// 設定は tx→rx へ専用 `clock` メッセージ（{visible,textColor,bgColor,fontSize}）で流れる。
// 時刻そのものは同期しない＝各端末が自分のローカル時刻を毎秒描く（毎フレームは流れない）。
// WS は無認証なので、rx が受信した値はここで必ず検証してから表示に使う。
// obs-mode.js / draw-mode.js / ticker-config.js と同じ「起動時に一度だけ解析する純関数」の流儀。

// 文字サイズ(px)の許容範囲。
export const FONT_MIN = 12;
export const FONT_MAX = 80;

// 既定値。visible=false なので、操作側が表示を ON にするまで何も出ない。
export const CLOCK_DEFAULTS = Object.freeze({
  visible: false,
  textColor: '#ffffff',
  bgColor: '#000000',
  fontSize: 28,
});

// #rgb / #rrggbb のみ許容（style 注入を防ぐ）。前後空白は許容。
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export function normalizeHexColor(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return HEX_RE.test(s) ? s : fallback;
}

// 文字サイズを FONT_MIN..FONT_MAX に収める。非数値は既定へ。
export function clampFontSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return CLOCK_DEFAULTS.fontSize;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));
}

// 受信/保存した設定を各フィールド検証つきで完全な設定へ正規化する（常に新オブジェクト）。
export function normalizeClockConfig(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    visible: d.visible === true, // 厳密 true のみ
    textColor: normalizeHexColor(d.textColor, CLOCK_DEFAULTS.textColor),
    bgColor: normalizeHexColor(d.bgColor, CLOCK_DEFAULTS.bgColor),
    fontSize: clampFontSize(d.fontSize),
  };
}

// Date を "YYYY/MM/DD HH:mm"（24時間・ゼロ埋め）へ。ローカル時刻。不正な入力は空文字。
export function formatClockTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${p(date.getMonth() + 1)}/${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// 真偽フラグの許容表記。?clock（値なし）も有効にしたいので空文字を含める。
const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);
function triState(params, name) {
  if (!params.has(name)) return undefined;
  return TRUTHY.has((params.get(name) || '').toLowerCase());
}

/**
 * URL の search 文字列から時計モードを解析する純関数。
 * ?clock[=1] で有効、?clock=0 で無効、無しは undefined（呼び出し側で既定を決める）。
 * @param {string} [search]
 * @returns {{ clock: (boolean|undefined) }}
 */
export function parseClockParams(search = '') {
  const params = new URLSearchParams(search);
  return {
    clock: triState(params, 'clock'),
  };
}
