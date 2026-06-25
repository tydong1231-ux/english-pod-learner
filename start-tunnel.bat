@echo off
REM Cloudflare Tunnel starter for PodFluent.
REM Configure %USERPROFILE%\.cloudflared\config.yml before running this file.

echo Starting PodFluent Cloudflare Tunnel...
echo.
echo Frontend: https://podcast.botly.cn
echo Backend API: https://api.botly.cn
echo.
echo Press Ctrl+C to stop the tunnel.
echo.

cloudflared tunnel run podfluent
