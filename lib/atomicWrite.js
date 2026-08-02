// Schreibt eine Datei atomar: zuerst in eine temporaere Datei im selben
// Verzeichnis, dann per rename() ersetzt (auf POSIX-Dateisystemen atomar).
// Verhindert, dass ein gleichzeitiger Leser (z.B. nginx fuer das Frontend)
// eine halb geschriebene JSON-Datei serviert.
import { writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function atomicWriteFile(path, data) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, data, "utf8");
  await rename(tmpPath, path);
}
