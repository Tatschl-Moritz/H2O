// Zentrale Einstellungen. Hier kannst du bei Bedarf Werte anpassen.

export const config = {
  // Basis-URL der H2O-Seite
  baseUrl: "https://www.h2o-adventure.at",

  // Sprachpfad ("de" oder "en")
  lang: "de",

  // Zeitzone fuer die Datumsberechnung (heute / morgen)
  timezone: "Europe/Vienna",

  // Welche Tage sollen pro Lauf geholt werden?
  // 0 = heute, 1 = morgen. [0, 1] = beide.
  daysToScrape: [0, 1],

  // Pause zwischen den Abrufen der einzelnen Tour-Seiten (Millisekunden),
  // damit die H2O-Seite geschont wird.
  delayBetweenRequestsMs: 1500,

  // User-Agent, damit die Anfrage wie ein normaler Browser aussieht.
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",

  // Ausgabeordner (wird statisch ausgeliefert, z.B. via nginx/Coolify).
  // Per Env-Var ueberschreibbar, damit der Worker-Container ins gemeinsame
  // Volume (/shared/data, /shared/history) schreibt, waehrend lokale
  // Entwicklung ohne weitere Konfiguration in public/ schreibt.
  publicDir: "./public",
  dataDir: process.env.H2O_DATA_DIR || "./public/data",       // aktuelle Momentaufnahme pro Tag
  historyDir: process.env.H2O_HISTORY_DIR || "./public/history", // Verlaufs-Log pro Tag (waechst)
};
