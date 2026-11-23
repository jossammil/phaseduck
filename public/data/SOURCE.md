# Phase Deck data sources

## January 2024 yellow taxi pickups

NYC Taxi and Limousine Commission publishes monthly yellow taxi trip records. Phase Deck uses the calendar day and hour of the reported pickup timestamp in New York local time. Counts represent reported records, including all fare and distance values. [TLC source catalog](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page) · [January 2024 source Parquet](https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet)

Verified on November 22, 2026 with DuckDB 1.4.3. The source file contains 2,964,624 rows, spans 49,961,641 bytes, and has SHA-256 `c4d59da7bbc8abaeeeb1727947ee93d9891a71acb42854bd80db1571b2030510`. The January date filter keeps 2,964,606 rows. Eighteen source rows fall outside the requested month.

The 744 date/hour combinations cover all 31 days. The grid fills a missing hour with zero. All hours in this fixture had observations. January 1 at 00:00 has 6,596 trips. The smallest hourly count is 157.

- `trips.parquet` has columns `date` (DATE), `hour` (SMALLINT), and `trips` (INTEGER). File size is 3,922 bytes. SHA-256 is `7d5cc357e3db40850e4515bb84a41e4c41228d25349aceeae6a6d1537e1f0268`.
- `days.json` lists 31 objects with ISO dates and 24 counts in hour order. File size is 4,581 bytes. SHA-256 is `3eb9db2752fb6ef7b9153a4d7112b64f09d5f0236a51399484651cadc348cf57`.

To regenerate, download the source as `yellow_tripdata_2024-01.parquet` and run `fixture.sql` in a scratch directory with DuckDB and its Parquet and JSON extensions. The bundled JSON uses compact jsonlite serialization of the same data. Encoders and DuckDB versions may change output bytes. Check the row counts and compare all 744 values across files when regenerating.

## Radar reflectivity

Rain Glass uses the Iowa Environmental Mesonet NEXRAD composite. Jackson’s six archived frames are from March 25, 2023 UTC. The Gulf Coast’s six are from April 10, 2024, 13:00–15:30 UTC. The [archive manifest](radar/index.json) records the bounds, exact timestamps, and original WMS URLs. The renderer takes the peak palette-matched reflectivity per display cell and keeps missing cells out of contour interpolation. [IEM mosaic documentation](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/)

## Hourly traffic counts

The 744 rows in [the bundled CSV](fhwa-hourly-counts.csv) are for Louisiana LTPP station `22-0100`, direction 1, lane 1, July 2015. The source is the `HH_CL_CT` table in FHWA LTPP InfoPave’s SDR 40 **Hourly Class Counts AL MT** archive. The extract sums the reported vehicle-class counts for each valid hour. The art compares hourly medians, with 23 weekdays and eight weekend days contributing to every hour. The original FHWA TMAS Mississippi ZIPs could not be retrieved during development. [FHWA InfoPave standard data release](https://infopave.fhwa.dot.gov/Data/StandardDataRelease/) · [FHWA traffic data guide](https://highways.fhwa.dot.gov/sites/fhwa.dot.gov/files/FHWA-HRT-24-062.pdf)

## Natchez elevation profiles

The bundled [terrain sample](natchez-terrain.json) contains 22 west-to-east ground elevation profiles, each 112 points wide, sampled in metres from the USGS 3DEP Elevation ImageServer. The JSON retains the request URL and WGS84 bounds. Run `python3 scripts/terrain-sample.py` from the repository root to regenerate it. [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program/)
