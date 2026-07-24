// ============================================================================
// Wasserstand-Abruf
// ----------------------------------------------------------------------------
// Holt aktuellen Pegel/Abfluss/Wassertemperatur fuer mehrere Messstellen
// (Inn + Malchbach) nahe der Imster Schlucht / Ried im Oberinntal von
// riverapp.net. Die Seite rendert die Werte serverseitig als schema.org-
// "Dataset"-JSON direkt im HTML (Quelle laut riverapp.net: Hydrographischer
// Dienst Tirol) - kein Login, kein Javascript-Rendering noetig.
//
// Speichert:
//   1. Momentaufnahme  -> public/data/wasserstand.json       (aktuelle Werte)
//   2. 24h-Verlauf     -> public/data/wasserstand-history.json (fuer die Graphen)
//
// Ausfuehren: node wasserstand.js
// ============================================================================

import { readFile, writeFile } from "node:fs/promises";
import { config } from "./config.js";

const STATIONEN = [
  { id: "51b60958e4b082f2a47370ba", name: "Magerbach", gewaesser: "Inn" },
  { id: "51b60958e4b082f2a4737086", name: "Landeck-Perjen", gewaesser: "Inn" },
  { id: "5452b67b30042edb2ef484f9", name: "Imst", gewaesser: "Malchbach" },
];

const HISTORY_STUNDEN = 24;

function stationUrl(id) {
  return `https://www.riverapp.net/en/station/${id}`;
}

function extrahiereDataset(html) {
  const scriptMatches = html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  );
  for (const match of scriptMatches) {
    let json;
    try {
      json = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (json["@type"] === "Dataset") {
      return json;
    }
  }
  return null;
}

async function holeStation(station) {
  const url = stationUrl(station.id);
  const response = await fetch(url, {
    headers: { "User-Agent": config.userAgent },
  });
  if (response.ok === false) {
    throw new Error(`Abruf fehlgeschlagen (HTTP ${response.status}): ${url}`);
  }
  const html = await response.text();

  const dataset = extrahiereDataset(html);
  if (dataset === null) {
    throw new Error(`Kein Dataset-JSON auf der Seite gefunden: ${url}`);
  }

  const werte = dataset.variableMeasured || [];
  const abfluss = werte.find((w) => w.name === "Streamflow") || null;
  const pegel = werte.find((w) => w.name === "River stage") || null;
  const temperatur = werte.find((w) => w.name === "Water temperature") || null;

  return {
    station: station.name,
    gewaesser: station.gewaesser,
    pegelCm: pegel ? Math.round(pegel.value) : null,
    pegelGemessenAm: pegel ? pegel.observationDate : null,
    abflussM3s: abfluss ? abfluss.value : null,
    abflussGemessenAm: abfluss ? abfluss.observationDate : null,
    temperaturC: temperatur ? temperatur.value : null,
    temperaturGemessenAm: temperatur ? temperatur.observationDate : null,
    quelle: url,
  };
}

async function ladeHistory() {
  try {
    const inhalt = await readFile(`${config.dataDir}/wasserstand-history.json`, "utf8");
    return JSON.parse(inhalt);
  } catch {
    return {};
  }
}

// Haengt die neue Messung an und wirft alles raus, was aelter als
// HISTORY_STUNDEN ist - so bleibt die Datei klein statt endlos zu wachsen.
function aktualisiereHistory(history, station, aktualisiertAm) {
  if (history[station.station] === undefined) {
    history[station.station] = [];
  }

  if (station.pegelCm !== null) {
    history[station.station].push({ t: aktualisiertAm, cm: station.pegelCm });
  }

  const grenze = Date.now() - HISTORY_STUNDEN * 60 * 60 * 1000;
  history[station.station] = history[station.station].filter(
    (eintrag) => new Date(eintrag.t).getTime() >= grenze
  );
}

export async function holeWasserstand() {
  const aktualisiertAm = new Date().toISOString();
  const history = await ladeHistory();
  const stationen = [];

  for (const station of STATIONEN) {
    try {
      const ergebnis = await holeStation(station);
      stationen.push(ergebnis);
      aktualisiereHistory(history, ergebnis, aktualisiertAm);
      console.log(
        `[wasserstand] ${ergebnis.station}: ${ergebnis.pegelCm} cm, ${ergebnis.abflussM3s} m³/s, ${ergebnis.temperaturC} °C`
      );
    } catch (error) {
      console.warn(`[wasserstand] ${station.name} fehlgeschlagen: ${error.message}`);
    }
  }

  const snapshot = { aktualisiertAm, stationen };
  await writeFile(`${config.dataDir}/wasserstand.json`, JSON.stringify(snapshot, null, 2), "utf8");
  await writeFile(
    `${config.dataDir}/wasserstand-history.json`,
    JSON.stringify(history, null, 2),
    "utf8"
  );

  return snapshot;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("wasserstand.js");
if (isDirectRun) {
  holeWasserstand().catch((error) => {
    console.error(`[wasserstand] Abgebrochen: ${error.message}`);
    process.exit(1);
  });
}
