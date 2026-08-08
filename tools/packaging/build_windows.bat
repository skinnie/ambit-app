@echo off
REM Builds the standalone Windows .exe. Run this ON Windows - PyInstaller does not
REM cross-compile, so this cannot be run from Linux or Mac to produce a Windows build.
REM
REM Auto-detects Python and PyInstaller; installs PyInstaller into a local, throwaway venv
REM (tools\packaging\.build-venv) if it's missing, rather than touching any system Python.
REM If Python itself is missing, tries winget (built into Windows 10 1709+/11); if that's
REM not available either, opens the official download page instead.

setlocal
cd /d "%~dp0\..\.."

where python >nul 2>nul
if errorlevel 1 (
    echo Python 3 wasn't found on this system.
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Opening the Python download page - install it, then run this script again.
        start https://www.python.org/downloads/windows/
        exit /b 1
    ) else (
        echo Installing Python via winget - a system installer window may appear...
        winget install -e --id Python.Python.3.12
        echo.
        echo If that succeeded, close this window and run the script again from a NEW
        echo terminal, so it picks up the updated PATH.
        exit /b 1
    )
)

set VENV=tools\packaging\.build-venv
if not exist "%VENV%\Scripts\pyinstaller.exe" (
    echo Setting up a local build environment ^(one-time^) in %VENV% ...
    python -m venv "%VENV%"
    call "%VENV%\Scripts\pip" install --quiet --upgrade pip
    call "%VENV%\Scripts\pip" install --quiet pyinstaller
)

call "%VENV%\Scripts\pyinstaller" --clean --distpath dist\windows --workpath build\windows tools\packaging\workout_builder.spec
echo.
echo Done. The standalone app is at dist\windows\Ambit3 Workout Builder.exe
