"""Package the static site and local launch instructions into a reproducible ZIP."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
if not (dist / "index.html").is_file():
    raise SystemExit("Run npm run build first.")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=root / "releases/phaseduck-browser.zip")
out = parser.parse_args().output.resolve()
out.parent.mkdir(parents=True, exist_ok=True)
instructions = """Phase Deck browser edition

Extract this whole archive. Open a terminal in the extracted folder and run:

    python3 -m http.server 4180 --bind 127.0.0.1 --directory site

On Windows with the Python launcher, use py -3 in place of python3.
Open http://localhost:4180 in your browser. Stop the server with Ctrl+C.
Base R, Python and DuckDB are bundled. Imported data stays in your browser.
Use Explore data for CSV and Parquet, Compose to arrange layers, and Ambient
display to open a separate window. Music Visualizer can play a local audio file.
Rain Glass replays bundled radar offline. Latest observation needs internet
access. Traffic Patterns and Terrain Profiles include bundled observations.
Use Export 4K still to save an instrument or composition as a PNG.
The Mac native job runner is a separate tool.
"""
def add(archive, name, data):
    entry = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    entry.external_attr = 0o100644 << 16
    archive.writestr(entry, data, compress_type=ZIP_DEFLATED, compresslevel=6)

with ZipFile(out, "w") as archive:
    add(archive, "README.txt", instructions.encode())
    for path in sorted(dist.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Unexpected symlink in build: {path}")
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(dist).parts):
            add(archive, "site/" + path.relative_to(dist).as_posix(), path.read_bytes())
print(out)
