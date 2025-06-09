import RAPIER from "@dimforge/rapier3d-compat";
import type {
  Collider,
  RevoluteImpulseJoint,
  RigidBody,
  Rotation,
} from "@dimforge/rapier3d-compat";

export const GEOMETRY = Object.freeze({
  halfArm: 0.65,
  pivotY: 1.15,
  hangerLength: 0.43,
  panRadius: 0.26,
  panThickness: 0.016,
  maxAngle: 0.23,
});
export const CALIBRATION = Object.freeze({
  fixedDt: 1 / 60,
  maxDelta: 0.25,
  maxSubsteps: 8,
  angleTolerance: Math.PI / 360,
  positionTolerance: Math.PI / 720,
  beamSpeed: 0.005,
  loadSpeed: 0.01,
  loadAngularSpeed: 0.05,
  settledDuration: 0.5,
});
export type Side = "left" | "right";
export type Preset = "empty" | "equal" | "two-for-one";
type Vector = { x: number; y: number; z: number };
export type ItemDefinition = {
  id: string;
  kind: "bear" | "weight";
  mass: number;
  color?: string;
  height: number;
  radius: number;
  home: Vector | null;
};
export type Item = { body: RigidBody; collider: Collider; definition: ItemDefinition };
export type Simulation = Awaited<ReturnType<typeof createSimulation>>;
type Transform = ReturnType<typeof transform>;

const GRAVITY = 9.81;
const identity = { x: 0, y: 0, z: 0, w: 1 };
const zero = { x: 0, y: 0, z: 0 };
const zAxis = { x: 0, y: 0, z: 1 };

// Size scales with the cube root of mass, so volume is proportional to mass.
// The 10 g bear and the 50 g weight are the size references.
const REFERENCE_BEAR_HEIGHT = 0.18;
const BEAR_COLORS = [
  "#bd1738",
  "#e3a009",
  "#248840",
  "#e06413",
  "#a92350",
  "#d8ad17",
  "#3c9235",
  "#d33e19",
];
const BEAR_MASSES = [0.002, 0.003, 0.004, 0.005, 0.006, 0.01, 0.015, 0.02];
const WEIGHT_MASSES = [0.001, 0.005, 0.01, 0.02, 0.05];

const ITEMS: ItemDefinition[] = [
  ...BEAR_MASSES.map((mass, index): ItemDefinition => {
    const height = REFERENCE_BEAR_HEIGHT * Math.cbrt(mass / 0.01);
    return {
      id: `bear-${index + 1}`,
      kind: "bear",
      mass,
      color: BEAR_COLORS[index],
      height,
      radius: (0.055 * height) / REFERENCE_BEAR_HEIGHT,
      home: { x: -0.63 + index * 0.18, y: height / 2 + 0.002, z: 0.56 },
    };
  }),
  ...WEIGHT_MASSES.map((mass, index): ItemDefinition => {
    const size = Math.cbrt(mass / 0.05);
    const height = 0.12 * size;
    return {
      id: `weight-${index + 1}`,
      kind: "weight",
      mass,
      height,
      radius: 0.063 * size,
      home: { x: -0.4 + index * 0.2, y: height / 2 + 0.002, z: 0.82 },
    };
  }),
];

const zAngle = (rotation: Rotation) =>
  Math.atan2(
    2 * (rotation.w * rotation.z + rotation.x * rotation.y),
    1 - 2 * (rotation.y ** 2 + rotation.z ** 2),
  );
const magnitude = (vector: Vector) => Math.hypot(vector.x, vector.y, vector.z);
const transform = (body: RigidBody) => ({
  position: { ...body.translation() },
  rotation: { ...body.rotation() },
});
// A snapshot with no motion in it yet, e.g. right after a body was created or teleported.
const restingSnapshot = (body: RigidBody) => ({
  previous: transform(body),
  current: transform(body),
});
const isOutOfBounds = ({ x, y, z }: Vector) => y < -0.5 || Math.abs(x) > 3 || Math.abs(z) > 3;

