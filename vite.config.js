import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Alles unter public/ (inkl. data/ und history/) wird 1:1 statisch ausgeliefert.
export default defineConfig({
  plugins: [react()],
});
