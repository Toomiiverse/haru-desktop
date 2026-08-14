@echo off
REM Starts Haru's speech-to-text server on 127.0.0.1:9881.
REM
REM It borrows the Python that GPT-SoVITS bundles, which already has
REM faster-whisper and a CUDA torch in it. Point HARU_PYTHON somewhere else if
REM that install ever moves.
REM
REM PYTHONUTF8 for the same reason as the voice server: without it Python on
REM Windows gives stdout a cp1252 encoding and a non-ASCII character anywhere in
REM a transcript raises mid-request.
REM
REM Close this window to stop it.

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

if not defined HARU_PYTHON set "HARU_PYTHON=C:\GPT-SoVITS\GPT-SoVITS-v2pro-20250604\runtime\python.exe"

if not exist "%HARU_PYTHON%" (
  echo Could not find Python at "%HARU_PYTHON%".
  echo Set HARU_PYTHON to the python.exe of a install that has faster-whisper.
  pause
  exit /b 1
)

cd /d "%~dp0"

title Haru speech-to-text (faster-whisper)
"%HARU_PYTHON%" asr-server.py

echo.
echo The speech-to-text server stopped. Exit code %ERRORLEVEL%.
pause
