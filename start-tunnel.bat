@echo off
REM Cloudflare Tunnel starter for PodFluent.
REM Configure %USERPROFILE%\.cloudflared\config.yml before running this file.

echo Starting PodFluent Cloudflare Tunnel...
echo.
echo Set PODFLUENT_TUNNEL_NAME to override the default tunnel name.
echo.
echo Press Ctrl+C to stop the tunnel.
echo.

if "%PODFLUENT_TUNNEL_NAME%"=="" (
  cloudflared tunnel run podfluent
) else (
  cloudflared tunnel run "%PODFLUENT_TUNNEL_NAME%"
)
