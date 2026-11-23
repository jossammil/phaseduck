import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
export async function openTerminal(host, id, api, onClose) {
  if (!document.querySelector("link[data-xterm]")) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "./vendor/xterm.css";
    css.dataset.xterm = "";
    document.head.append(css);
    await new Promise((ok, fail) => {
      css.onload = ok;
      css.onerror = fail;
    });
  }
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "Menlo,monospace",
    theme: { background: "#0b131a", foreground: "#dcebe6" },
    scrollback: 500,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  const url = "/api/terminal/" + id;
  let closed = false,
    cursor = 0,
    writing = Promise.resolve();
  const send = (data) => {
    writing = writing
      .then(() => api(url, data))
      .catch((e) => terminal.writeln(String(e)));
  };
  terminal.onData((input) => send({ input }));
  let lastSize = "";
  function resize() {
    if (!host.clientWidth || !host.clientHeight) return;
    fit.fit();
    const size = terminal.cols + "x" + terminal.rows;
    if (size !== lastSize) {
      lastSize = size;
      send({ cols: terminal.cols, rows: terminal.rows });
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  terminal.focus();
  async function poll() {
    try {
      const result = await api(url + "?cursor=" + cursor);
      cursor = result.cursor;
      if (result.data)
        await new Promise((ok) =>
          terminal.write(
            Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0)),
            ok,
          ),
        );
      if (result.closed) {
        closed = true;
        ro.disconnect();
        terminal.dispose();
        onClose();
        return;
      }
    } catch (e) {
      terminal.writeln(String(e));
    }
    if (!closed) setTimeout(poll, document.hidden ? 750 : 65);
  }
  poll();
  return terminal;
}
