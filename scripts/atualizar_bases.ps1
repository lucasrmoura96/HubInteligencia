# =========================================================
# HUB Agroadvance - Refresh automatico dos 4 xlsx
# Abre cada arquivo em background, atualiza PowerQuery (SharePoint),
# salva e fecha. Tudo invisivel para o usuario.
# =========================================================

$ErrorActionPreference = 'Stop'
$basesDir = Join-Path $PSScriptRoot '..\bases'

if (-not (Test-Path $basesDir)) {
    Write-Host "  [ERRO] Pasta 'bases/' nao encontrada em $basesDir" -ForegroundColor Red
    exit 1
}

$arquivos = Get-ChildItem -Path $basesDir -Filter '*.xlsx' | Sort-Object Name
if ($arquivos.Count -eq 0) {
    Write-Host "  [ERRO] Nenhum .xlsx encontrado em bases/" -ForegroundColor Red
    exit 1
}

# Inicia Excel em background (sem janela visivel)
$xl = $null
try {
    $xl = New-Object -ComObject Excel.Application
} catch {
    Write-Host "  [ERRO] Excel nao instalado ou COM nao disponivel." -ForegroundColor Red
    Write-Host "         Instale o Microsoft Excel para usar este script." -ForegroundColor Red
    exit 2
}

$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.AskToUpdateLinks = $false
$xl.EnableEvents = $false
$xl.ScreenUpdating = $false

$ok = 0
$falhas = @()

try {
    foreach ($arq in $arquivos) {
        $nomeCurto = $arq.Name
        # Trunca nome longo para alinhamento visual
        if ($nomeCurto.Length -gt 42) { $nomeCurto = $nomeCurto.Substring(0, 39) + '...' }
        $padded = $nomeCurto.PadRight(45)
        Write-Host "        > $padded" -NoNewline

        try {
            $wb = $xl.Workbooks.Open($arq.FullName, 0, $false)

            # Forca PowerQuery em modo sincrono (RefreshAll bloqueia ate terminar)
            foreach ($conn in $wb.Connections) {
                try {
                    if ($conn.OLEDBConnection) { $conn.OLEDBConnection.BackgroundQuery = $false }
                    if ($conn.ODBCConnection)  { $conn.ODBCConnection.BackgroundQuery  = $false }
                } catch {}
            }
            # Tambem desliga BackgroundQuery em Queries do PowerQuery (Excel 2016+)
            try {
                foreach ($q in $wb.Queries) {
                    # Algumas versoes nao expoem refresh sync por aqui; ignoramos
                }
            } catch {}

            $wb.RefreshAll()
            # Margem de seguranca apos refresh (PowerQuery pode levar 1-3s extras)
            Start-Sleep -Seconds 2
            $wb.Save()
            $wb.Close($false)

            Write-Host " [OK]" -ForegroundColor Green
            $ok++
        } catch {
            Write-Host " [FALHOU]" -ForegroundColor Red
            $falhas += "$($arq.Name): $($_.Exception.Message)"
            try { if ($wb) { $wb.Close($false) } } catch {}
        }
    }
} finally {
    try { $xl.Quit() } catch {}
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
    [System.GC]::Collect() | Out-Null
    [System.GC]::WaitForPendingFinalizers() | Out-Null
}

Write-Host ""
Write-Host "        ${ok}/$($arquivos.Count) bases atualizadas com sucesso."

if ($falhas.Count -gt 0) {
    Write-Host ""
    Write-Host "        Falhas:" -ForegroundColor Yellow
    foreach ($f in $falhas) { Write-Host "          - $f" -ForegroundColor Yellow }
    exit 1
}

exit 0
