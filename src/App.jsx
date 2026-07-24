import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

// Feste Farbwerte statt CSS-Variablen, weil SVG-Attribute (fill/stroke) var()
// nicht zuverlaessig ueberall aufloesen. Muss synchron zu styles.css bleiben.
const FARBEN = {
  fg: "#ffffff",
  muted: "rgba(255, 255, 255, 0.45)",
  border: "rgba(255, 255, 255, 0.1)",
};

const TOOLTIP_STYLE = {
  background: "var(--bg)",
  border: "1px solid var(--border-med)",
  borderRadius: 10,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--fg)",
  padding: "8px 12px",
};

// Ohne das faellt Recharts bei Pie-Charts auf die (teils sehr blasse)
// Segmentfarbe fuer den Text zurueck -> im Tooltip kaum lesbar.
const TOOLTIP_ITEM_STYLE = { color: "var(--fg)" };
const TOOLTIP_LABEL_STYLE = { color: "var(--fg)" };

// Anzeige-Reihenfolge: erst Rafting, dann Canyoning, dann der Rest.
function tourGruppe(kategorie) {
  if (kategorie === "Rafting") {
    return { prioritaet: 0, label: "Rafting" };
  } else if (kategorie === "Canyoning") {
    return { prioritaet: 1, label: "Canyoning" };
  } else {
    return { prioritaet: 2, label: "Sonstige" };
  }
}

function sortiereTouren(tours) {
  return [...tours].sort((a, b) => {
    const pa = tourGruppe(a.kategorie).prioritaet;
    const pb = tourGruppe(b.kategorie).prioritaet;
    if (pa !== pb) {
      return pa - pb;
    }
    if (a.time < b.time) {
      return -1;
    } else if (a.time > b.time) {
      return 1;
    } else {
      return 0;
    }
  });
}

