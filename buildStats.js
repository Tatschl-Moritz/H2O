// ============================================================================
// Stats-Aggregation
// ----------------------------------------------------------------------------
// Liest die gesamte History (public/history/*.jsonl) und verdichtet sie zu
// einer kompakten public/data/stats.json fuer die Statistik-Graphen.
//
// Wichtige Regel: Alles was nach 18:00 Wiener Zeit gescraped wurde, fliesst
// NICHT in die Auswertung ein. Nach 18 Uhr werden Anmeldezahlen teils von den
// Chefs manuell nachbearbeitet (kein automatischer Buchungsschluss im Code
// der H2O-Seite), das sind dann keine echten Kunden-Buchungen mehr.
//
// Ausfuehren: node buildStats.js
// ============================================================================

import { readdir, readFile, writeFile } from "node:fs/promises";
import { config } from "./config.js";

const CUTOFF_HOUR = 18;

// Groesserer Scrape-Abstand als das erlaubt keine verlaessliche Zuordnung
// zu einer einzelnen Stunde mehr (z.B. Ausfaelle oder Nacht-Luecken aus der
// Anfangszeit, bevor der Cron rund um die Uhr lief) -> so einen Zuwachs
// verwerfen wir lieber. 240min trennt sauber die normale Tages-Kadenz
// (inkl. GitHub-Actions-Verspaetungen, meist unter 3.5h) von echten Luecken.
const MAX_LUECKE_MINUTEN = 240;

// Kurznamen fuer die Graphen (lange Originaltitel sprengen sonst die Achsen-
// beschriftung). Unbekannte Touren fallen auf den vollen Titel zurueck.
const TOUR_KURZNAME = {
  "Familien-Piratenrafting": "Familientour Rafting",
  "Rafting Einsteigertour": "Rafting Einsteiger",
  "Einsteigertour \"Wonderland\"": "Wonderland",
  "Waldseilgarten im Verwall": "Waldseilgarten",
  "Klettersteig für Einsteiger und Familien": "Klettersteig Familien",
  "Canyoning \"X-Dream\"": "X-Dream",
};

function kurzname(tour) {
  return TOUR_KURZNAME[tour] || tour;
}

// H2O bietet nur Sommeraktivitaeten an (Rafting/Canyoning/Klettersteig/
// Hochseilgarten), daher bislang nur eine Saison pro Jahr (Apr-Okt). Fuer
// den Fall, dass doch mal ein Wintertermin auftaucht, faengt der trotzdem
// sauber in einer eigenen Saison auf, statt die Sommerdaten zu verwaschen.
function saisonLabel(dateStr) {
  const [jahrStr, monatStr] = dateStr.split("-");
  const jahr = parseInt(jahrStr, 10);
  const monat = parseInt(monatStr, 10);
  const kurzjahr = (n) => String(n % 100).padStart(2, "0");

  if (monat >= 4 && monat <= 10) {
    return { label: `Sommersaison ${kurzjahr(jahr)}`, sortierSchluessel: `${jahr}-04` };
  }
  if (monat >= 11) {
    return { label: `Wintersaison ${kurzjahr(jahr)}/${kurzjahr(jahr + 1)}`, sortierSchluessel: `${jahr}-11` };
  }
  return { label: `Wintersaison ${kurzjahr(jahr - 1)}/${kurzjahr(jahr)}`, sortierSchluessel: `${jahr - 1}-11` };
}

function wienerStunde(iso) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timezone,
    hour: "2-digit",
    hour12: false,
  });
  return parseInt(formatter.format(new Date(iso)), 10);
}

async function ladeHistory() {
  const dateien = await readdir(config.historyDir);
  const zeilen = [];

  for (const datei of dateien) {
    if (datei.endsWith(".jsonl") === false) {
      continue;
    }
    const inhalt = await readFile(`${config.historyDir}/${datei}`, "utf8");
    const dateiZeilen = inhalt.trim().split("\n").filter((z) => z.length > 0);
    for (const zeile of dateiZeilen) {
      zeilen.push(JSON.parse(zeile));
    }
  }

  return zeilen;
}

// Gruppiert nach date+tourId und behaelt nur Eintraege vor dem Cutoff,
// chronologisch sortiert.
function gruppiereProTour(zeilen) {
  const gruppen = new Map();

  for (const eintrag of zeilen) {
    if (wienerStunde(eintrag.scrapedAt) >= CUTOFF_HOUR) {
      continue;
    }
    const schluessel = `${eintrag.date}__${eintrag.tourId}`;
    if (gruppen.has(schluessel) === false) {
      gruppen.set(schluessel, []);
    }
    gruppen.get(schluessel).push(eintrag);
  }

  for (const liste of gruppen.values()) {
    liste.sort((a, b) => (a.scrapedAt < b.scrapedAt ? -1 : 1));
  }

  return gruppen;
}

// Teilt die Tour-Gruppen nach Saison der Gruppen selbst auf (alle Eintraege
// einer Gruppe teilen sich dasselbe date-Feld).
function gruppenNachSaison(gruppen) {
  const nachSaison = new Map();

  for (const [schluessel, liste] of gruppen.entries()) {
    const saison = saisonLabel(liste[0].date);
    if (nachSaison.has(saison.label) === false) {
      nachSaison.set(saison.label, { sortierSchluessel: saison.sortierSchluessel, gruppen: new Map() });
    }
    nachSaison.get(saison.label).gruppen.set(schluessel, liste);
  }

  return nachSaison;
}

