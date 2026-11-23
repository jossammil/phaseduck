-- Run from a temporary directory containing yellow_tripdata_2024-01.parquet.
-- The two COPY statements create trips.parquet and days.json in that directory.
CREATE TEMP TABLE trips AS
WITH
  calendar AS (
    SELECT CAST(ts AS DATE) AS date, CAST(hour(ts) AS SMALLINT) AS hour
    FROM generate_series(TIMESTAMP '2024-01-01', TIMESTAMP '2024-01-31 23:00', INTERVAL '1 hour') AS s(ts)
  ),
  counted AS (
    SELECT CAST(tpep_pickup_datetime AS DATE) AS date,
           CAST(hour(tpep_pickup_datetime) AS SMALLINT) AS hour,
           count(*) AS trips
    FROM read_parquet('yellow_tripdata_2024-01.parquet')
    WHERE tpep_pickup_datetime >= TIMESTAMP '2024-01-01'
      AND tpep_pickup_datetime < TIMESTAMP '2024-02-01'
    GROUP BY 1, 2
  )
SELECT c.date, c.hour, CAST(coalesce(t.trips, 0) AS INTEGER) AS trips
FROM calendar c
LEFT JOIN counted t USING (date, hour)
ORDER BY c.date, c.hour;

COPY trips TO 'trips.parquet' (FORMAT PARQUET, COMPRESSION SNAPPY);
COPY (
  SELECT strftime(date, '%Y-%m-%d') AS date, list(trips ORDER BY hour) AS hours
  FROM trips GROUP BY date ORDER BY date
) TO 'days.json' (FORMAT JSON, ARRAY true);
