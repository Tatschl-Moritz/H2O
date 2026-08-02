#!/bin/sh
# Fuehrt einen Job aus und loggt Start/Ende/Fehler klar auf stdout/stderr.
# Gibt immer 0 zurueck: ein fehlgeschlagener Lauf soll weder den naechsten
# Cron-Tick verhindern noch crond (PID 1) zum Absturz bringen.
#
# Bei Erfolg wird zusaetzlich eine Heartbeat-Datei beruehrt (worker/healthcheck.sh
# prueft deren Alter), damit der Healthcheck nicht nur "crond laeuft", sondern
# "der letzte Lauf war tatsaechlich erfolgreich" verifizieren kann.
#
# Aufruf: run-job.sh <name> <befehl...>
name="$1"
shift

echo "[$name] Start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if "$@"; then
  echo "[$name] OK $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  touch "/tmp/h2o-worker-heartbeat-$name"
else
  status=$?
  echo "[$name] FEHLER (exit $status) $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
fi
exit 0
