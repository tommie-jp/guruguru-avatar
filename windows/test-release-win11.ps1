<#
.SYNOPSIS
  guruguru-avatar の最新 Windows リリース（Electron ポータブル exe）を実機 Windows 11 で
  End-to-End テストする。

.DESCRIPTION
  実際のユーザー手順をそのまま自動化して検証する:
    1. GitHub の「最新リリース」から *-portable.exe を取得し、ダウンロードフォルダへ保存する
    2. ポータブル exe を起動する（%TEMP% へ自己展開 → 子プロセス "Guruguru Avatar" が
       内蔵サーバ 127.0.0.1:5179 で待ち受ける）
    3. 送信側 ?tx / OBS 受信側 ?rx&obs が curl で 200 OK / HTML として取得できるか検証する
    4. GET /version.json でリリースタグとビルドのバージョン一致を検証する
    5. WS 中継 /__relay の tx→rx 1 フレーム疎通を検証する
    6. 後片付けでアプリを停止する（-KeepRunning を付けると起動したまま残す）

  ダウンロード由来の Mark-of-the-Web は Unblock-File で外し、SmartScreen による
  起動ブロックでテストが止まらないようにする。

  Electron 固有の注意（旧 zip 版 E2E からの変更点）:
  - ポータブルは二重プロセス構造。ランチャー（ダウンロードした exe）が %TEMP% へ展開し、
    子プロセス "Guruguru Avatar" を起動して待つ。停止は必ず「子 → ランチャー」の順
    （ランチャーを先に殺すと子がオーファン化してポートを握り続ける）。
  - 内蔵サーバは 5179 を優先し、使用中なら ephemeral ポートへフォールバックする。
    誤検証を防ぐため、事前に 5179 の空きを required とし、起動後は「5179 の所有 PID が
    ランチャーの子孫であること」を検証する（他人のサーバへの curl で偽 PASS しない）。
  - アプリは単一インスタンス。既存の "Guruguru Avatar" が居ると新規起動は既存窓の
    フォーカスに化けて旧バイナリを検証してしまうため、事前チェックで abort する。
    （デプロイ機＝常用機の場合、アプリ使用中は本テストを実行できない仕様）

.PARAMETER Repo
  対象リポジトリ owner/repo（既定: tommie-jp/guruguru-avatar）。

.PARAMETER Tag
  テストするリリースのタグ（例: win-v1.10.0）。指定すると releases/tags/<Tag> を使う。
  未指定なら releases/latest（最新リリース）。

.PARAMETER LocalExe
  開発モード: GitHub からダウンロードせず、指定したローカルの *-portable.exe を検証する。
  WSL のビルド成果物を直接指定できる（例:
  \\wsl.localhost\Ubuntu24.04\home\...\dist-electron\GuruguruAvatar-1.10.0-portable.exe）。

.PARAMETER TimeoutSec
  サーバ起動を待つ最大秒数（既定: 120）。初回はポータブルの %TEMP% 展開（約 160MB）と
  Defender の検疫スキャンで時間がかかる。

.PARAMETER KeepRunning
  検証後もアプリを停止せず、起動したままにする（手動で画面確認したいとき）。

