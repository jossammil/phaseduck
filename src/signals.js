export const targets = {
  "motion.speed": "any",
  "dunes.height": "dunes",
  "waves.amplitude": "silk",
  "orbit.radius": "orbit",
  "feedback.gain": "feedback",
  "clock.drift": "clock",
  "rain.fold": "rain",
  "loom.spacing": "loom",
};
export function validateSignal(name, values, unit = "") {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) ||
    ["constructor", "prototype"].includes(name)
  )
    throw Error(
      "Use a short signal name with letters, digits, or underscores.",
    );
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 4096 ||
    !values.every(Number.isFinite)
  )
    throw Error("A signal needs 1–4096 finite numbers.");
  if (typeof unit !== "string" || unit.length > 80)
    throw Error("Use a short units label.");
  return { values, unit, at: new Date().toISOString() };
}
export function validateMarks(marks) {
  if (!Array.isArray(marks) || marks.length > 192)
    throw Error("Use up to 192 marks per sketch.");
  const bounded = (n) => Number.isFinite(n) && Math.abs(n) <= 8;
  for (const m of marks) {
    if (
      !m ||
      !["point", "ring", "path"].includes(m.type) ||
      !/^#[0-9a-f]{6}$/i.test(m.color)
    )
      throw Error("A mark needs a type and a six-digit hex color.");
    if (
      m.width !== undefined &&
      (!Number.isFinite(m.width) || m.width <= 0 || m.width > 16)
    )
      throw Error("Use a line width between 0 and 16.");
    if (m.type === "path") {
      if (
        !Array.isArray(m.points) ||
        m.points.length < 2 ||
        m.points.length > 1024 ||
        !m.points.every(
          (p) => Array.isArray(p) && p.length === 2 && p.every(bounded),
        )
      )
        throw Error("Use 2–1024 normalized coordinate pairs per path.");
    } else if (![m.x, m.y, m.r].every(bounded) || m.r < 0)
      throw Error("Use normalized x, y, and radius.");
  }
  return marks;
}
export const examples = {
  "wave.R": `# Send a DuckDB-derived hourly series to the landscape.
counts <- deck_input("trip_hours")
deck_signal("rush_hour", sqrt(counts), "sqrt(trips)")
plot(0:23, counts, type="l", col="steelblue", xlab="Pickup hour", ylab="January trips")
`,
  "shell.py": `# Change the winding or use a different data series, then run again.
values = deck_input("trip_hours")
top = max(values)
points = []
for i in range(420):
    a = i / 419 * math.tau * 3
    radius = (0.04 + i / 419 * 0.23) * (0.7 + 0.3 * values[i % 24] / top)
    points.append((0.5 + radius * math.cos(a), 0.5 + radius * math.sin(a)))
deck_sketch(deck_path(points, "#a8f2db", 1.5), deck_ring(.5, .5, .10, "#e1aada"))
print("Drew a spiral from 24 pickup counts.")
`,
};
export function safeFilename(name) {
  if (!/^[\w -]{1,64}\.(py|r)$/i.test(name))
    throw Error("Use a short .R or .py filename.");
  return name;
}
