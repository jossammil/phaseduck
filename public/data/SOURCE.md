# January 2024 yellow taxi pickups

NYC Taxi and Limousine Commission publishes monthly yellow taxi trip records. Phase Deck uses the calendar day and hour of the reported pickup timestamp in New York local time. Counts represent reported records, including all fare and distance values. [TLC source catalog](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page) · [January 2024 source Parquet](https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet)

Verified on November 22, 2026 with DuckDB 1.4.3. The source file contains 2,964,624 rows, spans 49,961,641 bytes, and has SHA-256 `c4d59da7bbc8abaeeeb1727947ee93d9891a71acb42854bd80db1571b2030510`. The January date filter keeps 2,964,606 rows. Eighteen source rows fall outside the requested month.

The 744 date/hour combinations cover all 31 days. The grid fills a missing hour with zero. All hours in this fixture had observations. January 1 at 00:00 has 6,596 trips. The smallest hourly count is 157.

- `trips.parquet` has columns `date` (DATE), `hour` (SMALLINT), and `trips` (INTEGER). File size is 3,922 bytes. SHA-256 is `7d5cc357e3db40850e4515bb84a41e4c41228d25349aceeae6a6d1537e1f0268`.
- `days.json` lists 31 objects with ISO dates and 24 counts in hour order. File size is 4,581 bytes. SHA-256 is `3eb9db2752fb6ef7b9153a4d7112b64f09d5f0236a51399484651cadc348cf57`.

To regenerate, download the source as `yellow_tripdata_2024-01.parquet` and run `fixture.sql` in a scratch directory with DuckDB and its Parquet and JSON extensions. The bundled JSON uses compact jsonlite serialization of the same data. Encoders and DuckDB versions may change output bytes. Check the row counts and compare all 744 values across files when regenerating.
