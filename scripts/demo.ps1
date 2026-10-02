param(
  [int]$Port = 3217,
  [string]$DataDir = "data"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$db = Join-Path $DataDir "demo.sqlite"
Remove-Item -Force $db -ErrorAction SilentlyContinue

Write-Host "== Import unit square =="
node dist/cli.js import square examples/square.json --db $db

Write-Host "`n== Low cutoff 1: H1 is born and right-censored =="
node dist/cli.js analyze 1 --max-epsilon 1 --db $db
node dist/cli.js slice 1 1 --db $db

Write-Host "`n== Full cutoff sqrt(2): triangles fill H1 =="
node dist/cli.js analyze 1 --max-epsilon 1.4142135623730951 --db $db
node dist/cli.js barcodes 2 --db $db
node dist/cli.js slice 2 1.4142135623730951 --db $db

Write-Host "`n== Representative cycle GF(2) boundary and fill triangles =="
node dist/cli.js cycle 2 c,d --db $db

Write-Host "`n== CSV export =="
node dist/cli.js export 2 csv --db $db

Write-Host "`n== HTTP API smoke test =="
$env:PORT = "$Port"
$env:DATA_DIR = $DataDir
$process = Start-Process -FilePath node -ArgumentList "dist/index.js" -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    try { Invoke-RestMethod "http://localhost:$Port/health" | Out-Null; $ready = $true; break } catch {}
  }
  if (-not $ready) { throw "server did not start" }
  Invoke-RestMethod "http://localhost:$Port/clouds" | ConvertTo-Json -Depth 5
} finally {
  Stop-Process -Id $process.Id -Force
}
Write-Host "`nDemo complete. Database retained at $db. Previous analyses are never overwritten."
