import React from 'react';
// fork: 永続化ヘルパーは独立モジュールへ分離（本家 scaffold には無い）
import {
  tweaksStorageKey, tweaksPageName, loadTweaks, saveTweaks,
  presetsStorageKey, loadPresets, savePresets,
  mergeIntoDefaults,
  resolveDefaultValues, resolveDefaultName, shallowEqualValues,
  serializePresets, fetchBuiltinPresets,
  serializeTheme, parseThemesImport,
  defaultThemeStorageKey, activeThemeStorageKey, loadThemeName, saveThemeName,
  loadSectionState, saveSectionState, tweaksExportFilename, themeExportFilename,
} from './use-tweaks.js';

// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)

/* BEGIN USAGE */
// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
// Exports (to window): useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider,
//   TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// TweakRadio is the segmented control for 2–3 short options (auto-falls-back to
// TweakSelect past ~16/~10 chars per label); reach for TweakSelect directly when
// options are many or long. For color tweaks always curate 3-4 options rather than
// a free picker; an option can also be a whole 2–5 color palette (the stored value
// is the array). The Tweak* controls are a floor, not a ceiling — build custom
// controls inside the panel if a tweak calls for UI they don't cover.
/* END USAGE */
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-fab{position:fixed;left:calc(16px + env(safe-area-inset-left));
    bottom:calc(58px + env(safe-area-inset-bottom));z-index:2147483646;
    appearance:none;border:0;border-radius:999px;padding:9px;
    display:inline-flex;align-items:center;justify-content:center;
    background:rgba(41,38,27,.86);color:#fff;
    -webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);
    box-shadow:0 10px 30px rgba(0,0,0,.22),0 1px 0 rgba(255,255,255,.2) inset;
    font:14px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;font-weight:700;
    letter-spacing:.01em;cursor:pointer}
  .twk-fab:hover{background:rgba(41,38,27,.94)}
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:14px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:15px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:24px;height:24px;border-radius:6px;cursor:default;font-size:16px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  /* fork:sections — 折りたたみセクションのヘッダ（クリックで開閉） */
  .twk-sect-btn{display:flex;align-items:center;gap:6px;width:100%;text-align:left;
    appearance:none;border:0;background:transparent;cursor:default;
    font:600 11px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;
    letter-spacing:.06em;text-transform:uppercase;color:rgba(41,38,27,.45);
    padding:10px 0 0}
  .twk-sect-btn:first-child{padding-top:0}
  .twk-sect-btn:hover{color:rgba(41,38,27,.7)}
  .twk-sect-chev{flex:0 0 auto;font-size:9px;line-height:1;color:rgba(41,38,27,.4);
    transition:transform .15s}
  .twk-sect-btn[data-open="1"] .twk-sect-chev{transform:rotate(90deg)}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none;touch-action:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;min-height:26px;padding:5px 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default;
    line-height:1.25;white-space:normal;text-align:center}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}
  .twk-btn:disabled{opacity:.4;pointer-events:none}

  /* fork:presets — テーマ保存/適用/入出力の横並び行 */
  .twk-presets-row{display:flex;gap:6px;align-items:center}
  .twk-presets-row .twk-field{flex:1 1 auto}
  .twk-presets-row .twk-btn{flex:0 0 auto}
  .twk-presets-row .twk-btn.grow{flex:1 1 auto}
  .twk-presets-empty{font-size:13px;color:rgba(0,0,0,.45);padding:2px 0}
  .twk-presets-head{font-size:11px;font-weight:600;letter-spacing:.04em;
    color:rgba(0,0,0,.4);margin:8px 0 2px}
  .twk-presets-status{font-size:13px;color:rgba(0,0,0,.7);padding:2px 0 4px}
  .twk-presets-status b{font-weight:600}
  .twk-presets-status .dirty{color:#b5651d}
  .twk-presets-status .muted{color:rgba(0,0,0,.45)}
  .twk-presets-legend{font-size:11px;color:rgba(0,0,0,.4);padding:4px 0 0;line-height:1.5}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}

  /* モバイル（狭いポートレイト）: 横幅いっぱい＋タッチしやすい大きめUI */
  @media (max-width:480px){
    .twk-panel{width:calc(100vw - 24px);right:12px;bottom:12px;max-height:72vh}
    .twk-fab{left:calc(12px + env(safe-area-inset-left));
      bottom:calc(56px + env(safe-area-inset-bottom));padding:11px}
    .twk-hd{padding:12px 10px 12px 16px}
    .twk-hd b{font-size:16px}
    .twk-x{width:32px;height:32px;font-size:18px}
    .twk-body{padding:2px 16px 16px;gap:14px;font-size:16px}
    .twk-sect,.twk-sect-btn{font-size:12px}
    .twk-sect-btn{padding-top:14px}
    .twk-sect-btn:first-child{padding-top:0}
    .twk-slider{height:6px;margin:9px 0}
    .twk-slider::-webkit-slider-thumb{width:24px;height:24px}
    .twk-slider::-moz-range-thumb{width:24px;height:24px}
    .twk-toggle{width:44px;height:26px}
    .twk-toggle i{width:22px;height:22px}
    .twk-toggle[data-on="1"] i{transform:translateX(18px)}
    .twk-btn{min-height:36px;padding:7px 14px}
    .twk-field,.twk-num{height:34px}
    .twk-swatch{height:30px;width:66px}
  }
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk) AND to
// localStorage so the user's adjustments survive a page reload.

