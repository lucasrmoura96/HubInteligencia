@echo off
setlocal enableextensions enabledelayedexpansion
chcp 65001 >nul
title HUB AGROADVANCE - Atualizar e publicar
set PYTHONIOENCODING=utf-8

echo.
echo ============================================================
echo   HUB AGROADVANCE - Atualizar e publicar no GitHub
echo ============================================================
echo.

cd /d "%~dp0"

REM ========================================================
REM 1) PIPELINE — processa os 4 xlsx e gera JSON
REM ========================================================
echo [1/3] Processando bases (Atividades, Negocios, Investimento, RD)...
echo.
python scripts\atualizar_painel.py
if errorlevel 1 (
    echo.
    echo ============================================================
    echo   ERRO no pipeline. Verifique a mensagem acima.
    echo   Dicas comuns:
    echo     - Algum xlsx ainda aberto no Excel? Feche e tente de novo.
    echo     - Coluna renomeada? A mensagem mostra qual.
    echo ============================================================
    pause
    exit /b 1
)

REM ========================================================
REM 2) GIT — add/commit/push (deploy via GitHub Pages)
REM ========================================================
echo.
echo [2/3] Publicando no GitHub...
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo   ERRO: este diretorio nao e um repositorio git.
    echo         Rode primeiro: git init -b main + remote add origin ^<url^>
    pause
    exit /b 1
)

git add hub/ scripts/ .gitignore *.md 2>nul

REM Detecta se ha algo pra commitar
git diff --cached --quiet
if errorlevel 1 (
    REM Ha mudancas — commita
    for /f "tokens=1-3 delims=/ " %%a in ('echo %date%') do set DATA=%%a/%%b/%%c
    for /f "tokens=1-2 delims=:." %%a in ('echo %time%') do set HORA=%%a:%%b
    set MSG=chore: atualiza dados !DATA! !HORA!
    echo   Commit: !MSG!
    git commit -m "!MSG!"
    if errorlevel 1 (
        echo   ERRO ao commitar. Verifique a mensagem acima.
        pause
        exit /b 1
    )
) else (
    echo   Sem mudancas para commitar - dados ja estao iguais ao ultimo deploy.
)

echo.
echo   Enviando para o GitHub...
git push origin main
if errorlevel 1 (
    echo   ERRO no push. Possiveis causas:
    echo     - Sem autenticacao git configurada (PAT ou SSH)
    echo     - Branch remoto divergente — faca 'git pull' manualmente
    pause
    exit /b 1
)

REM ========================================================
REM 3) FIM — mostra link do GitHub Pages
REM ========================================================
echo.
echo ============================================================
echo   SUCESSO! Painel atualizado e publicado.
echo ============================================================
echo.
echo   Acesse o HUB online em:
echo     https://lucasrmoura96.github.io/HubInteligencia/hub/
echo.
echo   (Pode levar 30-60s para o GitHub Pages atualizar o cache)
echo ============================================================
echo.
pause
