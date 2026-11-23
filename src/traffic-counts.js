const count = /^\d+$/;

function median(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function profileTraffic(rows, provenance = {}) {
  if (!rows.length) throw Error("Choose a CSV containing hourly counts.");
  const groups = Array.from({ length: 2 }, () => Array.from({ length: 24 }, () => []));
  const seen = new Set();
  let station = "", first = "", last = "";
  for (const [index, row] of rows.entries()) {
    const site = String(row.station_id ?? "").trim();
    const date = String(row.date ?? "").trim();
    const hour = String(row.hour ?? "").trim();
    const vehicles = String(row.vehicles ?? "").trim();
    const time = new Date(date + "T00:00:00Z");
    const validDate = /^\d{4}-\d\d-\d\d$/.test(date) && Number.isFinite(+time) &&
      time.toISOString().startsWith(date + "T");
    if (!site || site.length > 80 || !validDate || !count.test(hour) || Number(hour) > 23 ||
        !count.test(vehicles) || !Number.isSafeInteger(Number(vehicles))) {
      throw Error(`Data row ${index + 1} needs station_id, date (YYYY-MM-DD), hour (0–23), and a whole, nonnegative vehicles count.`);
    }
    if (station && station !== site) throw Error("Use one counting station per CSV.");
    station = site;
    const key = date + "/" + Number(hour);
    if (seen.has(key)) throw Error("Use one count per station, date and hour. Duplicate: " + key);
    seen.add(key);
    if (!first || date < first) first = date;
    if (date > last) last = date;
    const weekend = time.getUTCDay() === 6 || time.getUTCDay() === 0;
    groups[Number(weekend)][Number(hour)].push(Number(vehicles));
  }
  const [weekday, weekend] = groups.map((hours) => hours.map(median));
  if (weekday.every((x) => x === null) || weekend.every((x) => x === null))
    throw Error("Include counts for at least one weekday and one weekend day.");
  return {
    station, first, last, weekday, weekend,
    sampleSizes: groups.map((hours) => hours.map((values) => values.length)),
    ...provenance,
  };
}
