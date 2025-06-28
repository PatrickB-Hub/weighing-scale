import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import { GEOMETRY } from "./physics/scale";
import type { ItemDefinition, Side, Simulation } from "./physics/scale";
import { updateJiggle } from "./jiggle";

type Point = [number, number, number];
type Drawable = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material & { map?: THREE.Texture | null };
};
type Visual = {
  group: THREE.Group;
  gummy?: THREE.Mesh;
  lastVelocity: THREE.Vector3;
  amplitude: number;
  phase: number;
};

const standardMaterial = (color: string, metalness: number, roughness: number) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });

const brass = standardMaterial("#b6a16a", 0.78, 0.3);
const goldEdge = standardMaterial("#d8c28b", 0.8, 0.23);
const darkBrass = standardMaterial("#766d4d", 0.75, 0.38);
const enamel = standardMaterial("#395346", 0.22, 0.32);
const ivory = standardMaterial("#efe9d5", 0.08, 0.5);

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parent: THREE.Object3D,
  position: Point = [0, 0, 0],
) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function cylinder(
  parent: THREE.Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  y: number,
  material: THREE.Material = brass,
) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 48);
  return mesh(geometry, material, parent, [0, y, 0]);
}

function lathe(parent: THREE.Object3D, profile: [number, number][], material: THREE.Material) {
  const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
  return mesh(new THREE.LatheGeometry(points, 64), material, parent);
}

function rod(
  parent: THREE.Object3D,
  from: Point,
  to: Point,
  radius = 0.004,
  material: THREE.Material = brass,
) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const geometry = new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 10);
  const object = mesh(geometry, material, parent);
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  return object;
}

function textSprite(text: string, color = "#f2e5b8", scale = 0.08) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.font = "500 58px Georgia";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(text, 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(scale * 2, scale, 1);
  return sprite;
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const maxPixelRatio = matchMedia("(pointer: coarse)").matches ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight("#fff7e5", "#88987f", 1.5));

  const key = new THREE.DirectionalLight("#fff4db", 3);
  key.position.set(-2, 4, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 10 });
  key.shadow.normalBias = 0.012;
  key.shadow.bias = -0.0001;
  key.shadow.radius = 3;
  scene.add(key);

  const fill = new THREE.DirectionalLight("#e7f1e1", 1.4);
  fill.position.set(2, 2, -2);
  scene.add(fill);

  const floorMaterial = new THREE.ShadowMaterial({ color: "#66704e", opacity: 0.19 });
  const floor = mesh(new THREE.PlaneGeometry(200, 200), floorMaterial, scene);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.castShadow = false;
}

// Engraved equilibrium dial fixed to the column
function buildDial() {
  const dial = new THREE.Group();
  dial.position.set(0, 0.915, 0.057);

  const face = mesh(new THREE.CircleGeometry(0.095, 48), ivory, dial);
  face.castShadow = false;
  const rim = mesh(new THREE.TorusGeometry(0.095, 0.003, 8, 64), goldEdge, dial);
  rim.position.z = 0.002;

  for (let i = -5; i <= 5; i++) {
    const angle = i * 0.15;
    const inner = i % 5 === 0 ? 0.06 : 0.068;
    rod(
      dial,
      [Math.sin(angle) * 0.075, Math.cos(angle) * 0.075, 0.004],
      [Math.sin(angle) * inner, Math.cos(angle) * inner, 0.004],
      0.0008,
      darkBrass,
    );
  }

  const label = textSprite("BALANCE", "#6f735f", 0.015);
  label.position.set(0, -0.04, 0.007);
  dial.add(label);
  return dial;
}

function buildStand() {
  const stand = new THREE.Group();
  const baseProfile: [number, number][] = [
    [0, 0.018],
    [0.28, 0.018],
    [0.285, 0.035],
    [0.275, 0.06],
    [0.22, 0.078],
    [0, 0.078],
  ];
  const columnProfile: [number, number][] = [
    [0, 0.07],
    [0.16, 0.07],
    [0.135, 0.09],
    [0.105, 0.12],
    [0.08, 0.135],
    [0.06, 0.15],
    [0.045, 0.2],
    [0.032, 0.26],
    [0.032, 0.9],
    [0.047, 0.93],
    [0.049, 0.965],
    [0.037, 0.984],
    [0.033, 1.02],
    [0, 1.02],
  ];
  lathe(stand, baseProfile, enamel);
  cylinder(stand, 0.257, 0.269, 0.008, 0.057, goldEdge);
  lathe(stand, columnProfile, brass);
  for (const y of [0.18, 0.23, 0.89, 0.945]) cylinder(stand, 0.044, 0.044, 0.009, y, goldEdge);
  cylinder(stand, 0.028, 0.034, 0.18, 1.06, brass);
  mesh(new THREE.SphereGeometry(0.036, 24, 16), goldEdge, stand, [0, GEOMETRY.pivotY + 0.062, 0]);

  const badge = textSprite("01", "#d7c796", 0.037);
  badge.position.set(0, 0.069, 0.235);
  stand.add(badge);
  stand.add(buildDial());
  return stand;
}

