"""Extract the small GeoTIFF requested from the USGS 3DEP image service."""
import argparse
import json
from pathlib import Path
import struct
from urllib.parse import urlencode
from urllib.request import urlopen

BOUNDS = [-91.47, 31.47, -91.22, 31.64]
SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
QUERY = urlencode({
    "bbox": ",".join(map(str, BOUNDS)), "bboxSR": 4326, "imageSR": 4326,
    "size": "112,22", "format": "tiff", "pixelType": "F32",
    "adjustAspectRatio": "false", "f": "image",
})


def decode(data):
    endian = {b"II": "<", b"MM": ">"}[data[:2]]
    magic, offset = struct.unpack_from(endian + "HI", data, 2)
    if magic != 42:
        raise ValueError("Expected a classic GeoTIFF.")
    entries = struct.unpack_from(endian + "H", data, offset)[0]
    tags = {}
    for index in range(entries):
        pos = offset + 2 + 12 * index
        key, kind, count = struct.unpack_from(endian + "HHI", data, pos)
        if count == 1 and kind in (3, 4):
            tags[key] = struct.unpack_from(endian + ("H" if kind == 3 else "I"), data, pos + 8)[0]
    width, height = tags[256], tags[257]
    tile_width, tile_height = tags[322], tags[323]
    if (width > tile_width or height > tile_height or tags[258] != 32 or
            tags[259] != 1 or tags[277] != 1 or tags[339] != 3):
        raise ValueError("Expected one uncompressed floating-point elevation tile.")
    rows = [list(struct.unpack_from(endian + f"{width}f", data, tags[324] + row * tile_width * 4))
            for row in range(height)]
    if not all(-50 <= value <= 500 for row in rows for value in row):
        raise ValueError("Unexpected elevation or missing data in the requested extent.")
    return [[round(value, 1) for value in row] for row in rows]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Decode a previously downloaded TIFF.")
    parser.add_argument("--output", type=Path, default=Path("public/data/natchez-terrain.json"))
    options = parser.parse_args()
    if options.input:
        raw = options.input.read_bytes()
    else:
        with urlopen(SERVICE + "?" + QUERY, timeout=20) as response:
            raw = response.read()
    result = {"name": "Natchez and the Mississippi River", "source": "USGS 3DEP",
              "url": SERVICE + "?" + QUERY, "bounds": BOUNDS, "rows": decode(raw)}
    options.output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
