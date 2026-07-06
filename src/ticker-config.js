// テロップ（CNN 風・下部クロール）の設定を正規化・検証する純関数群と URL パラメータ解析。
//
// テロップ設定は tx→rx へ専用 `ticker` メッセージ（{text,bgColor,textColor,speed,visible}）で
// 流れる。WS は無認証なので、rx が受信した値はここで必ず検証してから表示に使う
// （偽注入・暴走対策。draw-live の点列検証や cue の色検証と同じ方針）。
// obs-mode.js / draw-mode.js と同じ「起動時に一度だけ解析する純関数」の流儀に揃える。

// 文言の最大長（無認証 WS からの巨大文字列で描画を膨らませない）。
export const MAX_TICKER_TEXT_LEN = 300;
// クロールの見かけ速度（px/秒）の許容範囲。
export const SPEED_MIN = 10;
export const SPEED_MAX = 400;
// クロール1周の最小時間（速すぎ・短すぎでチカチカしないための下限）。
export const MIN_CRAWL_MS = 1000;

// 既定値。visible=false なので、操作側が表示を ON にするまで何も出ない。
export const TICKER_DEFAULTS = Object.freeze({
  text: '',
  bgColor: '#cc0000',   // CNN 風の赤バー
  textColor: '#ffffff',
  speed: 90,            // px/秒
  visible: false,
});

// #rgb / #rrggbb のみ許容（input[type=color] は #rrggbb を返すが受信値は何でも来うる）。
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// 制御文字（U+0000..U+001F と U+007F）。改行・タブも1行クロール用に潰す。
// 実制御文字をソースに埋め込まないよう RegExp を文字列から生成する。
const CTRL_RE = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

// 色文字列を検証し、不正なら fallback を返す。前後空白は許容してトリムする。
export function normalizeHexColor(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return HEX_RE.test(s) ? s : fallback;
}

// 速度を SPEED_MIN..SPEED_MAX に収める。非数値は既定速度へ。
export function clampSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return TICKER_DEFAULTS.speed;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(n)));
}

// 文言を1行クロール用に整える。制御文字を空白へ畳み、長さ上限で切る。
// 先に上限で切ってから置換する（置換は1文字→1文字で長さ不変なので結果は同じ。
// 巨大な受信文字列でも走査コストを O(MAX_TICKER_TEXT_LEN) に抑える防御）。
export function sanitizeTickerText(v) {
  if (typeof v !== 'string') return '';
  return v.slice(0, MAX_TICKER_TEXT_LEN).replace(CTRL_RE, ' ');
}

// 受信/保存した設定オブジェクトを、各フィールド検証つきで完全な設定へ正規化する。
// 常に新しいオブジェクトを返す（入力は破壊しない）。
export function normalizeTickerConfig(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    text: sanitizeTickerText(d.text),
    bgColor: normalizeHexColor(d.bgColor, TICKER_DEFAULTS.bgColor),
    textColor: normalizeHexColor(d.textColor, TICKER_DEFAULTS.textColor),
    speed: clampSpeed(d.speed),
    visible: d.visible === true, // 厳密 true のみ（truthy な 1/"true" は不可）
  };
}

// 1コピー分の幅(px)と速度(px/秒)からクロール1周の所要時間(ms)を出す。
// 見かけ速度を文言の長短によらず一定に保つため、幅に比例した時間にする。
export function crawlDurationMs(widthPx, speed) {
  const w = Number(widthPx);
  const s = clampSpeed(speed);
  if (!Number.isFinite(w) || w <= 0) return MIN_CRAWL_MS;
  return Math.max(MIN_CRAWL_MS, Math.round((w / s) * 1000));
}

// 真偽フラグの許容表記。?ticker（値なし）も有効にしたいので空文字を含める。
const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

// 未指定は undefined、指定ありは真偽を返す三状態フラグ（obs-mode.js / draw-mode.js と同じ）。
function triState(params, name) {
  if (!params.has(name)) return undefined;
  return TRUTHY.has((params.get(name) || '').toLowerCase());
}

/**
 * URL の search 文字列からテロップモードを解析する純関数。
 * ?ticker[=1] で有効、?ticker=0 で無効、無しは undefined（呼び出し側で既定を決める）。
 * @param {string} [search] '?ticker=1' / 'ticker=1' / '' など。先頭の ? は任意。
 * @returns {{ ticker: (boolean|undefined) }}
 */
export function parseTickerParams(search = '') {
  const params = new URLSearchParams(search);
  return {
    ticker: triState(params, 'ticker'),
  };
}
