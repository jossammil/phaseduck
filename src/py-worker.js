const base = new URL("./runtime/python/", self.location.href).href;
let ready;
const helpers = `
import json, math
def deck_input(name): return json.loads(_deck_input_json)[name]["values"]
def deck_signal(name,values,unit=""):
    if isinstance(values,(int,float)): values=[values]
    print("@DECK@"+json.dumps(dict(type="signal",name=name,values=list(values),unit=unit),allow_nan=False))
def deck_path(points,color="#adedd9",width=1): return dict(type="path",points=list(map(list,points)),color=color,width=width)
def deck_ring(x,y,r,color="#e5b6db",width=1): return dict(type="ring",x=x,y=y,r=r,color=color,width=width)
def deck_point(x,y,r=.008,color="#b7ead9"): return dict(type="point",x=x,y=y,r=r,color=color)
def deck_sketch(*marks): print("@DECK@"+json.dumps(dict(type="sketch",marks=marks),allow_nan=False))
`;
async function load() {
  if (!ready)
    ready = import(base + "pyodide.mjs").then(async (m) => {
      const py = await m.loadPyodide({ indexURL: base });
      await py.runPythonAsync(helpers);
      return py;
    });
  return ready;
}
self.onmessage = async ({ data }) => {
  const lines = [];
  try {
    const py = await load();
    if (data.action === "load") {
      self.postMessage({ lines: [py.version] });
      return;
    }
    py.setStdout({ batched: (text) => lines.push(text) });
    py.setStderr({ batched: (text) => lines.push(text) });
    py.globals.set("_deck_input_json", JSON.stringify(data.signals));
    const result = await py.runPythonAsync(data.source);
    if (result !== undefined && result !== null) {
      lines.push(String(result));
      result?.destroy?.();
    }
    self.postMessage({ lines });
  } catch (e) {
    self.postMessage({ lines, error: String(e) });
  }
};
