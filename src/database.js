import { AsyncDuckDB, ConsoleLogger, DuckDBDataProtocol, LogLevel } from "@duckdb/duckdb-wasm";
const asset = (name) => new URL(name, document.baseURI).href;
let opening;
let imported,
  sequence = 0;
let imports = Promise.resolve();
async function start() {
  const worker = new Worker(asset("vendor/duckdb-browser-eh.worker.js"));
  const db = new AsyncDuckDB(new ConsoleLogger(LogLevel.WARNING), worker);
  try {
    await db.instantiate(asset("vendor/duckdb-eh.wasm"));
    await db.open({ maximumThreads: 1, query: { castDecimalToDouble: true } });
    const conn = await db.connect();
    await conn.query(
      "SET custom_extension_repository='" +
        asset("vendor/extensions").replaceAll("'", "''") +
        "'; LOAD parquet",
    );
    const response = await fetch(asset("data/trips.parquet"));
    if (!response.ok) throw new Error("Missing taxi sample");
    await db.registerFileBuffer(
      "trips.parquet",
      new Uint8Array(await response.arrayBuffer()),
    );
    await conn.query(
      "CREATE VIEW trips AS SELECT * FROM read_parquet('trips.parquet')",
    );
    return { db, conn };
  } catch (error) {
    await db.terminate();
    throw error;
  }
}
function ready() {
  return (opening ??= start().catch((error) => {
    opening = null;
    throw error;
  }));
}
export async function sql(query, limit = 4097) {
  const { conn } = await ready();
  const source = query.trim().replace(/;+\s*$/, "");
  const table = await conn.query(
    "SELECT * FROM (" + source + ") AS deck_result LIMIT " + limit,
  );
  return records(table);
}
function records(table) {
  return Array.from(table, (row) =>
    Object.fromEntries(
      Object.entries(row.toJSON()).map(([k, v]) => [
        k,
        typeof v === "bigint"
          ? Number.isSafeInteger(Number(v))
            ? Number(v)
            : String(v)
          : v,
      ]),
    ),
  );
}
export function addFile(file) {
  const task = imports.then(() => register(file));
  imports = task.catch(() => {});
  return task;
}
async function register(file) {
  const { db, conn } = await ready();
  const suffix = file.name.toLowerCase().split(".").at(-1);
  if (!["csv", "parquet"].includes(suffix)) throw Error("Choose a CSV or Parquet file.");
  const name = "user-data-" + ++sequence + "." + suffix;
  const source = (suffix === "csv" ? "read_csv_auto" : "read_parquet") + "('" + name + "')";
  await db.registerFileHandle(name, file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
  let dataset;
  try {
    const columns = records(await conn.query("DESCRIBE SELECT * FROM " + source));
    const rows = records(await conn.query("SELECT * FROM " + source + " LIMIT 25"));
    await conn.query("CREATE OR REPLACE VIEW user_data AS SELECT * FROM " + source);
    dataset = { name: file.name, columns, rows };
  } catch (e) {
    await db.dropFile(name);
    throw e;
  }
  if (imported) await db.dropFile(imported);
  imported = name;
  return dataset;
}

export function numericColumn(type) {
  return /^(U?(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|FLOAT|DOUBLE|DECIMAL\(\d+,\s*\d+\))$/.test(type);
}

export function fieldQueries(field) {
  const column = '"' + field.replaceAll('"', '""') + '"';
  const scan = `SELECT row_number() OVER () AS source_row,
       TRY_CAST(${column} AS DOUBLE) AS value
FROM user_data`;
  return {
    signal: `WITH scanned AS (
  ${scan}
), sampled AS (
  SELECT source_row, value, ntile(4096) OVER (ORDER BY source_row) AS position
  FROM scanned WHERE isfinite(value)
)
SELECT first(value ORDER BY source_row) AS value
FROM sampled GROUP BY position ORDER BY position`,
    histogram: `WITH scanned AS (
  ${scan}
), stats AS (
  SELECT min(value) FILTER (WHERE isfinite(value)) AS minimum,
         max(value) FILTER (WHERE isfinite(value)) AS maximum,
         count(*) FILTER (WHERE isfinite(value)) AS usable,
         count(*) - count(*) FILTER (WHERE isfinite(value)) AS excluded
  FROM scanned
), bucketed AS (
  SELECT CASE WHEN minimum = maximum THEN 0 ELSE
    least(19, floor(20 * CASE
      WHEN isfinite(maximum - minimum) THEN (value - minimum) / (maximum - minimum)
      ELSE (value / 2 - minimum / 2) / (maximum / 2 - minimum / 2)
    END)::INTEGER) END AS bin
  FROM scanned CROSS JOIN stats WHERE isfinite(value)
), counts AS (
  SELECT bin, count(*) AS frequency FROM bucketed GROUP BY bin
)
SELECT bin, coalesce(frequency, 0) AS frequency, minimum, maximum, usable, excluded
FROM stats CROSS JOIN range(20) AS bins(bin) LEFT JOIN counts USING (bin)
WHERE bin = 0 OR minimum <> maximum ORDER BY bin`,
  };
}
