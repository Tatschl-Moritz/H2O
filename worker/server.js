// ============================================================================
// Worker-Server
// ----------------------------------------------------------------------------
// Ein Prozess, zwei Aufgaben:
//   1. Cron (node-cron, Europe/Vienna): scraper.js+buildStats.js stuendlich,
//      wasserstand.js alle 15 Minuten - beide mit persistHistory:true, also
//      "mode: scheduled". Diese Laeufe sind die einzigen, die History-Zeilen
//      oder stats.json veraendern.
//   2. HTTP-API (Express): POST /api/refresh fuer den "Aktualisieren"-Button
//      im Frontend - "mode: manual", persistHistory:false. Aktualisiert nur
//      die Anzeige-Momentaufnahmen (<datum>.json, wasserstand.json), laesst
//      History/Stats unberuehrt.
//
// Ein globaler Mutex (activeRun) verhindert, dass zwei Laeufe gleichzeitig
// gegen h2o-adventure.at/riverapp.net laufen - egal ob scheduled oder manual.
// ============================================================================

import express from "express";
import cron from "node-cron";
import { runScrape } from "../scraper.js";
import { holeWasserstand } from "../wasserstand.js";
import { buildStats } from "../buildStats.js";

const PORT = process.env.PORT || 3000;
const TIMEZONE = "Europe/Vienna";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || null;
const ALLOWED_ORIGIN = process.env.H2O_PUBLIC_ORIGIN || null;
const MANUAL_COOLDOWN_MS = 30_000; // Rate-Limit: min. Abstand zwischen zwei erfolgreichen manuellen Refreshes
const MANUAL_TIMEOUT_MS = 45_000; // Ab hier antwortet die API "laeuft noch", ohne den Lauf abzubrechen

// { mode: "scheduled-scrape" | "scheduled-wasserstand" | "manual", startedAt }
let activeRun = null;
let lastManualCompletedAt = 0;
// Healthcheck-Basis: Zeitpunkt des letzten ERFOLGREICHEN scheduled-Laufs.
let lastScheduledScrapeAt = null;
let lastScheduledWasserstandAt = null;

function log(...args) {
  console.log("[worker]", ...args);
}

// --- Scheduled-Laeufe (node-cron) -------------------------------------------

async function runScheduledScrape() {
  if (activeRun !== null) {
    log(`scheduled scrape uebersprungen - ${activeRun.mode}-Lauf laeuft bereits seit ${activeRun.startedAt}`);
    return;
  }
  activeRun = { mode: "scheduled-scrape", startedAt: new Date().toISOString() };
  try {
    await runScrape({ persistHistory: true });
    await buildStats();
    lastScheduledScrapeAt = Date.now();
    log("scheduled scrape + stats OK");
  } finally {
    activeRun = null;
  }
}

async function runScheduledWasserstand() {
  if (activeRun !== null) {
    log(`scheduled wasserstand uebersprungen - ${activeRun.mode}-Lauf laeuft bereits seit ${activeRun.startedAt}`);
    return;
  }
  activeRun = { mode: "scheduled-wasserstand", startedAt: new Date().toISOString() };
  try {
    await holeWasserstand({ persistHistory: true });
    lastScheduledWasserstandAt = Date.now();
    log("scheduled wasserstand OK");
  } finally {
    activeRun = null;
  }
}

// --- Manueller Lauf (POST /api/refresh) -------------------------------------

// Mutierbares Fortschritts-Objekt, das waehrend eines manuellen Laufs an
// activeRun.progress haengt - scraper.js/wasserstand.js rufen die beiden
// onXProgress-Callbacks live auf, GET /api/refresh/status liest daraus.
function neuerProgress() {
  return { scrapeCompleted: 0, scrapeTotal: 0, wasserstandCompleted: 0, wasserstandTotal: 0, label: "Startet …" };
}

// Scraped + holt Wasserstand parallel, beides mit persistHistory:false.
// Laeuft NIE buildStats.js - der manuelle Refresh darf dessen Quelldaten
// (die History) gar nicht erst veraendert haben.
async function runManualRefresh(progress) {
  const t0 = Date.now();

  const [scrapeResult, wasserstandResult] = await Promise.allSettled([
    runScrape({
      persistHistory: false,
      onProgress: ({ completed, total, label }) => {
        progress.scrapeCompleted = completed;
        progress.scrapeTotal = total;
        progress.label = label;
      },
    }),
    holeWasserstand({
      persistHistory: false,
      onProgress: ({ completed, total, label }) => {
        progress.wasserstandCompleted = completed;
        progress.wasserstandTotal = total;
        progress.label = label;
      },
    }),
  ]);

  if (scrapeResult.status === "rejected") {
    console.error("[worker] manueller scrape fehlgeschlagen:", scrapeResult.reason);
  }
  if (wasserstandResult.status === "rejected") {
    console.error("[worker] manueller wasserstand fehlgeschlagen:", wasserstandResult.reason);
  }

  return {
    updatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    summary: {
      scrape:
        scrapeResult.status === "fulfilled"
          ? { dates: scrapeResult.value.dates }
          : { error: scrapeResult.reason.message },
      wasserstand:
        wasserstandResult.status === "fulfilled"
          ? { stationen: wasserstandResult.value.stationen.length }
          : { error: wasserstandResult.reason.message },
    },
  };
}