function buildBeam() {
  const beam = new THREE.Group();
  const halfArm = GEOMETRY.halfArm;

  const outline = new THREE.Shape();
  outline.moveTo(-halfArm, -0.009);
  outline.bezierCurveTo(-halfArm * 0.8, 0.004, -0.2, 0.026, 0, 0.02);
  outline.bezierCurveTo(0.2, 0.026, halfArm * 0.8, 0.004, halfArm, -0.009);
  outline.lineTo(halfArm, 0.014);
  outline.bezierCurveTo(halfArm * 0.6, 0.026, 0.18, 0.082, 0, 0.057);
  outline.bezierCurveTo(-0.18, 0.082, -halfArm * 0.6, 0.026, -halfArm, 0.014);
  outline.closePath();
  const beamGeometry = new THREE.ExtrudeGeometry(outline, {
    depth: 0.026,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    curveSegments: 24,
  });
  const beamMesh = mesh(beamGeometry, brass, beam);
  beamMesh.position.z = -0.013;

  for (const x of [-halfArm, 0, halfArm]) {
    const radius = x === 0 ? 0.036 : 0.018;
    mesh(new THREE.SphereGeometry(radius, 24, 16), goldEdge, beam, [x, 0.007, 0]);
  }

  // Pointer that swings over the dial
  rod(beam, [0, -0.007, 0.05], [0, -0.19, 0.05], 0.0025, darkBrass);
  const tip = mesh(new THREE.ConeGeometry(0.008, 0.035, 3), darkBrass, beam, [0, -0.205, 0.05]);
  tip.rotation.z = Math.PI;
  return beam;
}

function buildPan() {
  const pan = new THREE.Group();
  const drop = GEOMETRY.hangerLength;
  const radius = GEOMETRY.panRadius;

  const bowlProfile: [number, number][] = [
    [0, -drop - 0.014],
    [radius * 0.6, -drop - 0.014],
    [radius * 0.88, -drop - 0.005],
    [radius, -drop + 0.033],
    [radius, -drop + 0.043],
    [radius * 0.97, -drop + 0.046],
    [radius * 0.84, -drop + 0.005],
    [0, -drop + 0.005],
  ];
  const bowl = lathe(pan, bowlProfile, brass);
  bowl.receiveShadow = true;

  const lip = mesh(new THREE.TorusGeometry(radius * 0.989, 0.003, 8, 64), goldEdge, pan);
  lip.position.y = -drop + 0.04;
  lip.rotation.x = Math.PI / 2;

  for (const angle of [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6]) {
    const anchor: Point = [
      Math.cos(angle) * radius * 0.94,
      -drop + 0.039,
      Math.sin(angle) * radius * 0.94,
    ];
    rod(pan, [0, -0.035, 0], anchor, 0.0025, goldEdge);
  }

  const ring = mesh(new THREE.TorusGeometry(0.021, 0.003, 8, 24), goldEdge, pan, [0, -0.016, 0]);
  ring.rotation.y = Math.PI / 2;
  return pan;
}

// Returns the bear mesh centred on the origin and scaled to a height of 1
async function loadBearGeometry() {
  const asset = await new GLTFLoader().loadAsync(
    `${import.meta.env.BASE_URL}models/gummy-bear.glb`,
  );
  const source = asset.scene.getObjectByName("GummyBear") as THREE.Mesh | undefined;
  if (!source?.isMesh) throw new Error("The gummy-bear model is missing its GummyBear mesh.");

  const bounds = new THREE.Box3().setFromObject(source);
  const centre = bounds.getCenter(new THREE.Vector3());
  const height = bounds.max.y - bounds.min.y;
  const geometry = source.geometry.clone();
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / height, 1 / height, 1 / height);

  for (const object of asset.scene.children as Drawable[]) {
    if (!(object as THREE.Mesh).isMesh) continue;
    object.geometry!.dispose();
    object.material!.dispose();
  }
  return geometry;
}

function createItemVisual(
  id: string,
  definition: ItemDefinition,
  bearGeometry: THREE.BufferGeometry,
) {
  const group = new THREE.Group();
  group.userData.itemId = id;
  let gummy: THREE.Mesh | undefined;

  if (definition.kind === "bear") {
    const material = new THREE.MeshPhysicalMaterial({
      color: definition.color,
      roughness: 0.17,
      metalness: 0,
      transmission: 0.3,
      thickness: 0.075,
      ior: 1.45,
      clearcoat: 0.8,
      clearcoatRoughness: 0.14,
      attenuationDistance: 0.06,
      attenuationColor: definition.color,
    });
    gummy = mesh(bearGeometry, material, group);
    group.scale.setScalar(definition.height);
  } else {
    const { height, radius } = definition;
    const half = height / 2;
    const weightProfile: [number, number][] = [
      [0, -half],
      [radius, -half],
      [radius, -half + 0.007],
      [radius * 0.83, -half + 0.01],
      [radius * 0.68, height * 0.16],
      [radius * 0.45, height * 0.22],
      [radius * 0.37, height * 0.3],
      [radius * 0.46, height * 0.32],
      [radius * 0.48, height * 0.4],
      [radius * 0.35, half],
      [0, half],
    ];
    lathe(group, weightProfile, darkBrass);
    cylinder(group, radius * 0.96, radius * 0.96, 0.003, -half + 0.007, goldEdge);
    const grams = `${Math.round(definition.mass * 1000)}`;
    const label = textSprite(grams, "#e5d5a1", Math.max(0.012, radius * 0.4));
    label.position.set(0, -height * 0.12, radius * 0.83);
    group.add(label);
  }

  group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) object.userData.itemId = id;
  });
  return { group, gummy, lastVelocity: new THREE.Vector3(), amplitude: 0, phase: 0 };
}