// fork: 永続化ヘルパー（tweaksStorageKey / loadTweaks / saveTweaks）は
// ./use-tweaks.js に分離。本家に無い純粋な追加なので、衝突しないファイルへ退避した。

// fork:theme-sidecar — 継承キー（__proto__ 等）を除いた自前プロパティ判定。
const hasOwnKey = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

// fork: 本家 useTweaks に localStorage 永続化と resetTweaks を追加（番兵で明示）。
//
// fork:theme-sidecar — 第3引数 sidecar（任意）でテーマと一緒に持ち運ぶ付随データを扱う。
// useTweaks は中身を解釈しない汎用 API: { key, value, write, equal }。
//   key   … プリセット値オブジェクトに同梱する予約キー（例 '__cueOffsets'）。values 本体には混ぜない。
//   value … 現在のサイドカー値（保存スナップショットと dirty 判定に使う）。
//   write … テーマ適用/リセット/シード時にサイドカー値を書き戻す関数（key を持つテーマのみ呼ぶ）。
//   equal … 2値の構造比較（dirty 判定用。未指定ならサイドカー差分は dirty にしない）。
// 未指定（talk/ぐるぐる）なら全サイドカー処理がスキップされ、従来挙動とバイト不変。
function useTweaks(defaults, storageKey, sidecar) {
  // ── fork:persist ↓ ── 永続化（ヘルパーは ./use-tweaks.js）
  const key = React.useMemo(() => tweaksStorageKey(storageKey), [storageKey]);
  const presetsKey = React.useMemo(() => presetsStorageKey(storageKey), [storageKey]);
  // fork:default-theme/active-theme — テーマ「名」1つずつの別キー（値とは分離）。
  const defaultThemeKey = React.useMemo(() => defaultThemeStorageKey(storageKey), [storageKey]);
  const activeThemeKey = React.useMemo(() => activeThemeStorageKey(storageKey), [storageKey]);
  // 初回起動（localStorage に未保存）かを記録する。ビルトイン読込後に「最初の
  // テーマ」をデフォルトとして流し込むか判断するのに使う。初期化子は一度しか
  // 走らないので、saveTweaks 副作用が書き込む前のこの時点で判定する。
  const seedRef = React.useRef({ firstRun: false, seeded: false });
  // 初回レンダーで保存値を読み込む（関数初期化なので一度だけ実行される）。
  const [values, setValues] = React.useState(() => {
    try { seedRef.current.firstRun = window.localStorage.getItem(key) == null; } catch { /* private mode */ }
    return loadTweaks(key, defaults);
  });
  // ユーザーが保存したテーマ（localStorage 永続化）。ビルトインとは別レイヤー。
  const [presets, setPresets] = React.useState(() => loadPresets(presetsKey));
  // ビルトイン（配布デフォルト）テーマ。public/default-themes から毎回読むので
  // 非永続。localStorage には混ぜない（混ぜると JSON 更新が届かなくなる）。
  const [builtins, setBuiltins] = React.useState({});
  // fork:default-theme — ユーザー指定デフォルトテーマ名（起動シードと reset が参照）。
  const [defaultTheme, setDefaultTheme] = React.useState(() => loadThemeName(defaultThemeKey));
  // fork:active-theme — いま適用中のテーマ名（リロードをまたいで「現在」を表示）。
  const [activeTheme, setActiveTheme] = React.useState(() => loadThemeName(activeThemeKey));
  // reset 用に最新の defaults を保持（通常はモジュール定数なので安定）。
  const defaultsRef = React.useRef(defaults);
  defaultsRef.current = defaults;
  // テーマ操作のコールバックを毎回作り直さずに最新値を読むための ref。
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const presetsRef = React.useRef(presets);
  presetsRef.current = presets;
  const builtinsRef = React.useRef(builtins);
  builtinsRef.current = builtins;
  const defaultThemeRef = React.useRef(defaultTheme);
  defaultThemeRef.current = defaultTheme;
  // fork:theme-sidecar — コールバックから最新の sidecar（write/value/key）を読むための ref。
  const sidecarRef = React.useRef(sidecar);
  sidecarRef.current = sidecar;

  // values が変わるたびに保存する。初回マウント時にも書き込むため、コード側で
  // defaults にキーが増えた場合は保存済みデータも自動で追従する。
  React.useEffect(() => { saveTweaks(key, values); }, [key, values]);
  // ユーザーテーマだけ永続化する（ビルトインは含めない）。
  React.useEffect(() => { savePresets(presetsKey, presets); }, [presetsKey, presets]);
  // デフォルト指定テーマ名・適用中テーマ名（それぞれ別キー）。null は removeItem。
  React.useEffect(() => { saveThemeName(defaultThemeKey, defaultTheme); }, [defaultThemeKey, defaultTheme]);
  React.useEffect(() => { saveThemeName(activeThemeKey, activeTheme); }, [activeThemeKey, activeTheme]);
  // ── fork:persist ↑ ──

  // 値一式を反映し、host（__edit_mode_set_keys）と同一ページのリスナ
  // （tweakchange）にも知らせる共通処理。reset とテーマ適用が共有する。
  const applyValues = React.useCallback((next) => {
    setValues(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: next }, '*');
    window.dispatchEvent(new CustomEvent('tweakchange', { detail: next }));
  }, []);

  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null
      ? keyOrEdits : { [keyOrEdits]: val };
    setValues((prev) => ({ ...prev, ...edits }));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', { detail: edits }));
  }, []);

  // ── fork:persist ↓ ── すべての項目を「デフォルト」に戻す（本家には無い）。
  // デフォルト = ユーザー指定テーマ（あれば）→ 無ければビルトイン先頭 → 無ければ
  // hardcoded defaults。解決したテーマ名を activeTheme にも反映する。保存は上の
  // useEffect が拾い、host とも同期する。reset と「標準に戻す」が共有する。
  // fork:theme-sidecar — 解決済み raw テーマからサイドカーを書き戻す。key を持つテーマのみ
  // write を呼ぶ。key 無し（旧テーマ）は触れない（後方互換: オフセット未保存テーマの適用で
  // 既存オフセットを消さない）。apply / reset / seed が共有する。
  const applyThemeSidecar = React.useCallback((rawTheme) => {
    const sc = sidecarRef.current;
    if (sc && hasOwnKey(rawTheme, sc.key)) sc.write(rawTheme[sc.key]);
  }, []);

  const applyDefaultTheme = React.useCallback(() => {
    const b = builtinsRef.current, p = presetsRef.current, dn = defaultThemeRef.current;
    const name = resolveDefaultName(b, p, dn);
    applyValues(resolveDefaultValues(b, p, defaultsRef.current, dn));
    setActiveTheme(name);
    if (name) applyThemeSidecar({ ...b, ...p }[name]);
  }, [applyValues, applyThemeSidecar]);
  const resetTweaks = applyDefaultTheme;
  // ── fork:persist ↑ ──

  // ── fork:default-theme ↓ ── ビルトインテーマを起動時に1回読む。
  // 失敗は無害に {}（フォールバック）。初回起動（未保存）なら、デフォルト指定
  // テーマ（無ければビルトイン先頭）を実効デフォルトとして流し込み、その名前を
  // activeTheme にも記録する（既存ユーザーの値は上書きしない）。
  React.useEffect(() => {
    let alive = true;
    fetchBuiltinPresets(import.meta.env.BASE_URL, tweaksPageName(), key)
      .then((b) => {
        if (!alive) return;
        setBuiltins(b);
        if (seedRef.current.firstRun && !seedRef.current.seeded && Object.keys(b).length) {
          seedRef.current.seeded = true;
          const dn = defaultThemeRef.current, p = presetsRef.current;
          const name = resolveDefaultName(b, p, dn);
          applyValues(resolveDefaultValues(b, p, defaultsRef.current, dn));
          setActiveTheme(name);
          if (name) applyThemeSidecar({ ...b, ...p }[name]); // 初回シードでもサイドカーを反映
        }
      });
    return () => { alive = false; };
  }, [key, applyValues, applyThemeSidecar]);
  // ── fork:default-theme ↑ ──

  // ── fork:presets ↓ ── テーマ（名前付きプリセット）コントローラ。
  // 2層: ビルトイン（基底）にユーザーテーマを重ね、同名はユーザー優先で上書き。
  // メソッドは ref で最新値を読むので、依存は list を更新する builtins/presets のみ。
  const themes = React.useMemo(() => {
    const merged = { ...builtins, ...presets };
    // 表示用リスト。builtin=ユーザーが上書きしていない配布デフォルトのみ true。
    // isDefault=ユーザー指定デフォルト。並びは標準→ユーザーの順に整える。
    const list = Object.keys(merged)
      .map((name) => ({
        name,
        builtin: (name in builtins) && !(name in presets),
        isDefault: name === defaultTheme,
      }))
      .sort((a, b) => (a.builtin === b.builtin ? 0 : a.builtin ? -1 : 1));
    // 適用中テーマの解決値。現在値と一致するか＝「未保存変更（dirty）」を出すため。
    const activeResolved = activeTheme && merged[activeTheme]
      ? mergeIntoDefaults(merged[activeTheme], defaultsRef.current) : null;
    // 適用中テーマが（まだ）存在するか。旧ユーザーや削除済みなら null 扱い。
    const activeExists = !!(activeTheme && merged[activeTheme]);
    const valuesDirty = activeResolved ? !shallowEqualValues(values, activeResolved) : false;
    // fork:theme-sidecar — 適用中テーマが key を持つときだけ、サイドカー（cue オフセット等）の
    // 差分も dirty に含める。key 無し（旧テーマ）や equal 未指定なら、サイドカーでは dirty にしない。
    const activeRaw = activeExists ? merged[activeTheme] : null;
    const sidecarDirty = !!(sidecar && typeof sidecar.equal === 'function'
      && hasOwnKey(activeRaw, sidecar.key)
      && !sidecar.equal(sidecar.value, activeRaw[sidecar.key]));
    const dirty = valuesDirty || sidecarDirty;
    return {
      list,
      active: activeExists ? activeTheme : null,
      default: defaultTheme,
      dirty,
      // 現在値のスナップショットを name で保存（既存名は上書き）。空名は no-op。
      // ビルトインと同名なら、ユーザー層に積んで上書きする形になる。保存したテーマを
      // 適用中（active）にする。
      save(name) {
        const n = String(name || '').trim();
        if (!n) return false;
        // fork:theme-sidecar — サイドカー（cue オフセット等）を予約キーで同梱する。values 本体には
        // 混ぜない（apply 時に mergeIntoDefaults が落とすので values は汚れない）。常に同梱するので
        // 旧テーマも再保存で自動昇格する。sidecar 未指定（talk/ぐるぐる）は従来どおり values だけ。
        const sc = sidecarRef.current;
        const snapshot = sc
          ? { ...valuesRef.current, [sc.key]: sc.value }
          : { ...valuesRef.current };
        setPresets((prev) => ({ ...prev, [n]: snapshot }));
        setActiveTheme(n);
        return true;
      },
      // name のテーマ（ユーザー優先で解決）を defaults にマージして適用（前方互換）。
      // 適用したテーマを active にする。サイドカー（key 付き）も復元する。
      apply(name) {
        const saved = { ...builtinsRef.current, ...presetsRef.current }[name];
        if (!saved) return false;
        applyValues(mergeIntoDefaults(saved, defaultsRef.current));
        setActiveTheme(name);
        applyThemeSidecar(saved); // key があればサイドカーも復元（無ければ触れない）
        return true;
      },
      // ユーザー層からのみ削除。ビルトインは消えない（上書きを取り消すと元に戻る）。
      // 消す名前がデフォルト指定／適用中なら、その参照も解除する（stale を残さない。
      // 残すと同名テーマを後で再作成したとき適用していないのに active 復活＝dirty 誤判定）。
      remove(name) {
        setPresets((prev) => {
          if (!(name in prev)) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
        if (defaultThemeRef.current === name) setDefaultTheme(null);
        if (activeTheme === name) setActiveTheme(null);
      },
      // 指定テーマをデフォルトにする。存在する名前のみ true（builtin/user 問わず）。
      setDefault(name) {
        const all = { ...builtinsRef.current, ...presetsRef.current };
        if (!name || !(name in all)) return false;
        setDefaultTheme(name);
        return true;
      },
      clearDefault() { setDefaultTheme(null); },
      // 表示中の全テーマ（ビルトイン＋ユーザー）を bundle JSON にする（バックアップ）。
      exportJSON() {
        const all = { ...builtinsRef.current, ...presetsRef.current };
        return serializePresets(all, tweaksStorageKey(storageKey));
      },
      // 1テーマだけを per-file JSON にする（人に渡す主動線）。存在しなければ null。
      exportThemeJSON(name) {
        const v = { ...builtinsRef.current, ...presetsRef.current }[name];
        if (!v) return null;
        return serializeTheme(name, v, tweaksStorageKey(storageKey));
      },
      // JSON を取り込みユーザー層にマージ（同名は取り込み側優先）。per-file / bundle /
      // 素マップを自動判別する。取り込めた件数を返す。壊れていれば例外（呼び出し側で握る）。
      importJSON(text) {
        const incoming = parseThemesImport(text);
        setPresets((prev) => ({ ...prev, ...incoming }));
        return Object.keys(incoming).length;
      },
    };
    // sidecar/applyThemeSidecar を依存に含める: サイドカー値（cue オフセット）が変わったら
    // dirty を再計算する（呼び出し側で sidecar を useMemo 化し識別を安定させる前提）。
  }, [builtins, presets, defaultTheme, activeTheme, values, applyValues, storageKey,
      sidecar, applyThemeSidecar]);
  // ── fork:presets ↑ ──

  // fork: 本家は [values, setTweak]。resetTweaks・themes を加えた4要素返し。
  return [values, setTweak, resetTweaks, themes];
  // ── fork:persist ↑ ──
}

// ── fork:sections ─────────────────────────────────────────────────────────
// 折りたたみセクションの開閉状態をパネル単位で一元管理する。各 TweakSection が
// 個別に localStorage を読み書きすると read-modify-write が競合するため、所有者を
// Provider 1 つに集約する。状態は専用キー（sectionStateKey）へ永続化し、tweaks
// 値・テーマとは混ぜない。Provider 外（collapsible を使わない talk/app 等）では
// TweakSection は従来どおり素のヘッダを描くので、後方互換は保たれる。
const CollapseContext = React.createContext(null);

function CollapseProvider({ storageKey, children }) {
  const [openMap, setOpenMap] = React.useState(() => loadSectionState(storageKey));
  React.useEffect(() => { saveSectionState(openMap, storageKey); }, [storageKey, openMap]);
  const api = React.useMemo(() => ({
    // 未記録のラベルはセクション側の defaultOpen に従う。
    isOpen: (label, defaultOpen) => (label in openMap ? openMap[label] : defaultOpen),
    setOpen: (label, val) => setOpenMap((m) => ({ ...m, [label]: val })),
  }), [openMap]);
  return <CollapseContext.Provider value={api}>{children}</CollapseContext.Provider>;
}

// ── fork:safe-area ───────────────────────────────────────────────────────────
// パネルは JS が right/bottom を px で直書きするため CSS の env() が効かない。ノッチ/
// ホームインジケータを避けるには JS で safe-area inset(px) を知る必要がある。CSS の
// custom property は env() を未解決のまま返すので、実プロパティを持つプローブで1度だけ
// 実測してキャッシュする（PC では全て 0px に落ちる）。
let __saCache = null;
let __saBound = false;
function safeAreaInsets() {
  if (__saCache) return __saCache;
  if (typeof document === 'undefined' || !document.body) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  // 回転で inset 値は入れ替わる（縦ノッチ上→横で左右へ）。初回だけ購読し、回転/リサイズで
  // キャッシュを捨てて次回 clampToViewport が再実測するようにする。
  if (!__saBound && typeof window !== 'undefined') {
    __saBound = true;
    const clear = () => { __saCache = null; };
    window.addEventListener('orientationchange', clear);
    window.addEventListener('resize', clear);
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
    + 'top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);'
    + 'bottom:env(safe-area-inset-bottom,0px);left:env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  __saCache = {
    top: parseFloat(cs.top) || 0, right: parseFloat(cs.right) || 0,
    bottom: parseFloat(cs.bottom) || 0, left: parseFloat(cs.left) || 0,
  };
  probe.remove();
  return __saCache;
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({ title = 'Tweaks', storageKey, closeOnOutsideClick = true, children }) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  const offsetRef = React.useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    // safe-area を避けるため、各辺の最小オフセットに inset を足す（ノッチ/ホームバー回避）。
    const sa = safeAreaInsets();
    const minX = PAD + sa.right, minY = PAD + sa.bottom;
    const maxRight = Math.max(minX, window.innerWidth - w - PAD - sa.left);
    const maxBottom = Math.max(minY, window.innerHeight - h - PAD - sa.top);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(minX, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(minY, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);

  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);

  React.useEffect(() => {
    const onMsg = (e) => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);
      else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ── fork:outside-close ↓ ── 本家 scaffold に無い「外側クリックで閉じる」。
  // closeOnOutsideClick=false なら無効化し、範囲外をクリックしても開いたままにする
  // （camera 版で使用）。有効時は範囲外のクリック/タップでパネルを閉じる（pointerdown
  // でマウス・タッチ両対応）。capture フェーズで拾い、パネル内（dragRef）のタップは
  // 無視する。開いた瞬間のクリックは open=false 時にはリスナ未登録なので即閉じは起きない。
  React.useEffect(() => {
    if (!open || !closeOnOutsideClick) return undefined;
    const onOutsidePointer = (e) => {
      const panel = dragRef.current;
      // 常時表示の FAB（.twk-fab）クリックはトグル扱いにしたいので外側閉じから除外する。
      const onFab = e.target && e.target.closest && e.target.closest('.twk-fab');
      if (panel && !panel.contains(e.target) && !onFab) {
        setOpen(false);
        window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
      }
    };
    document.addEventListener('pointerdown', onOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', onOutsidePointer, true);
  }, [open, closeOnOutsideClick]);
  // ── fork:outside-close ↑ ──

  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
  };

  const onDragStart = (e) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <>
      <style>{__TWEAKS_STYLE}</style>
      {/* ハンバーガーは常時表示。クリックでパネルを開閉トグルする（外側クリック閉じ処理は
          .twk-fab を除外しているので二重発火しない）。 */}
      <button type="button" className="twk-fab" onClick={() => setOpen((o) => !o)} aria-label={title} title={title}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path d="M4 6h14M4 11h14M4 16h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div ref={dragRef} className="twk-panel" data-omelette-chrome=""
             style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
          <div className="twk-hd" onMouseDown={onDragStart}>
            <b>{title}</b>
            <button className="twk-x" aria-label="Close tweaks"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={dismiss}>✕</button>
          </div>
          <div className="twk-body">
            <CollapseProvider storageKey={storageKey}>
              {children}
            </CollapseProvider>
          </div>
        </div>
      )}
    </>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

// collapsible を付けると、ヘッダをクリックで開閉できる折りたたみセクションになる
// （子要素として内側にコントロールを入れ子にする使い方）。開閉状態は CollapseContext
// が一元管理し永続化する。collapsible 未指定、または Provider 外では従来どおり
// 素のラベル＋兄弟並びで描く（既存呼び出しは無改修で同じ見た目）。
function TweakSection({ label, children, collapsible = false, defaultOpen = false }) {
  const ctx = React.useContext(CollapseContext);
  if (!collapsible || !ctx) {
    return (
      <>
        <div className="twk-sect">{label}</div>
        {children}
      </>
    );
  }
  const open = ctx.isOpen(label, defaultOpen);
  return (
    <>
      <button type="button" className="twk-sect-btn" data-open={open ? '1' : '0'}
              aria-expanded={open} onClick={() => ctx.setOpen(label, !open)}>
        <span className="twk-sect-chev" aria-hidden="true">▸</span>
        <span>{label}</span>
      </button>
      {open && children}
    </>
  );
}

function TweakRow({ label, value, children, inline = false }) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }) {
  return (
    <TweakRow label={label} value={`${value}${unit}`}>
      <input type="range" className="twk-slider" min={min} max={max} step={step}
             value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </TweakRow>
  );
}

