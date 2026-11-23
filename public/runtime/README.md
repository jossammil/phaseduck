# Phase Deck offline base runtimes

The webR 0.6.1 and Pyodide 0.27.7 base distributions are pinned. Their official release asset digests and per-file source/digest records are in `manifest.json`. Code and runtime data are unmodified. Both runtimes need HTTP hosting from the local Mac. The webR package repository and extra Pyodide wheels are separate optional distributions.

## Reproducing the files

Download each `archives.*.url` listed in the manifest and verify its SHA-256. For each `files[]` entry, copy the specified member from the identified archive to its listed relative path. Download entries containing `url` directly from their source. Two standalone R license records are extracted from the gzip-compressed `doc.data.gz` file using the start and end offsets for their virtual filenames in `doc.js.metadata`. Verify every installed file against the listed size and digest.

The webR selection includes the ESM loader, worker, R JS/Wasm assets, BLAS and LAPACK libraries, and the complete release `vfs/` subtree. The graphics and encoding files in that tree support R plots. The Python selection includes the complete official core release and its Python 3.12.7 standard library. Additional upstream license/notice files accompany both.

## Verified on November 22, 2026

A fresh Google Chrome profile loaded both runtimes from a loopback HTTP server below a /deck/ subpath with external HTTP access blocked. webR reported R 4.6.0, computed 55, and returned one 480 by 320 plot. Pyodide ran a multiline function in a module worker and returned 26. Combined with a local DuckDB fixture check, the run observed 24 requests and zero external attempts. This tested the base bundled runtimes independently of the final application.
