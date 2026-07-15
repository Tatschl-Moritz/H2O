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

  // Ausgabeordner (wird von Vercel statisch ausgeliefert)
  publicDir: "./public",
  dataDir: "./public/data",       // aktuelle Momentaufnahme pro Tag
  historyDir: "./public/history", // Verlaufs-Log pro Tag (waechst)
};
