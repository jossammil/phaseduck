const textOptions = [
  ["title", "Title and category"],
  ["readout", "Live readout"],
  ["labels", "Labels inside visuals"],
];

export function setupFocus(ui, frame, trigger, exit, changed) {
  const { elt, label, button, modal, close, getStored, store } = ui;
  const saved = getStored("focus-text", {});
  const options = Object.fromEntries(textOptions.map(([key]) => [key, saved[key] !== false]));
  let active = false;
  let touchStart, revealTimer;

  function exitFocus() {
    active = false;
    touchStart = null;
    clearTimeout(revealTimer);
    exit.classList.remove("revealed");
    exit.hidden = true;
    document.body.classList.remove("focus");
    for (const [key] of textOptions) frame.removeAttribute("data-hide-focus-" + key);
    changed(false);
    trigger.focus();
  }

  function configure() {
    const controls = elt("div", undefined, "focus-options");
    const fields = textOptions.map(([key, name]) => {
      const field = elt("input");
      field.type = "checkbox";
      field.checked = options[key] !== false;
      controls.append(label(name, field));
      return [key, field];
    });
    const enter = button("Enter Focus", () => {
      for (const [key, field] of fields) options[key] = field.checked;
      store("focus-text", options);
      close();
      active = true;
      document.body.classList.add("focus");
      for (const [key] of textOptions)
        frame.toggleAttribute("data-hide-focus-" + key, !options[key]);
      exit.hidden = false;
      changed(true);
      frame.focus({ preventScroll: true });
    });
    const actions = elt("div", undefined, "panel-actions");
    actions.append(button("Artwork only", () => {
      for (const [, field] of fields) field.checked = false;
    }), enter);
    modal("Focus view", [
      controls, actions,
      elt("p", "Press Escape to exit. On touchscreens, tap the top edge to reveal Exit Focus.", "hint"),
    ]);
  }

  trigger.onclick = configure;
  exit.onclick = exitFocus;
  frame.addEventListener("pointerdown", (event) => {
    if (!active || event.pointerType !== "touch" || event.target === exit) return;
    const top = frame.getBoundingClientRect().top;
    if (event.clientY - top <= 32) {
      touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });
  frame.addEventListener("pointercancel", () => { touchStart = null; });
  frame.addEventListener("pointerup", (event) => {
    if (event.pointerId !== touchStart?.id) return;
    const { x, y } = touchStart;
    touchStart = null;
    if (Math.hypot(event.clientX - x, event.clientY - y) > 12) return;
    exit.classList.add("revealed");
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => exit.classList.remove("revealed"), 5000);
  });

  return {
    hideLabels: () => active && options.labels === false,
    escape(event) {
      if (!active || event.repeat || event.defaultPrevented || document.fullscreenElement) return;
      event.preventDefault();
      exitFocus();
    },
  };
}