function TweakToggle({ label, value, onChange }) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl"><span>{label}</span></div>
      <button type="button" className="twk-toggle" data-on={value ? '1' : '0'}
              role="switch" aria-checked={!!value}
              onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

function TweakRadio({ label, value, options, onChange }) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 14px system-ui averages ~7.7px/char — so 2
  // options fit ~14 chars each, 3 fit ~8. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = (o) => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({ 2: 14, 3: 8 }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = (s) => {
      const m = options.find((o) => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return <TweakSelect label={label} value={value} options={options}
                        onChange={(s) => onChange(resolve(s))} />;
  }
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  const idx = Math.max(0, opts.findIndex((o) => o.value === value));
  const n = opts.length;

  const segAt = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };

  const onPointerDown = (e) => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = (ev) => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <TweakRow label={label}>
      <div ref={trackRef} role="radiogroup" onPointerDown={onPointerDown}
           className={dragging ? 'twk-seg dragging' : 'twk-seg'}>
        <div className="twk-seg-thumb"
             style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
                      width: `calc((100% - 4px) / ${n})` }} />
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

function TweakSelect({ label, value, options, onChange }) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </TweakRow>
  );
}

function TweakText({ label, value, placeholder, onChange }) {
  return (
    <TweakRow label={label}>
      <input className="twk-field" type="text" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </TweakRow>
  );
}