export async function createScene(container: HTMLElement, simulation: Simulation) {
  const renderer = createRenderer();
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.75;
  room.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minDistance = 2.5;
  controls.maxDistance = 5.8;
  controls.minPolarAngle = Math.PI * 0.23;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minAzimuthAngle = -0.65;
  controls.maxAzimuthAngle = 0.65;
  const resetCamera = () => {
    camera.position.set(0.65, 1.85, 3.45);
    controls.target.set(0, 0.51, 0.16);
    controls.update();
  };
  resetCamera();

  addLights(scene);
  scene.add(buildStand());
  const beam = buildBeam();
  scene.add(beam);
  const pans = { left: buildPan(), right: buildPan() } satisfies Record<Side, THREE.Group>;
  scene.add(pans.left, pans.right);

  const bearGeometry = await loadBearGeometry();
  const visuals = new Map<string, Visual>();

  function addVisual(id: string, definition: ItemDefinition) {
    const visual = createItemVisual(id, definition, bearGeometry);
    scene.add(visual.group);
    visuals.set(id, visual);
  }

  function removeVisual(id: string, { group }: Visual) {
    scene.remove(group);
    group.traverse((child) => {
      const object = child as Drawable;
      if ((object as THREE.Mesh).isMesh && object.geometry !== bearGeometry) {
        object.geometry!.dispose();
      }
      if (object.material && object.material !== darkBrass && object.material !== goldEdge) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    visuals.delete(id);
  }

  for (const [id, item] of simulation.items) addVisual(id, item.definition);

  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    camera.aspect = width / height;
    camera.fov = camera.aspect < 1 ? 42 / camera.aspect : 34;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // Reused every frame to avoid allocations
  const fromPosition = new THREE.Vector3();
  const toPosition = new THREE.Vector3();
  const fromRotation = new THREE.Quaternion();
  const toRotation = new THREE.Quaternion();

  // Interpolates between the last two physics steps so motion stays smooth at any frame rate
  function sync(object: THREE.Object3D, body: RigidBody, alpha: number) {
    const snapshot = simulation.snapshots.get(body.handle);
    if (!snapshot) {
      object.position.copy(body.translation());
      object.quaternion.copy(body.rotation());
      return;
    }
    fromPosition.copy(snapshot.previous.position);
    toPosition.copy(snapshot.current.position);
    fromRotation.copy(snapshot.previous.rotation);
    toRotation.copy(snapshot.current.rotation);
    object.position.copy(fromPosition).lerp(toPosition, alpha);
    object.quaternion.copy(fromRotation).slerp(toRotation, alpha);
  }

  function render(alpha: number, dt: number, reducedMotion: boolean) {
    sync(beam, simulation.beam, alpha);
    sync(pans.left, simulation.pans.left, alpha);
    sync(pans.right, simulation.pans.right, alpha);

    for (const [id, item] of simulation.items) {
      if (!visuals.has(id)) addVisual(id, item.definition);
    }
    for (const [id, visual] of visuals) {
      if (!simulation.items.has(id)) removeVisual(id, visual);
    }

    for (const [id, visual] of visuals) {
      const item = simulation.items.get(id)!;
      sync(visual.group, item.body, alpha);
      if (!visual.gummy) continue;

      const velocity = new THREE.Vector3().copy(item.body.linvel());
      const spin = item.body.angvel();
      const jiggle = updateJiggle(
        visual,
        dt,
        velocity.distanceTo(visual.lastVelocity),
        Math.hypot(spin.x, spin.y, spin.z),
        simulation.takeImpact(id),
        reducedMotion,
      );
      visual.gummy.scale.set(jiggle.x, jiggle.y, jiggle.z);
      visual.gummy.rotation.z = jiggle.tilt;
      visual.lastVelocity.copy(velocity);
    }

    controls.enableDamping = !reducedMotion;
    controls.update();
    renderer.render(scene, camera);
  }

  function dispose() {
    observer.disconnect();
    controls.dispose();
    environment.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<NonNullable<Drawable["material"]>>();
    scene.traverse((child) => {
      const object = child as Drawable;
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { scene, camera, renderer, controls, visuals, render, resetCamera, dispose };
}