// Datum "2026-07-15" in der Zeitzone Wien berechnen (passt zu den Dateinamen).
function dateInVienna(offsetDays) {
  const base = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

function formatLangdatum(isoDate) {
  const [y, m, d] = isoDate.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatKurzdatum(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

function formatStand(iso) {
  const date = new Date(iso);
  return date.toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Eine Tour-Zeile. Animiert wird nur die Anmeldungen-Zahl, nicht die ganze Zeile,
// damit beim Tab-Wechsel nicht die komplette Liste von oben nach unten neu einfliegt.
function TourRow({ tour, maxCount }) {
  // Wasserstand-Breite: relativ zur vollsten Tour des Tages.
  let fill = 0;
  if (tour.anmeldungen !== null && maxCount > 0) {
    fill = Math.round((tour.anmeldungen / maxCount) * 100);
  }

  // Anzeige der Zahl bzw. Fehlt-Hinweis.
  let countBlock;
  if (tour.anmeldungen === null) {
    countBlock = (
      <div className="count empty">
        <div className="missing">nicht gefunden</div>
        <div className="lbl">Anmeldungen</div>
      </div>
    );
  } else {
    countBlock = (
      <div className="count">
        <AnimatePresence mode="wait">
          <motion.div
            key={tour.anmeldungen}
            className="num"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28 }}
          >
            {tour.anmeldungen}
          </motion.div>
        </AnimatePresence>
        <div className="lbl">Anmeldungen</div>
      </div>
    );
  }

  return (
    <div className="row">
      <div className="water" style={{ width: fill + "%" }} />
      <div className="time">{tour.time}</div>
      <div className="info">
        <div className="name">{tour.title}</div>
      </div>
      {countBlock}
    </div>
  );
}

// Rahmen fuer ein einzelnes Diagramm: Titel + Chart-Flaeche.
function ChartCard({ titel, hoehe, children }) {
  return (
    <div className="chart-card">
      <div className="chart-title">{titel}</div>
      <div style={{ width: "100%", height: hoehe }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const ACHSEN_STIL = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fill: FARBEN.muted,
};

// Fuer Kuchendiagramme: monochromer Verlauf statt bunter Segmente,
// damit die 2-Farben-Regel des Designs eingehalten wird.
function mitVerlaufsfarbe(daten) {
  return daten.map((eintrag, i) => ({
    ...eintrag,
    farbe: `rgba(255, 255, 255, ${Math.max(0.2, 1 - i * 0.22)})`,
  }));
}

// Statistik-Tab: laedt die vorberechnete stats.json und zeigt die Graphen.
// Die Daten darin beruecksichtigen nur Scrapes bis 18 Uhr Wiener Zeit, weil
// danach Zahlen von den Chefs manuell nachbearbeitet werden koennen.
function Statistik() {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  // Index in stats.seasons; 0 = neueste Saison (Array ist neueste-zuerst sortiert).
  const [saisonIndex, setSaisonIndex] = useState(0);

  useEffect(() => {
    let aktiv = true;
    fetch("/data/stats.json")
      .then((res) => {
        if (res.ok === false) {
          throw new Error("not found");
        }
        return res.json();
      })
      .then((json) => {
        if (aktiv === false) {
          return;
        }
        setStats(json);
        setStatus("ok");
      })
      .catch(() => {
        if (aktiv === true) {
          setStatus("error");
        }
      });
    return () => {
      aktiv = false;
    };
  }, []);

  if (status === "loading") {
    return <div className="state">Lade Statistik …</div>;
  }
  if (status === "error" || stats.seasons.length === 0) {
    return <div className="state">Statistik ist noch nicht verfuegbar.</div>;
  }

  const saison = stats.seasons[saisonIndex] || stats.seasons[0];

  const wochentagKurz = {
    Montag: "Mo",
    Dienstag: "Di",
    Mittwoch: "Mi",
    Donnerstag: "Do",
    Freitag: "Fr",
    Samstag: "Sa",
    Sonntag: "So",
  };

  const stundenDaten = saison.bookingActivityByHour
    .filter((eintrag) => eintrag.total > 0)
    .map((eintrag) => ({
      label: String(eintrag.hour).padStart(2, "0") + ":00",
      total: eintrag.total,
    }));

  const kategorieDaten = mitVerlaufsfarbe(
    saison.byKategorie.map((eintrag) => ({
      label: eintrag.kategorie,
      total: eintrag.total,
    }))
  );

  const wochentagDaten = saison.byWeekday.map((eintrag) => ({
    label: wochentagKurz[eintrag.weekday] || eintrag.weekday,
    total: eintrag.avgTotal,
  }));

  const tourenDaten = saison.topTouren.map((eintrag) => ({
    label: eintrag.label,
    tour: eintrag.tour,
    total: eintrag.total,
  }));

  const saisonDaten = saison.seasonTrend.map((eintrag) => ({
    label: eintrag.date.slice(5), // MM-DD reicht, Jahr ist immer gleich
    total: eintrag.total,
  }));

  return (
    <div className="stats">
      <div className="saison-auswahl">
        <select value={saisonIndex} onChange={(e) => setSaisonIndex(Number(e.target.value))}>
          {stats.seasons.map((eintrag, i) => (
            <option key={eintrag.label} value={i}>
              {eintrag.label}
            </option>
          ))}
        </select>
      </div>

      <p className="stats-note">
        {saison.zeitraum && (
          <>
            Zeitraum: {formatKurzdatum(saison.zeitraum.von)} – {formatKurzdatum(saison.zeitraum.bis)}
            <br />
          </>
        )}
        Nur Anmeldungen bis 18 Uhr gezaehlt — danach werden Zahlen teils manuell
        nachbearbeitet und sind keine echten Buchungen mehr.
      </p>

      <ChartCard titel="Wann wird gebucht (Zuwachs nach Uhrzeit)" hoehe={220}>
        <BarChart data={stundenDaten}>
          <CartesianGrid vertical={false} stroke={FARBEN.border} />
          <XAxis dataKey="label" tick={ACHSEN_STIL} axisLine={{ stroke: FARBEN.border }} tickLine={false} />
          <YAxis tick={ACHSEN_STIL} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ fill: FARBEN.border }} />
          <Bar dataKey="total" fill={FARBEN.fg} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard titel="Anmeldungen nach Kategorie" hoehe={220}>
        <PieChart>
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
          <Pie data={kategorieDaten} dataKey="total" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={2}>
            {kategorieDaten.map((eintrag) => (
              <Cell key={eintrag.label} fill={eintrag.farbe} stroke="var(--bg)" strokeWidth={2} />
            ))}
          </Pie>
        </PieChart>
      </ChartCard>

      <div className="legend">
        {kategorieDaten.map((eintrag) => (
          <div className="legend-item" key={eintrag.label}>
            <span className="legend-dot" style={{ background: eintrag.farbe }} />
            {eintrag.label} · {eintrag.total}
          </div>
        ))}
      </div>

      <ChartCard titel="Ø Anmeldungen nach Wochentag" hoehe={200}>
        <BarChart data={wochentagDaten}>
          <CartesianGrid vertical={false} stroke={FARBEN.border} />
          <XAxis dataKey="label" tick={ACHSEN_STIL} axisLine={{ stroke: FARBEN.border }} tickLine={false} />
          <YAxis tick={ACHSEN_STIL} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ fill: FARBEN.border }} />
          <Bar dataKey="total" fill={FARBEN.fg} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard titel="Top Touren (gesamt)" hoehe={280}>
        <BarChart data={tourenDaten} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid horizontal={false} stroke={FARBEN.border} />
          <XAxis type="number" tick={ACHSEN_STIL} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="label"
            tick={ACHSEN_STIL}
            axisLine={false}
            tickLine={false}
            width={148}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
            cursor={{ fill: FARBEN.border }}
            formatter={(value, name, eintrag) => [value, eintrag.payload.tour]}
          />
          <Bar dataKey="total" fill={FARBEN.fg} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard titel="Anmeldungen pro Tag" hoehe={200}>
        <LineChart data={saisonDaten}>
          <CartesianGrid vertical={false} stroke={FARBEN.border} />
          <XAxis dataKey="label" tick={ACHSEN_STIL} axisLine={{ stroke: FARBEN.border }} tickLine={false} />
          <YAxis tick={ACHSEN_STIL} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ stroke: FARBEN.border }} />
          <Line type="monotone" dataKey="total" stroke={FARBEN.fg} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>
    </div>
  );
}

