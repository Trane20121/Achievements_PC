@echo off
setlocal enabledelayedexpansion

:: Forza il percorso sulla cartella del batch (risolve errori UNC/Rete)
pushd "%~dp0"

:: 1. Controllo se Python è già installato
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Python non trovato.
    
    :: 2. Controllo se Winget è presente
    winget --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo [INFO] Winget non trovato. Installazione tramite PowerShell...
        
        :: Esecuzione logica basata sulla soluzione di Vladan (StackOverflow)
        powershell -Command "$progressPreference = 'silentlyContinue'; $URL = (Invoke-WebRequest -Uri 'https://api.github.com/repos/microsoft/winget-cli/releases/latest').Content | ConvertFrom-Json | Select-Object -ExpandProperty 'assets' | Where-Object 'browser_download_url' -Match '.msixbundle' | Select-Object -ExpandProperty 'browser_download_url'; Write-Host 'Scaricamento Winget...'; Invoke-WebRequest -Uri $URL -OutFile 'Setup.msix' -UseBasicParsing; Write-Host 'Installazione...'; Add-AppxPackage -Path 'Setup.msix'; Remove-Item 'Setup.msix'"
        
        if !errorlevel! neq 0 (
            echo [ERRORE] L'installazione di Winget e fallita.
            pause
            exit /b 1
        )
        echo [OK] Winget installato correttamente.
    )

    :: 3. Installazione Python tramite Winget
    echo [INFO] Installazione Python 3.12...
    winget install --id Python.Python.3.12 --exact --silent --accept-source-agreements --accept-package-agreements
    
    :: Ricarica il PATH per vedere subito Python
    call :REFRESH_PATH
) else (
    echo [OK] Python e gia installato.
)

:: 4. Installazione dipendenze
echo [INFO] Aggiornamento pip e installazione librerie...
python -m pip install --upgrade pip
python -m pip install flask flask-cors requests requests-cache waitress

:: 5. Avvio server
if exist server.py (
    echo [OK] Avvio server in corso...
    python server.py
) else (
    echo [ERRORE] File server.py non trovato.
)

pause
popd
goto :eof

:: Funzione per aggiornare le variabili d'ambiente nella sessione corrente
:REFRESH_PATH
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USERPATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKLM\System\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYSPATH=%%b"
set "PATH=%USERPATH%;%SYSPATH%"
goto :eof