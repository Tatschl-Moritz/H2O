#!/bin/sh
set -e

/app/worker/init-volume.sh

echo "[worker] Starte crond (TZ=${TZ:-nicht gesetzt})"
exec crond -f -l 2