function TweakNumber({ label, value, min, max, step = 1, unit = '', onChange }) {
  const clamp = (n) => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({ x: 0, val: 0 });
  const onScrubStart = (e) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, val: value };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = (ev) => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="twk-num">
      <span className="twk-num-lbl" onPointerDown={onScrubStart}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
             onChange={(e) => onChange(clamp(Number(e.target.value)))} />
      {unit && <span className="twk-num-unit">{unit}</span>}
    </div>
  );
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}

const __TwkCheck = ({ light }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          stroke={light ? 'rgba(0,0,0,.78)' : '#fff'} />
  </svg>
);

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({ label, value, options, onChange }) {
  if (!options || !options.length) {
    return (
      <div className="twk-row twk-row-h">
        <div className="twk-lbl"><span>{label}</span></div>
        <input type="color" className="twk-swatch" value={value}
               onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = (o) => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((o, i) => {
          const colors = Array.isArray(o) ? o : [o];
          const [hero, ...rest] = colors;
          const sup = rest.slice(0, 4);
          const on = key(o) === cur;
          return (
            <button key={i} type="button" className="twk-chip" role="radio"
                    aria-checked={on} data-on={on ? '1' : '0'}
                    aria-label={colors.join(', ')} title={colors.join(' · ')}
                    style={{ background: hero }}
                    onClick={() => onChange(o)}>
              {sup.length > 0 && (
                <span>
                  {sup.map((c, j) => <i key={j} style={{ background: c }} />)}
                </span>
              )}
              {on && <__TwkCheck light={__twkIsLight(hero)} />}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
}

function TweakButton({ label, onClick, secondary = false }) {
  return (
    <button type="button" className={secondary ? 'twk-btn secondary' : 'twk-btn'}
            onClick={onClick}>{label}</button>
  );
}

// ── fork:presets ─────────────────────────────────────────────────────────────
// Blob ダウンロードの共通ヘルパー。テキストを filename で1ファイル保存する。
function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// TweakPresets — useTweaks の 4 番目の返り値 themes を受け取り、テーマを保存／適用／
// デフォルト指定／削除し、ファイルで書き出し／読み込みする UI。操作を「端末内で使う」
// と「ファイルでやりとり」の2グループに分け、いま適用中のテーマ（active）を明示する。
function TweakPresets({ themes }) {
  const [name, setName] = React.useState('');
  const [sel, setSel] = React.useState('');
  const fileRef = React.useRef(null);
  const { list, active, default: defaultName, dirty } = themes;
  const selEntry = list.find((e) => e.name === sel);
  const selIsBuiltin = !!selEntry?.builtin;       // 標準は削除不可
  const selIsDefault = sel && sel === defaultName; // 既にデフォルト指定中か
  const activeEntry = list.find((e) => e.name === active);

  // 適用中テーマが変わったら、操作対象の選択もそれに合わせる（現在を既定選択に）。
  React.useEffect(() => { if (active) setSel(active); }, [active]);
  // 選択中のテーマが消えたら選択を解除する。
  React.useEffect(() => {
    if (sel && !list.some((e) => e.name === sel)) setSel('');
  }, [list, sel]);

  const onSave = () => {
    const n = name.trim();
    if (!n) return;
    if (list.some((e) => e.name === n) && !window.confirm(`「${n}」を上書きしますか？`)) return;
    if (themes.save(n)) { setSel(n); setName(''); }
  };
  const onApply = () => { if (sel) themes.apply(sel); };
  // 同じテーマで押すとデフォルト解除（トグル）。解除導線をここに集約する。
  const onToggleDefault = () => {
    if (!sel) return;
    if (selIsDefault) themes.clearDefault();
    else themes.setDefault(sel);
  };
  const onDelete = () => {
    if (sel && !selIsBuiltin && window.confirm(`「${sel}」を削除しますか？`)) themes.remove(sel);
  };

  const onExportTheme = () => {
    if (!sel) return;
    const json = themes.exportThemeJSON(sel);
    if (json) downloadTextFile(json, themeExportFilename(sel));
  };
  const onExportAll = () => downloadTextFile(themes.exportJSON(), tweaksExportFilename(new Date()));
  const onImportPick = () => fileRef.current?.click();
  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 同じファイルを連続で選び直せるようリセット
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const count = themes.importJSON(String(reader.result));
        window.alert(`${count} 件のテーマを読み込みました`);
      } catch (err) {
        window.alert(`読み込めませんでした: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // ドロップダウンの表示ラベル（●=適用中 / （標準） / ★=デフォルト）。
  const optionLabel = (e) =>
    `${e.name === active ? '● ' : ''}${e.name}${e.builtin ? '（標準）' : ''}${e.isDefault ? ' ★' : ''}`;

  return (
    <>
      {/* ── 端末内で使う ── */}
      <div className="twk-presets-head">端末内で使う</div>
      <div className="twk-presets-status">
        現在のテーマ:{' '}
        {activeEntry ? (
          <>
            ● <b>{activeEntry.name}</b>
            {activeEntry.builtin ? '（標準）' : ''}
            {activeEntry.isDefault ? ' ★' : ''}
            {dirty ? <span className="dirty">（変更あり）</span> : ''}
          </>
        ) : (
          // テーマ未適用（旧ユーザー/配布テーマ無し）。手動設定は永続化済みなので
          // 警告色にはせず、中立の淡色で「未選択」とだけ示す。
          <span className="muted">（テーマ未選択・手動設定）</span>
        )}
      </div>
      {list.length > 0 ? (
        <>
          <div className="twk-presets-row">
            <select className="twk-field" value={sel}
                    onChange={(e) => setSel(e.target.value)}>
              <option value="">— 選択 —</option>
              {list.map((e) => (
                <option key={e.name} value={e.name}>{optionLabel(e)}</option>
              ))}
            </select>
            <button type="button" className="twk-btn" disabled={!sel}
                    onClick={onApply}>適用</button>
          </div>
          <div className="twk-presets-row">
            <button type="button" className="twk-btn secondary grow"
                    disabled={!sel}
                    title={selIsDefault ? 'デフォルト指定を解除します' : '次回起動時とリセット時に適用されます'}
                    onClick={onToggleDefault}>
              {selIsDefault ? '★ デフォルト解除' : '★ デフォルトに設定'}
            </button>
            <button type="button" className="twk-btn secondary grow"
                    disabled={!sel || selIsBuiltin}
                    title={selIsBuiltin ? '標準テーマは削除できません' : undefined}
                    onClick={onDelete}>削除</button>
          </div>
        </>
      ) : (
        <div className="twk-presets-empty">保存したテーマはまだありません</div>
      )}
      <TweakRow label="いまの見た目を保存">
        <div className="twk-presets-row">
          <input className="twk-field" type="text" value={name} placeholder="テーマ名を入力…"
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }} />
          <button type="button" className="twk-btn" onClick={onSave}>保存</button>
        </div>
      </TweakRow>

      {/* ── ファイルでやりとり ── */}
      <div className="twk-presets-head">ファイルでやりとり</div>
      <div className="twk-presets-row">
        <button type="button" className="twk-btn secondary grow" disabled={!sel}
                title={sel ? `「${sel}」を1ファイルで書き出す` : '先にテーマを選択してください'}
                onClick={onExportTheme}>選択テーマを書き出し</button>
        <button type="button" className="twk-btn secondary grow"
                title="全テーマを1ファイルにまとめて書き出す（バックアップ）"
                onClick={onExportAll}>全部まとめて書き出し</button>
      </div>
      <div className="twk-presets-row">
        <button type="button" className="twk-btn secondary grow" onClick={onImportPick}>
          読み込み
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json"
               style={{ display: 'none' }} onChange={onImportFile} />
      </div>
      <div className="twk-presets-legend">●=表示中　★=デフォルト　（標準）=配布テーマ</div>
    </>
  );
}

Object.assign(window, {
  useTweaks, TweaksPanel, TweakSection, TweakRow,
  TweakSlider, TweakToggle, TweakRadio, TweakSelect,
  TweakText, TweakNumber, TweakColor, TweakButton, TweakPresets,
});
