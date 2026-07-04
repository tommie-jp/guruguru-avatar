# ============================================================
#  guruguru-relay.exe を生成する（Bun = bun build --compile）。
#  Windows 単体で「Bun ランタイム同梱の単体 exe」を作る経路。
#  ※ WSL/Linux/macOS が使えるなら `npm run build:relay` が win/linux/macOS の
#     3 つを 1 台からクロスコンパイルするので、そちらが手軽
#     （./doBuild.sh は Electron アプリのビルダーに変わったため対象外）。
#  ★ このスクリプトはプロジェクト一式（package.json / server\ / node_modules）が
#     必要。guruguru-avatar\windows\build-exe.ps1 に置いた状態で実行する。
#     .ps1 だけを Downloads 等にコピーしても動かない（先に git clone / コピーが必要）。
#
#  実行: PowerShell で
#    cd <...>\guruguru-avatar
#    powershell -ExecutionPolicy Bypass -File windows\build-exe.ps1
#
#  出力: dist-exe\guruguru-relay.exe / dist-exe\dist-local\ / dist-exe\start.bat
#        → dist-exe\ を丸ごと配布すれば、配布先に Node も Bun も不要で動く。
# ============================================================
$ErrorActionPreference = 'Stop'

# プロジェクト直下（package.json と server\relay.mjs がある場所）を探す。
# 候補: スクリプトの一つ上 → スクリプトのある場所 → 現在地。
function Find-ProjectRoot {
  $candidates = @(
    (Join-Path $PSScriptRoot '..'),
    $PSScriptRoot,
    (Get-Location).Path
  )
  foreach ($c in $candidates) {
    if (-not $c) { continue }
    $p = (Resolve-Path $c -ErrorAction SilentlyContinue)
    if ($p -and
        (Test-Path (Join-Path $p.Path 'package.json')) -and
        (Test-Path (Join-Path $p.Path 'server\relay.mjs'))) {
      return $p.Path
    }
  }
  return $null
}

$root = Find-ProjectRoot
if (-not $root) {
  Write-Host ''
  Write-Host '[エラー] プロジェクトが見つかりません。' -ForegroundColor Red
  Write-Host '  build-exe.ps1 は guruguru-avatar\windows\ に置き、プロジェクト一式'
  Write-Host '  （package.json / server\ / node_modules）がある状態で実行してください。'
  Write-Host '  .ps1 だけを Downloads 等に置いても動きません。先に次のどちらかを:'
  Write-Host '    1) git clone https://github.com/tommie-jp/guruguru-avatar'
  Write-Host '    2) WSL 等からプロジェクトを丸ごとコピー'
  Write-Host '  そのうえで guruguru-avatar 直下で windows\build-exe.ps1 を実行。'
  Write-Host ''
  exit 1
}
Set-Location $root
Write-Host "[info] プロジェクト直下: $root"

$exe = 'dist-exe\guruguru-relay.exe'

# bun を解決（PATH → %USERPROFILE%\.bun\bin → 自動インストール）。
function Resolve-Bun {
  $c = Get-Command bun -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $local = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
  if (Test-Path $local) { return $local }
  Write-Host '[0/4] bun が無いのでインストールします (bun.sh)...'
  powershell -NoProfile -Command "irm bun.sh/install.ps1 | iex"
  if (Test-Path $local) { return $local }
  throw 'bun のインストールに失敗しました。https://bun.sh を参照してください。'
}
$bun = Resolve-Bun
Write-Host "[info] bun: $bun"

if (-not (Test-Path 'node_modules')) {
  Write-Host '[1/4] 依存をインストール (npm install) ...'
  npm install
}

Write-Host '[2/4] 静的配信物をビルド (dist-local) ...'
npm run build:local

Write-Host '[3/4] リレイサーバを単一 exe にコンパイル (bun --compile) ...'
New-Item -ItemType Directory -Force -Path 'dist-exe' | Out-Null
& $bun build --compile --minify --target=bun-windows-x64 server\relay.mjs --outfile $exe
if (-not (Test-Path $exe)) { throw "exe の生成に失敗しました: $exe" }
$size = (Get-Item $exe).Length
if ($size -lt 20000000) { throw "exe が小さすぎます（size=$size）。ビルド失敗。" }
Write-Host "  OK $exe (size=$size)"

Write-Host '[4/4] 配布フォルダを組み立て ...'
if (Test-Path 'dist-exe\dist-local') { Remove-Item -Recurse -Force 'dist-exe\dist-local' }
Copy-Item -Recurse -Force 'dist-local' 'dist-exe\dist-local'

# 配布用 start.bat（exe の隣で実行する想定・全 ASCII で BOM なし）
$startBat = @'
@echo off
cd /d "%~dp0"
start "guruguru-relay" /min guruguru-relay.exe --web-root dist-local --port 8787 --host 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/?tx"
echo.
echo  tx (send) : http://127.0.0.1:8787/?tx
echo  rx (OBS)  : http://127.0.0.1:8787/?rx
echo.
pause
'@
Set-Content -Path 'dist-exe\start.bat' -Value $startBat -Encoding ascii

Write-Host ''
Write-Host '完成: dist-exe\ を丸ごと配布してください。'
Write-Host '  - guruguru-relay.exe / dist-local\ / start.bat'
Write-Host '  - 配布先での起動: start.bat をダブルクリック（Node も Bun も不要）'
