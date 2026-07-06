// Tweaks 値の localStorage 永続化ヘルパー（フォーク追加）。
//
// 本家 tweaks-panel.jsx（vendored scaffold）はこれらを持たない。永続化は
// フォーク固有の関心事なので、本家ファイルに混ぜずこの独立モジュールに置く。
// こうすると本家が scaffold を差し替えても、永続化ロジックは無傷で残る。
//
// tweaks-panel.jsx の useTweaks がこれらを import して使う。

// 現在ページ名（例: index.html）。ストレージキーと default-themes の
// ファイル名の両方で使う。パスが取れなければ index にフォールバック。
export function tweaksPageName() {
  const path = (typeof location !== 'undefined' && location.pathname) || '';
  return path.split('/').pop() || 'index';
}

// 永続化キー。ページごとにバケットを分け、同一オリジンの guruguru / talk /
// camera が localStorage を共有しても衝突しないようにする。明示キーを渡せば優先。
export function tweaksStorageKey(explicit) {
  if (explicit) return explicit;
  return `tomari-tweaks:${tweaksPageName()}`;
}

// 配列・null を除いたプレーンなオブジェクトか。プリセット検証の土台。
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// 自前プロパティか（__proto__ 等の継承キーを名前解決から除外するため）。
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// saved を defaults に上書きマージして新しいオブジェクトを返す。defaults に
// 無いキーは捨てる（前方互換: 後から tweak 項目が増えても古い保存値で壊れない）。
// saved がオブジェクトでなければ defaults のコピーをそのまま返す。
export function mergeIntoDefaults(saved, defaults) {
  const merged = { ...defaults };
  if (isPlainObject(saved)) {
    for (const k of Object.keys(defaults)) {
      if (k in saved) merged[k] = saved[k];
    }
  }
  return merged;
}

// 「実効デフォルト」。ビルトインの最初のテーマを hardcoded defaults にマージ
// したものを返す。ビルトインが空／不正なら defaults のコピー。初期化時の
// シードと resetTweaks の両方で使う。部分テーマでも未指定キーは defaults で
// 埋まる（前方互換）。オブジェクトのキー順＝挿入順なので「最初の項目」が効く。
export function effectiveDefaultsFrom(builtins, defaults) {
  const first = isPlainObject(builtins) ? Object.keys(builtins)[0] : undefined;
  return first ? mergeIntoDefaults(builtins[first], defaults) : { ...defaults };
}

// ── fork:default-theme ── ユーザー指定デフォルトテーマの解決 ──────────────────
// builtins とユーザー presets を重ねた名前空間（user 優先）から defaultName を
// 解決する。指定が解決できれば「その名前」、無ければ従来どおり builtins 先頭、
// それも無ければ null を返す。effectiveDefaultsFrom と優先順位を合わせる。

// 解決されるテーマ「名」を返す（UI の現在テーマ追従用）。値は resolveDefaultValues。
export function resolveDefaultName(builtins, presets, defaultName) {
  const all = {
    ...(isPlainObject(builtins) ? builtins : {}),
    ...(isPlainObject(presets) ? presets : {}),
  };
  if (defaultName && hasOwn(all, defaultName) && isPlainObject(all[defaultName])) return defaultName;
  const first = isPlainObject(builtins) ? Object.keys(builtins)[0] : undefined;
  return first || null;
}

// 解決されたテーマ「値」を defaults にマージして返す。指定が解決できなければ
// 従来の effectiveDefaultsFrom（builtins 先頭→無ければ defaults コピー）に委譲。
export function resolveDefaultValues(builtins, presets, defaults, defaultName) {
  const all = {
    ...(isPlainObject(builtins) ? builtins : {}),
    ...(isPlainObject(presets) ? presets : {}),
  };
  if (defaultName && hasOwn(all, defaultName) && isPlainObject(all[defaultName])) {
    return mergeIntoDefaults(all[defaultName], defaults);
  }
  return effectiveDefaultsFrom(builtins, defaults);
}

// 2つの tweak 値オブジェクトが同じか（浅い比較）。現在値が適用中テーマと一致
// するか＝「未保存変更（dirty）」判定に使う。NaN も Object.is で安全に比較する。
// 注意: 値が配列/オブジェクトだと参照比較になる（同値でも別参照なら false）。
// 現状の tweak 値は数値・文字列・真偽のみなので問題ないが、将来 tweak に配列を
// 入れる場合は等値比較を1段足すこと。
export function shallowEqualValues(a, b) {
  if (!isPlainObject(a) || !isPlainObject(b)) return a === b;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

// 保存値を defaults に上書きマージして返す。defaults に無いキーは捨て、
// 読み取り不可（プライベートモード等）や壊れた JSON なら defaults を使う。
export function loadTweaks(key, defaults) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaults;
    return mergeIntoDefaults(JSON.parse(raw), defaults);
  } catch {
    return defaults;
  }
}

export function saveTweaks(key, values) {
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（アプリは継続動作） */
  }
}

// ── テーマ（名前付きプリセット）─────────────────────────────────────────────
// 現在値（上の tomari-tweaks:<page>）とは別キーに、名前付きスナップショットの
// マップ {名前: 値} を保存する。混ぜると「保存したら現在値が消えた」事故が
// 起きるため分離する。エクスポート/インポートで端末間の持ち運びにも対応。

export const PRESETS_EXPORT_VERSION = 1;

// 現在値キーに :presets を足したプリセット集のキー。ページ単位で分かれる。
export function presetsStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':presets';
}

