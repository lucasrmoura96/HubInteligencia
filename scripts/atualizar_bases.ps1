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

# ---------------------------------------------------------
# Limpeza preventiva: mata processos Excel.exe orfaos
# (execucoes anteriores podem deixar Excel "fantasma" travando arquivos)
# ---------------------------------------------------------
$excelProcs = Get-Process -Name 'EXCEL' -ErrorAction SilentlyContinue
if ($excelProcs) {
    Write-Host "        Encontrei $($excelProcs.Count) processo(s) Excel rodando." -ForegroundColor Yellow
    Write-Host "        Encerrando antes de comecar (libera arquivos travados)..." -ForegroundColor Yellow
    $excelProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Pequena pausa para OneDrive terminar qualquer sync pendente
Start-Sleep -Milliseconds 800

# ---------------------------------------------------------
# Verifica locks (arquivos com handle aberto por outro processo)
# ---------------------------------------------------------
function Test-FileLock {
    param([string]$Path)
    try {
        $stream = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')
        $stream.Close()
        return $false
    } catch {
        return $true
    }
}

$travados = @()
foreach ($arq in $arquivos) {
    if (Test-FileLock $arq.FullName) {
        $travados += $arq.Name
    }
}

if ($travados.Count -gt 0) {
    Write-Host ""
    Write-Host "  [ERRO] Estes arquivos estao travados por outro processo:" -ForegroundColor Red
    foreach ($t in $travados) { Write-Host "         - $t" -ForegroundColor Red }
    Write-Host ""
    Write-Host "         Causas possiveis:" -ForegroundColor Yellow
    Write-Host "           1) Excel aberto manualmente (mesmo minimizado/segundo plano)" -ForegroundColor Yellow
    Write-Host "           2) OneDrive sincronizando agora (aguarde 30s e tente de novo)" -ForegroundColor Yellow
    Write-Host "           3) Antivirus escaneando o arquivo (aguarde alguns segundos)" -ForegroundColor Yellow
    exit 3
}

# ---------------------------------------------------------
# Inicia Excel em background
# ---------------------------------------------------------
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
        if ($nomeCurto.Length -gt 42) { $nomeCurto = $nomeCurto.Substring(0, 39) + '...' }
        $padded = $nomeCurto.PadRight(45)
        Write-Host "        > $padded" -NoNewline

        $tentativas = 0
        $sucesso = $false
        $ultimoErro = ''

        while (-not $sucesso -and $tentativas -lt 3) {
            $tentativas++
            try {
                # Open(filename, updateLinks=0, readOnly=$false, ...)
                $wb = $xl.Workbooks.Open($arq.FullName, 0, $false, [Type]::Missing, [Type]::Missing, [Type]::Missing, $true, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, $false)

                # Forca PowerQuery em modo sincrono
                foreach ($conn in $wb.Connections) {
                    try {
                        if ($conn.OLEDBConnection) { $conn.OLEDBConnection.BackgroundQuery = $false }
                        if ($conn.ODBCConnection)  { $conn.ODBCConnection.BackgroundQuery  = $false }
                    } catch {}
                }

                $wb.RefreshAll()
                Start-Sleep -Seconds 2
                $wb.Save()
                $wb.Close($false)
                $sucesso = $true
            } catch {
                $ultimoErro = $_.Exception.Message
                try { if ($wb) { $wb.Close($false) } } catch {}
                if ($tentativas -lt 3) {
                    Start-Sleep -Seconds 2
                }
            }
        }

        if ($sucesso) {
            Write-Host " [OK]" -ForegroundColor Green
            $ok++
        } else {
            Write-Host " [FALHOU]" -ForegroundColor Red
            $falhas += "$($arq.Name): $ultimoErro"
        }
    }
} finally {
    try { $xl.Quit() } catch {}
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
    [System.GC]::Collect() | Out-Null
    [System.GC]::WaitForPendingFinalizers() | Out-Null

    # Garante que nenhum Excel fica orfao depois
    Start-Sleep -Milliseconds 500
    Get-Process -Name 'EXCEL' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
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
