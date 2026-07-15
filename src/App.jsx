import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

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

export default function App() {
  const [tab, setTab] = useState("heute"); // "heute" | "morgen"
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | empty | error
  // Bleibt beim Tab-Wechsel stehen, damit die "Stand"-Zeile nicht kurz
  // verschwindet, waehrend die Daten des anderen Tages nachgeladen werden.
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const dates = { heute: dateInVienna(0), morgen: dateInVienna(1) };

  useEffect(() => {
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
  if (status === "loading") {
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
  let pillX;
  if (tab === "heute") {
    pillX = "0%";
  } else {
    pillX = "100%";
  }

  let heuteClass = "";
  let morgenClass = "";
  if (tab === "heute") {
    heuteClass = "active";
  } else {
    morgenClass = "active";
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

  return (
    <div className="app">
      <header className="head">
        <p className="wordmark">H<b>2</b>O · Guide-Board</p>
        <div className="title-row">
          <h1>{formatLangdatum(dates[tab])}</h1>
          {stand}
        </div>

        <div className="toggle">
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
        Öffentliche Anmeldezahlen von h2o-adventure.at · stündlich aktualisiert 08–19 Uhr
      </p>
    </div>
  );
}
