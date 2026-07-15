// ============================================================================
// H2O Scraper
// ----------------------------------------------------------------------------
// Holt fuer die konfigurierten Tage (heute + morgen) das Tagesprogramm,
// liest pro Tour die oeffentlich sichtbaren Infos aus und speichert:
//   1. Momentaufnahme -> public/data/<datum>.json      (wird ueberschrieben)
//   2. Verlaufszeile  -> public/history/<datum>.jsonl  (wird angehaengt)
//   3. Tagesliste     -> public/data/index.json        (fuer das Frontend)
//
// Ausfuehren:  node scraper.js
// ============================================================================

import * as cheerio from "cheerio";
import { writeFile, appendFile, mkdir, readdir } from "node:fs/promises";
import { config } from "./config.js";

// --- kleine Helfer ----------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDate(offsetDays) {
  const base = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(base);
}

function getWeekday(dateString) {
  const parts = dateString.split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const formatter = new Intl.DateTimeFormat("de-AT", {
    weekday: "long",
    timeZone: config.timezone,
  });
  return formatter.format(d);
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": config.userAgent },
  });
  if (response.ok === false) {
    throw new Error(`Abruf fehlgeschlagen (HTTP ${response.status}): ${url}`);
  }
  return response.text();
}

// --- Kategorie ---------------------------------------------------------------
// H2O nennt die Kategorie direkt in den Attributen der Uebersicht:
//   Anker-title: "Details und Termine fuer <Tour>, <Kategorie> H2O Adventure"
//   Bild-title:  "<Tour> - <Kategorie> H2O Adventure"
// Das ist zuverlaessiger als aus dem Namen zu raten.
function kategorieAusAttribut(text) {
  if (text === undefined || text === null) {
    return null;
  }
  // Variante Anker-title (nach dem Komma)
  let m = text.match(/,\s*(.+?)\s+H2O Adventure\s*$/i);
  if (m !== null) {
    return m[1].trim();
  }
  // Variante Bild-title (nach dem Bindestrich)
  m = text.match(/\s[-–]\s(.+?)\s+H2O Adventure\s*$/i);
  if (m !== null) {
    return m[1].trim();
  }
  return null;
}

// Rueckfall, falls die Attribute mal fehlen: grobe Ableitung aus dem Namen.
const KATEGORIE_REGELN = [
  { schluessel: ["canyoning", "wonderland", "x-dream", "pure action"], kategorie: "Canyoning" },
  { schluessel: ["rafting", "wildwasser", "piratenrafting", "raft"], kategorie: "Rafting" },
  { schluessel: ["river bug", "riverbug", "tubing", "funsport"], kategorie: "Wasser Funsport" },
  { schluessel: ["klettersteig", "kletterkurs", "klettern"], kategorie: "Bergabenteuer" },
  { schluessel: ["seilgarten", "hochseilgarten"], kategorie: "Hochseilgarten" },
  { schluessel: ["bike", "surron", "rad"], kategorie: "Bike" },
];

function findeKategorie(titel) {
  const t = titel.toLowerCase();
  for (const regel of KATEGORIE_REGELN) {
    for (const wort of regel.schluessel) {
      if (t.includes(wort) === true) {
        return regel.kategorie;
      }
    }
  }
  return null;
}

// --- Parsing: Tagesprogramm -------------------------------------------------