// --- HTTP-API ----------------------------------------------------------------

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (req, res) => {
  const jetzt = Date.now();
  const gruenzeMs = 20 * 60 * 1000; // Wasserstand-Zyklus ist 15min, +Puffer

  if (lastScheduledWasserstandAt === null) {
    res.status(503).json({ ok: false, reason: "noch kein erfolgreicher scheduled wasserstand-Lauf" });
    return;
  }
  const alterMs = jetzt - lastScheduledWasserstandAt;
  if (alterMs > gruenzeMs) {
    res.status(503).json({ ok: false, reason: `letzter scheduled wasserstand-Lauf ist ${Math.round(alterMs / 1000)}s alt` });
    return;
  }
  res.status(200).json({
    ok: true,
    lastScheduledScrapeAt: lastScheduledScrapeAt ? new Date(lastScheduledScrapeAt).toISOString() : null,
    lastScheduledWasserstandAt: new Date(lastScheduledWasserstandAt).toISOString(),
  });
});

// Gilt fuer alle /api/*-Routen (Refresh-Trigger UND Status-Abfrage) - eine
// Stelle statt Duplikation in jedem Handler.
app.use("/api", (req, res, next) => {
  // Sicherheit, Schicht 1 (strukturell): dieser Port wird nie veroeffentlicht
  // und bekommt keine Coolify-Domain - erreichbar nur ueber nginx' proxy_pass.
  // Schicht 2: gemeinsames Secret, das nur nginx setzt (siehe nginx.conf.template).
  if (INTERNAL_SECRET !== null && req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
    res.status(403).json({ success: false, error: "forbidden" });
    return;
  }
  // Schicht 3 (optional, per Env-Var aktivierbar): Origin muss zur oeffentlichen Domain passen.
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN !== null && origin !== undefined && origin !== ALLOWED_ORIGIN) {
    res.status(403).json({ success: false, error: "forbidden origin" });
    return;
  }
  next();
});

// Fuer die Fortschrittsanzeige im Frontend waehrend eines manuellen Refreshs -
// rein lesend, kein Rate-Limit/Mutex noetig (loest selbst nichts aus).
app.get("/api/refresh/status", (req, res) => {
  if (activeRun === null) {
    res.status(200).json({ active: false });
    return;
  }
  const p = activeRun.progress;
  res.status(200).json({
    active: true,
    mode: activeRun.mode,
    startedAt: activeRun.startedAt,
    completed: p ? p.scrapeCompleted + p.wasserstandCompleted : null,
    total: p ? p.scrapeTotal + p.wasserstandTotal : null,
    label: p ? p.label : null,
  });
});

app.post("/api/refresh", async (req, res) => {
  if (activeRun !== null) {
    res.status(409).json({
      success: false,
      error: "Ein Lauf laeuft bereits",
      mode: activeRun.mode,
      startedAt: activeRun.startedAt,
    });
    return;
  }

  const jetzt = Date.now();
  if (jetzt - lastManualCompletedAt < MANUAL_COOLDOWN_MS) {
    const wartenSekunden = Math.ceil((MANUAL_COOLDOWN_MS - (jetzt - lastManualCompletedAt)) / 1000);
    res.status(429).json({
      success: false,
      error: `Bitte noch ${wartenSekunden}s warten, bevor erneut aktualisiert wird.`,
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const progress = neuerProgress();
  activeRun = { mode: "manual", startedAt, progress };
  const runPromise = runManualRefresh(progress).finally(() => {
    activeRun = null;
    lastManualCompletedAt = Date.now();
  });

  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ timedOut: true }), MANUAL_TIMEOUT_MS);
  });

  const ergebnis = await Promise.race([runPromise.then((result) => ({ timedOut: false, result })), timeout]);

  if (ergebnis.timedOut === true) {
    // Lock bleibt bestehen, bis runPromise tatsaechlich fertig ist (siehe
    // .finally() oben) - hier antworten wir dem Client nur schon mal, damit
    // der Request nicht ewig haengt.
    res.status(202).json({
      success: true,
      mode: "manual",
      startedAt,
      note: "Laeuft im Hintergrund weiter - bitte in Kuerze neu laden.",
    });
    return;
  }

  res.status(200).json({
    success: true,
    mode: "manual",
    updatedAt: ergebnis.result.updatedAt,
    durationMs: ergebnis.result.durationMs,
    data: ergebnis.result.summary,
  });
});

app.use((err, req, res, next) => {
  console.error("[worker] unerwarteter Fehler im API-Handler:", err);
  res.status(500).json({ success: false, error: "internal error" });
});

app.listen(PORT, () => {
  log(`API auf Port ${PORT} (TZ=${TIMEZONE}, Secret ${INTERNAL_SECRET !== null ? "aktiv" : "NICHT gesetzt"})`);
});

cron.schedule("0 * * * *", runScheduledScrape, { timezone: TIMEZONE, noOverlap: true });
cron.schedule("*/15 * * * *", runScheduledWasserstand, { timezone: TIMEZONE, noOverlap: true });
log("Cron registriert: scrape+stats stuendlich, wasserstand alle 15 Minuten");
