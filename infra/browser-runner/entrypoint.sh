#!/bin/sh
set -eu

: "${BROWSER_GATEWAY_SECRET:?BROWSER_GATEWAY_SECRET is required}"
: "${BROWSER_ALLOWED_ORIGINS:?BROWSER_ALLOWED_ORIGINS is required}"

Xvfb "${DISPLAY:-:99}" -screen 0 1440x900x24 -nolisten tcp &
display_number=$(printf '%s' "${DISPLAY:-:99}" | sed 's/^://; s/\..*$//')
display_socket="/tmp/.X11-unix/X${display_number}"
attempt=0
until [ -S "$display_socket" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 50 ]; then
    echo "Xvfb did not create ${display_socket}" >&2
    exit 1
  fi
  sleep 0.1
done
x11vnc -display "${DISPLAY:-:99}" -localhost -forever -shared -nopw -rfbport "${BROWSER_VNC_PORT:-5900}" &

exec node /app/apps/browser-gateway/dist/server.js