// Wasserstand-Tab: aktuelle Pegel-Werte + 24h-Verlauf je Messstelle.
function Wasserstand() {
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let aktiv = true;
    Promise.all([
      fetch("/data/wasserstand.json").then((res) => (res.ok ? res.json() : null)),
      fetch("/data/wasserstand-history.json").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([snapshotJson, historyJson]) => {
        if (aktiv === false) {
          return;
        }
        if (snapshotJson === null) {
          setStatus("error");
          return;
        }
        setSnapshot(snapshotJson);
        setHistory(historyJson || {});
        setStatus("ok");
      })
      .catch(() => {
        if (aktiv === true) {
          setStatus("error");
        }
      });
    return () => {
      aktiv = false;
    };
  }, []);

  if (status === "loading") {
    return <div className="state">Lade Wasserstand …</div>;
  }
  if (status === "error" || snapshot.stationen.length === 0) {
    return <div className="state">Wasserstand ist gerade nicht verfuegbar.</div>;
  }

  return (
    <div className="stats">
      <div className="stand">
        <span className="dot" />
        Stand {formatStand(snapshot.aktualisiertAm)}
      </div>

      <p className="stats-note">
        Pegel von Inn und Malchbach nahe der Imster Schlucht, Quelle: riverapp.net
        (Hydrographischer Dienst Tirol). Aktualisiert alle 15 Minuten.
      </p>

      {snapshot.stationen.map((station) => {
        const verlauf = (history[station.station] || []).map((eintrag) => ({
          label: new Date(eintrag.t).toLocaleTimeString("de-AT", {
            timeZone: "Europe/Vienna",
            hour: "2-digit",
            minute: "2-digit",
          }),
          cm: eintrag.cm,
        }));

        let abfluss = null;
        if (station.abflussM3s !== null) {
          abfluss = <span className="pegel-abfluss">{station.abflussM3s} m³/s</span>;
        }

        let temperatur = null;
        if (station.temperaturC !== null) {
          temperatur = <span className="pegel-abfluss">{station.temperaturC} °C</span>;
        }

        return (
          <div className="chart-card" key={station.station}>
            <div className="chart-title">
              {station.station} · {station.gewaesser}
            </div>
            <div className="pegel-aktuell">
              <span className="pegel-cm">{station.pegelCm} cm</span>
              {abfluss}
              {temperatur}
            </div>
            <div style={{ width: "100%", height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={verlauf}>
                  <CartesianGrid vertical={false} stroke={FARBEN.border} />
                  <XAxis
                    dataKey="label"
                    tick={ACHSEN_STIL}
                    axisLine={{ stroke: FARBEN.border }}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    tick={ACHSEN_STIL}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    domain={["dataMin - 2", "dataMax + 2"]}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    cursor={{ stroke: FARBEN.border }}
                    formatter={(value) => [`${value} cm`, "Pegel"]}
                  />
                  <Line type="monotone" dataKey="cm" stroke={FARBEN.fg} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}

      <a
        className="pegel-quelle"
        href="https://www.riverapp.net/"
        target="_blank"
        rel="noreferrer noopener"
      >
        Quelle: riverapp.net ↗
      </a>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("heute"); // "heute" | "morgen" | "statistik" | "wasserstand"
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | empty | error
  // Bleibt beim Tab-Wechsel stehen, damit die "Stand"-Zeile nicht kurz
  // verschwindet, waehrend die Daten des anderen Tages nachgeladen werden.
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const dates = { heute: dateInVienna(0), morgen: dateInVienna(1) };

  useEffect(() => {
    if (tab === "statistik" || tab === "wasserstand") {
      return;
    }

    let aktiv = true;
    setStatus("loading");
    setData(null);

    const datum = dates[tab];
    fetch(`/data/${datum}.json`)
      .then((res) => {
        if (res.ok === false) {
          throw new Error("not found");
        }
        return res.json();
      })
      .then((json) => {
        if (aktiv === false) {
          return;
        }
        setData(json);
        if (json.updatedAt) {
          setLastUpdatedAt(json.updatedAt);
        }
        if (json.tours && json.tours.length > 0) {
          setStatus("ok");
        } else {
          setStatus("empty");
        }
      })
      .catch(() => {
        if (aktiv === true) {
          setStatus("error");
        }
      });

    return () => {
      aktiv = false;
    };
  }, [tab]);

  // Vollste Tour des Tages (fuer die Wasserstand-Skala).
  let maxCount = 0;
  if (data && data.tours) {
    for (const t of data.tours) {
      if (t.anmeldungen !== null && t.anmeldungen > maxCount) {
        maxCount = t.anmeldungen;
      }
    }
  }

  // Hauptbereich je nach Zustand.
  let body;
  if (tab === "statistik") {
    body = <Statistik />;
  } else if (tab === "wasserstand") {
    body = <Wasserstand />;
  } else if (status === "loading") {
    body = <div className="state">Lade Programm …</div>;
  } else if (status === "error") {
    body = (
      <div className="state">
        Für <b>{formatLangdatum(dates[tab])}</b> liegen noch keine Daten vor.<br />
        Der nächste Abruf holt sie automatisch.
      </div>
    );
  } else if (status === "empty") {
    body = (
      <div className="state">
        Keine Touren an diesem Tag.
      </div>
    );
  } else {
    // Touren ohne Anmeldungen (0) blenden wir aus, die sind fuer die Guides irrelevant.
    const relevanteTouren = data.tours.filter((tour) => tour.anmeldungen !== 0);
    const sortiert = sortiereTouren(relevanteTouren);
    const items = [];
    let vorherigeGruppe = null;
    sortiert.forEach((tour) => {
      const gruppe = tourGruppe(tour.kategorie);
      if (gruppe.prioritaet !== vorherigeGruppe) {
        items.push(
          <div className="divider" key={`divider-${tour.url}`}>
            {gruppe.label}
          </div>
        );
      }
      items.push(<TourRow key={tour.url} tour={tour} maxCount={maxCount} />);
      vorherigeGruppe = gruppe.prioritaet;
    });

    if (items.length === 0) {
      body = <div className="state">Keine Touren mit Anmeldungen an diesem Tag.</div>;
    } else {
      body = <div className="list">{items}</div>;
    }
  }

  // Toggle: Pill-Verschiebung per Transform (statt left/right), damit es
  // ruckelfrei ueber die GPU animiert wird statt bei jedem Frame ein Layout-Reflow auszuloesen.
  const pillX = { heute: "0%", morgen: "100%", statistik: "200%", wasserstand: "300%" }[tab];

  let heuteClass = "";
  let morgenClass = "";
  let statistikClass = "";
  let wasserstandClass = "";
  if (tab === "heute") {
    heuteClass = "active";
  } else if (tab === "morgen") {
    morgenClass = "active";
  } else if (tab === "statistik") {
    statistikClass = "active";
  } else {
    wasserstandClass = "active";
  }

  // "Stand"-Zeile: nutzt den zuletzt bekannten Wert, damit sie beim
  // Tab-Wechsel nicht kurz verschwindet.
  let stand = null;
  if (lastUpdatedAt) {
    stand = (
      <div className="stand">
        <span className="dot" />
        Stand {formatStand(lastUpdatedAt)}
      </div>
    );
  }

  // Kopfzeile: Datum+Stand fuer Heute/Morgen, ein einfacher Titel sonst.
  let titelBereich;
  if (tab === "statistik") {
    titelBereich = (
      <div className="title-row">
        <h1>Statistik</h1>
      </div>
    );
  } else if (tab === "wasserstand") {
    titelBereich = (
      <div className="title-row">
        <h1>Wasserstand</h1>
      </div>
    );
  } else {
    titelBereich = (
      <div className="title-row">
        <h1>{formatLangdatum(dates[tab])}</h1>
        {stand}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="head">
        <p className="wordmark">H<b>2</b>O · Guide-Board</p>
        {titelBereich}

        <div className="toggle toggle-4">
          <motion.div
            className="pill"
            animate={{ x: pillX }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          />
          <button className={heuteClass} onClick={() => setTab("heute")}>
            Heute
          </button>
          <button className={morgenClass} onClick={() => setTab("morgen")}>
            Morgen
          </button>
          <button className={statistikClass} onClick={() => setTab("statistik")}>
            Statistik
            <span className="badge-neu">Neu</span>
          </button>
          <button className={wasserstandClass} onClick={() => setTab("wasserstand")}>
            Wasserstand
            <span className="badge-neu">Neu</span>
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.main
          key={tab + status}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {body}
        </motion.main>
      </AnimatePresence>

      <p className="foot">
        Öffentliche Anmeldezahlen von h2o-adventure.at · stündlich aktualisiert
      </p>
    </div>
  );
}