.PARAMETER SkipDownload
  既にダウンロード済みの exe を使い、ダウンロードを省略する（サイズ一致時のみ）。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\test-release-win11.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\test-release-win11.ps1 -KeepRunning

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\test-release-win11.ps1 `
    -LocalExe '\\wsl.localhost\Ubuntu24.04\home\tommie\39-guruguru-avator\guruguru-avatar\dist-electron\GuruguruAvatar-1.10.0-portable.exe'

.NOTES
  - Windows 10/11 標準の curl.exe（C:\Windows\System32\curl.exe）を使用する。
    PowerShell の `curl` エイリアス（Invoke-WebRequest）ではない。
  - アプリの窓がテスト中に一瞬開く（カメラ許可はアプリが自オリジンへ自動付与）。
    合否は curl / WS の結果だけで判定する。
  - このファイルは UTF-8 (BOM 付き) で保存すること。BOM が無いと Windows PowerShell 5.1 が
    ANSI コードページで解釈し、日本語メッセージが文字化けする。
#>
[CmdletBinding()]
param(
  [string]$Repo = 'tommie-jp/guruguru-avatar',
  [string]$Tag = '',
  [string]$LocalExe = '',
  [int]$TimeoutSec = 120,
  [switch]$KeepRunning,
  [switch]$SkipDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# コンソール出力を UTF-8 に（… → ✅ ❌ や日本語が化けないように）。
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}
# 古い PowerShell でも GitHub への HTTPS が通るように TLS1.2 を明示。
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Info([string]$m) { Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "[OK]    $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[WARN]  $m" -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host "[FAIL]  $m" -ForegroundColor Red }

# ---- Electron アプリの既定値 ------------------------------------------------
$APP_PROCESS_NAME = 'Guruguru Avatar'          # 子プロセス（Electron 本体）のイメージ名
$APP_PORT         = 5179                       # 内蔵サーバの優先ポート（electron/main.mjs）
$UNPACK_DIR_NAME  = 'guruguru-avatar-portable' # portable.unpackDirName（%TEMP% 配下）

# ---- 状態変数（StrictMode 対策で先に初期化）-------------------------------
$launcher   = $null
$appPid     = $null
$serverUp   = $false
$allPass    = $false
$results    = @()
$base       = "http://127.0.0.1:$APP_PORT"
$wsBase     = "ws://127.0.0.1:$APP_PORT"

# ---- 小物ヘルパ -----------------------------------------------------------
function Get-PortOwnerPid([int]$p) {
  try {
    return (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop |
      Select-Object -First 1 -ExpandProperty OwningProcess)
  } catch { return $null }
}
function Get-PidName([int]$id) {
  try { return (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch { return $null }
}
# childPid が rootPid の子孫（親チェーン上に rootPid が居る）なら $true。
function Test-Descendant([int]$childPid, [int]$rootPid) {
  $cur = $childPid
  for ($i = 0; $i -lt 10 -and $cur; $i++) {
    if ($cur -eq $rootPid) { return $true }
    $row = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
    if (-not $row) { return $false }
    $cur = [int]$row.ParentProcessId
  }
  return $false
}

# ---- curl.exe を解決（PowerShell の curl エイリアスを避け、実体を使う）-----
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path -LiteralPath $curl)) {
  $cmd = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
  if ($cmd) { $curl = $cmd.Source }
  else { throw 'curl.exe が見つかりません（Windows 10/11 には標準搭載されています）。' }
}
Info "curl: $curl"

# ---- テスト対象の exe を決める（GitHub リリース or -LocalExe）--------------
$expectedVersion = ''   # version.json と突き合わせる期待バージョン（取れた場合のみ検証）
$exePath = $null

if ($LocalExe) {
  if (-not (Test-Path -LiteralPath $LocalExe)) { throw "-LocalExe が見つかりません: $LocalExe" }
  $exePath = (Get-Item -LiteralPath $LocalExe).FullName
  if ($exePath -match '(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-portable\.exe$') {
    $expectedVersion = $Matches[1]
  }
  Ok "ローカル exe を検証（開発モード）: $exePath"
} else {
  # ---- ダウンロードフォルダを解決 -----------------------------------------
  function Get-DownloadsDir {
    try {
      $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
      $name = '{374DE290-123F-4565-9164-39C4925E467B}'
      $val = (Get-ItemProperty -Path $key -Name $name -ErrorAction Stop).$name
      if ($val) { return [Environment]::ExpandEnvironmentVariables([string]$val) }
    } catch {}
    return (Join-Path $env:USERPROFILE 'Downloads')
  }
  $downloads = Get-DownloadsDir
  if (-not (Test-Path -LiteralPath $downloads)) {
    New-Item -ItemType Directory -Path $downloads -Force | Out-Null
  }
  Info "ダウンロードフォルダ: $downloads"

  # ---- リリースを特定（API エラーは分かりやすく案内）-----------------------
  if ($Tag) {
    $apiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Tag"
    Info "指定タグのリリースを問い合わせ: $apiUrl"
  } else {
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    Info "最新リリースを問い合わせ: $apiUrl"
  }
  $headers = @{ 'User-Agent' = 'guruguru-release-test'; 'Accept' = 'application/vnd.github+json' }
  if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }  # 任意（レート制限緩和）
  try {
    $rel = Invoke-RestMethod -Uri $apiUrl -Headers $headers
  } catch {
    $sc = $null
    try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
    $remaining = $null
    try { $remaining = $_.Exception.Response.Headers['X-RateLimit-Remaining'] } catch {}
    if ($sc -eq 403 -and "$remaining" -eq '0') {
      Fail 'GitHub API のレート制限に達しました（未認証は 60回/時）。環境変数 GITHUB_TOKEN に PAT を設定して再実行してください。'
    } elseif ($sc) {
      Fail "GitHub API がエラーを返しました (HTTP $sc)。リポジトリ名/公開状態を確認してください。"
    } else {
      Fail 'GitHub に到達できません（ネットワーク/DNS/プロキシ/TLS を確認してください）。'
    }
    throw
  }
  # タグ win-vX.Y.Z から期待バージョンを得る（version.json との一致検証に使う）。
  if ("$($rel.tag_name)" -match '^win-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$') {
    $expectedVersion = $Matches[1]
  }
  # ポータブル exe アセットを選ぶ（NSIS インストーラ側は選ばない）。
  $asset = $rel.assets | Where-Object { $_.name -like '*-portable.exe' } | Select-Object -First 1
  if (-not $asset) { throw "リリース $($rel.tag_name) にポータブル exe（*-portable.exe）が見つかりません。旧 zip 配布（win-v1.9.x 以前）は本スクリプトの対象外です。" }
  $sizeMB = [math]::Round($asset.size / 1MB, 1)
  Ok "リリース: $($rel.tag_name)  /  asset: $($asset.name)  (${sizeMB} MB)"

  # ---- ダウンロード（curl.exe で。リダイレクト追従 + リトライ）-------------
  $exePath = Join-Path $downloads $asset.name
  $needDownload = $true
  if ($SkipDownload -and (Test-Path -LiteralPath $exePath)) {
    $have = (Get-Item -LiteralPath $exePath).Length
    if ($have -eq $asset.size) {
      Info "既存 exe を再利用（-SkipDownload, サイズ一致）: $exePath"
      $needDownload = $false
    } else {
      Warn "既存 exe のサイズが不一致（$have != $($asset.size)）。破損とみなし再取得します。"
    }
  }
  if ($needDownload) {
    Info "ダウンロード中… $($asset.browser_download_url)"
    & $curl -L --fail --retry 3 --retry-delay 2 -o $exePath $asset.browser_download_url
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $exePath -Force -ErrorAction SilentlyContinue
      throw "ダウンロードに失敗しました (curl 終了コード $LASTEXITCODE)。"
    }
  }
  if (-not (Test-Path -LiteralPath $exePath)) { throw "exe が見つかりません: $exePath" }
  $exeBytes = (Get-Item -LiteralPath $exePath).Length
  if ($exeBytes -ne $asset.size) { throw "exe サイズ不一致: $exeBytes != $($asset.size)（ダウンロード破損）。" }
  Ok "保存: $exePath ($exeBytes bytes)"
  # SmartScreen でブロックされないよう Mark-of-the-Web を外す。
  Unblock-File -LiteralPath $exePath -ErrorAction SilentlyContinue
}

# ---- 事前チェック（偽 PASS 防止。満たせない場合は検証せず中断=exit 2）------
$already = @(Get-Process -Name $APP_PROCESS_NAME -ErrorAction SilentlyContinue)
if ($already.Count -gt 0) {
  Fail "既に $APP_PROCESS_NAME が動作中です (PID: $($already.Id -join ', '))。単一インスタンス制御により新規起動が既存窓のフォーカスに化け、旧バイナリを検証してしまうため中断します。アプリを終了してから再実行してください。"
  exit 2
}
$owner = Get-PortOwnerPid $APP_PORT
if ($owner) {
  Fail "ポート $APP_PORT は別プロセス（$(Get-PidName $owner), PID $owner）が使用中です。内蔵サーバが別ポートへ逃げて検証不能になるため中断します。占有プロセスを止めてから再実行してください。"
  exit 2
}

# ---- curl による単一エンドポイント検証 ------------------------------------
function Test-Endpoint([string]$label, [string]$url, [string]$bodyMarker = '') {
  $tmp = Join-Path $env:TEMP ('ggtest_' + [Guid]::NewGuid().ToString('N') + '.html')
  $meta = & $curl -s -o $tmp -w '%{http_code}|%{content_type}' --max-time 8 $url
  $parts = "$meta".Split('|')
  $code  = $parts[0]
  $ctype = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  $body  = if (Test-Path -LiteralPath $tmp) { Get-Content -Raw -LiteralPath $tmp -ErrorAction SilentlyContinue } else { '' }
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  $isHtml = ($body -imatch '<html' -or $body -imatch '<!doctype')
  $marker = if ($bodyMarker) { [bool]($body -imatch [regex]::Escape($bodyMarker)) } else { $true }
  [pscustomobject]@{
    Label       = $label
    Url         = $url
    Code        = $code
    ContentType = $ctype
    Pass        = (($code -eq '200') -and $isHtml -and $marker)
  }
}

# ---- WS 中継の tx→rx 1 フレーム疎通 ----------------------------------------
function Test-RelayRoundtrip([string]$wsRoot) {
  $rx = New-Object System.Net.WebSockets.ClientWebSocket
  $tx = New-Object System.Net.WebSockets.ClientWebSocket
  $ct = [System.Threading.CancellationToken]::None
  try {
    $t = $rx.ConnectAsync([Uri]"$wsRoot/__relay?role=rx", $ct)
    if (-not $t.Wait(5000)) { throw 'rx の WS 接続がタイムアウト' }
    $t = $tx.ConnectAsync([Uri]"$wsRoot/__relay?role=tx", $ct)
    if (-not $t.Wait(5000)) { throw 'tx の WS 接続がタイムアウト' }
    $payload = [System.Text.Encoding]::UTF8.GetBytes('{"type":"e2e-ping"}')
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $payload)
    $t = $tx.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct)
    if (-not $t.Wait(5000)) { throw 'tx の送信がタイムアウト' }
    $buf = New-Object byte[] 8192
    $rseg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $buf)
    # peer 通知など他のフレームは読み飛ばし、送った e2e-ping が届くことを確認する。
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline) {
      $rt = $rx.ReceiveAsync($rseg, $ct)
      if (-not $rt.Wait(5000)) { throw 'rx の受信がタイムアウト' }
      $text = [System.Text.Encoding]::UTF8.GetString($buf, 0, $rt.Result.Count)
      if ($text -match 'e2e-ping') { return $true }
    }
    throw 'e2e-ping フレームが rx に届きませんでした'
  } finally {
    foreach ($w in @($rx, $tx)) { try { $w.Dispose() } catch {} }
  }
}

$startedAt = Get-Date

try {
  # ---- ポータブル exe を起動 ------------------------------------------------
  Info 'ポータブル exe を起動します…（%TEMP% へ自己展開 → アプリ窓が開きます）'
  $launcher = Start-Process -FilePath $exePath -PassThru

  # ---- 起動待ち: 5179 の所有者が「今起動したランチャーの子孫」になるまで ----
  Info "サーバ起動を待機（最大 ${TimeoutSec}s。初回は展開+検疫スキャンで遅い）…"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ($launcher.HasExited) {
      Fail "ランチャーが起動直後に終了しました (exit=$($launcher.ExitCode))。SmartScreen/Defender のブロック、または既存インスタンスとの競合の可能性があります。"
      break
    }
    $ownerNow = Get-PortOwnerPid $APP_PORT
    if ($ownerNow) {
      $ownerName = Get-PidName $ownerNow
      if ($ownerName -ne $APP_PROCESS_NAME) {
        Fail "ポート $APP_PORT を握ったのは想定外のプロセスです: $ownerName (PID $ownerNow)"
        break
      }
      if (-not (Test-Descendant $ownerNow $launcher.Id)) {
        Fail "ポート $APP_PORT の所有者 (PID $ownerNow) が今起動したランチャー (PID $($launcher.Id)) の子孫ではありません。別インスタンスの可能性があるため FAIL とします。"
        break
      }
      $appPid = $ownerNow
      $serverUp = $true
      break
    }
    Start-Sleep -Milliseconds 700
  }

  if (-not $serverUp) {
    if (-not $launcher.HasExited) {
      Fail "タイムアウト: $base にサーバが立ち上がりませんでした（${TimeoutSec}s）。"
      Warn 'アプリ窓のタイトル「Guruguru Avatar — :ポート」を確認してください。5179 以外なら他プロセスとのポート競合です。'
    }
  } else {
    Ok "アプリ起動を確認: $APP_PROCESS_NAME (PID $appPid, launcher $($launcher.Id))"
    # ---- エンドポイント検証 -------------------------------------------------
    $results = @(
      (Test-Endpoint 'tx (送信側)'     "$base/index.html?tx" '<title'),
      (Test-Endpoint 'rx (OBS 受信側)' "$base/index.html?rx&obs" '<title')
    )
    # ---- version.json（配布物の同一性）--------------------------------------
    $verPass = $false
    $verGot = ''
    try {
      $verJson = & $curl -s --max-time 8 "$base/version.json" | ConvertFrom-Json
      $verGot = "$($verJson.version)"
      if ($expectedVersion) { $verPass = ($verGot -eq $expectedVersion) }
      else { $verPass = [bool]$verGot }  # 期待値不明時は「取得できること」まで
    } catch {
      Warn "version.json の取得に失敗: $($_.Exception.Message)"
    }
    $verLabel = if ($expectedVersion) { "version.json ($verGot == $expectedVersion)" } else { "version.json ($verGot)" }
    $results += [pscustomobject]@{ Label = $verLabel; Url = "$base/version.json"; Code = ''; ContentType = 'application/json'; Pass = $verPass }
    # ---- WS 中継疎通 ---------------------------------------------------------
    $wsPass = $false
    try {
      $wsPass = Test-RelayRoundtrip $wsBase
      Ok 'WS 中継: tx→rx の 1 フレーム疎通を確認'
    } catch {
      Warn "WS 中継の疎通に失敗: $($_.Exception.Message)"
    }
    $results += [pscustomobject]@{ Label = 'WS 中継 (tx→rx)'; Url = "$wsBase/__relay"; Code = ''; ContentType = ''; Pass = $wsPass }
  }
}
finally {
  if ($KeepRunning) {
    Warn '-KeepRunning 指定: アプリは起動したままにします（停止は窓を閉じてください）。'
  } else {
    Info 'アプリを停止します…（子 → ランチャーの順）'
    # 1) 子（Electron 本体）を先に止める。ランチャーが展開物を自己掃除して終了する。
    if ($appPid) { Stop-Process -Id $appPid -Force -ErrorAction SilentlyContinue }
    # 2) ランチャーの自然終了を待つ（自己掃除の完了を兼ねる）。
    if ($launcher) {
      $w = 0
      while (-not $launcher.HasExited -and $w -lt 15) { Start-Sleep -Seconds 1; $w++ }
      if (-not $launcher.HasExited) {
        Warn 'ランチャーが終了しないため強制停止します（%TEMP% に展開残骸が残る可能性）。'
        & taskkill /PID $launcher.Id /T /F 2>$null | Out-Null
      }
    }
    # 3) このテストが起動した後に現れた同名プロセスを掃除（事前チェックで 0 匹を保証済み）。
    Get-Process -Name $APP_PROCESS_NAME -ErrorAction SilentlyContinue |
      Where-Object { $_.StartTime -gt $startedAt } |
      ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    # 4) 展開ディレクトリの残骸を掃除（unpackDirName 固定なので安全に特定できる）。
    $unpackDir = Join-Path $env:TEMP $UNPACK_DIR_NAME
    if (Test-Path -LiteralPath $unpackDir) {
      Remove-Item -LiteralPath $unpackDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

# ---- 結果表示 -------------------------------------------------------------
Write-Host ''
Write-Host '==================== 検証結果 ====================' -ForegroundColor White
if ($results.Count -gt 0) {
  $results | Format-Table Label, Code, Pass -AutoSize | Out-String | Write-Host
  foreach ($r in $results) {
    if ($r.Pass) { Ok   "$($r.Label)" }
    else         { Fail "$($r.Label): $($r.Url) (Code=$($r.Code))" }
  }
  $allPass = (@($results | Where-Object { -not $_.Pass }).Count -eq 0)
} else {
  $allPass = $false
}

Write-Host ''
Info "exe      : $exePath"
Write-Host ''
if ($allPass) { Ok   '総合判定: PASS ✅  (tx / rx / version / WS 中継)' ; exit 0 }
else          { Fail '総合判定: FAIL ❌' ; exit 1 }
