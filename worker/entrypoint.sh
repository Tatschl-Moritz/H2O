#!/bin/sh
set -e

/app/worker/init-volume.sh

echo "[worker] Starte server.js (TZ=${TZ:-nicht gesetzt})"
exec node worker/server.js
