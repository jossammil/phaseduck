const sizes = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
const outcomes = new Set(["complete", "failed", "cancelled", "interrupted"]);
const running = new Set(["running", "waiting", "canceling"]);

export function bytes(value) {
  if (!Number.isFinite(value)) return "";
  let index = 0;
  while (value >= 1024 && index < sizes.length - 1) {
    value /= 1024;
    index++;
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: index ? 1 : 0 }).format(value) + " " + sizes[index];
}

export function jobStatus(status) {
  return ({ complete: "Complete", failed: "Failed", cancelled: "Cancelled",
    interrupted: "Interrupted", canceling: "Cancelling", running: "Running",
    waiting: "Waiting", queued: "Queued", watching: "Watching" })[status] || status;
}

function estimate(seconds) {
  if (seconds < 60) return Math.max(1, Math.ceil(seconds)) + " sec";
  if (seconds < 3600) return Math.ceil(seconds / 60) + " min";
  return Math.ceil(seconds / 3600) + " hr";
}

export function jobMetrics(job) {
  const totalKnown = Number.isFinite(job.total_bytes);
  const doneKnown = Number.isFinite(job.bytes);
  const transfer = job.kind === "download" || doneKnown;
  const metrics = [];
  if (doneKnown) metrics.push(bytes(job.bytes) + (totalKnown ? " / " + bytes(job.total_bytes) : " transferred"));
  if (transfer && !totalKnown) metrics.push("Total size unknown");
  if (Number.isFinite(job.progress) && (!transfer || totalKnown || job.progress_kind === "estimated")) {
    const kind = job.progress_kind === "measured" ? "measured"
      : job.progress_kind === "estimated" ? "estimated" : "reported";
    metrics.push(Math.min(100, Math.floor(job.progress * 100)) + "% " + kind);
  }
  if (running.has(job.status) && Number.isFinite(job.bytes_per_second)) {
    metrics.push(bytes(job.bytes_per_second) + "/s");
    if (doneKnown && totalKnown && job.bytes_per_second > 0 && job.bytes < job.total_bytes) {
      metrics.push("ETA about " + estimate((job.total_bytes - job.bytes) / job.bytes_per_second));
    }
  }
  return metrics;
}

export function workActivity(job) {
  return running.has(job.status) && (job.kind === "download" || !!(job.stage || job.last) || Number.isFinite(job.progress));
}

export function workOutcome(job) {
  return outcomes.has(job.status) && (job.kind === "download" || !!(job.stage || job.last) || Number.isFinite(job.progress));
}

export function jobCard(elt) {
  const card = elt("div", undefined, "job-card");
  const status = elt("strong"), name = elt("span"), stage = elt("span"), values = elt("span");
  const meter = elt("progress");
  meter.max = 1;
  meter.setAttribute("aria-label", "Download progress");
  card.append(status, name, stage, values, meter);
  let last;
  function show(job, { stale = false, empty = "No active jobs" } = {}) {
    const metrics = job ? jobMetrics(job) : [];
    const labels = [stale ? "Work monitor disconnected" : job ? jobStatus(job.status) : empty,
      job?.label || "", job?.stage || "", metrics.join(" · ")];
    const showMeter = (job?.kind === "download" || Number.isFinite(job?.bytes)) &&
      running.has(job.status) && !stale;
    const measured = showMeter && job.progress_kind === "measured" && Number.isFinite(job.progress)
      ? Math.min(1, job.progress) : null;
    const next = JSON.stringify([labels, showMeter, measured]);
    if (last === next) return;
    last = next;
    [status, name, stage, values].forEach((node, index) => { node.textContent = labels[index]; });
    meter.hidden = !showMeter;
    if (measured === null) meter.removeAttribute("value");
    else meter.value = measured;
  }
  return { card, show };
}

