# InboxEye — Exporta ejecuciones YA realizadas; no crea corridas ni llama a Anthropic.
# Ejecutar desde la raiz del repositorio, con npm run dev:api activo.
param(
    [string]$ApiBase = 'http://127.0.0.1:3001',
    [string]$OutputDir = '.\demo-backups'
)
$ErrorActionPreference = 'Stop'
$base = $ApiBase.TrimEnd('/')
try {
    $runs = @(Invoke-RestMethod -Uri "$base/runs" -Method Get -TimeoutSec 8)
} catch {
    Write-Error "No pude consultar $base/runs. Verifica que el backend este iniciado. Detalle: $_"
    exit 1
}
$completed = @($runs | Where-Object { $_.status -ne 'PROCESSING' })
if ($completed.Count -eq 0) {
    Write-Warning 'No hay corridas finalizadas para exportar. Procesa algunos correos antes de ejecutar este script.'
    exit 0
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$filename = Join-Path $OutputDir "inboxeye_runs_$stamp.json"
# Se exporta la salida de la API, no archivos .env ni claves.
ConvertTo-Json -InputObject $completed -Depth 70 | Set-Content -Path $filename -Encoding utf8
Write-Host "Guardadas $($completed.Count) corridas en: $filename" -ForegroundColor Green
Write-Host 'Se pueden abrir offline desde InboxEye_Replay_Offline.html. El archivo no reproduce ni ejecuta herramientas.'