function baueStatsFuerSaison(gruppen) {
  const aktivitaetProStunde = new Map(); // hour -> Summe positiver Deltas
  const summeProKategorie = new Map();
  const summeProTour = new Map();
  const summeProDatum = new Map();
  const werteProWochentag = new Map(); // weekday -> [] von Tagessummen

  for (const liste of gruppen.values()) {
    // Buchungsgeschwindigkeit: Zuwachs zwischen aufeinanderfolgenden Scrapes.
    for (let i = 1; i < liste.length; i++) {
      const vorher = liste[i - 1].anmeldungen;
      const nachher = liste[i].anmeldungen;
      if (vorher === null || nachher === null) {
        continue;
      }
      const luecke = (new Date(liste[i].scrapedAt) - new Date(liste[i - 1].scrapedAt)) / 60000;
      if (luecke > MAX_LUECKE_MINUTEN) {
        continue;
      }
      const delta = nachher - vorher;
      if (delta > 0) {
        const stunde = wienerStunde(liste[i].scrapedAt);
        aktivitaetProStunde.set(stunde, (aktivitaetProStunde.get(stunde) || 0) + delta);
      }
    }

    // Letzter bekannter Stand vor dem Cutoff = "echter" Tagesendstand.
    const letzter = liste[liste.length - 1];
    if (letzter.anmeldungen === null) {
      continue;
    }

    if (letzter.kategorie !== null) {
      summeProKategorie.set(
        letzter.kategorie,
        (summeProKategorie.get(letzter.kategorie) || 0) + letzter.anmeldungen
      );
    }
    summeProTour.set(letzter.tour, (summeProTour.get(letzter.tour) || 0) + letzter.anmeldungen);
    summeProDatum.set(letzter.date, (summeProDatum.get(letzter.date) || 0) + letzter.anmeldungen);

    if (werteProWochentag.has(letzter.weekday) === false) {
      werteProWochentag.set(letzter.weekday, new Map());
    }
    const tagesSummen = werteProWochentag.get(letzter.weekday);
    tagesSummen.set(letzter.date, (tagesSummen.get(letzter.date) || 0) + letzter.anmeldungen);
  }

  const wochentagReihenfolge = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
  ];

  const byWeekday = wochentagReihenfolge
    .filter((tag) => werteProWochentag.has(tag))
    .map((tag) => {
      const tagesSummen = [...werteProWochentag.get(tag).values()];
      const avg = tagesSummen.reduce((a, b) => a + b, 0) / tagesSummen.length;
      return { weekday: tag, avgTotal: Math.round(avg * 10) / 10 };
    });

  const bookingActivityByHour = [];
  for (let stunde = 0; stunde < CUTOFF_HOUR; stunde++) {
    bookingActivityByHour.push({ hour: stunde, total: aktivitaetProStunde.get(stunde) || 0 });
  }

  const byKategorie = [...summeProKategorie.entries()]
    .map(([kategorie, total]) => ({ kategorie, total }))
    .filter((eintrag) => eintrag.total > 0)
    .sort((a, b) => b.total - a.total);

  const topTouren = [...summeProTour.entries()]
    .map(([tour, total]) => ({ tour, label: kurzname(tour), total }))
    .filter((eintrag) => eintrag.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const seasonTrend = [...summeProDatum.entries()]
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const zeitraum =
    seasonTrend.length > 0
      ? { von: seasonTrend[0].date, bis: seasonTrend[seasonTrend.length - 1].date }
      : null;

  return {
    zeitraum,
    bookingActivityByHour,
    byKategorie,
    byWeekday,
    topTouren,
    seasonTrend,
  };
}

export async function buildStats() {
  const zeilen = await ladeHistory();
  const alleGruppen = gruppiereProTour(zeilen);
  const saisonGruppen = gruppenNachSaison(alleGruppen);

  const proSaison = [...saisonGruppen.entries()]
    .map(([label, eintrag]) => ({
      label,
      sortierSchluessel: eintrag.sortierSchluessel,
      ...baueStatsFuerSaison(eintrag.gruppen),
    }))
    .sort((a, b) => (a.sortierSchluessel < b.sortierSchluessel ? 1 : -1)) // neueste zuerst
    .map(({ sortierSchluessel, ...rest }) => rest);

  // "Gesamt" ueber alle Saisons hinweg - steht immer zuerst und ist die
  // Standardauswahl im Frontend (Index 0).
  const gesamt = { label: "Gesamt", ...baueStatsFuerSaison(alleGruppen) };

  const seasons = [gesamt, ...proSaison];

  const stats = {
    generatedAt: new Date().toISOString(),
    cutoffHour: CUTOFF_HOUR,
    seasons,
  };

  await writeFile(`${config.dataDir}/stats.json`, JSON.stringify(stats, null, 2), "utf8");
  console.log(
    `[stats] ${zeilen.length} History-Zeilen -> ${seasons.length} Saison(en) -> ${config.dataDir}/stats.json`
  );
  return stats;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("buildStats.js");
if (isDirectRun) {
  buildStats().catch((error) => {
    console.error(`[stats] Abgebrochen: ${error.message}`);
    process.exit(1);
  });
}
