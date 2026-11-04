@echo off
title DECK 26 - Inicializador de Ambiente Local (Windows 11)

echo ============================================================================
echo   DECK 26 - SISTEMA DE GESTAO INTEGRADA (BAR, RESTAURANTE E HOTEL MILLA)
echo   Ambiente de Desenvolvimento e Testes Locais (Windows 11)
echo ============================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] O Node.js nao foi encontrado no seu computador.
    echo Por favor, instale o Node.js 22+ antes de iniciar o sistema.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js detectado: %NODE_VER% - Suporte nativo a node:sqlite ativo.

if not exist "node_modules\" (
    echo [AVISO] A pasta node_modules nao foi encontrada. Instalando pacotes locais...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependencias do projeto.
        pause
        exit /b 1
    )
) else (
    echo [OK] Dependencias locais verificadas com sucesso.
)

echo.
echo Verificando portas locais 4000, 4100, 5173 e 5174...
for %%p in (4000 4100 5173 5174) do (
    netstat -ano | findstr /R /C:":%%p .*LISTENING" >nul
    if not errorlevel 1 (
        echo [AVISO] A porta %%p ja esta em uso neste computador.
    ) else (
        echo [LIVRE] Porta %%p disponivel.
    )
)

echo.
echo ============================================================================
echo   URLS DE ACESSO LOCAL - ABRA NO SEU NAVEGADOR:
echo ----------------------------------------------------------------------------
echo   1. Programa Principal - Dashboard, Caixa, Mesas, Hotel:
echo      http://localhost:5173
echo.
echo   2. Tela Exclusiva da Cozinha / Chapa - KDS:
echo      http://localhost:5173/?terminal=cozinha
echo.
echo   3. Tela de Lancamento de Garcom:
echo      http://localhost:5173/?terminal=garcom
echo.
echo   4. Site Publico - Cardapio Digital QR Code, Delivery e Painel do Dono:
echo      http://localhost:5174
echo.
echo   PINs Operacionais de Teste:
echo   Proprietario: 2626 / Gerente: 1010 / Caixa: 2020 / Garcom: 3030 / Cozinha: 4040
echo ============================================================================
echo.
echo Iniciando todos os servicos do DECK 26... Pressione Ctrl+C para encerrar.
echo.

call npm run dev:all