function parseTourList(html) {
  const $ = cheerio.load(html);
  const found = new Map();

  // WICHTIG: nicht nach dem Datum im Link filtern! Die H2O-Links tragen ein
  // festes Basisdatum (z.B. .../2026-07-15/action-...), die echte Kennung ist
  // die action-ID. Wir matchen daher alle /action--Links der Seite.
  $('a[href*="/action-"]').each((_, element) => {
    const rawHref = $(element).attr("href");
    if (rawHref === undefined || rawHref === null || rawHref === "") {
      return;
    }

    let url;
    if (rawHref.startsWith("http") === true) {
      url = rawHref;
    } else {
      url = config.baseUrl + rawHref;
    }

    let tourId = null;
    const idMatch = url.match(/action-(\d+)/);
    if (idMatch !== null) {
      tourId = idMatch[1];
    }

    const text = $(element).text().replace(/\s+/g, " ").trim();

    let time = "";
    const timeMatch = text.match(/(\d{2}:\d{2})\s*Uhr/);
    if (timeMatch !== null) {
      time = timeMatch[1];
    }

    // Titel: bevorzugt aus dem <strong> (der fettgedruckte Name), sonst Text.
    let title = $(element).find("strong").first().text().trim();
    if (title === "") {
      title = text.replace(/^.*?Uhr\s*/, "").replace(/Details.*$/, "").trim();
    }

    // Kategorie: zuerst aus dem Anker-title, dann Bild-title, dann Namensregel.
    let kategorie = kategorieAusAttribut($(element).attr("title"));
    if (kategorie === null) {
      kategorie = kategorieAusAttribut($(element).find("img").first().attr("title"));
    }
    if (kategorie === null) {
      kategorie = findeKategorie(title);
    }

    if (found.has(url) === false) {
      found.set(url, { url, tourId, time, title, kategorie });
    }
  });

  return Array.from(found.values());
}

// --- Parsing: Tour-Detailseite ----------------------------------------------

// Titel robust: nimmt die erste nicht-leere Ueberschrift (h1 ODER h2).
// Dient nur als Rueckfall - Hauptquelle ist der Titel aus der Uebersicht.
function parseHeading($) {
  const kandidaten = ["h1", "h2"];
  for (const tag of kandidaten) {
    const text = $(tag).first().text().trim();
    if (text.length > 0) {
      return text;
    }
  }
  return null;
}

// Ort robust: steht im Kopfblock direkt nach der Uhrzeit,
// z.B. "... 09:30 UHR Ried im Oberinntal". Wir suchen nur im oberen
// Seitenbereich, damit die Buchungszeilen weiter unten nicht stoeren.
function parseLocation(pageText) {
  const kopf = pageText.slice(0, 600);
  const m = kopf.match(
    /\d{2}:\d{2}\s*Uhr\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.\-\s]{2,40}?)(?=\s+ab\s|\s+\d|\s+Perfekt|\s+Erlebe|$)/i
  );
  if (m !== null) {
    return m[1].trim();
  }
  return null;
}