export async function createSimulation() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  const events = new RAPIER.EventQueue(true);
  const impactImpulses = new Map<string, number>();
  world.timestep = CALIBRATION.fixedDt;
  world.numSolverIterations = 12;

  // Table, base plate and column
  const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(4, 0.05, 4).setTranslation(0, -0.05, 0).setFriction(0.8),
    base,
  );
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.038, 0.28).setTranslation(0, 0.038, 0).setFriction(0.8),
    base,
  );
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.54, 0.033).setTranslation(0, 0.61, 0).setFriction(0.7),
    base,
  );
  const beam = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, GEOMETRY.pivotY, 0)
      .setAdditionalMassProperties(
        0.6,
        { x: 0, y: -0.12, z: 0 },
        { x: 0.006, y: 0.055, z: 0.06 },
        identity,
      )
      .setAngularDamping(12)
      .setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.65, 0.018, 0.035).setDensity(0), beam);
  const fulcrum = world.createImpulseJoint(
    RAPIER.JointData.revolute({ x: 0, y: GEOMETRY.pivotY, z: 0 }, zero, zAxis),
    base,
    beam,
    true,
  ) as RevoluteImpulseJoint;
  fulcrum.setLimits(-GEOMETRY.maxAngle, GEOMETRY.maxAngle);
  fulcrum.setContactsEnabled(false);

  function createPan(sign: number) {
    const pan = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(sign * GEOMETRY.halfArm, GEOMETRY.pivotY, 0)
        .setAdditionalMassProperties(
          0.45,
          { x: 0, y: -0.43, z: 0 },
          { x: 0.095, y: 0.017, z: 0.095 },
          identity,
        )
        .setAngularDamping(2)
        .setCanSleep(false),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(GEOMETRY.panThickness / 2, GEOMETRY.panRadius)
        .setTranslation(0, -GEOMETRY.hangerLength, 0)
        .setDensity(0)
        .setFriction(0.9)
        .setRestitution(0),
      pan,
    );
    // Twelve short walls form the shallow rim
    for (let index = 0; index < 12; index++) {
      const angle = (index * Math.PI) / 6;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.071, 0.014, 0.009)
          .setTranslation(
            Math.sin(angle) * 0.253,
            -GEOMETRY.hangerLength + 0.012,
            Math.cos(angle) * 0.253,
          )
          .setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) })
          .setDensity(0)
          .setFriction(0.8),
        pan,
      );
    }
    const hinge = RAPIER.JointData.revolute(
      { x: sign * GEOMETRY.halfArm, y: 0, z: 0 },
      zero,
      zAxis,
    );
    world.createImpulseJoint(hinge, beam, pan, true).setContactsEnabled(false);
    return pan;
  }
  const pans: Record<Side, RigidBody> = { left: createPan(-1), right: createPan(1) };

  const items = new Map<string, Item>();
  const bodies = [beam, pans.left, pans.right];
  const colliderItems = new Map<number, Item>();
  const snapshots = new Map<number, { previous: Transform; current: Transform }>();

  function addItem(definition: ItemDefinition, position: Vector = definition.home!) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.25)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    const [hx, hy, hz, rounding] = [0.038, 0.073, 0.025, 0.017].map(
      (size) => (size * definition.height) / REFERENCE_BEAR_HEIGHT,
    );
    const shape =
      definition.kind === "bear"
        ? RAPIER.ColliderDesc.roundCuboid(hx, hy, hz, rounding)
        : RAPIER.ColliderDesc.cylinder(definition.height / 2, definition.radius);
    const collider = world.createCollider(
      shape
        .setMass(definition.mass)
        .setFriction(0.85)
        .setRestitution(0)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      body,
    );
    const item: Item = { body, collider, definition };
    items.set(definition.id, item);
    bodies.push(body);
    colliderItems.set(collider.handle, item);
    snapshots.set(body.handle, restingSnapshot(body));
  }
  for (const definition of ITEMS) addItem(definition);

  let copies = 0;
  function spawn(id: string) {
    const source = items.get(id)?.definition;
    if (!source) return null;
    const definition = { ...source, id: `${source.id.split("#")[0]}#${++copies}`, home: null };
    addItem(definition, source.home!);
    return definition.id;
  }
  function remove(id: string) {
    const item = items.get(id);
    if (!item) return;
    if (heldId === id) endDrag(id);
    items.delete(id);
    bodies.splice(bodies.indexOf(item.body), 1);
    colliderItems.delete(item.collider.handle);
    snapshots.delete(item.body.handle);
    impactImpulses.delete(id);
    world.removeRigidBody(item.body);
  }

  let accumulator = 0;
  let settledFor = 0;
  let stepCount = 0;
  let heldId: string | null = null;
  let pickup: Transform | null = null;

  function syncSnapshots() {
    for (const body of bodies) snapshots.set(body.handle, restingSnapshot(body));
  }

  function teleport(body: RigidBody, position: Vector, rotation: Rotation = identity) {
    body.setTranslation(position, true);
    body.setRotation(rotation, true);
    body.setLinvel(zero, true);
    body.setAngvel(zero, true);
    body.resetForces(true);
    body.resetTorques(true);
    snapshots.set(body.handle, restingSnapshot(body));
    settledFor = 0;
  }
  function place(
    id: string,
    side: Side,
    offset: { x?: number; z?: number } = {},
    dropHeight = 0.03,
  ) {
    const item = items.get(id);
    if (!item || !pans[side]) return;
    if (heldId === id) endDrag(id);
    const pan = pans[side];
    const angle = zAngle(pan.rotation());
    const localX = offset.x ?? 0;
    const localY =
      -GEOMETRY.hangerLength + GEOMETRY.panThickness / 2 + item.definition.height / 2 + dropHeight;
    const position = pan.translation();
    teleport(item.body, {
      x: position.x + localX * Math.cos(angle) - localY * Math.sin(angle),
      y: position.y + localX * Math.sin(angle) + localY * Math.cos(angle),
      z: position.z + (offset.z ?? 0),
    });
  }
  function reset(preset: Preset = "empty") {
    if (heldId) endDrag(heldId);
    teleport(beam, { x: 0, y: GEOMETRY.pivotY, z: 0 });
    teleport(pans.left, { x: -GEOMETRY.halfArm, y: GEOMETRY.pivotY, z: 0 });
    teleport(pans.right, { x: GEOMETRY.halfArm, y: GEOMETRY.pivotY, z: 0 });
    for (const item of items.values()) {
      if (item.definition.home) teleport(item.body, item.definition.home);
      else remove(item.definition.id);
    }
    if (preset === "equal") {
      place("weight-4", "left");
      place("bear-8", "right");
    } else if (preset === "two-for-one") {
      place("weight-3", "left");
      place("bear-3", "right", { z: -0.09 });
      place("bear-5", "right", { z: 0.09 });
    }
    accumulator = 0;
    stepCount = 0;
    impactImpulses.clear();
    syncSnapshots();
  }
  function beginDrag(id: string) {
    if (heldId) cancelDrag(heldId);
    const item = items.get(id);
    if (!item) return false;
    heldId = id;
    pickup = transform(item.body);
    item.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    item.body.enableCcd(false);
    item.collider.setCollisionGroups(0);
    settledFor = 0;
    return true;
  }
  function moveDrag(id: string, position: Vector) {
    if (heldId !== id || ![position.x, position.y, position.z].every(Number.isFinite)) return;
    const body = items.get(id)!.body;
    body.setNextKinematicTranslation(position);
    body.setNextKinematicRotation(identity);
  }
  function endDrag(id: string) {
    if (heldId !== id) return;
    const item = items.get(id)!;
    item.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    item.body.setLinvel(zero, true);
    item.body.setAngvel(zero, true);
    item.collider.setCollisionGroups(0xffffffff);
    item.body.enableCcd(true);
    heldId = null;
    pickup = null;
    settledFor = 0;
  }
  function cancelDrag(id: string) {
    if (heldId !== id) return;
    const previous = pickup!;
    endDrag(id);
    teleport(items.get(id)!.body, previous.position, previous.rotation);
  }
  function returnHome(id: string) {
    const item = items.get(id);
    if (!item) return;
    if (!item.definition.home) return remove(id);
    if (heldId === id) endDrag(id);
    teleport(item.body, item.definition.home);
  }
  function step(delta: number) {
    accumulator += Math.min(CALIBRATION.maxDelta, Math.max(0, Number.isFinite(delta) ? delta : 0));
    let substeps = 0;
    while (accumulator + 1e-10 >= CALIBRATION.fixedDt && substeps < CALIBRATION.maxSubsteps) {
      for (const body of bodies) snapshots.get(body.handle)!.previous = transform(body);
      const moving = new Set(
        [...items.values()]
          .filter(({ body }) => magnitude(body.linvel()) > 0.04 || magnitude(body.angvel()) > 0.2)
          .map((item) => item.definition.id),
      );
      world.step(events);
      events.drainContactForceEvents((event) => {
        for (const handle of [event.collider1(), event.collider2()]) {
          const item = colliderItems.get(handle);
          if (!item || !moving.has(item.definition.id)) continue;
          const { id, mass } = item.definition;
          const excessForce = event.totalForceMagnitude() - mass * GRAVITY * 1.5;
          const impulse = Math.max(0, excessForce) * CALIBRATION.fixedDt;
          impactImpulses.set(id, Math.max(impulse, impactImpulses.get(id) ?? 0));
        }
      });
      for (const { body, definition } of items.values()) {
        if (heldId !== definition.id && isOutOfBounds(body.translation())) {
          returnHome(definition.id);
        }
      }
      for (const body of bodies) snapshots.get(body.handle)!.current = transform(body);
      const still =
        !heldId &&
        magnitude(beam.angvel()) <= CALIBRATION.beamSpeed &&
        [...items.values()].every(
          ({ body }) =>
            magnitude(body.linvel()) <= CALIBRATION.loadSpeed &&
            magnitude(body.angvel()) <= CALIBRATION.loadAngularSpeed,
        );
      settledFor = still ? settledFor + CALIBRATION.fixedDt : 0;
      accumulator = Math.max(0, accumulator - CALIBRATION.fixedDt);
      substeps++;
      stepCount++;
    }
    if (substeps === CALIBRATION.maxSubsteps) accumulator = 0;
    return accumulator / CALIBRATION.fixedDt;
  }

  function loadedMass(side: Side) {
    const pan = pans[side];
    if (!pan) return 0;
    const byCollider = new Map([...items.values()].map((item) => [item.collider.handle, item]));
    const visited = new Set<number>();
    const pending = Array.from({ length: pan.numColliders() }, (_, index) => pan.collider(index));
    let mass = 0;
    for (let index = 0; index < pending.length; index++) {
      const support = pending[index];
      world.contactPairsWith(support, (other) => {
        const item = byCollider.get(other.handle);
        if (!item || visited.has(other.handle) || heldId === item.definition.id) return;
        let touching = false;
        world.contactPair(support, other, (manifold) => {
          touching ||= manifold.numSolverContacts() > 0;
        });
        if (!touching) return;
        visited.add(other.handle);
        pending.push(other);
        mass += item.definition.mass;
      });
    }
    return mass;
  }

  reset();
  return {
    world,
    beam,
    pans,
    items,
    snapshots,
    step,
    reset,
    place,
    spawn,
    remove,
    beginDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    loadedMass,
    returnHome,
    takeImpact(id: string) {
      const impulse = impactImpulses.get(id) ?? 0;
      impactImpulses.delete(id);
      return impulse;
    },
    angle: () => zAngle(beam.rotation()),
    panAngle: (side: Side) => zAngle(pans[side].rotation()),
    isSettled: () => settledFor >= CALIBRATION.settledDuration,
    get heldId() {
      return heldId;
    },
    get stepCount() {
      return stepCount;
    },
    dispose: () => {
      events.free();
      world.free();
    },
  };
}
