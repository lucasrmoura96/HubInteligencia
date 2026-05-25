@echo off
setlocal enableextensions enabledelayedexpansion
chcp 65001 >nul
title HUB AGROADVANCE - Atualizar e publicar
set PYTHONIOENCODING=utf-8
color 0A
cls

echo.
echo  ============================================================
echo                HUB AGROADVANCE - Performance ^& MKT
echo                  Refresh bases - Pipeline - Deploy
echo  ============================================================
echo.

cd /d "%~dp0"

REM ============================================================
REM  [1/4] Refresh dos 4 xlsx via PowerShell (PowerQuery + SharePoint)
REM ============================================================
echo   [1/4]  Atualizando bases (PowerQuery -^> SharePoint)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\atualizar_bases.ps1"
if errorlevel 1 (
    echo.
    echo  ============================================================
    echo   [X] ERRO ao atualizar as bases.
    echo   Verifique se nenhum xlsx esta aberto no Excel e tente de novo.
    echo  ============================================================
    pause
    exit /b 1
)

REM ============================================================
REM  [2/4] Pipeline Python
REM ============================================================
echo.
echo   [2/4]  Processando bases (gerando JSON do painel)
echo.
python scripts\atualizar_painel.py
if errorlevel 1 (
    echo.
    echo  ============================================================
    echo   [X] ERRO no pipeline. Verifique a mensagem acima.
    echo   Dicas comuns:
    echo     - Algum xlsx ainda aberto? Feche e tente de novo.
    echo     - Coluna renomeada? A mensagem mostra qual.
    echo  ============================================================
    pause
    exit /b 1
)

REM ============================================================
REM  [3/4] Delta vs ultimo deploy
REM ============================================================
echo.
echo   [3/4]  Variacao desde o ultimo deploy:
echo.
python scripts\comparar_atualizacao.py
echo.

REM ============================================================
REM  [4/4] Git: commit + push (deploy GitHub Pages)
REM ============================================================
echo   [4/4]  Publicando no GitHub Pages
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo   [X] ERRO: este diretorio nao e um repositorio git.
    pause
    exit /b 1
)

git add hub/ scripts/ .gitignore *.md 2>nul

git diff --cached --quiet
if errorlevel 1 (
    for /f "tokens=1-3 delims=/ " %%a in ('echo %date%') do set DATA=%%a/%%b/%%c
    for /f "tokens=1-2 delims=:." %%a in ('echo %time%') do set HORA=%%a:%%b
    set MSG=chore: atualiza dados !DATA! !HORA!
    git commit -m "!MSG!" >nul
    if errorlevel 1 (
        echo   [X] ERRO ao commitar.
        pause
        exit /b 1
    )
    echo        [OK] Commit: !MSG!
) else (
    echo        [-]  Sem mudancas - dados ja estao iguais ao ultimo deploy.
)

git push origin main >nul 2>&1
if errorlevel 1 (
    echo   [X] ERRO no push. Verifique sua autenticacao git (PAT/SSH).
    pause
    exit /b 1
)
echo        [OK] Push para origin/main

REM ============================================================
REM  FIM
REM ============================================================
echo.
echo  ============================================================
echo   [OK]  SUCESSO - Painel atualizado e publicado
echo  ============================================================
echo.
echo    Acesse:
echo    https://lucasrmoura96.github.io/HubInteligencia/hub/
echo.
echo    (Cache do GitHub Pages atualiza em 30-60s)
echo  ============================================================
echo.
pause