function parseTourDetail(html) {
  const $ = cheerio.load(html);
  const pageText = $("body").text().replace(/\s+/g, " ");

  const detail = {
    anmeldungen: null,
    heading: null,
    location: null,
    minAge: null,
    durationH: null,
    distanceKm: null,
  };

  const countMatch = pageText.match(/(\d+)\s*Anmeldung/i);
  if (countMatch !== null) {
    detail.anmeldungen = parseInt(countMatch[1], 10);
  }

  detail.heading = parseHeading($);
  detail.location = parseLocation(pageText);

  const ageMatch = pageText.match(/ab\s*(\d+)\s*Jahr/i);
  if (ageMatch !== null) {
    detail.minAge = parseInt(ageMatch[1], 10);
  }

  const durMatch = pageText.match(/(\d+(?:[.,]\d+)?)\s*h\b/i);
  if (durMatch !== null) {
    detail.durationH = parseFloat(durMatch[1].replace(",", "."));
  }

  const kmMatch = pageText.match(/(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (kmMatch !== null) {
    detail.distanceKm = parseFloat(kmMatch[1].replace(",", "."));
  }

  return detail;
}

// --- Ein Tag verarbeiten ----------------------------------------------------

// Punkt 6: prueft die Pflichtfelder und meldet klar, welches bei welcher Tour fehlt.
function meldeFehlendeFelder(record) {
  const pflicht = {
    Tourname: record.title,
    Uhrzeit: record.time,
    Kategorie: record.kategorie,
    Ort: record.location,
    Anmeldungen: record.anmeldungen,
  };

  for (const feldName in pflicht) {
    const wert = pflicht[feldName];
    if (wert === null || wert === undefined || wert === "") {
      console.warn(`[fehlt]  ${record.date} ${record.time} "${record.title}"  ->  Feld "${feldName}" nicht gefunden`);
    }
  }
}

async function scrapeDay(date, scrapedAt) {
  const listUrl = `${config.baseUrl}/${config.lang}/buchen/${date}/`;
  console.log(`[scrape] ${date}: lade Tagesprogramm ${listUrl}`);

  const listHtml = await fetchPage(listUrl);
  const tours = parseTourList(listHtml);
  console.log(`[scrape] ${date}: ${tours.length} Tour(en) gefunden.`);

  const weekday = getWeekday(date);
  const records = [];

  for (const tour of tours) {
    // Titel aus der Uebersicht ist die verlaessliche Hauptquelle.
    let title = tour.title;

    const record = {
      date: date,
      weekday: weekday,
      tourId: tour.tourId,
      title: title,
      time: tour.time,
      anmeldungen: null,
      kategorie: tour.kategorie,
      location: null,
      minAge: null,
      durationH: null,
      distanceKm: null,
      url: tour.url,
    };

    try {
      const detailHtml = await fetchPage(tour.url);
      const d = parseTourDetail(detailHtml);

      record.anmeldungen = d.anmeldungen;
      record.location = d.location;
      record.minAge = d.minAge;
      record.durationH = d.durationH;
      record.distanceKm = d.distanceKm;

      // Nur wenn die Uebersicht keinen Titel hatte, auf die Ueberschrift zurueckfallen.
      if ((title === "" || title === null) && d.heading !== null) {
        record.title = d.heading;
        record.kategorie = findeKategorie(d.heading);
      }

      console.log(`[scrape]   ${record.time}  ${record.title}  [${record.kategorie}]  ${record.location}  ->  ${record.anmeldungen} Anmeldungen`);
    } catch (error) {
      console.warn(`[scrape]   Fehler bei ${tour.url}: ${error.message}`);
    }

    // Punkt 6: fehlende Pflichtfelder melden, aber weiterlaufen.
    meldeFehlendeFelder(record);

    records.push(record);
    await sleep(config.delayBetweenRequestsMs);
  }

  records.sort((a, b) => {
    if (a.time < b.time) {
      return -1;
    } else if (a.time > b.time) {
      return 1;
    } else {
      return 0;
    }
  });

  const snapshot = {
    date: date,
    weekday: weekday,
    updatedAt: scrapedAt,
    tours: records,
  };
  await writeFile(`${config.dataDir}/${date}.json`, JSON.stringify(snapshot, null, 2), "utf8");

  let logLines = "";
  for (const record of records) {
    const logEntry = {
      scrapedAt: scrapedAt,
      date: record.date,
      weekday: record.weekday,
      tourId: record.tourId,
      tour: record.title,
      kategorie: record.kategorie,
      time: record.time,
      location: record.location,
      anmeldungen: record.anmeldungen,
      url: record.url,
    };
    logLines += JSON.stringify(logEntry) + "\n";
  }
  await appendFile(`${config.historyDir}/${date}.jsonl`, logLines, "utf8");

  return date;
}

async function writeIndex() {
  const files = await readdir(config.dataDir);
  const dates = [];
  for (const file of files) {
    if (file.endsWith(".json") === true && file !== "index.json") {
      dates.push(file.replace(".json", ""));
    }
  }
  dates.sort();
  await writeFile(`${config.dataDir}/index.json`, JSON.stringify({ dates: dates }, null, 2), "utf8");
}

export async function runScrape() {
  const scrapedAt = new Date().toISOString();

  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.historyDir, { recursive: true });

  for (const offset of config.daysToScrape) {
    const date = getDate(offset);
    try {
      await scrapeDay(date, scrapedAt);
    } catch (error) {
      console.error(`[scrape] Tag ${date} fehlgeschlagen: ${error.message}`);
    }
  }

  await writeIndex();
  console.log("[scrape] Fertig.");
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("scraper.js");
if (isDirectRun) {
  runScrape().catch((error) => {
    console.error(`[scrape] Abgebrochen: ${error.message}`);
    process.exit(1);
  });
}

export { parseTourList, parseTourDetail, findeKategorie, kategorieAusAttribut, parseLocation };
