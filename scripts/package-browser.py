"""Package the static site and local launch instructions into a reproducible ZIP."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
if not (dist / "index.html").is_file():
    raise SystemExit("Run npm run build first.")
out = root / "releases" / "phaseduck-browser.zip"
out.parent.mkdir(exist_ok=True)
instructions = """Phase Deck browser edition

Extract this whole archive. Open a terminal in the extracted folder and run:

    python3 -m http.server 4180 --bind 127.0.0.1 --directory site

On Windows with the Python launcher, use py -3 in place of python3.
Open http://localhost:4180 in your browser. Stop the server with Ctrl+C.
Base R, Python and DuckDB are bundled. Imported data stays in your browser.
Live radar needs internet access. The Mac native job runner is a separate tool.
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
