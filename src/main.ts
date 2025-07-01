import "./styles.scss";
import * as THREE from "three";
import { CALIBRATION, createSimulation, GEOMETRY } from "./physics/scale";
import type { Item, ItemDefinition, Preset, Side } from "./physics/scale";
import { createScene } from "./scene";
import bearIcon from "./icons/bear.svg?raw";
import weightIcon from "./icons/weight.svg?raw";

const UI_UPDATE_INTERVAL_MS = 160;
// A pan holds one centre slot plus a ring of six
const SLOTS_PER_LAYER = 7;

const PRESET_ANNOUNCEMENTS: Record<Preset, string> = {
  empty: "Scale reset. All objects are on the table.",
  equal: "Equal measures: a 20 gram bear balances a 20 gram weight.",
  "two-for-one": "Two for one: a 4 gram and a 6 gram bear balance a 10 gram weight.",
};

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

function announce(text: string) {
  $("#announcement").textContent = text;
}

const grams = (kilograms: number) => Math.round(kilograms * 1000);

const itemNumber = (id: string) => id.split(/[-#]/)[1];

const isOnScale = ({ body, definition }: Item) => body.translation().y > definition.height + 0.2;

function balanceStatus(settled: boolean, angle: number) {
  if (!settled) return "SETTLING";
  if (Math.abs(angle) < CALIBRATION.angleTolerance) return "IN BALANCE";
  return angle > 0 ? "LEFT IS HEAVIER" : "RIGHT IS HEAVIER";
}

function createObjectButton(id: string, definition: ItemDefinition) {
  const isBear = definition.kind === "bear";
  const button = document.createElement("button");
  button.className = "object-button";
  button.dataset.item = id;
  button.setAttribute("aria-pressed", "false");
  button.setAttribute(
    "aria-label",
    `${isBear ? "Gummy bear" : "Brass weight"} ${itemNumber(id)}, ${grams(definition.mass)} grams`,
  );
  if (isBear) button.style.setProperty("--bear-color", definition.color!);
  const icon = isBear ? bearIcon : weightIcon;
  button.innerHTML = `${icon.trim()}<small>${grams(definition.mass)} g</small>`;
  return button;
}

async function start() {
  const simulation = await createSimulation();
  const view = await createScene($("#scene"), simulation);
  $("#loading").hidden = true;

  const canvas = view.renderer.domElement;
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new AbortController();
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options: AddEventListenerOptions = {},
  ) =>
    target.addEventListener(type, handler as EventListener, {
      ...options,
      signal: listeners.signal,
    });

  const objectButtons = new Map<string, HTMLButtonElement>();
  let selected: string | null = null;
  let selectionLabel = "";
  let dragging: { id: string; pointerId: number } | null = null;
  let lastFrameTime: number | null = null;
  let lastUIUpdate = 0;
  let lastAnnouncement = "";
  let running = true;

  // Selecting and placing objects with the buttons

  function select(id: string | null) {
    selected = id;
    const definition = id === null ? undefined : simulation.items.get(id)?.definition;
    for (const [itemId, button] of objectButtons) {
      button.setAttribute("aria-pressed", String(itemId === id));
    }
    selectionLabel = "";
    if (definition) {
      const name = definition.kind === "bear" ? `Gummy bear ${itemNumber(id!)}` : "Brass weight";
      selectionLabel = `${name} · ${grams(definition.mass)} g`;
    }
    for (const name of ["#place-left", "#place-right", "#return-object"]) {
      $<HTMLButtonElement>(name).disabled = !definition;
    }
  }

  function place(side: Side) {
    if (!selected) return;
    const panX = simulation.pans[side].translation().x;
    const itemsOnPan = [...simulation.items.values()].filter(
      (item) => Math.abs(item.body.translation().x - panX) < GEOMETRY.panRadius && isOnScale(item),
    ).length;
    const slot = itemsOnPan % SLOTS_PER_LAYER;
    const layer = Math.floor(itemsOnPan / SLOTS_PER_LAYER);
    const angle = (slot * Math.PI) / 3;
    const offset = slot === 0 ? {} : { x: Math.cos(angle) * 0.12, z: Math.sin(angle) * 0.12 };
    simulation.place(selected, side, offset, 0.15 + layer * 0.12);
    announce(`${selectionLabel} placed on the ${side} pan.`);
  }

  function reset(preset: Preset) {
    cancelDrag();
    simulation.reset(preset);
    select(null);
    announce(PRESET_ANNOUNCEMENTS[preset]);
  }

  for (const [id, { definition }] of simulation.items) {
    const button = createObjectButton(id, definition);
    listen(button, "click", () => {
      // An object already on the scale (or in hand) stays put
      const inUse = isOnScale(simulation.items.get(id)!) || simulation.heldId === id;
      select(inUse ? simulation.spawn(id) : id);
      place(definition.kind === "bear" ? "left" : "right");
    });
    $(definition.kind === "bear" ? "#bear-list" : "#weight-list").appendChild(button);
    objectButtons.set(id, button);
  }

  listen($("#place-left"), "click", () => place("left"));
  listen($("#place-right"), "click", () => place("right"));
  listen($("#return-object"), "click", () => {
    if (!selected) return;
    simulation.returnHome(selected);
    if (!simulation.items.has(selected)) select(null);
    announce("Object returned to the table.");
  });
  listen($("#reset"), "click", () => reset("empty"));
  for (const button of document.querySelectorAll<HTMLElement>("[data-preset]")) {
    listen(button, "click", () => reset(button.dataset.preset as Preset));
  }
  listen($("#camera-reset"), "click", () => view.resetCamera());
  listen($("#about-toggle"), "click", () => {
    const expanded = $("#about").hidden;
    $("#about").hidden = !expanded;
    $("#about-toggle").setAttribute("aria-expanded", String(expanded));
    $("#about-toggle span").textContent = expanded ? "−" : "+";
  });

  // Dragging objects in the scene

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPoint = new THREE.Vector3();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.1);

  function setRay(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, view.camera);
  }

  function moveHeld(event: PointerEvent) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    setRay(event);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    const height = simulation.items.get(dragging.id)!.definition.height;
    simulation.moveDrag(dragging.id, {
      x: THREE.MathUtils.clamp(dragPoint.x, -1.4, 1.4),
      y: THREE.MathUtils.clamp(dragPoint.y + height * 0.3, height / 2 + 0.02, 1.7),
      z: 0.1,
    });
  }

  function clearDrag() {
    const pointerId = dragging?.pointerId;
    dragging = null;
    view.controls.enabled = true;
    canvas.classList.remove("dragging");
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    $("#interaction-hint").innerHTML =
      "Drag to weigh <span>·</span> Drag the background to look around";
  }

  function cancelDrag() {
    if (!dragging) return;
    simulation.cancelDrag(dragging.id);
    clearDrag();
    announce("Pick-up cancelled.");
  }

  listen(
    canvas,
    "pointerdown",
    (event: PointerEvent) => {
      if (event.button !== 0 || dragging) return;
      setRay(event);
      const intersections = raycaster.intersectObjects(
        [...view.visuals.values()].map((visual) => visual.group),
        true,
      );
      const hit = intersections.find((intersection) => intersection.object.userData.itemId);
      if (!hit) return;
      const id: string = hit.object.userData.itemId;
      if (!simulation.beginDrag(id)) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      view.controls.enabled = false;
      dragging = { id, pointerId: event.pointerId };
      select(id);
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
      $("#interaction-hint").textContent = "Release above a pan · Escape to cancel";
      moveHeld(event);
    },
    { capture: true },
  );
  listen(canvas, "pointermove", moveHeld);
  listen(canvas, "pointerup", (event: PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const id = dragging.id;
    moveHeld(event);
    // Position can lag one physics tick; flush pending kinematic movement before release.
    simulation.step(CALIBRATION.fixedDt);
    simulation.endDrag(id);
    clearDrag();
    announce("Object released.");
  });
  listen(canvas, "pointercancel", cancelDrag);
  listen(canvas, "lostpointercapture", cancelDrag);
  listen(window, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") cancelDrag();
  });
  listen(document, "visibilitychange", () => {
    if (document.hidden) cancelDrag();
    lastFrameTime = null;
  });
  listen(window, "blur", cancelDrag);

  // Readouts

  function updateUI(time: number) {
    if (time - lastUIUpdate < UI_UPDATE_INTERVAL_MS) return;
    lastUIUpdate = time;
    const left = grams(simulation.loadedMass("left"));
    const right = grams(simulation.loadedMass("right"));
    $("#left-mass").innerHTML = `${left} <small>g</small>`;
    $("#right-mass").innerHTML = `${right} <small>g</small>`;

    const settled = simulation.isSettled();
    const status = dragging ? "IN YOUR HANDS" : balanceStatus(settled, simulation.angle());
    $("#balance-state").textContent = status;
    if (settled && status !== lastAnnouncement) {
      announce(`${status.toLowerCase()}. Left pan ${left} grams, right pan ${right} grams.`);
      lastAnnouncement = status;
    }
    for (const [id, button] of objectButtons) {
      button.classList.toggle("is-placed", isOnScale(simulation.items.get(id)!));
    }
  }

  // Frame loop and teardown

  function frame(time: number) {
    if (!running) return;
    const dt = lastFrameTime === null ? 0 : Math.max(0, (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    const alpha = simulation.step(dt);
    view.render(alpha, Math.min(dt, 0.05), motionPreference.matches);
    updateUI(time);
  }
  view.renderer.setAnimationLoop(frame);

  function dispose() {
    if (!running) return;
    running = false;
    listeners.abort();
    view.renderer.setAnimationLoop(null);
    view.dispose();
    simulation.dispose();
  }
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  listen(
    window,
    "pagehide",
    (event: PageTransitionEvent) => {
      if (!event.persisted) dispose();
    },
    { once: true },
  );
}

start().catch((error) => {
  console.error(error);
  $("#loading").textContent =
    "The scene could not load. Please reload in a browser with WebGL support.";
  $("#loading").setAttribute("role", "alert");
});
