const form = document.getElementById("traffic-key");
const input = document.getElementById("maps-key");
const mapPanel = document.getElementById("live-traffic-map");
const status = document.getElementById("traffic-status");
const retry = document.getElementById("traffic-retry");
const fullscreen = document.getElementById("traffic-fullscreen");
const intro = document.querySelector(".traffic-intro");
let failed = false;
let timer;

function unavailable(message) {
  clearTimeout(timer);
  failed = true;
  status.textContent = message;
  mapPanel.hidden = true;
  retry.hidden = false;
  fullscreen.hidden = true;
}

globalThis.gm_authFailure = () => unavailable(
  "Google rejected this key. Check the website restriction, Maps JavaScript API, and billing.",
);
globalThis.phaseDeckTrafficReady = async () => {
  if (failed) return;
  try {
    const { Map, TrafficLayer } = await google.maps.importLibrary("maps");
    if (failed) return;
    mapPanel.hidden = false;
    const map = new Map(mapPanel, {
      center: { lat: 32.299, lng: -90.184 },
      zoom: 12,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    });
    const traffic = new TrafficLayer({ autoRefresh: true });
    traffic.setMap(map);
    clearTimeout(timer);
    status.textContent = "";
    intro.classList.add("traffic-ready");
    fullscreen.hidden = !document.documentElement.requestFullscreen;
  } catch {
    unavailable("Google traffic is unavailable. Reload to try again.");
  }
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (form.hidden || !form.reportValidity()) return;
  const url = new URL("https://maps.googleapis.com/maps/api/js");
  url.search = new URLSearchParams({
    key: input.value.trim(), v: "quarterly", loading: "async",
    auth_referrer_policy: "origin", callback: "phaseDeckTrafficReady",
  });
  input.value = "";
  form.hidden = true;
  status.textContent = "Loading Google traffic…";
  const script = document.createElement("script");
  script.src = url.href;
  script.async = true;
  script.referrerPolicy = "strict-origin-when-cross-origin";
  script.onerror = () => unavailable("Google Maps could not load. Check the connection and reload.");
  timer = setTimeout(() => unavailable("Google Maps took too long to load. Reload to try again."), 15000);
  document.head.append(script);
});

retry.onclick = () => location.reload();
fullscreen.onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    status.textContent = "Full screen is unavailable. Use your browser’s window controls.";
  }
};
document.addEventListener("fullscreenchange", () => {
  fullscreen.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
});
