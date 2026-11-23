<#
  Mengubah MongoDB (Windows Service) dari standalone menjadi replica set SATU NODE,
  supaya transaksi multi-dokumen bisa dipakai. Data yang ada TIDAK dipindah/dihapus.

  Jalankan di PowerShell "Run as Administrator", dari folder backend:
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-replica-set.ps1

  Langkah (aman dijalankan ulang):
    1. Backup mongod.cfg, lalu tambahkan blok replication (replSetName + oplogSizeMB)
    2. Restart service MongoDB (jika gagal: config dikembalikan dari backup)
    3. Inisialisasi replica set (scripts/init-replica-set.js)
    4. Tambahkan replicaSet=<nama> ke MONGO_URI di backend/.env
#>
param(
  [string]$ConfigPath = 'C:\Program Files\MongoDB\Server\8.0\bin\mongod.cfg',
  [string]$ServiceName = 'MongoDB',
  [string]$ReplSetName = 'rs0',
  [int]$OplogSizeMB = 1024,
  [int]$Port = 27017
)

$ErrorActionPreference = 'Stop'
$BackendDir = Split-Path -Parent $PSScriptRoot
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "    $msg" }
function Fail($msg) { Write-Host "`n[GAGAL] $msg" -ForegroundColor Red; exit 1 }

function Wait-Port([int]$p, [int]$seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try {
      $c = New-Object System.Net.Sockets.TcpClient
      $c.Connect('127.0.0.1', $p)
      $c.Close()
      return $true
    } catch { Start-Sleep -Seconds 1 }
  }
  return $false
}

# ---------- 0. Prasyarat ----------
Write-Step 'Memeriksa prasyarat'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail 'Script harus dijalankan sebagai Administrator (klik kanan PowerShell > Run as Administrator).' }
if (-not (Test-Path $ConfigPath)) { Fail "File config tidak ditemukan: $ConfigPath (pakai -ConfigPath <path>)" }
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Fail "Service '$ServiceName' tidak ditemukan (pakai -ServiceName <nama>)" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js tidak ditemukan di PATH.' }
if (-not (Test-Path (Join-Path $BackendDir 'node_modules\mongodb'))) { Fail 'node_modules backend belum terpasang. Jalankan: npm install (di folder backend).' }

$freeGB = [math]::Round((Get-PSDrive -Name ($ConfigPath.Substring(0, 1))).Free / 1GB, 1)
$needGB = [math]::Ceiling($OplogSizeMB / 1024) + 1
if ($freeGB -lt $needGB) { Fail "Ruang kosong drive hanya $freeGB GB; oplog butuh +/- $needGB GB." }
Write-Ok "Administrator, service '$ServiceName' ($($svc.Status)), ruang kosong $freeGB GB"

# ---------- 1. mongod.cfg ----------
Write-Step "Mengatur replication di $ConfigPath"
$cfg = [System.IO.File]::ReadAllText($ConfigPath)
$backup = $null

if ($cfg -match '(?m)^replication:') {
  if ($cfg -match "(?m)^\s+replSetName:\s*['""]?$ReplSetName['""]?\s*$") {
    Write-Ok "Blok replication dengan replSetName '$ReplSetName' sudah ada, tidak diubah"
  } else {
    Fail "mongod.cfg sudah punya blok 'replication:' dengan pengaturan lain. Periksa manual: $ConfigPath"
  }
} else {
  $backup = "$ConfigPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $ConfigPath $backup
  Write-Ok "Backup: $backup"

  $block = "`r`nreplication:`r`n  replSetName: $ReplSetName`r`n  oplogSizeMB: $OplogSizeMB`r`n"
  [System.IO.File]::WriteAllText($ConfigPath, $cfg.TrimEnd() + "`r`n" + $block, $Utf8NoBom)
  Write-Ok "Ditambahkan: replication.replSetName=$ReplSetName, oplogSizeMB=$OplogSizeMB"
}

# ---------- 2. Restart service ----------
Write-Step "Restart service $ServiceName"
try {
  Restart-Service -Name $ServiceName -Force
  if (-not (Wait-Port $Port 60)) { throw "Port $Port tidak merespons setelah 60 detik" }
  Write-Ok "Service berjalan, port $Port aktif"
} catch {
  Write-Host "    Restart gagal: $($_.Exception.Message)" -ForegroundColor Yellow
  if ($backup) {
    Copy-Item $backup $ConfigPath -Force
    Write-Host '    Config dikembalikan dari backup, mencoba menyalakan ulang service...' -ForegroundColor Yellow
    try { Restart-Service -Name $ServiceName -Force } catch { }
  }
  Fail 'Cek log mongod (lihat systemLog.path di mongod.cfg) untuk detail error.'
}

# ---------- 3. Inisialisasi replica set ----------
Write-Step 'Inisialisasi replica set'
$env:RS_HOST = "127.0.0.1:$Port"
$env:RS_NAME = $ReplSetName
Push-Location $BackendDir
try {
  & node 'scripts/init-replica-set.js'
  $initExit = $LASTEXITCODE
} finally { Pop-Location }
if ($initExit -ne 0) { Fail 'Inisialisasi replica set gagal (lihat pesan di atas).' }

# ---------- 4. MONGO_URI di .env ----------
Write-Step 'Memperbarui MONGO_URI di backend/.env'
$envPath = Join-Path $BackendDir '.env'
if (-not (Test-Path $envPath)) {
  Write-Host "    .env tidak ditemukan. Tambahkan manual: MONGO_URI=mongodb://localhost:$Port/<db>?replicaSet=$ReplSetName" -ForegroundColor Yellow
} else {
  $lines = [System.IO.File]::ReadAllLines($envPath)
  $changed = $false
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match '^\s*MONGO_URI\s*=\s*(.+?)\s*$') {
      $uri = $Matches[1].Trim('"', "'")
      if ($uri -match 'replicaSet=') {
        Write-Ok 'MONGO_URI sudah memakai replicaSet, tidak diubah'
      } else {
        $sep = if ($uri.Contains('?')) { '&' } else { '?' }
        $lines[$i] = "MONGO_URI=$uri$sep" + "replicaSet=$ReplSetName"
        $changed = $true
        Write-Ok "MONGO_URI ditambah '$sep" + "replicaSet=$ReplSetName' (hapus bagian itu untuk kembali ke semula)"
      }
    }
  }
  if ($changed) { [System.IO.File]::WriteAllLines($envPath, $lines, $Utf8NoBom) }
  elseif (-not ($lines -match '^\s*MONGO_URI\s*=')) { Write-Host '    MONGO_URI tidak ditemukan di .env' -ForegroundColor Yellow }
}

Write-Host "`nSelesai. Restart backend (npm run dev) - saat start akan tampil 'replica set: $ReplSetName'." -ForegroundColor Green
if ($backup) { Write-Host "Rollback: salin $backup ke $ConfigPath, Restart-Service $ServiceName, lalu hapus replicaSet=... dari MONGO_URI." }
