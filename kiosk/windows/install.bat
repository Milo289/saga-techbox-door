@echo off
rem Door screen installer for Windows: starts the door screen full screen every time you log in.
setlocal
echo.
echo  Door screen setup
echo  -----------------
echo  Where does the door server run?
echo    - On this PC (Docker Desktop):  just press Enter
echo    - On another computer:          type its address, e.g. http://192.168.1.50:8080
echo.
set "URL="
set /p URL=Server address: 
if "%URL%"=="" set "URL=http://localhost:8080"

set "DEST=%USERPROFILE%\DoorScreen"
mkdir "%DEST%" 2>nul
copy /y "%~dp0door-screen.bat" "%DEST%\door-screen.bat" >nul
> "%DEST%\door-url.txt" echo %URL%

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\Door screen.bat" echo @start "" /min "%DEST%\door-screen.bat"

rem keep the monitor and PC awake while plugged in
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0

echo.
echo  Done. The door screen starts now and after every login.
echo  Closing it makes it reopen. To stop it: close the minimised "door-screen" window first, then Alt+F4.
echo  To remove it: delete "Door screen.bat" from your Startup folder.
echo  Tip: turn on automatic sign-in (Win+R, netplwiz) so it also starts after a power cut.
echo.
start "" /min "%DEST%\door-screen.bat"
pause
