import { build } from "esbuild";
import { rm, mkdir, cp, copyFile, writeFile, readFile } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/vendor", { recursive: true });
await cp("public", "dist", { recursive: true });
for (const file of ["duckdb-eh.wasm", "duckdb-browser-eh.worker.js"])
  await copyFile(
    "node_modules/@duckdb/duckdb-wasm/dist/" + file,
    "dist/vendor/" + file,
  );
await copyFile(
  "node_modules/@xterm/xterm/css/xterm.css",
  "dist/vendor/xterm.css",
);
await build({
  entryPoints: ["src/app.js"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  splitting: false,
  external: ["./editor.js", "./r-runtime.js", "./database.js", "./native.js"],
});
for (const name of ["editor", "r-runtime", "database", "native", "py-worker"])
  await build({
    entryPoints: ["src/" + name + ".js"],
    outfile: "dist/" + name + ".js",
    format: "esm",
    target: "es2022",
    minify: true,
    bundle: true,
  });
await writeFile("dist/.nojekyll", "");

const days = JSON.parse(await readFile("public/data/days.json", "utf8"));
const values = Array.from({ length: 24 }, (_, h) =>
  days.reduce((sum, d) => sum + d.hours[h], 0),
);
const sig = { values, unit: "trips" };
const patches = {
  "Rush-hour dunes": {
    version: 1,
    scene: "dunes",
    name: "trip_hours",
    target: "dunes.height",
    signal: sig,
    marks: [],
  },
  "Pickup harmonics": {
    version: 1,
    scene: "orbit",
    name: "trip_hours",
    target: "orbit.radius",
    signal: sig,
    marks: [],
  },
};
await writeFile("dist/data/patches.json", JSON.stringify(patches));