// プリセット集を {名前: プレーンオブジェクト} だけに正規化する。空名や
// オブジェクトでない値は捨て、壊れた入力でも安全なマップを返す。
export function sanitizePresets(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [name, val] of Object.entries(obj)) {
    if (name && isPlainObject(val)) out[name] = val;
  }
  return out;
}

export function loadPresets(key) {
  try {
    return sanitizePresets(JSON.parse(window.localStorage.getItem(key) || 'null'));
  } catch {
    return {};
  }
}

export function savePresets(key, presets) {
  try {
    window.localStorage.setItem(key, JSON.stringify(presets));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（アプリは継続動作） */
  }
}

// ── fork:default-theme / active-theme ── テーマ「名」1つの永続化 ──────────────
// デフォルト指定テーマと、いま適用中のテーマの2つを、それぞれ別キーにテーマ名
// （生文字列1つ）で保存する。値マップ（:presets）とは分け、空/空白は removeItem
// ＝未指定として扱う。読み書き不可（プライベートモード等）は黙ってフォールバック。

// 起動シードと「デフォルトに戻す」が参照する、ユーザー指定デフォルトテーマ名。
export function defaultThemeStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':defaultTheme';
}

// いま画面に適用中のテーマ名。リロードをまたいで「現在のテーマ」を表示するため。
export function activeThemeStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':activeTheme';
}

// テーマ名（文字列1つ）を読む。未保存・空白のみ・読取不可は null。saveThemeName が
// trim して保存するのに合わせ、読み出しも trim して返す（往復で対称・キー照合が確実）。
export function loadThemeName(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const n = typeof raw === 'string' ? raw.trim() : '';
    return n || null;
  } catch {
    return null;
  }
}

// テーマ名を保存する。空・空白のみ・null は removeItem（＝指定解除）。
export function saveThemeName(key, name) {
  try {
    const n = typeof name === 'string' ? name.trim() : '';
    if (n) window.localStorage.setItem(key, n);
    else window.localStorage.removeItem(key);
  } catch {
    /* 読み書き不可（プライベートモード等）では黙って諦める（アプリは継続動作） */
  }
}

// エクスポート用 JSON 文字列。app/version のエンベロープを付け、別アプリの
// JSON を取り違えてインポートしても弾けるようにする。読みやすく整形して返す。
export function serializePresets(presets, page) {
  return JSON.stringify({
    app: 'tomari-tweaks',
    version: PRESETS_EXPORT_VERSION,
    page: page || null,
    presets: sanitizePresets(presets),
  }, null, 2);
}

// エンベロープ {app,version,presets} なら presets を、素のマップ {名前:値}
// ならそれ自身を返す。インポートとビルトイン読込の両方で形を揃える。
function unwrapPresetsEnvelope(data) {
  return isPlainObject(data) && isPlainObject(data.presets) ? data.presets : data;
}

// インポート文字列を検証してプリセットマップを返す。エンベロープ形式
// （{app,version,presets}）と素のマップ（{名前:値}）の両方を受ける。JSON
// として読めない／有効なテーマが1件も無ければ例外を投げる（呼び出し側で握る）。
export function parsePresetsImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み込めませんでした');
  }
  const presets = sanitizePresets(unwrapPresetsEnvelope(data));
  if (Object.keys(presets).length === 0) {
    throw new Error('テーマが1件も見つかりませんでした');
  }
  return presets;
}

// ── fork:per-file ── 1テーマ=1ファイルの書き出し／読み込み ────────────────────
// 「人に1テーマだけ渡す」主動線。bundle（全テーマまとめ）と区別できるよう、
// エンベロープに themeName と theme（単一テーマの値）を持たせる。page は bundle
// と同じく tweaksStorageKey 値（例 tomari-tweaks:camera.html）を入れて形式を揃える。

// 単一テーマをエクスポート用 JSON にする。values が壊れていても安全に {} を入れる。
export function serializeTheme(name, values, page) {
  return JSON.stringify({
    app: 'tomari-tweaks',
    version: PRESETS_EXPORT_VERSION,
    page: page || null,
    themeName: String(name == null ? '' : name),
    theme: isPlainObject(values) ? values : {},
  }, null, 2);
}

// インポート文字列を解析してプリセットマップ {名前:値} を返す。per-file
// （{themeName, theme}）と bundle/素マップの両方を1入力で受ける（後方互換）。
// per-file は themeName を名前にした1件だけにする。どちらも有効テーマが0件なら
// 例外を投げる（呼び出し側で握る）。JSON として読めない場合も例外。
export function parseThemesImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み込めませんでした');
  }
  // per-file 形式: themeName(文字列) を持てば per-file 意図とみなす。theme が壊れて
  // いれば bundle に落とさず、原因が分かる専用メッセージで投げる（誤誘導を防ぐ）。
  if (isPlainObject(data) && typeof data.themeName === 'string') {
    if (!isPlainObject(data.theme)) {
      throw new Error('テーマ本体（theme）が不正です');
    }
    const name = data.themeName.trim();
    const presets = sanitizePresets(name ? { [name]: data.theme } : {});
    if (Object.keys(presets).length === 0) {
      throw new Error('テーマが1件も見つかりませんでした');
    }
    return presets;
  }
  // bundle / 素マップは従来パーサに委譲（完全な後方互換）。
  return parsePresetsImport(text);
}

// ── ビルトイン（配布デフォルト）テーマ ───────────────────────────────────────
// public/default-themes/<page>.json を「常に存在する基底レイヤー」として読む。
// 非永続: 毎回ここから読むので JSON を更新すれば全ユーザーに反映される。
// localStorage のユーザーテーマは上に重ね、同名はユーザー優先で上書きできる。

