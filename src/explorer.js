const targetLabels = [
  ["dunes.height", "Dunes"],
  ["waves.amplitude", "Silk Waves"],
  ["orbit.radius", "Harmonics"],
];

export function dataExplorer(ui, apply, addHistogram) {
  const { elt, button, choose, modal, picker, copy } = ui;
  let dataset = null;
  let profile = null;
  let target = targetLabels[0][0];
  let revision = 0;
  let opening = false;
  let analyzing = false;
  let message = "";

  function preview() {
    const box = elt("div", undefined, "data-table");
    const table = elt("table");
    const head = table.createTHead().insertRow();
    for (const { column_name, column_type } of dataset.columns) {
      const th = elt("th", column_name);
      th.scope = "col";
      th.append(elt("small", column_type));
      head.append(th);
    }
    const body = table.createTBody();
    for (const row of dataset.rows) {
      const tr = body.insertRow();
      for (const { column_name } of dataset.columns) {
        const value = row[column_name];
        const cell = tr.insertCell();
        cell.textContent = value == null ? "—" : String(value).slice(0, 350);
      }
    }
    box.append(table);
    return box;
  }

  async function load(file) {
    if (!file || opening) return;
    opening = true;
    analyzing = false;
    message = "";
    ++revision;
    render();
    try {
      const db = await import("./database.js");
      const next = await db.addFile(file);
      dataset = { ...next, numeric: next.columns.filter((c) => db.numericColumn(c.column_type)) };
      profile = null;
    } catch (error) {
      message = "Could not open the file. " + error.message;
    } finally {
      opening = false;
      render(false);
    }
  }

  async function analyze(field) {
    const index = ++revision;
    profile = null;
    message = "";
    analyzing = !!field;
    render(false);
    if (!field) return;
    try {
      const db = await import("./database.js");
      const queries = db.fieldQueries(field);
      const bins = await db.sql(queries.histogram, 20);
      if (index !== revision) return;
      const values = bins[0]?.usable ? (await db.sql(queries.signal, 4096)).map((row) => row.value) : [];
      if (index !== revision) return;
      profile = {
        field, queries, values, bins: bins.map((row) => Number(row.frequency)),
        usable: Number(bins[0]?.usable || 0), excluded: Number(bins[0]?.excluded || 0),
        min: bins[0]?.minimum, max: bins[0]?.maximum,
      };
    } catch (error) {
      if (index === revision) message = "Could not analyze this field. " + error.message;
    } finally {
      if (index === revision) {
        analyzing = false;
        render(false);
      }
    }
  }

  function render(open = true) {
    if (!open && !ui.isPanel("Explore data")) return;
    const openFile = button("Open CSV or Parquet", async () => load(await choose(".csv,.parquet")));
    openFile.disabled = opening;
    const items = [openFile];
    if (opening) items.push(elt("p", "Opening file…", "hint"));
    if (message) items.push(elt("p", message, "error"));
    if (dataset) {
      items.push(elt("h3", dataset.name, "data-heading"), preview());
      const choices = dataset.numeric.map(({ column_name }) => [column_name, column_name]);
      if (choices.length) {
        const field = picker([["", "Choose a numeric field"], ...choices], profile?.field || "", analyze, "Numeric field");
        field.disabled = opening || analyzing;
        items.push(field);
      } else items.push(elt("p", "This file has no numeric columns."));
      if (analyzing) items.push(elt("p", "Analyzing column…", "hint"));
    }
    if (profile) {
      const { values, queries, usable, excluded } = profile;
      const tools = elt("div", undefined, "panel-actions");
      if (values.length) {
        items.push(histogram(elt, profile));
        tools.append(
          picker(targetLabels, target, (next) => { target = next; }, "Instrument"),
          button("Apply to instrument", () => apply(target, profile, false)),
          button("Add instrument layer", () => apply(target, profile, true)),
          button("Add histogram layer", () => addHistogram(profile)),
        );
      } else items.push(elt("p", "This column has no finite values."));
      items.push(elt("p", `${usable.toLocaleString()} usable · ${excluded.toLocaleString()} excluded · ${values.length.toLocaleString()} values displayed`, "hint"));
      items.push(tools);
      const sql = elt("details");
      sql.append(elt("summary", "Generated SQL · current user_data"));
      for (const [name, query] of Object.entries(queries)) {
        sql.append(button(`Copy ${name} SQL`, () => copy(query)), elt("pre", query, "log-output"));
      }
      items.push(sql);
    }
    modal("Explore data", items);
  }
  return { open: render, load };
}

export function histogram(elt, { field, bins, min, max }) {
  const fig = elt("figure", undefined, "histogram");
  fig.append(elt("figcaption", field));
  const chart = elt("div", undefined, "histogram-bars");
  const top = Math.max(1, ...bins);
  const format = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 });
  chart.setAttribute("role", "img");
  const ranges = bins.map((count, index) => {
    const low = index / bins.length, high = (index + 1) / bins.length;
    const a = format.format(min * (1 - low) + max * low);
    const b = format.format(min * (1 - high) + max * high);
    return `${a}${a === b ? "" : " to " + b}: ${count.toLocaleString()}`;
  });
  chart.setAttribute("aria-label", "Histogram. " + ranges.join("; "));
  bins.forEach((count, index) => {
    const bar = elt("span");
    bar.title = ranges[index];
    bar.style.height = `${Math.max(count ? 3 : 0, (count / top) * 100)}%`;
    chart.append(bar);
  });
  const range = elt("div", undefined, "histogram-range");
  range.append(elt("span", format.format(min)));
  if (min !== max) range.append(elt("span", format.format(max)));
  fig.append(chart, range);
  return fig;
}
