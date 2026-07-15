import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Kategorie -> Farbe (H2Os echte Kategorienamen)
function farbeFuerKategorie(kategorie) {
  if (kategorie === "Rafting") {
    return "var(--k-rafting)";
  } else if (kategorie === "Canyoning") {
    return "var(--k-canyoning)";
  } else if (kategorie === "Wasser Funsport") {
    return "var(--k-wasser)";
  } else if (kategorie === "Bergabenteuer") {
    return "var(--k-berg)";
  } else if (kategorie === "Hochseilgarten") {
    return "var(--k-seil)";
  } else {
    return "var(--k-default)";
  }
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

// Eine Tour-Zeile.
function TourRow({ tour, maxCount, index }) {
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
        <div className="num">{tour.anmeldungen}</div>
        <div className="lbl">Anmeldungen</div>
      </div>
    );
  }

  let location = tour.location;
  if (location === null || location === undefined) {
    location = "";
  }

  return (
    <motion.div
      className="row"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.04 }}
    >
      <div className="water" style={{ width: fill + "%" }} />
      <div className="time">{tour.time}</div>
      <div className="info">
        <div className="name">{tour.title}</div>
        <div className="sub">
          <span className="chip" style={{ background: farbeFuerKategorie(tour.kategorie) }}>
            {tour.kategorie}
          </span>
          <span className="loc">{location}</span>
        </div>
      </div>
      {countBlock}
    </motion.div>
  );
}

export default function App() {
  const [tab, setTab] = useState("heute"); // "heute" | "morgen"
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | empty | error

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
    body = (
      <div className="list">
        {data.tours.map((tour, i) => (
          <TourRow key={tour.url} tour={tour} maxCount={maxCount} index={i} />
        ))}
      </div>
    );
  }

  // Toggle: Pill-Position und aktive Klassen ohne Ternary vorberechnen.
  let pillStyle;
  if (tab === "heute") {
    pillStyle = { left: 4, right: "50%" };
  } else {
    pillStyle = { left: "50%", right: 4 };
  }

  let heuteClass = "";
  let morgenClass = "";
  if (tab === "heute") {
    heuteClass = "active";
  } else {
    morgenClass = "active";
  }

  // "Stand"-Zeile.
  let stand = null;
  if (data && data.updatedAt) {
    stand = (
      <div className="stand">
        <span className="dot" />
        Stand {formatStand(data.updatedAt)}
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
          <motion.div layoutId="pill" className="pill" style={pillStyle} />
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
