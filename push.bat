@echo off
setlocal enabledelayedexpansion

echo ============================================
echo  chemistry_equalation - GitHub Upload Script
echo  Target repo: https://github.com/ramalok3846/chemistry_equalation
echo ============================================
echo.

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] git is not installed.
    echo Please install it from https://git-scm.com/download/win and run this again.
    pause
    exit /b 1
)

if not exist ".git" (
    echo [1/6] Initializing git repository...
    git init
    git branch -M main
) else (
    echo [1/6] Using existing git repository.
)

echo [1b/6] Checking git user identity for this repo...
git config user.email >nul 2>nul
if errorlevel 1 (
    git config user.email "ramalok3846@users.noreply.github.com"
    git config user.name "ramalok3846"
    echo   -^> Local git identity set: ramalok3846 ^<ramalok3846@users.noreply.github.com^>
) else (
    echo   -^> git identity already set for this repo.
)

echo [2/6] Checking remote "origin"...
git remote get-url origin >nul 2>nul
if errorlevel 1 (
    git remote add origin https://github.com/ramalok3846/chemistry_equalation.git
    echo   -^> origin added: https://github.com/ramalok3846/chemistry_equalation.git
) else (
    echo   -^> origin already set
)

echo [3/6] Staging changed files...
git add -A

echo [4/6] Enter a commit message (press Enter to use the default):
set /p COMMITMSG=">> "
if "%COMMITMSG%"=="" set COMMITMSG=Update chemistry equilibrium simulator

git commit -m "%COMMITMSG%"
if errorlevel 1 (
    echo   -^> Nothing to commit, or commit failed. Continuing anyway.
)

echo [5/6] Switching to main branch...
git branch -M main

git rev-parse HEAD >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERROR] There is no commit to push yet. This usually means the commit
    echo         step above failed. Scroll up to check for an error message,
    echo         then run this script again.
    echo.
    pause
    exit /b 1
)

echo [6/6] Pushing to GitHub... (a login window may appear the first time)
git push -u origin main

if errorlevel 1 (
    echo.
    echo [NOTICE] The push may have been rejected. If the remote repo already has
    echo          different content, you may need to force it to match ^(this will
    echo          OVERWRITE the remote content^):
    echo          git push -u origin main --force
    echo.
) else (
    echo.
    echo ============================================
    echo  Upload complete! https://github.com/ramalok3846/chemistry_equalation
    echo ============================================
)

echo.
pause