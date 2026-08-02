#!/bin/sh
# Uebernimmt die im Image mitgelieferten Referenzdaten (public/data,
# public/history aus dem Git-Repo) in das gemeinsame Volume - aber NUR
# beim allerersten Start, wenn das Volume dort noch leer ist. Bestehende
# Daten im Volume werden nie ueberschrieben oder geloescht.
set -e

DATA_DIR="${H2O_DATA_DIR:-/shared/data}"
HISTORY_DIR="${H2O_HISTORY_DIR:-/shared/history}"

mkdir -p "$DATA_DIR" "$HISTORY_DIR"

if [ -z "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
  echo "[init] $DATA_DIR ist leer - uebernehme Referenzdaten aus dem Image."
  cp -r /app/public/data/. "$DATA_DIR"/
else
  echo "[init] $DATA_DIR enthaelt bereits Daten - Initialisierung uebersprungen."
fi

if [ -z "$(ls -A "$HISTORY_DIR" 2>/dev/null)" ]; then
  echo "[init] $HISTORY_DIR ist leer - uebernehme Referenzdaten aus dem Image."
  cp -r /app/public/history/. "$HISTORY_DIR"/
else
  echo "[init] $HISTORY_DIR enthaelt bereits Daten - Initialisierung uebersprungen."
fi
