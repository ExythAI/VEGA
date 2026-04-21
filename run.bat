@echo off
echo Stopping any previous VEGA instance on port 5014...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5014 " ^| findstr "LISTENING"') do (
    echo Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Starting VEGA...
echo.

dotnet run

echo.
pause
