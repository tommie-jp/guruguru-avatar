// フォーク固有の Vite 設定。本家 vite.config.js は素のまま保ち、ここを
// mergeConfig で合成する（vite.config.js 参照）。
//
// 集約しているもの:
//   - カメラ/トラッキング版のビルドエントリ（本家に無いページ）
//   - WSL 自動判定による server.host 既定（Windows 側 Chrome から到達可能に）
//   - VITE_HOST / VITE_NO_OPEN による明示上書き
//   - dev サーバのポート固定（strictPort）
//
// 新しいページを足すときは下の input に1行足すだけ。vite.config.js は触らない。
import { loadEnv } from 'vite';
import { resolve, basename } from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { VitePWA } from 'vite-plugin-pwa';
import relayWsPlugin from './vite-plugin-relay.mjs';
import { guruguruPwaManifest } from './pwa-manifest.js';

// ビルドされたコミットを一意に特定するための short SHA。
// CI(GitHub Actions)は checkout 済みなので git で取れる。取れない場合は
// 環境変数 GITHUB_SHA にフォールバックし、それも無ければ 'unknown'。
function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    const sha = process.env.GITHUB_SHA;
    return sha ? sha.slice(0, 7) : 'unknown';
  }
}

// WSL かどうかの判定。WSL では Windows 側ブラウザが WSL の eth0 IP 経由でしか
// 届かず、127.0.0.1 バインドだと到達できない。0.0.0.0 バインドが必須になる。
// ネイティブ Linux / mac は同一ホストの loopback で足りるので 127.0.0.1 のままでよい。
function isWSL() {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

export default function forkConfig({ command, mode }) {
  // WSL は自動判定して 0.0.0.0 バインドを既定にするため、通常 .env.local は不要。
  // 個人環境向けの明示上書き（git 管理外の .env.local）も引き続き最優先で効く:
  //   VITE_HOST=1    … 0.0.0.0 でリッスン（ヘッドレス/リモート閲覧などで明示したいとき）
  //   VITE_NO_OPEN=1 … 自動ブラウザオープンを無効化
  const env = loadEnv(mode, process.cwd(), '');

  // バージョン表示用。真実の源は package.json の version（semver）。
  // build 時のみ SHA / 日付を埋め込み、dev では 'dev' 表記にして区別する。
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
  );
  const isBuild = command === 'build';

  // ビルド情報（define の静的置換と version.json 出力で共有する）。
  const buildSha = isBuild ? gitShortSha() : 'dev';
  const buildDate = isBuild ? new Date().toISOString().slice(0, 10) : 'dev';

  // dev/preview サーバの固定ポート（strictPort）。下の server.port と公開オリジンで共有。
  const DEV_PORT = 5173;

  // アプリ内 QR（camera-app の「QRコード」）が指す、外部端末（iPhone 等）から到達できる
  // 公開オリジン。これを埋め込むと、PC を localhost で開いても iPhone(tx) 用の tailscale
  // URL を QR 化できる。優先順位:
  //   1) VITE_TX_PUBLIC_ORIGIN … 明示指定（例: https://wsl40.taild830ae.ts.net:5173）
  //   2) TLS 証明書ファイル名が FQDN（tailscale cert / mkcert）なら https://<FQDN>:5173
  //   3) どちらも無ければ空 … ブラウザ側で location.origin にフォールバック
  const txPublicOrigin = (() => {
    if (env.VITE_TX_PUBLIC_ORIGIN) return env.VITE_TX_PUBLIC_ORIGIN;
    if (env.VITE_TLS_CERT) {
      const name = basename(env.VITE_TLS_CERT).replace(/\.(crt|pem|cer|key)$/i, '');
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name)) return `https://${name}:${DEV_PORT}`;
    }
    return '';
  })();

  // PWA / base で共有する基準パス。build:local の VITE_BASE=/ も含め一箇所に集約し、
  // manifest の start_url / scope / icons[].src が base とズレないようにする。
  const pwaBase = env.VITE_BASE || (command === 'build' ? '/guruguru-avatar/' : '/');

  const config = {
    // dev/preview に WS 中継を同居させる（配信版と同じ「1プロセス・同一オリジン」）。
    // mergeConfig は plugins 配列を連結するので upstream の react() と共存する。
    // 既定は loopback 限定。RELAY_EXPOSE=1（shell or .env.local）で LAN 公開にオプトイン。
    plugins: [
      relayWsPlugin({ expose: env.RELAY_EXPOSE === '1' }),
      // index.html（カメラ版）をインストール可能な PWA にする。manifest / Service Worker /
      // 登録スクリプトを Vite ビルドに同梱する。WS 中継には介在しない（navigateFallback:null）。
      //
      // Electron 配布ビルド（VITE_NO_PWA=1、dist:win 系が設定）では PWA を丸ごと外す:
      // 内蔵サーバはローカルディスク配信なので SW キャッシュに利点が無く、CacheFirst(30日)が
      // アプリ更新後も旧アセットを見せ続ける害だけが残る（OBS CEF に入った SW は剥がしにくい）。
      ...(env.VITE_NO_PWA === '1' ? [] : [VitePWA({
        registerType: 'autoUpdate', // 新版は次回読込で静かに有効化（配信中にトーストを出さない）
        filename: 'sw.js',
        injectRegister: 'auto', // 各 HTML の <head> に登録スクリプトを注入（アプリ側コード不要）
        manifest: guruguruPwaManifest(pwaBase),
        workbox: {
          // app shell のみ precache。大容量の slices2 / slices2-sheets / mediapipe は除外し
          // runtimeCaching で扱う（precache を肥大させない／2MiB 超の黙殺・ビルドエラーを避ける）。
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          globIgnores: ['**/slices2/**', '**/slices2-sheets/**', '**/mediapipe/**'],
          // multi-page サイトなので SPA フォールバックは誤り（talk/guruguru/tracking を直に配信）。
          navigateFallback: null,
          // pixi/mediapipe の JS バンドルを precache に通すため上限を引き上げる（既定 2MiB）。
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // MediaPipe wasm/.task（数十MB）。precache せず初回アクセスで CacheFirst。
              urlPattern: ({ url }) =>
                url.pathname.includes('/mediapipe/')
                || url.pathname.endsWith('.wasm')
                || url.pathname.endsWith('.task'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'mediapipe-assets',
                cacheableResponse: { statuses: [0, 200] },
                expiration: {
                  maxEntries: 12,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                  purgeOnQuotaError: true, // iOS の quota 逼迫時に自己回復
                },
                rangeRequests: true,
              },
            },
            {
              // アバターのスライス画像（多数・大容量）。CacheFirst で runtime キャッシュ。
              urlPattern: ({ url }) =>
                url.pathname.includes('/slices2/')
                || url.pathname.includes('/slices2-sheets/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'avatar-slices',
                expiration: {
                  maxEntries: 2000,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                  purgeOnQuotaError: true,
                },
              },
            },
            {
              // Google Fonts のスタイルシート（fonts.googleapis.com）= StaleWhileRevalidate
              urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-stylesheets',
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Google Fonts の本体 woff2（fonts.gstatic.com）= CacheFirst・1年（opaque=status 0）
              urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                cacheableResponse: { statuses: [0, 200] },
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                  purgeOnQuotaError: true,
                },
              },
            },
          ],
        },
        // dev では SW を無効（必要なら true にして devOptions で検証）。
        devOptions: { enabled: false, type: 'module' },
      })]),
      // 配布物の同一性検証用マーカー。リリース E2E（windows/test-release-win11.ps1）が
      // GET /version.json でリリースタグとビルドの一致を確認する。
      {
        name: 'guruguru-version-json',
        apply: 'build',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ version: pkg.version, sha: buildSha, date: buildDate }),
          });
        },
      },
    ],
    // ビルド時に静的置換される定数。camera-app.jsx などから参照する。
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __GIT_SHA__: JSON.stringify(buildSha),
      __BUILD_DATE__: JSON.stringify(buildDate),
      __TX_PUBLIC_ORIGIN__: JSON.stringify(txPublicOrigin),
    },
    // fork: GitHub Pages のリポジトリ名（guruguru-avatar）に追従させる base。
    // 本家 vite.config.js は upstream と字面一致を保ちたいので、リネームに伴う
    // base 上書きはこの fork 側に集約する（mergeConfig で fork が勝つ）。
    // VITE_BASE があれば最優先（ローカル統合サーバ配信用に base '/' を流し込む。
    //   build:local: cross-env VITE_BASE=/ vite build --outDir dist-local
    // ＝ node server/relay.mjs --web-root dist-local がルート配信で動くようにする）。
    base: pwaBase,
    server: {
      port: DEV_PORT,
      strictPort: true,
      // npm run dev で開く既定ページ。トップ＝index.html（カメラ版/Pixi・複数アバター）。
      open: '/',
    },
    preview: {
      // npm run preview ではトップ index.html を開く（base /guruguru-avatar/ 込みの絶対パス）
      open: '/guruguru-avatar/',
    },
    build: {
      rollupOptions: {
        input: {
          index_old: resolve(import.meta.dirname, 'index_old.html'),
          // 旧 camera2.html は index.html へのリダイレクトとして残す（OGPキャッシュ/既存リンク対策）
          camera2: resolve(import.meta.dirname, 'camera2.html'),
          tracking: resolve(import.meta.dirname, 'tracking.html'),
        },
      },
    },
  };

  // WSL なら既定で全インターフェイスにバインド（Windows Chrome から到達可能に）。
  // ネイティブ環境では host を設定せず、upstream の 127.0.0.1 をそのまま活かす。
  if (isWSL()) config.server.host = true;

  // 明示フラグは常に最優先（従来互換。WSL 判定や upstream 既定より勝つ）。
  if (env.VITE_HOST === '1') config.server.host = true;
  if (env.VITE_NO_OPEN === '1') config.server.open = false;

  // doStartDev.sh の既定 --both モード用。vite は http のまま（WSL なら 0.0.0.0 のまま＝
  // Windows Chrome から localhost で届く）、別ポートの TLS プロキシ(server/dev-tls-proxy.mjs)
  // が tailscale から FQDN(Host) 付きで素通ししてくる。vite8 の host 検証は https のときだけ
  // 無効化されるため、http の本モードでは既定 allowedHosts=[] がこの FQDN をブロックしてしまう
  // （"Blocked request"）。そこで該当 FQDN だけを allowedHosts に足して通す（localhost / IP は
  // 既定で常に許可されるので PC ローカルには影響しない）。
  if (env.VITE_ALLOWED_HOST) {
    config.server.allowedHosts = [env.VITE_ALLOWED_HOST];
  }

  // iPhone Safari は secure context でないとカメラ(getUserMedia)が動かない。LAN の別端末
  // から開く tx モード用に、mkcert / `tailscale cert` の鍵を渡せば dev/preview を HTTPS 配信する:
  //   VITE_TLS_CERT=cert.pem VITE_TLS_KEY=key.pem npm run dev
  // 鍵未指定なら従来どおり http のまま（同一マシンの localhost 利用に影響しない）。
  if (env.VITE_TLS_CERT && env.VITE_TLS_KEY) {
    const https = {
      cert: readFileSync(env.VITE_TLS_CERT),
      key: readFileSync(env.VITE_TLS_KEY),
    };
    config.server.https = https;
    config.preview = { ...config.preview, https };
  }

  return config;
}
