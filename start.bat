@echo off
setlocal

:: Controlla se python è installato e versione >= 3.7
python --version >nul 2>&1
if errorlevel 1 (
    echo Python non trovato. Procedo con il download e installazione...
    set "PYTHON_INSTALLER=python-installer.exe"
    if not exist "%PYTHON_INSTALLER%" (
        echo Scarico Python 3.12...
        powershell -Command "Invoke-WebRequest -Uri https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe -OutFile %PYTHON_INSTALLER%"
    )
    echo Installazione Python in corso...
    start /wait "" "%PYTHON_INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1
    if errorlevel 1 (
        echo Errore durante l'installazione di Python.
        pause
        exit /b 1
    )
) else (
    echo Python trovato.
)

:: Aggiorna pip
python -m pip install --upgrade pip

:: Installa dipendenze
echo Installazione dipendenze Python...
python -m pip install flask flask-cors requests requests-cache waitress

:: Avvia il server
echo Avvio server...
start "" "http://127.0.0.1:5000"
python server.py

pause