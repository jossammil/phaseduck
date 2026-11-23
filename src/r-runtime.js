const base = new URL("./runtime/webr/", document.baseURI).href;
let instance,
  initializing,
  generation = 0;
const helpers = String.raw`
.deck_n <- function(x) { if (!length(x) || any(!is.finite(x))) stop("Use finite numbers"); paste(sprintf("%.15g", x),collapse=",") }
.deck_q <- function(x) encodeString(as.character(x)[1],quote='"')
.deck_send <- function(x) { cat(paste0("@DECK@",x,"\n")); invisible(NULL) }
deck_signal <- function(name, values, unit="") .deck_send(sprintf('{"type":"signal","name":%s,"unit":%s,"values":[%s]}',.deck_q(name),.deck_q(unit),.deck_n(as.numeric(values))))
deck_path <- function(points,color="#adedd9",width=1) {
  p <- as.matrix(points); if(ncol(p)!=2) stop("Pass two columns, x and y")
  sprintf('{"type":"path","points":[%s],"color":%s,"width":%s}',paste0("[",apply(p,1,.deck_n),"]",collapse=","),.deck_q(color),.deck_n(width))
}
deck_ring <- function(x,y,r,color="#e5b6db",width=1) sprintf('{"type":"ring","x":%s,"y":%s,"r":%s,"color":%s,"width":%s}',.deck_n(x),.deck_n(y),.deck_n(r),.deck_q(color),.deck_n(width))
deck_point <- function(x,y,r=.008,color="#b7ead9") sprintf('{"type":"point","x":%s,"y":%s,"r":%s,"color":%s}',.deck_n(x),.deck_n(y),.deck_n(r),.deck_q(color))
deck_sketch <- function(...) .deck_send(paste0('{"type":"sketch","marks":[',paste(c(...),collapse=","),']}'))
`;
export function reset() {
  generation++;
  instance?.close();
  instance = null;
  initializing = null;
}
export async function load() {
  if (initializing) return initializing;
  const gen = generation;
  initializing = (async () => {
    const { WebR, ChannelType } = await import(base + "webr.mjs");
    if (gen !== generation) throw Error("R session reset");
    const r = new WebR({
      baseUrl: base,
      channelType: ChannelType.PostMessage,
      interactive: false,
    });
    instance = r;
    await r.init();
    await r.evalRVoid(helpers);
    return r;
  })().catch((e) => {
    if (gen === generation) reset();
    throw e;
  });
  return initializing;
}
export async function evaluate(source, signals) {
  const engine = await load();
  const inputs = Object.entries(signals).map(
    ([name, s]) => JSON.stringify(name) + "=c(" + s.values.join(",") + ")",
  );
  await engine.evalRVoid(
    "deck_inputs <- list(" +
      inputs.join(",") +
      "); deck_input <- function(name) deck_inputs[[name]]",
  );
  const shelter = await new engine.Shelter();
  try {
    const capture = await shelter.captureR(source, {
      withAutoprint: true,
      captureStreams: true,
      captureConditions: true,
      throwJsException: false,
      captureGraphics: { width: 540, height: 340, bg: "#ffffff" },
    });
    const lines = [];
    let error = "";
    for (const item of capture.output) {
      if (["stdout", "stderr"].includes(item.type))
        lines.push(String(item.data));
      else {
        let str = String(item.type);
        try {
          str = await (await item.data.get("message")).toString();
        } catch {}
        if (item.type === "error") error = str;
        else lines.push(item.type + " " + str);
      }
    }
    return { lines, images: capture.images, error };
  } finally {
    await shelter.purge();
  }
}