// パース済み JSON からビルトインプリセットを取り出す純関数。ページガード付き:
// エンベロープに page があり expectedKey と不一致なら取り違えとみなし {} を返す。
// page が無い／expectedKey 未指定ならガードは効かせない。
export function selectBuiltinPresets(data, expectedKey) {
  if (isPlainObject(data) && data.page && expectedKey && data.page !== expectedKey) {
    return {};
  }
  return sanitizePresets(unwrapPresetsEnvelope(data));
}

// 応答が JSON ではなく HTML（dev サーバーや SPA フォールバックの index.html）か。
// 存在しない .json でも 200 で index.html を返すホストがあり、その場合 res.ok は
// true のまま本文が HTML になる。Content-Type が HTML、または本文が '<' で始まれば
// 「配布テーマ未配置」とみなす。壊れた JSON（'<' で始まらない）は false のまま
// 本物の異常として扱い、呼び出し側で error ログに残す。
export function isHtmlFallback(contentType, text) {
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('html')) {
    return true;
  }
  return /^\s*</.test(text || '');
}

// public/default-themes/<page>.json を取得してビルトインプリセットを返す。
// 404・ネットワーク不通・壊れた JSON・ページ不一致・HTML フォールバックは
// すべて {}（無害に無効化）。
export async function fetchBuiltinPresets(baseUrl, page, expectedKey) {
  const url = (baseUrl || '/') + 'default-themes/' + page + '.json';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 404 等。配布テーマが無いだけならアプリは継続動作するが、なぜテーマが
      // 当たらないか調べられるよう必ずログに残す（黙って消さない）。
      console.warn(`[tweaks] 配布デフォルトテーマを読み込めません (HTTP ${res.status}): ${url}`);
      return {};
    }
    const text = await res.text();
    // dev サーバー（Vite）や SPA フォールバックのある静的ホストは、存在しない
    // .json でも 200 で index.html を返す。これは「未配置」であって異常ではない
    // ので、JSON.parse して error を出さず、HTML を検知して warn で無害に {}。
    if (isHtmlFallback(res.headers.get('content-type'), text)) {
      console.warn(`[tweaks] 配布デフォルトテーマは未配置です（HTML フォールバック応答）: ${url}`);
      return {};
    }
    return selectBuiltinPresets(JSON.parse(text), expectedKey);
  } catch (err) {
    // ネットワーク不通や JSON パース失敗など「読めない」ケース。原因を添えて出す。
    console.error(`[tweaks] 配布デフォルトテーマの読み込みに失敗しました: ${url}`, err);
    return {};
  }
}

// ── パネル位置（ドラッグ移動）の永続化 ───────────────────────────────────────
// DraggablePanel が掴んで動かした HUD パネルの位置を覚えておくためのレイヤー。
// Tweaks 値とは別キーにし、ページ（camera/talk/...）× パネル id 単位で保存する。
// 形は {left, top}（px, 画面左上基準）。読み書き不可（プライベートモード等）や
// 壊れた値は黙って無視し、既定位置にフォールバックする（アプリは継続動作）。

export function panelPosStorageKey(id, explicit) {
  return tweaksStorageKey(explicit) + ':panelpos:' + id;
}

