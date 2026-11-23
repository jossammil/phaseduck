# Phase Deck

An ambient browser workbench for a spare display. Procedural instruments turn time, radar, calendars, audio and dataset signals into moving geometry. Open the terminal for webR, Python, DuckDB SQL and a Vim-style editor. The base runtimes load on demand.

[Open Phase Deck](https://jossammil.github.io/phaseduck/) · [Download the current release](https://github.com/jossammil/phaseduck/releases/latest)

The **browser edition** runs on Windows, Mac and Linux. The optional **Apple silicon Mac companion** adds native jobs, persistent logs and Neovim. The Mac download is ad-hoc signed and has no Apple notarization. Native R jobs use a local installation of R.

## Try it

- Choose **Patch signals** and recall **Rush-hour dunes** to see the January 2024 NYC taxi pickup pattern. Click a ridge to inspect the hourly total.
- Open **Terminal** and enter `sql SELECT sum(trips) FROM trips`. The bundled Parquet fixture contains 744 hourly counts.
- Enter `edit shell.py` or `edit wave.R`, then select **Run code**.

## Explore a CSV or Parquet file

1. Select **Explore data**, then **Open CSV or Parquet**. The preview shows column types and the first 25 rows.
2. Choose a numeric field. The histogram counts all finite values, and the visual uses up to 4,096 values sampled in file order.
3. Choose Dunes, Silk Waves, or Harmonics and select **Apply to instrument**. Use **Add instrument layer** or **Add histogram layer** to place the result in a composition.
4. Expand **Generated SQL** and copy the signal or histogram query. In **Terminal**, type `sql ` and paste the query. The current file is available as `user_data`.

Files are read on your device. Saved data layers contain the values or histogram counts used in the composition. Reopen the original file to query it in a new session.

## Compose a visual or play music

1. Select **Compose** to start with the current instrument. Pick a layer type and select **Add layer**. A composition holds up to six layers.
2. Drag a layer to move it and use its corner handle to resize it. The layer inspector provides keyboard-accessible position and size fields, opacity, blend mode, and source settings. Use **Bring forward** or **Send backward** to change the stacking order.
3. Name the composition and select **Save composition**. Reopen it from **Saved compositions** or select **Add to favorites** to use it in the ambient rotation.

For music, open **Music Visualizer → Music input → Open audio file**. Choose Waveform, Radial spectrum, or Spectral ribbons and adjust the palette and sensitivity. The music visualizer is also available as a layer. Safari and desktop playback capture are available for testing in the Mac companion’s opt-in audio preview.

## Set up a spare display

1. Select **Ambient display**. Add and order your favorite instruments or compositions and choose how long each stays on screen.
2. Select **Open ambient display**, move the window to the spare monitor, and select **Full screen**. Use **Pause motion** to hold the current scene.
3. When connected to the Mac companion, the display shows active Phase Deck downloads or jobs that report activity. It shows a brief outcome cue and then resumes the prior favorite.

Scripts, patches, compositions, and ambient favorites are saved for the current site address and browser profile. Archived radar works offline. **Latest observation** requests data from Iowa Environmental Mesonet.

## Run from source

Install Node.js 22 and Python 3. From the repository root, run:

```sh
npm ci
npm run build
npm start
```

Open http://localhost:4180. To produce the standalone browser download, run `npm run package:browser`. The resulting `releases/phaseduck-browser.zip` contains the built site, bundled runtimes, sample data and local startup instructions. The Pages workflow builds the same frontend on pushes to main.

See the [fixture provenance](public/data/SOURCE.md), [language runtime manifest](public/runtime/manifest.json) and [third-party notices](public/notices/). Upstream projects publish the matching [webR source](https://github.com/r-wasm/webr/tree/v0.6.1) and [Pyodide source](https://github.com/pyodide/pyodide/tree/0.27.7).
