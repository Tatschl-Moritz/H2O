#!/bin/sh
# Healthy nur wenn:
#   1. crond ueberhaupt laeuft, UND
#   2. der wasserstand-Job (kuerzester Zyklus, alle 15 Min) innerhalb der
#      letzten 20 Minuten erfolgreich durchgelaufen ist (Heartbeat-Datei von
#      run-job.sh, nicht nur "Prozess existiert").
#
# Nutzt "find -mmin" statt "stat -c" fuer die Alterspruefung - stabiler
# ueber verschiedene BusyBox-Versionen hinweg.
#
# Waehrend docker-compose.yml's "start_period" fuer den Worker zaehlen
# fehlschlagende Checks noch nicht als "unhealthy" - das deckt die Zeit bis
# zum allerersten Cron-Tick nach dem Start ab.
set -e

pgrep crond > /dev/null

HEARTBEAT="/tmp/h2o-worker-heartbeat-wasserstand"
MAX_AGE_MINUTES=20

[ -f "$HEARTBEAT" ]

if [ -z "$(find "$HEARTBEAT" -mmin "-$MAX_AGE_MINUTES" 2>/dev/null)" ]; then
  echo "Letzter erfolgreicher wasserstand-Lauf ist aelter als ${MAX_AGE_MINUTES} Minuten" >&2
  exit 1
fi
