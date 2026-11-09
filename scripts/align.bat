@echo off
rem Re-time the lyrics from your SVP project. Usage: scripts\align.bat "D:\path\to\project.svp"
if "%~1"=="" (echo usage: scripts\align.bat "path\to\project.svp" & exit /b 1)
set "SVP=%~f1"
cd /d "%~dp0.."
if not exist "%SVP%" (echo SVP not found: %SVP% & exit /b 1)
set PYTHONIOENCODING=utf-8
python scripts\align_lyrics.py "%SVP%" lyrics\lyrics.txt src\data\lyrics.json
