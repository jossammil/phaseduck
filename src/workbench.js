import { examples, safeFilename } from "./signals.js";
const $ = (id) => document.getElementById(id);
const saveKey = "phase-deck-files-1";
function storedFiles() {
  try {
    return {
      ...examples,
      ...JSON.parse(localStorage.getItem(saveKey) || "{}"),
    };
  } catch {
    return { ...examples };
  }
}
function splitWords(s) {
  const matches = s.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
  return matches.map((w) => (/^(['"])(.*)\1$/.test(w) ? w.slice(1, -1) : w));
}
export function setupConsole(deck) {
  let mode = "deck",
    busy = false,
    epoch = 0,
    py = null,
    pyPending = null,
    editor = null,
    file = "",
    pty = false,
    rModule,
    history = [],
    position = 0;
  const files = storedFiles();
  function line(message, kind = "") {
    const e = document.createElement("pre");
    e.textContent = String(message).slice(0, 80000);
    e.className = kind;
    const log = $("history");
    log.append(e);
    while (log.childElementCount > 120) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  function saveFile(name, text) {
    files[name] = text;
    try {
      localStorage.setItem(saveKey, JSON.stringify(files));
    } catch {
      line(
        "Browser storage is full. Export your source before closing.",
        "error",
      );
    }
  }
  function label() {
    $("cmd-form").setAttribute("aria-busy", String(busy));
    $("prompt-type").textContent = pty
      ? "Neovim · Mac Studio"
      : mode === "deck"
        ? "Deck · browser"
        : (mode === "r" ? "R" : "Python") + " · browser";
    $("prompt").textContent = mode + " ›";
    $("stop").hidden = mode === "deck";
    $("command").placeholder =
      mode === "deck"
        ? "Type help for commands"
        : "Enter runs · Shift+Enter adds a line · :deck returns";
  }
  function drawer(show) {
    $("drawer").hidden = !show;
    $("terminal-button").setAttribute("aria-expanded", String(show));
    if (show) $("command").focus();
  }
  function closeEditor() {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    $("editor-pane").hidden = true;
    $("command").focus();
  }
  async function edit(name) {
    safeFilename(name);
    if (pty) throw Error("Save and exit Neovim with :wq first.");
    const { createEditor } = await import("./editor.js");
    closeEditor();
    file = name;
    if (!Object.hasOwn(files, name)) saveFile(name, "");
    $("filename").textContent = name + " · browser";
    $("editor-pane").hidden = false;
    editor = createEditor(
      $("editor"),
      files[name],
      (v) => saveFile(name, v),
      () => runFile(),
      closeEditor,
    );
    line(
      "Editing " +
        name +
        ". Changes save in this browser. ⌘/Ctrl+Enter runs the selection or file.",
    );
  }
  function python(action, source) {
    if (!py) {
      py = new Worker(new URL("py-worker.js", document.baseURI), {
        type: "module",
      });
      py.onmessage = (e) => {
        const p = pyPending;
        pyPending = null;
        p?.resolve(e.data);
      };
      py.onerror = (e) => {
        pyPending?.reject(Error(e.message));
        pyPending = null;
        py?.terminate();
        py = null;
      };
    }
    if (pyPending) throw Error("Python is busy.");
    return new Promise((resolve, reject) => {
      pyPending = { resolve, reject };
      py.postMessage({ action, source, signals: deck.signals() });
    });
  }
  function reset() {
    epoch++;
    const name =
      mode === "r" ? "R" : mode === "python" ? "Python" : "R and Python";
    if (mode !== "r") {
      py?.terminate();
      py = null;
      pyPending?.reject(Error("Python reset"));
      pyPending = null;
    }
    if (mode !== "python") rModule?.reset();
    mode = "deck";
    busy = false;
    label();
    line(
      name +
        " session reset. Its in-memory variables cleared. Saved source and patches are available.",
    );
  }
  async function execute(language, source, token) {
    const start = performance.now();
    let result;
    if (language === "r") {
      rModule = await import("./r-runtime.js");
      if (epoch !== token) return;
      result = await rModule.evaluate(source, deck.signals());
    } else result = await python("run", source);
    if (epoch !== token) {
      result.images?.forEach((im) => im.close());
      return;
    }
    const ordinary = [],
      events = [];
    for (const text of result.lines ?? [])
      for (const s of String(text).split("\n")) {
        if (s.startsWith("@DECK@")) events.push(JSON.parse(s.slice(6)));
        else if (s) ordinary.push(s);
      }
    if (ordinary.length) line(ordinary.join("\n"));
    for (const im of result.images ?? []) {
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = im.height;
      c.getContext("2d").drawImage(im, 0, 0);
      im.close();
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", "R plot");
      $("history").append(c);
    }
    if (result.error) throw Error(result.error);
    deck.apply(events);
    line(
      "Finished in " +
        ((performance.now() - start) / 1000).toFixed(2) +
        " s" +
        (events.length ? " · " + events.length + " instrument update(s)" : ""),
    );
  }
  async function guarded(fn) {
    if (busy) {
      line("A command is running. Use Reset runtime to stop browser code.");
      return;
    }
    const token = epoch;
    busy = true;
    label();
    try {
      await fn(token);
    } catch (e) {
      if (token === epoch) line(e.message || e, "error");
    } finally {
      if (token === epoch) {
        busy = false;
        label();
      }
    }
  }
  function runFile() {
    if (!editor) return;
    const source = editor.selected(),
      language = /\.r$/i.test(file) ? "r" : "python";
    guarded(async (token) => {
      mode = language;
      label();
      line("› " + file, "input");
      await execute(language, source, token);
    });
  }
  const help = [
    "r | python                 open a browser language session",
    ":deck                      return to deck commands",
    "edit wave.R | edit shell.py  Vim-style editor and runnable examples",
    "ls | export FILE           list or download browser scripts",
    "sql SELECT … FROM trips    query the bundled Parquet sample",
    "loom SELECT …             weave date, hour, trips columns from your table",
    "signal NAME = SELECT …     publish the final numeric SQL column",
    "patch trip_hours dunes.height   connect data to a landscape",
    "signals | unpatch | scene NAME | freeze | replay",
    "save NAME | load NAME      save or restore a patch in this browser",
    "jobs | log ID | use ID     inspect a job or import its published signals",
    "Mac: files | nvim FILE | run FILE [ARGS] | watch FILE",
    "Example: run pulse.py  ·  run download_taxi.py 2024-01",
    "Enter runs · Shift+Enter adds a line · Ctrl+` toggles the drawer",
  ].join("\n");
  async function command(input, token) {
    if (input === ":deck") {
      mode = "deck";
      label();
      return;
    }
    if (input === ":reset") {
      reset();
      return;
    }
    if (mode !== "deck") return execute(mode, input, token);
    const [keyword, ...args] = splitWords(input);
    const tail = input.slice(keyword.length).trim();
    switch (keyword) {
      case "help":
        line(help);
        break;
      case "r":
      case "python": {
        mode = keyword;
        label();
        line("Loading " + keyword + " locally…");
        if (mode === "r") {
          rModule = await import("./r-runtime.js");
          if (token !== epoch) return;
          await rModule.load();
        } else {
          const result = await python("load");
          if (result.error) throw Error(result.error);
        }
        if (token === epoch) line("Ready. Use :deck to return.");
        break;
      }
      case "edit":
        await edit(args[0] || "wave.R");
        break;
      case "ls":
        line(Object.keys(files).join("\n"));
        break;
      case "export":
        if (!Object.hasOwn(files, args[0])) throw Error("Unknown browser file");
        deck.download(args[0], files[args[0]]);
        break;
      case "sql":
      case "signal": {
        let query = tail,
          name;
        if (keyword === "signal") {
          const m = /^(\w+)\s*=\s*(.+)$/s.exec(tail);
          if (!m) throw Error("Use signal NAME = SELECT …");
          [, name, query] = m;
        }
        const rows = await (
          await import("./database.js")
        ).sql(query, name ? 4097 : 101);
        if (token !== epoch) return;
        if (name) {
          const k = Object.keys(rows[0] || {}).at(-1);
          deck.apply([
            { type: "signal", name, values: rows.map((r) => r[k]), unit: k },
          ]);
          line("Published " + name + " · " + rows.length + " values");
        } else
          line(
            JSON.stringify(rows.slice(0, 100), null, 2) +
              (rows.length > 100
                ? "\nShowing the first 100 rows."
                : "\n" + rows.length + " row(s)."),
          );
        break;
      }
      case "loom":
        await deck.makeLoom(tail);
        line("Wove your query into Data Loom.");
        break;
      case "patch":
        deck.patch(args[0], args[1]);
        line("Connected " + args[0] + " to " + args[1]);
        break;
      case "unpatch":
        deck.patch(null, null);
        break;
      case "signals":
        line(
          Object.entries(deck.signals())
            .map(
              ([n, s]) => n + " · " + s.values.length + " values · " + s.unit,
            )
            .join("\n"),
        );
        break;
      case "scene":
        deck.scene(args[0]);
        break;
      case "freeze":
        deck.freeze();
        break;
      case "replay":
        deck.replay();
        break;
      case "save":
      case "load":
        deck.preset(keyword, args[0]);
        line(keyword === "save" ? "Patch saved" : "Patch restored");
        break;
      case "jobs":
        line(
          deck
            .jobs()
            .map((j) =>
              [j.id, j.status, j.label, j.stage].filter(Boolean).join(" · "),
            )
            .join("\n") || "No recorded jobs.",
        );
        break;
      case "use":
        await deck.useJob(args[0]);
        line("Imported job output. Type signals to see its values.");
        break;
      case "files":
        line((await deck.api("/api/status")).files.join("\n"));
        break;
      case "log":
        line(
          (await deck.api("/api/log?id=" + encodeURIComponent(args[0]))).text ||
            "No output yet.",
        );
        break;
      case "run":
      case "watch": {
        const job = await deck.api("/api/jobs", {
          kind: keyword,
          path: args[0],
          args: args.slice(1),
        });
        await deck.refreshJobs();
        line((keyword === "run" ? "Queued " : "Watching ") + job.id);
        break;
      }
      case "nvim": {
        if (pty) throw Error("A native editor is already open.");
        const { openTerminal } = await import("./native.js");
        const { id } = await deck.api("/api/terminal", {
          path: args[0] || "hourly.R",
        });
        closeEditor();
        pty = true;
        label();
        $("pty-pane").hidden = false;
        try {
          await openTerminal($("pty"), id, deck.api, () => {
            pty = false;
            label();
            $("pty-pane").hidden = true;
            $("command").focus();
          });
        } catch (e) {
          pty = false;
          label();
          $("pty-pane").hidden = true;
          throw e;
        }
        break;
      }
      default:
        throw Error("Unknown command. Type help.");
    }
  }
  $("cmd-form").onsubmit = (e) => {
    e.preventDefault();
    const input = $("command").value.trim();
    if (!input || busy) return;
    $("command").value = "";
    history.push(input);
    position = history.length;
    line("› " + input, "input");
    guarded((token) => command(input, token));
  };
  $("command").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("cmd-form").requestSubmit();
    }
    if (
      e.key === "ArrowUp" &&
      !e.shiftKey &&
      !$("command").value.includes("\n") &&
      history.length
    ) {
      e.preventDefault();
      position = Math.max(0, position - 1);
      $("command").value = history[position];
    }
    if (
      e.key === "ArrowDown" &&
      !e.shiftKey &&
      !$("command").value.includes("\n")
    ) {
      e.preventDefault();
      position = Math.min(history.length, position + 1);
      $("command").value = history[position] || "";
    }
  };
  $("run-file").onclick = runFile;
  $("close-editor").onclick = closeEditor;
  $("stop").onclick = reset;
  $("terminal-button").onclick = () => drawer($("drawer").hidden);
  $("close").onclick = () => drawer(false);
  window.addEventListener("keydown", (e) => {
    const editing = e.target.closest(
      "input,textarea,select,[contenteditable=true],.xterm",
    );
    if (e.key === "`" && (!editing || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      drawer($("drawer").hidden);
    }
  });
  line("Type help for commands, or edit shell.py to draw with the taxi data.");
  return {
    line,
    open: () => drawer(true),
    edit: async (name) => {
      drawer(true);
      await edit(name);
    },
    seed: (s) => {
      drawer(true);
      mode = "deck";
      label();
      $("command").value = s;
    },
  };
}