// 保存値を {left, top} で返す。未保存・壊れ・読取不可は null（＝既定位置を使う合図）。
export function loadPanelPos(id, explicit) {
  try {
    const raw = window.localStorage.getItem(panelPosStorageKey(id, explicit));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (isPlainObject(o) && Number.isFinite(o.left) && Number.isFinite(o.top)) {
      return { left: o.left, top: o.top };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePanelPos(id, pos, explicit) {
  try {
    window.localStorage.setItem(
      panelPosStorageKey(id, explicit),
      JSON.stringify({ left: pos.left, top: pos.top }),
    );
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める */
  }
}

export function clearPanelPos(id, explicit) {
  try {
    window.localStorage.removeItem(panelPosStorageKey(id, explicit));
  } catch {
    /* 読み書き不可でも無視（既定位置に戻るだけ） */
  }
}

// パネルが画面外へ出ないよう {left, top} を内側へ収める純関数（DOM 非依存・テスト容易）。
// 四辺に pad の余白を残す。パネルが画面より大きい場合も左上は pad に留め（負へ行かない）、
// 少なくとも左上隅が掴める状態を保証する。
export function clampPanelPos(pos, viewport, size, pad = 8) {
  const maxLeft = Math.max(pad, viewport.width - size.width - pad);
  const maxTop = Math.max(pad, viewport.height - size.height - pad);
  return {
    left: Math.min(maxLeft, Math.max(pad, pos.left)),
    top: Math.min(maxTop, Math.max(pad, pos.top)),
  };
}

// ── パネル位置の「端からの相対（アンカー）」表現 ─────────────────────────────
// 端に寄せて置く帯（cuebar / パネル表示トグル帯）向けに、位置を左上固定の {left, top} で
// はなく「近い方の端からの距離」で覚える。こうするとブラウザをリサイズしても、下端寄りの帯は
// 下端から、右端寄りの帯は右端から一定距離を保って追従する（left/top 固定だと下/右へ寄せた帯が
// リサイズで端から離れてしまう）。軸ごとに独立に近い端を選ぶ純関数で、DOM 非依存・テスト容易。
//
// アンカー形: { ax:'left'|'right', x:number, ay:'top'|'bottom', y:number }。
//   x = ax 側の端からパネルの同じ側の辺までの距離、y も同様（いずれも 0 以上）。

// {left, top} を「近い方の端からの相対アンカー」に変換する（軸ごとに近い端を採用）。
export function resolvePanelAnchor(pos, viewport, size) {
  const leftGap = pos.left;
  const rightGap = viewport.width - (pos.left + size.width);
  const ax = leftGap <= rightGap ? 'left' : 'right';
  const x = Math.max(0, ax === 'left' ? leftGap : rightGap);

  const topGap = pos.top;
  const bottomGap = viewport.height - (pos.top + size.height);
  const ay = topGap <= bottomGap ? 'top' : 'bottom';
  const y = Math.max(0, ay === 'top' ? topGap : bottomGap);

  return { ax, x, ay, y };
}

// 相対アンカーを、いまのビューポート／サイズに合わせて {left, top} へ戻す（画面内へ clamp 済み）。
export function applyPanelAnchor(anchor, viewport, size, pad = 8) {
  const left = anchor.ax === 'right'
    ? viewport.width - size.width - anchor.x
    : anchor.x;
  const top = anchor.ay === 'bottom'
    ? viewport.height - size.height - anchor.y
    : anchor.y;
  return clampPanelPos({ left, top }, viewport, size, pad);
}

// アンカーの永続化。位置(panelpos)と同じ sidecar 方針で、端寄せ帯は {left,top} ではなく
// このアンカー形で覚える。読み書き不可・壊れ・不正な端名は null（＝既定へフォールバック）。
export function panelAnchorStorageKey(id, explicit) {
  return tweaksStorageKey(explicit) + ':panelanchor:' + id;
}

export function loadPanelAnchor(id, explicit) {
  try {
    const raw = window.localStorage.getItem(panelAnchorStorageKey(id, explicit));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (isPlainObject(o)
        && (o.ax === 'left' || o.ax === 'right')
        && (o.ay === 'top' || o.ay === 'bottom')
        && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      return { ax: o.ax, x: o.x, ay: o.ay, y: o.y };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePanelAnchor(id, anchor, explicit) {
  try {
    window.localStorage.setItem(
      panelAnchorStorageKey(id, explicit),
      JSON.stringify({ ax: anchor.ax, x: anchor.x, ay: anchor.ay, y: anchor.y }),
    );
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める */
  }
}

export function clearPanelAnchor(id, explicit) {
  try {
    window.localStorage.removeItem(panelAnchorStorageKey(id, explicit));
  } catch {
    /* 読み書き不可でも無視（既定位置に戻るだけ） */
  }
}

// ── パネルサイズ（リサイズ）の永続化 ─────────────────────────────────────────
// 位置(panelpos)と同様、ページ × パネル id 単位で {width, height}(px) を覚える。
// 読み書き不可・壊れ・非正値は null（＝サイズ未指定＝中身なりのサイズにフォールバック）。
export function panelSizeStorageKey(id, explicit) {
  return tweaksStorageKey(explicit) + ':panelsize:' + id;
}

export function loadPanelSize(id, explicit) {
  try {
    const raw = window.localStorage.getItem(panelSizeStorageKey(id, explicit));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (isPlainObject(o) && o.width > 0 && o.height > 0
        && Number.isFinite(o.width) && Number.isFinite(o.height)) {
      return { width: o.width, height: o.height };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePanelSize(id, size, explicit) {
  try {
    window.localStorage.setItem(
      panelSizeStorageKey(id, explicit),
      JSON.stringify({ width: size.width, height: size.height }),
    );
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める */
  }
}

export function clearPanelSize(id, explicit) {
  try {
    window.localStorage.removeItem(panelSizeStorageKey(id, explicit));
  } catch {
    /* 読み書き不可でも無視（中身なりのサイズに戻るだけ） */
  }
}

// パネルサイズを画面内に収める純関数（DOM 非依存・テスト容易）。最小サイズを保ちつつ、
// 画面から pad を引いた範囲に収める（巨大保存値や画面回転でも掴める状態を保証）。
export function clampPanelSize(size, viewport, pad = 8, min = { width: 100, height: 48 }) {
  const maxW = Math.max(min.width, viewport.width - pad * 2);
  const maxH = Math.max(min.height, viewport.height - pad * 2);
  return {
    width: Math.min(maxW, Math.max(min.width, size.width)),
    height: Math.min(maxH, Math.max(min.height, size.height)),
  };
}

// ── パネルの汎用文字列 pref の永続化 ─────────────────────────────────────────
// 位置(panelpos)/サイズ(panelsize)と同じ sidecar 方針で、パネルごとの小さな UI 設定
// （例: 演出帯の向き 'row'/'column'）を「値」とは別キーに覚える。値に混ぜると
// mergeIntoDefaults で落ち、テーマ export を汚し、resetTweaks で消えるため分離する。
// 保存するのは素の文字列 1 個。意味付け（enum など）は呼び出し側の責務で、ここでは
// 「空でない文字列か」だけを見て、想定外の値は素通しして呼び出し側の既定にフォールバック
// させる（loadPanelPos が形だけ検証するのと同じ流儀）。
export function panelPrefStorageKey(id, explicit) {
  return tweaksStorageKey(explicit) + ':panelpref:' + id;
}

// 保存文字列を返す。未保存・空文字・読取不可は null（＝既定を使う合図）。
export function loadPanelPref(id, explicit) {
  try {
    const raw = window.localStorage.getItem(panelPrefStorageKey(id, explicit));
    return (typeof raw === 'string' && raw !== '') ? raw : null;
  } catch {
    return null;
  }
}

export function savePanelPref(id, value, explicit) {
  try {
    window.localStorage.setItem(panelPrefStorageKey(id, explicit), String(value));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める */
  }
}

export function clearPanelPref(id, explicit) {
  try {
    window.localStorage.removeItem(panelPrefStorageKey(id, explicit));
  } catch {
    /* 読み書き不可でも無視（既定に戻るだけ） */
  }
}

// ── fork:sections ── 折りたたみセクションの開閉状態（{ ラベル: 開いているか }）。
// tweaks 値とは別キーに保存する。値に混ぜると mergeIntoDefaults で落ち、テーマ
// export を汚し、resetTweaks で消えてしまうため、UI クロームとして分離する。
export function sectionStateKey(explicit) {
  return tweaksStorageKey(explicit) + ':sections';
}

// 開閉マップを返す。未保存・壊れ・読取不可は {}。boolean 以外の値は捨てる。
export function loadSectionState(explicit) {
  try {
    const raw = window.localStorage.getItem(sectionStateKey(explicit));
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (!isPlainObject(o)) return {};
    const out = {};
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'boolean') out[k] = o[k];
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSectionState(map, explicit) {
  try {
    window.localStorage.setItem(sectionStateKey(explicit), JSON.stringify(map));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定の開閉に戻るだけ） */
  }
}

// ── fork:cue-offset ── 演出（スタンプ）のアバター相対オフセット { [cueId]: {x,y} } ──
// cue 毎にスタンプの表示位置を微調整した値を覚える。値とは別キー（:cueoffset）に置く:
// tweaks 値に入れると mergeIntoDefaults で落ち、shallowEqualValues（primitive 前提）を
// 壊し、テーマ export を汚し、resetTweaks で消えてしまうため、UI チューニングとして分離する
// （:sections / :panelpos と同じサイドカー方式）。単位は em（= スタンプ fontSize = アバター
// 幅比）なので、charSize/ズーム/解像度が変わってもスケール不変。既定 {0,0} は既存表示と一致。
// 形は :sections と同じく「ページ単位の単一マップ」（cueId ごとの :id 分割はしない）。
export function cueOffsetStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cueoffset';
}

// em オフセットを ±範囲（既定 ±1.5）に収め、非有限・欠落は 0 に正規化する純関数（DOM 非依存）。
// スタンプが画面外へ飛ばないよう保存前にこれを通す。clampPanelPos と同じく単体テスト容易。
export function clampCueOffset(o, lo = -1.5, hi = 1.5) {
  const num = (v) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
  return { x: num(o && o.x), y: num(o && o.y) };
}

// 保存マップを { [cueId]: {x,y} }（x,y は有限数）だけに正規化する。空 id・非オブジェクト・
// 非有限の x/y を持つエントリは捨て、壊れた入力でも安全なマップを返す（sanitizePresets と同型）。
// export: テーマ・サイドカー連携で camera 側の write（applyCueOffsets）が再利用する
// （ライブ保存の saveCueOffsets と同じ正規化を一点に保つ）。
export function sanitizeCueOffsets(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    if (id && isPlainObject(v) && Number.isFinite(v.x) && Number.isFinite(v.y)) {
      out[id] = { x: v.x, y: v.y };
    }
  }
  return out;
}

// 2つの cue オフセットマップが構造的に等しいか（テーマの「未保存変更（dirty）」判定用）。
// マップ値はネストした {x,y} オブジェクトなので shallowEqualValues（primitive 前提・参照比較）
// では使えない。両者を sanitize で正規化してからキー集合と各 x/y を Object.is で比較する純関数。
// 比較前に正規化するので、壊れた入力やキー順の違いでは false にならない（同値なら true）。
export function equalCueOffsetMaps(a, b) {
  const na = sanitizeCueOffsets(a);
  const nb = sanitizeCueOffsets(b);
  const ak = Object.keys(na);
  if (ak.length !== Object.keys(nb).length) return false;
  for (const k of ak) {
    if (!hasOwn(nb, k)) return false;
    if (!Object.is(na[k].x, nb[k].x) || !Object.is(na[k].y, nb[k].y)) return false;
  }
  return true;
}

// 保存マップを返す。未保存・壊れ・読取不可は {}（無害に無効化＝全 cue 既定位置）。
export function loadCueOffsets(explicit) {
  try {
    const raw = window.localStorage.getItem(cueOffsetStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueOffsets(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueOffsets(map, explicit) {
  try {
    window.localStorage.setItem(cueOffsetStorageKey(explicit), JSON.stringify(sanitizeCueOffsets(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定位置に戻るだけ） */
  }
}

export function clearCueOffsets(explicit) {
  try {
    window.localStorage.removeItem(cueOffsetStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定位置に戻るだけ） */
  }
}

// ── fork:cue-text ── 演出（スタンプ）の cue 毎カスタム文字列 { [cueId]: string } ──
// cue の既定 stamp（例: 'こんにちは！'）を任意文字列で上書きする。:cueoffset と同じく
// ローカル限定・relay しない UI チューニング。ただし :cueoffset と違って【テーマのサイドカーには
// 載せない独立キー（:cuetext）】: 文字の上書きはテーマ apply/reset/export に追従しない（意図的）。
// 将来「サイドカー化して直そう」と誤解しないこと（ユーザー方針: テーマ非連携の単独保存）。
// 形は :cueoffset と同じく「ページ単位の単一マップ」。空文字・既定一致は保存しない（呼び出し側で削除）。
// 文字数は MAX_CUE_TEXT_LEN で上限を切る（cue-stamp は whiteSpace:nowrap で横溢れするため）。
export const MAX_CUE_TEXT_LEN = 24;

export function cueTextStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cuetext';
}

// 保存マップを { [cueId]: 非空文字列(<=MAX) } だけに正規化する純関数（DOM 非依存）。空 id・非文字列・
// trim 後に空の値は捨て、長すぎる値は MAX_CUE_TEXT_LEN で切る。壊れた入力でも安全なマップを返す。
// 注意: 「既定 stamp と一致したら捨てる」判定は default を知らないここでは行わない（commit 側で行う）。
export function sanitizeCueTexts(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    if (id && typeof v === 'string') {
      const s = v.trim().slice(0, MAX_CUE_TEXT_LEN);
      if (s) out[id] = s;
    }
  }
  return out;
}

// 保存マップを返す。未保存・壊れ・読取不可は {}（無害に無効化＝全 cue 既定文字）。
export function loadCueTexts(explicit) {
  try {
    const raw = window.localStorage.getItem(cueTextStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueTexts(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueTexts(map, explicit) {
  try {
    window.localStorage.setItem(cueTextStorageKey(explicit), JSON.stringify(sanitizeCueTexts(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定文字に戻るだけ） */
  }
}

export function clearCueTexts(explicit) {
  try {
    window.localStorage.removeItem(cueTextStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定文字に戻るだけ） */
  }
}

// ── fork:cue-color ── 演出（スタンプ）の cue 毎カスタム文字色 { [cueId]: '#rrggbb' } ──
// cue-stamp の既定文字色（赤 = DEFAULT_CUE_COLOR）を任意の色で上書きする。:cuetext と同じく
// ローカル限定・テーマ非連携の独立キー（:cuecolor）。既定（赤）一致は保存しない（呼び出し側で削除）。
export const DEFAULT_CUE_COLOR = '#ff0000';

export function cueColorStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cuecolor';
}

// 文字列を #rrggbb（小文字）に正規化する純関数。#rgb は #rrggbb へ展開する。
// 不正・非文字列は null（＝上書き無し＝既定色）。<input type="color"> は常に #rrggbb を返すが、
// 手編集した localStorage や relay 外の値に備えてここで検証する。
export function normalizeHexColor(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

// 保存マップを { [cueId]: '#rrggbb' } だけに正規化する純関数（DOM 非依存）。空 id・不正色は捨てる。
export function sanitizeCueColors(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    const c = normalizeHexColor(v);
    if (id && c) out[id] = c;
  }
  return out;
}

// 保存マップを返す。未保存・壊れ・読取不可は {}（無害に無効化＝全 cue 既定色）。
export function loadCueColors(explicit) {
  try {
    const raw = window.localStorage.getItem(cueColorStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueColors(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueColors(map, explicit) {
  try {
    window.localStorage.setItem(cueColorStorageKey(explicit), JSON.stringify(sanitizeCueColors(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定色に戻るだけ） */
  }
}

export function clearCueColors(explicit) {
  try {
    window.localStorage.removeItem(cueColorStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定色に戻るだけ） */
  }
}

// ── fork:cue-size ── 演出スタンプの cue 毎フォント倍率 { [cueId]: number } ──
// cue-stamp はアバター幅からフォントサイズを自動算出する。その算出値への倍率（既定 1.0）を cue 毎に持つ。
// :cuetext/:cuecolor と同型のローカル限定・テーマ非連携の独立キー（:cuesize）。既定 1.0 は保存しない。
export const DEFAULT_CUE_FONT_SCALE = 1;
export const MIN_CUE_FONT_SCALE = 0.3;
export const MAX_CUE_FONT_SCALE = 3;

// 倍率を [MIN,MAX] に収め、非有限は既定(1.0)へ正規化する純関数（DOM 非依存）。
export function clampCueFontScale(v) {
  return Number.isFinite(v) ? Math.min(MAX_CUE_FONT_SCALE, Math.max(MIN_CUE_FONT_SCALE, v)) : DEFAULT_CUE_FONT_SCALE;
}

export function cueSizeStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cuesize';
}

// 保存マップを { [cueId]: [MIN,MAX] の数値 } だけに正規化する純関数。空 id・非数値は捨てる。
export function sanitizeCueSizes(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    if (id && Number.isFinite(v)) out[id] = clampCueFontScale(v);
  }
  return out;
}

export function loadCueSizes(explicit) {
  try {
    const raw = window.localStorage.getItem(cueSizeStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueSizes(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueSizes(map, explicit) {
  try {
    window.localStorage.setItem(cueSizeStorageKey(explicit), JSON.stringify(sanitizeCueSizes(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定倍率に戻るだけ） */
  }
}

export function clearCueSizes(explicit) {
  try {
    window.localStorage.removeItem(cueSizeStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定倍率に戻るだけ） */
  }
}

// ── fork:cue-shadow ── 演出スタンプの cue 毎影色 { [cueId]: '#rrggbb' } ──
// cue-stamp の縁取り/影（既定 = DEFAULT_CUE_SHADOW_COLOR の濃茶）を任意色で上書きする。
// :cuecolor と同型（normalizeHexColor で検証）。既定色一致は保存しない。
export const DEFAULT_CUE_SHADOW_COLOR = '#3c3026';

export function cueShadowStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cueshadow';
}

export function sanitizeCueShadows(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    const c = normalizeHexColor(v);
    if (id && c) out[id] = c;
  }
  return out;
}

export function loadCueShadows(explicit) {
  try {
    const raw = window.localStorage.getItem(cueShadowStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueShadows(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueShadows(map, explicit) {
  try {
    window.localStorage.setItem(cueShadowStorageKey(explicit), JSON.stringify(sanitizeCueShadows(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定影色に戻るだけ） */
  }
}

export function clearCueShadows(explicit) {
  try {
    window.localStorage.removeItem(cueShadowStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定影色に戻るだけ） */
  }
}

// ── fork:cue-hold ── 演出スタンプの cue 毎表示時間 { [cueId]: ms } ──
// cue の既定表示時間（cue.holdMs、未指定は 1100）を上書き。:cuecolor 等と同型のローカル限定。
// 既定は cue 毎に異なるため、保存マップは「絶対 ms」を持ち、commit 側で既定一致なら削除する。
export const MIN_CUE_HOLD_MS = 200;
export const MAX_CUE_HOLD_MS = 6000;

// 表示時間を [MIN,MAX] ms に収め整数化する純関数。非有限は null（＝無効・上書きしない）。
export function clampCueHoldMs(v) {
  return Number.isFinite(v) ? Math.round(Math.min(MAX_CUE_HOLD_MS, Math.max(MIN_CUE_HOLD_MS, v))) : null;
}

export function cueHoldStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cuehold';
}

export function sanitizeCueHolds(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    const ms = clampCueHoldMs(v);
    if (id && ms != null) out[id] = ms;
  }
  return out;
}

export function loadCueHolds(explicit) {
  try {
    const raw = window.localStorage.getItem(cueHoldStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueHolds(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueHolds(map, explicit) {
  try {
    window.localStorage.setItem(cueHoldStorageKey(explicit), JSON.stringify(sanitizeCueHolds(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定表示時間に戻るだけ） */
  }
}

export function clearCueHolds(explicit) {
  try {
    window.localStorage.removeItem(cueHoldStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定表示時間に戻るだけ） */
  }
}

// ── fork:cue-anim ── 演出スタンプの cue 毎アニメ種別 { [cueId]: 'pop'|'rise'|'shake' } ──
// cue の既定 anim を上書き。既定は cue 毎に異なるため commit 側で既定一致なら削除する。
export const CUE_ANIMS = ['pop', 'rise', 'shake'];

// アニメ名を検証し正規化（許可外は null）。
export function normalizeCueAnim(s) {
  return CUE_ANIMS.includes(s) ? s : null;
}

export function cueAnimStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cueanim';
}

export function sanitizeCueAnims(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    const a = normalizeCueAnim(v);
    if (id && a) out[id] = a;
  }
  return out;
}

export function loadCueAnims(explicit) {
  try {
    const raw = window.localStorage.getItem(cueAnimStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueAnims(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueAnims(map, explicit) {
  try {
    window.localStorage.setItem(cueAnimStorageKey(explicit), JSON.stringify(sanitizeCueAnims(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定アニメに戻るだけ） */
  }
}

export function clearCueAnims(explicit) {
  try {
    window.localStorage.removeItem(cueAnimStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定アニメに戻るだけ） */
  }
}

// ── fork:cue-weight ── 演出スタンプの cue 毎フォント太さ { [cueId]: 100..900 } ──
// 既定の太さ（DEFAULT_CUE_FONT_WEIGHT=800）を上書き。100 刻みに丸める。
export const DEFAULT_CUE_FONT_WEIGHT = 800;
export const MIN_CUE_FONT_WEIGHT = 100;
export const MAX_CUE_FONT_WEIGHT = 900;

// 太さを [100,900] に収め 100 刻みへ丸める純関数。非有限は既定(800)。
export function clampCueFontWeight(v) {
  if (!Number.isFinite(v)) return DEFAULT_CUE_FONT_WEIGHT;
  return Math.min(MAX_CUE_FONT_WEIGHT, Math.max(MIN_CUE_FONT_WEIGHT, Math.round(v / 100) * 100));
}

export function cueWeightStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cueweight';
}

export function sanitizeCueWeights(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    if (id && Number.isFinite(v)) out[id] = clampCueFontWeight(v);
  }
  return out;
}

export function loadCueWeights(explicit) {
  try {
    const raw = window.localStorage.getItem(cueWeightStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueWeights(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueWeights(map, explicit) {
  try {
    window.localStorage.setItem(cueWeightStorageKey(explicit), JSON.stringify(sanitizeCueWeights(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定の太さに戻るだけ） */
  }
}

export function clearCueWeights(explicit) {
  try {
    window.localStorage.removeItem(cueWeightStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定の太さに戻るだけ） */
  }
}

// ── fork:cue-stroke ── 演出スタンプの cue 毎縁取り太さ { [cueId]: em } ──
// 既定の縁取り（DEFAULT_CUE_STROKE_EM=0.05em）を上書き。0〜0.2em。
export const DEFAULT_CUE_STROKE_EM = 0.05;
export const MIN_CUE_STROKE_EM = 0;
export const MAX_CUE_STROKE_EM = 0.2;

// 縁取り em 幅を [0,0.2] に収める純関数。非有限は既定(0.05)。
export function clampCueStroke(v) {
  if (!Number.isFinite(v)) return DEFAULT_CUE_STROKE_EM;
  return Math.min(MAX_CUE_STROKE_EM, Math.max(MIN_CUE_STROKE_EM, v));
}

export function cueStrokeStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':cuestroke';
}

export function sanitizeCueStrokes(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    if (id && Number.isFinite(v)) out[id] = clampCueStroke(v);
  }
  return out;
}

export function loadCueStrokes(explicit) {
  try {
    const raw = window.localStorage.getItem(cueStrokeStorageKey(explicit));
    if (!raw) return {};
    return sanitizeCueStrokes(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCueStrokes(map, explicit) {
  try {
    window.localStorage.setItem(cueStrokeStorageKey(explicit), JSON.stringify(sanitizeCueStrokes(map)));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定の縁取りに戻るだけ） */
  }
}

export function clearCueStrokes(explicit) {
  try {
    window.localStorage.removeItem(cueStrokeStorageKey(explicit));
  } catch {
    /* 読み書き不可でも無視（全 cue 既定の縁取りに戻るだけ） */
  }
}

// ── fork:cue-extra ── 追加の cue 毎カスタム（回転/表示位置/白フチ/発光/音量/効果音）──
// ここからは「単一値マップ { [cueId]: value }」を共通ファクトリで量産する（上の :cuetext 等と同じ
// localStorage 形式・ローカル限定・テーマ非連携）。値の検証だけ差し替えて boilerplate を抑える。
// 返り値: { key, sanitize, load, save, clear }。sanitizeOne(v) は正規化済み値か null を返す。
function makeCueValueMap(suffix, sanitizeOne) {
  const key = (explicit) => tweaksStorageKey(explicit) + suffix;
  const sanitize = (obj) => {
    if (!isPlainObject(obj)) return {};
    const out = {};
    for (const [id, v] of Object.entries(obj)) {
      const s = sanitizeOne(v);
      if (id && s != null) out[id] = s;
    }
    return out;
  };
  const load = (explicit) => {
    try {
      const raw = window.localStorage.getItem(key(explicit));
      return raw ? sanitize(JSON.parse(raw)) : {};
    } catch { return {}; }
  };
  const save = (map, explicit) => {
    try { window.localStorage.setItem(key(explicit), JSON.stringify(sanitize(map))); } catch { /* 容量超過/プライベートは諦め */ }
  };
  const clear = (explicit) => {
    try { window.localStorage.removeItem(key(explicit)); } catch { /* noop */ }
  };
  return { key, sanitize, load, save, clear };
}

// 回転（度・±45・既定0）。スタンプを傾ける。
export const MAX_CUE_ROTATION = 45;
export const DEFAULT_CUE_ROTATION = 0;
export const cueRotationStore = makeCueValueMap(':cuerot',
  (v) => (Number.isFinite(v) ? Math.max(-MAX_CUE_ROTATION, Math.min(MAX_CUE_ROTATION, v)) : null));

// 表示位置（'above'=頭の上 / 'over'=重ねる）。既定は cue.place。
export const cuePlaceStore = makeCueValueMap(':cueplace',
  (v) => (v === 'above' || v === 'over' ? v : null));

// 白フチ（テキストの白いハロー）の強さ（0..1・既定0.55）。
export const DEFAULT_CUE_HALO = 0.55;
export const cueHaloStore = makeCueValueMap(':cuehalo',
  (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null));

// 発光フラッシュ（アバターのグロー）の強さ（0..10・0=off）。既定は cue.effect?.glow。
export const MAX_CUE_GLOW = 10;
export const cueGlowStore = makeCueValueMap(':cueglow',
  (v) => (Number.isFinite(v) ? Math.max(0, Math.min(MAX_CUE_GLOW, v)) : null));

// 発光フラッシュの色（#rrggbb）。既定は cue.effect?.glowColor。
export const DEFAULT_CUE_GLOW_COLOR = '#9fd8ff';
export const cueGlowColorStore = makeCueValueMap(':cueglowcol',
  (v) => normalizeHexColor(v));

// 効果音の音量（0..3・既定1）。
export const MAX_CUE_GAIN = 3;
export const DEFAULT_CUE_GAIN = 1;
export const cueGainStore = makeCueValueMap(':cuegain',
  (v) => (Number.isFinite(v) ? Math.max(0, Math.min(MAX_CUE_GAIN, v)) : null));

// 効果音の差し替え（data:audio... の data URL）。ローカル限定（relay しない・サイズ上限あり）。
// localStorage 圧迫を避けるため上限を切る。超過や非 audio は捨てる。
export const MAX_CUE_SOUND_LEN = 262144; // 256KB
export const cueSoundStore = makeCueValueMap(':cuesound',
  (v) => (typeof v === 'string' && v.startsWith('data:audio') && v.length <= MAX_CUE_SOUND_LEN ? v : null));

// テーマ・エクスポート JSON のファイル名。形式は
// guruguru-avatar-tweaks-YYYY-MM-DD-HHMM.json（HHMM=時分）。Date を引数で
// 受ける純関数にして決定的にテストできるようにする。値はローカル時刻で組む。
export function tweaksExportFilename(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = p2(date.getMonth() + 1);
  const d = p2(date.getDate());
  const hhmm = p2(date.getHours()) + p2(date.getMinutes());
  return `guruguru-avatar-tweaks-${y}-${mo}-${d}-${hhmm}.json`;
}

// ── fork:per-file ── テーマ名をファイル名に安全化する純関数 ───────────────────
// 先頭末尾の空白と . を除去し、OS 禁止文字・空白・ハイフンを _ に置換する。60 文字
// に切り詰め、空になれば 'theme'。日本語名はそのまま残す。順序が重要（除去→置換）。
export function safeThemeName(name) {
  let s = String(name == null ? '' : name);
  // 先に前後の空白・. を除去する（置換で _ 化される前に削るため、順序が重要）。
  s = s.trim().replace(/^\.+|\.+$/g, '').trim();
  // OS 禁止文字・空白・ハイフンをまとめて _ に置換する（ファイル名として安全に）。
  s = s.replace(/[\\/:*?"<>| -]/g, '_');
  // 残った空白（連続含む）を _ に。禁止文字クラスとは別に確実に潰す。
  s = s.replace(/\s+/g, '_');
  // コードポイント単位で 60 に切る（サロゲートペア＝絵文字を途中で割らない）。
  s = [...s].slice(0, 60).join('');
  return s || 'theme';
}

// 単一テーマ書き出しのファイル名。形式は guruguru-avatar-theme-<安全化名>.json。
// 日付は付けない（中身がテーマ名で分かるため）。
export function themeExportFilename(name) {
  return `guruguru-avatar-theme-${safeThemeName(name)}.json`;
}
