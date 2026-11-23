# Phase Deck

An ambient browser workbench for a spare display. Nine procedural instruments turn time, radar, calendars and dataset signals into moving geometry. Open the terminal for webR, Python, DuckDB SQL and a Vim-style editor. The base runtimes load on demand.

[Open Phase Deck](https://jossammil.github.io/phaseduck/) · [Download the current release](https://github.com/jossammil/phaseduck/releases/latest)

The **browser edition** runs on Windows, Mac and Linux. The optional **Apple silicon Mac companion** adds native jobs, persistent logs and Neovim. The Mac download is ad-hoc signed and has no Apple notarization. Native R jobs use a local installation of R.

## Try it

- Choose **Patch signals** and recall **Rush-hour dunes** to see the January 2024 NYC taxi pickup pattern. Click a ridge to inspect the hourly total.
- Open **Terminal** and enter `sql SELECT sum(trips) FROM trips`. The bundled Parquet fixture contains 744 hourly counts.
- Enter `edit shell.py` or `edit wave.R`, then select **Run code**. Use **Data Loom → Open Parquet** to explore a file on your computer.

Scripts, patches and imported calendar times are stored in your browser. Export anything you want to move between the hosted and local editions. Archived radar works offline. **Latest observation** requests data from Iowa Environmental Mesonet. Native jobs and Neovim require the separate Mac companion.

## Run from source

Install Node.js 22 and Python 3. From the repository root, run:

```sh
npm ci
npm run build
npm start
```

Open http://localhost:4180. To produce the standalone browser download, run `npm run package:browser`. The resulting `releases/phaseduck-browser.zip` contains the built site, bundled runtimes, sample data and local startup instructions. The Pages workflow builds the same frontend on pushes to main.

See the [fixture provenance](public/data/SOURCE.md), [language runtime manifest](public/runtime/manifest.json) and [third-party notices](public/notices/). Upstream projects publish the matching [webR source](https://github.com/r-wasm/webr/tree/v0.6.1) and [Pyodide source](https://github.com/pyodide/pyodide/tree/0.27.7).
