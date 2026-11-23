import { AsyncDuckDB, ConsoleLogger, LogLevel } from "@duckdb/duckdb-wasm";
const asset = (name) => new URL(name, document.baseURI).href;
let opening;
let imported,
  sequence = 0;
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
export async function addFile(file) {
  const { db, conn } = await ready();
  const name = "user-data-" + ++sequence + ".parquet";
  await db.registerFileHandle(name, file, 2, true);
  try {
    await conn.query(
      "CREATE OR REPLACE VIEW user_data AS SELECT * FROM read_parquet('" +
        name +
        "')",
    );
  } catch (e) {
    await db.dropFile(name);
    throw e;
  }
  if (imported) await db.dropFile(imported);
  imported = name;
}