export function setupJobs(ui, client) {
  const { elt, button, copy, modal, label } = ui;
  const title = "Job monitor";
  let selected = "";
  let logState;
  let panel;

  function actions(job, detail) {
    const row = detail.actions;
    row.replaceChildren();
    if (job.kind === "watch") row.append(elt("span", "Read-only watched log", "hint"));
    if (client.capable() && job.kind !== "watch") {
      const update = (operation) => async () => {
        detail.error.textContent = "";
        try {
          const response = await client.api("/api/jobs/" + operation, { id: job.id });
          if (response?.id) select(response.id);
          await client.refresh();
        } catch (error) {
          detail.error.textContent = error.message;
        }
      };
      if (job.status === "queued" || running.has(job.status)) {
        const cancel = button(job.status === "canceling" ? "Cancelling…" : "Cancel job", update("cancel"));
        cancel.disabled = job.status === "canceling";
        row.append(cancel);
      } else if (outcomes.has(job.status) && job.status !== "complete") {
        row.append(button("Retry job", update("retry")));
      }
    }
    row.append(button("Solo waveform", () => client.solo(job.id)));
  }

  function select(id) {
    if (!panel) return;
    selected = id;
    const summary = jobCard(elt);
    const times = elt("p", undefined, "hint");
    const controls = elt("div", undefined, "panel-actions");
    const error = elt("div", undefined, "error");
    const follow = elt("input");
    follow.type = "checkbox";
    follow.checked = true;
    const log = elt("pre", "Waiting for output…", "log-output job-log");
    const checkpoints = elt("details");
    const checkpointText = elt("pre", undefined, "log-output");
    checkpoints.append(elt("summary", "Structured checkpoints"), checkpointText);
    checkpoints.hidden = true;
    const tools = elt("div", undefined, "panel-actions");
    const state = { cursor: "", text: "", pending: false, truncated: false };
    const use = button("Use published output", () => client.use(id, state.text));
    use.hidden = true;
    tools.append(label("Follow output", follow), button("Copy log", () => copy(state.text)), use);
    panel.body.replaceChildren(summary.card, times, controls, error, tools, log, checkpoints);
    logState = Object.assign(state, { id, summary, times, actions: controls, error, log,
      follow, checkpoints, checkpointText, use, actionStatus: null });
  }

  async function refreshLog(detail) {
    if (detail.pending) return;
    detail.pending = true;
    try {
      const query = "/api/log?id=" + encodeURIComponent(detail.id);
      const response = await client.api(query + (client.capable() ? "&cursor=" + encodeURIComponent(detail.cursor) : ""));
      if (detail !== logState || !ui.isPanel(title)) return;
      if (response.reset || !client.capable()) {
        detail.text = "";
        detail.truncated = !!response.truncated;
      }
      if (response.cursor !== undefined) detail.cursor = response.cursor;
      if (response.text || response.reset) {
        detail.text += response.text;
        if (detail.text.length > 200000) {
          const trim = detail.text.length - 200000;
          const next = detail.text.indexOf("\n", trim);
          detail.text = detail.text.slice(next >= 0 ? next + 1 : trim);
          detail.truncated = true;
        }
        const lines = detail.text.split("\n");
        const structured = lines.filter((line) => line.startsWith("@phase "));
        const output = lines.filter((line) => !line.startsWith("@phase ") && !line.startsWith("@DECK@")).join("\n").trimEnd();
        const y = detail.log.scrollTop;
        detail.log.textContent = (detail.truncated ? "[Showing recent output]\n" : "") + (output || "No plain-text output yet.");
        detail.log.scrollTop = detail.follow.checked ? detail.log.scrollHeight : y;
        detail.checkpoints.hidden = !structured.length;
        detail.checkpointText.textContent = structured.map((line) => line.slice(7)).join("\n");
        detail.use.hidden = !lines.some((line) => line.startsWith("@DECK@"));
      }
    } catch (error) {
      if (detail === logState && ui.isPanel(title)) detail.error.textContent = error.message;
    } finally {
      detail.pending = false;
    }
  }

  const date = (text) => text ? new Date(text).toLocaleString() : "";
  function update() {
    if (!panel || !ui.isPanel(title) || !client.connected()) return;
    panel.connection.textContent = client.error() || "Workspace · " + client.workspace();
    const jobs = client.jobs();
    const keep = new Set();
    for (const job of jobs) {
      keep.add(job.id);
      let row = panel.rows.get(job.id);
      if (!row) {
        row = button("", () => { select(job.id); update(); });
        row.className = "job-row";
        panel.rows.set(job.id, row);
      }
      const text = job.label + " · " + jobStatus(job.status);
      if (row.textContent !== text) row.textContent = text;
      row.setAttribute("aria-pressed", String(job.id === selected));
    }
    for (const [id, row] of panel.rows) {
      if (!keep.has(id)) { row.remove(); panel.rows.delete(id); }
    }
    const order = jobs.map((job) => job.id).join(",");
    if (order !== panel.order) {
      panel.order = order;
      panel.list.replaceChildren(...jobs.map((job) => panel.rows.get(job.id)));
    }
    panel.empty.hidden = jobs.length > 0;
    const job = jobs.find((item) => item.id === selected);
    if (!job || !logState) return;
    logState.summary.show(job, { stale: !!client.error() });
    logState.times.textContent = [
      date(job.created) && "Queued " + date(job.created),
      date(job.started) && "Started " + date(job.started),
      date(job.finished) && "Finished " + date(job.finished),
      job.code != null && "Exit " + job.code,
      job.retry_of && "Retry of " + job.retry_of,
    ].filter(Boolean).join(" · ");
    if (logState.actionStatus !== job.status) {
      logState.actionStatus = job.status;
      actions(job, logState);
    }
    if (!client.error()) refreshLog(logState);
  }

  function open() {
    if (!client.connected()) {
      modal(title, [elt("p", "Open the private sign-in link from the Mac companion to view its jobs.")]);
      return;
    }
    const connection = elt("p", undefined, "hint");
    const list = elt("div", undefined, "job-list");
    const body = elt("section", undefined, "job-detail");
    const empty = elt("p", "No recorded jobs yet.", "hint");
    const tools = elt("div", undefined, "panel-actions");
    tools.append(button("Run pulse.py", async () => {
      const { id } = await client.api("/api/jobs", { kind: "run", path: "pulse.py" });
      select(id);
      await client.refresh();
    }));
    const items = [connection, tools];
    if (client.capable()) {
      const form = elt("form", undefined, "download-form");
      const url = elt("input"), filename = elt("input"), error = elt("p", undefined, "error");
      url.type = "url";
      url.required = filename.required = true;
      url.placeholder = "https://…";
      filename.placeholder = "data.csv";
      filename.maxLength = 180;
      const submit = elt("button", "Queue download");
      form.append(label("Download URL", url), label("Save as", filename), submit, error);
      form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          const { id } = await client.api("/api/jobs", { kind: "download", path: filename.value.trim(), args: [url.value.trim()] });
          form.reset();
          select(id);
          await client.refresh();
        } catch (failure) {
          error.textContent = failure.message;
        } finally {
          submit.disabled = false;
        }
      };
      const download = elt("details");
      download.append(elt("summary", "Download URL"), form);
      items.push(download);
    }
    const layout = elt("div", undefined, "job-layout");
    layout.append(list, body);
    items.push(layout, empty);
    panel = { connection, list, body, empty, rows: new Map(), order: "" };
    modal(title, items);
    if (selected) select(selected);
    else if (client.jobs()[0]) select(client.jobs()[0].id);
    update();
  }
  return { open, update };
}
