import { slabSurface } from "./slabSurface";
import { patternWind } from "../domain/wind";
import { thermalLabel } from "../domain/thermalLoads";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  actionVector,
  pointFraction,
  type MemberPointLoad,
} from "../domain/memberPointLoads";
import {
  distributedArrows,
  distributedLoadLabel,
} from "./DistributedLoadGlyph";
import { pointLoadLabel } from "./PointLoadGlyph";
import { memberAxis } from "../domain/memberOffsets";
import { beamMeshLayout } from "../domain/beamMesh";
import { ViewLayers, type LayerControls } from "./ViewLayers";
import { formatResult } from "./resultFormatting";
import { Maximize, Plus, Minus } from "lucide-react";
import {
  beamAxes,
  coordinates,
  distance,
  interpolate,
  scale,
  tolerance,
  type Point3,
} from "../domain/geometry";
import type {
  Member,
  Project,
  SelectedObject,
  Selection,
  StructuralNode,
} from "../domain/model";
import type { StructuralResult } from "../solver/oofem";
import { restrainedDofs, supportBasis } from "../domain/supports";
import type { Theme } from "../theme";
import { additiveSelection } from "./WorkPlaneView";
import { useUnits } from "./Units";
import {
  formatQuantity,
  unitLabel,
  type UnitPreferences,
  type UnitQuantity,
} from "../units";

export type SpatialCamera = {
  modelKey: string;
  eye: THREE.Vector3;
  target: THREE.Vector3;
};
interface SceneState {
  grid: THREE.GridHelper;
  modelKey: string;
  restoreOrFit: () => void;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: THREE.Group;
  memberAxes: THREE.Group;
  materials: ReturnType<typeof createModelMaterials>;
  render: () => void;
  fit: () => void;
  applyPalette: () => void;
}
function createModelMaterials() {
  return {
    slab: new THREE.MeshStandardMaterial(),
    selectedSlab: new THREE.MeshStandardMaterial(),
    member: new THREE.LineBasicMaterial(),
    selectedMember: new THREE.LineBasicMaterial(),
    rigidArm: new THREE.LineBasicMaterial(),
    launchAxis: new THREE.LineDashedMaterial({
      dashSize: 0.12,
      gapSize: 0.08,
      transparent: true,
      opacity: 0.5,
    }),
    load: new THREE.LineBasicMaterial(),
    deformed: new THREE.LineBasicMaterial(),
    axisX: new THREE.LineBasicMaterial({ depthTest: false }),
    axisY: new THREE.LineBasicMaterial({ depthTest: false }),
    axisZ: new THREE.LineBasicMaterial({ depthTest: false }),
    meshStation: new THREE.PointsMaterial({
      size: 5,
      sizeAttenuation: false,
      depthTest: false,
    }),
    node: new THREE.MeshStandardMaterial(),
    selectedNode: new THREE.MeshStandardMaterial(),
    support: new THREE.MeshStandardMaterial({ wireframe: true }),
  };
}

function clearModel(group: THREE.Group) {
  group.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
  group.clear();
}

function recolorGrid(grid: THREE.GridHelper, regular: string, center: string) {
  const colors = grid.geometry.getAttribute("color");
  const vertices = grid.geometry.getAttribute("position");
  const regularColor = new THREE.Color(regular);
  const centerColor = new THREE.Color(center);
  for (let i = 0; i < vertices.count; i += 2) {
    const onAxis =
      (vertices.getX(i) === 0 && vertices.getX(i + 1) === 0) ||
      (vertices.getZ(i) === 0 && vertices.getZ(i + 1) === 0);
    const { r, g, b } = onAxis ? centerColor : regularColor;
    colors.setXYZ(i, r, g, b);
    colors.setXYZ(i + 1, r, g, b);
  }
  colors.needsUpdate = true;
}

const scenePoint = (p: Point3) => new THREE.Vector3(p.x, p.z, -p.y);

function annotate(
  model: THREE.Group,
  at: THREE.Vector3,
  lines: string[],
  selected = false,
) {
  if (!lines.length) return;
  const element = document.createElement("span");
  element.className = selected ? "scene-label selected" : "scene-label";
  element.textContent = lines.join("\n");
  const label = new CSS2DObject(element);
  label.position.copy(at);
  label.center.set(0, 1);
  model.add(label);
  return label;
}

function drawMemberAxes(
  group: THREE.Group,
  materials: SceneState["materials"],
  member: Member,
  a: StructuralNode,
  b: StructuralNode,
  mode: Project["mode"],
) {
  const span = distance(a, b);
  if (span < tolerance) return;
  const size = Math.min(Math.max(span * 0.24, 0.2), 1.2);
  const center = scenePoint(interpolate(a, b, 0.5));
  const basis = beamAxes(a, b, member.roll, mode).map(scenePoint);
  for (const [i, material] of [
    materials.axisX,
    materials.axisY,
    materials.axisZ,
  ].entries()) {
    const axis = basis[i];
    const name = coordinates[i];
    const tip = center.clone().addScaledVector(axis, size);
    const neck = tip.clone().addScaledVector(axis, -size * 0.23);
    const points = [center, tip];
    for (const tangent of [basis[(i + 1) % 3], basis[(i + 2) % 3]]) {
      points.push(tip, neck.clone().addScaledVector(tangent, size * 0.09));
      points.push(tip, neck.clone().addScaledVector(tangent, -size * 0.09));
    }
    const arrow = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      material,
    );
    arrow.renderOrder = 3;
    group.add(arrow);
    const label = annotate(group, tip, [name])!;
    label.element.classList.add("scene-axis-label", `member-axis-${name}`);
    label.element.setAttribute(
      "aria-label",
      `Eixo local ${name} de ${member.name}`,
    );
  }
  for (const [end, node, other] of [
    ["i", a, b],
    ["j", b, a],
  ] as const) {
    const anchor = scenePoint(interpolate(node, other, 0.12));
    const label = annotate(group, anchor, [end])!;
    label.element.classList.add("scene-axis-label", "scene-member-end");
    label.center.set(0.5, 1);
    label.element.setAttribute(
      "aria-label",
      `${member.name}: ${end} ${node.name}`,
    );
  }
}

function drawPointAction(
  group: THREE.Group,
  material: THREE.LineBasicMaterial,
  at: THREE.Vector3,
  vector: Point3,
  span: number,
  kind: MemberPointLoad["kind"],
  proportion = 1,
) {
  const length = Math.min(Math.max(span * 0.12, 0.18), 1.1) * proportion;
  const dir = scenePoint(vector).normalize();
  const side = dir
    .clone()
    .cross(
      Math.abs(dir.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0),
    )
    .normalize();
  const points = [at.clone().addScaledVector(dir, -length), at];
  for (const fraction of kind === "moment" ? [0, 0.32] : [0]) {
    const tip = at.clone().addScaledVector(dir, -length * fraction);
    const neck = tip.clone().addScaledVector(dir, -length * 0.22);
    points.push(
      tip,
      neck.clone().addScaledVector(side, length * 0.1),
      tip,
      neck.clone().addScaledVector(side, -length * 0.1),
    );
  }
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      material,
    ),
  );
}

function loadComponents<T>(
  loads: T[],
  keys: (keyof T & string)[],
  quantity: UnitQuantity,
  units: UnitPreferences,
) {
  return keys.flatMap((key) => {
    const value = loads.reduce((sum, load) => sum + Number(load[key]), 0);
    return value
      ? [
          `${key.toUpperCase()} ${formatQuantity(value, quantity, units)} ${unitLabel(quantity, units)}`,
        ]
      : [];
  });
}

export default function SpatialView({
  active,
  onActivate,
  layers,
  setLayers,
  savedCamera,
  patternId,
  theme,
  project,
  showMemberAxes,
  selection,
  result,
  onSelect,
  onPickLoad,
}: LayerControls & {
  active: boolean;
  onActivate: () => void;
  savedCamera: RefObject<SpatialCamera | null>;
  patternId: string;
  theme: Theme;
  project: Project;
  showMemberAxes: boolean;
  selection: SelectedObject[];
  result: StructuralResult | null;
  onSelect: (s: Selection, additive: boolean) => void;
  onPickLoad?: (id: string, point: Point3) => void;
}) {
  const { units } = useUnits();
  const container = useRef<HTMLDivElement>(null),
    state = useRef<SceneState | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const pickLoad = useRef(onPickLoad);
  pickLoad.current = onPickLoad;
  const [error, setError] = useState(false);
  const deformationScale = useMemo(() => {
    if (!result) return 0;
    const bounds = new THREE.Box3().setFromPoints(
      project.nodes.map(scenePoint),
    );
    const span = bounds.getSize(new THREE.Vector3()).length();
    let max = 0;
    for (const stations of Object.values(result.members))
      for (const s of stations)
        max = Math.max(max, Math.hypot(s.ux, s.uy, s.uz));
    return max > 1e-12 ? (Math.max(span, 1) * 0.14) / max : 1;
  }, [project.nodes, result]);
  useEffect(() => {
    const el = container.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const overlay = new CSS2DRenderer();
    overlay.domElement.className = "scene-annotations";
    el.appendChild(overlay.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Vista espacial da estrutura",
    );
    const scene = new THREE.Scene();
    const background = new THREE.Color();
    scene.background = background;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100000);
    camera.position.set(10, 7, 11);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.target.set(3, 0, 0);
    const model = new THREE.Group();
    const memberAxes = new THREE.Group();
    const materials = createModelMaterials();
    scene.add(model, memberAxes);
    const light = new THREE.HemisphereLight(0xffffff, 0x000000, 3);
    scene.add(light);
    const grid = new THREE.GridHelper(30, 30);
    grid.position.y = -0.025;
    scene.add(grid);
    const axes = new THREE.AxesHelper(1.5);
    axes.rotation.x = -Math.PI / 2;
    scene.add(axes);
    const render = () => {
      renderer.render(scene, camera);
      overlay.render(scene, camera);
    };
    const applyPalette = () => {
      const style = getComputedStyle(el);
      const color = (name: string) => style.getPropertyValue(name).trim();
      background.set(color("--scene-background"));
      light.groundColor.set(color("--scene-light-ground"));
      recolorGrid(grid, color("--scene-grid"), color("--scene-grid-center"));
      axes.setColors(color("--axis-x"), color("--axis-y"), color("--axis-z"));
      materials.axisX.color.set(color("--axis-x"));
      materials.axisY.color.set(color("--axis-y"));
      materials.axisZ.color.set(color("--axis-z"));
      materials.slab.color.set(color("--geometry-member"));
      materials.selectedSlab.color.set(color("--geometry-selected"));
      materials.rigidArm.color.set(color("--geometry-support"));
      materials.launchAxis.color.set(color("--geometry-member"));
      materials.member.color.set(color("--geometry-member"));
      materials.selectedMember.color.set(color("--geometry-selected"));
      materials.load.color.set(color("--geometry-load"));
      materials.deformed.color.set(color("--geometry-deformed"));
      materials.meshStation.color.set(color("--geometry-deformed"));
      materials.node.color.set(color("--scene-node"));
      materials.selectedNode.color.set(color("--geometry-selected"));
      materials.support.color.set(color("--geometry-support"));
      render();
    };
    const fit = () => {
      const box = new THREE.Box3().setFromObject(model),
        center = new THREE.Vector3(3, 1, 0),
        extent = new THREE.Vector3(6, 3, 3);
      if (!box.isEmpty()) {
        box.getCenter(center);
        box.getSize(extent);
      }
      const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const halfHorizontalFov = Math.atan(
        Math.tan(halfVerticalFov) * camera.aspect,
      );
      const distance =
        (Math.max(2, extent.length() / 2) /
          Math.sin(Math.min(halfVerticalFov, halfHorizontalFov))) *
        1.15;
      camera.position
        .copy(center)
        .add(
          new THREE.Vector3(0.8, 0.6, 1.2).normalize().multiplyScalar(distance),
        );
      controls.target.copy(center);
      controls.update();
      render();
    };
    const restoreOrFit = () => {
      const previous = savedCamera.current;
      if (!previous || previous.modelKey !== state.current?.modelKey)
        return fit();
      camera.position.copy(previous.eye);
      controls.target.copy(previous.target);
      controls.update();
      render();
    };
    controls.addEventListener("change", render);
    let measured = false;
    const resize = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      overlay.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      if (!measured) {
        measured = true;
        restoreOrFit();
      } else render();
    });
    resize.observe(el);
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 0.12 };
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray
        .intersectObjects(model.children, true)
        .find((h) =>
          pickLoad.current
            ? h.object.userData.selection?.kind === "member"
            : h.object.userData.selection,
        );
      if (pickLoad.current) {
        if (hit)
          pickLoad.current(hit.object.userData.selection.id, {
            x: hit.point.x,
            y: -hit.point.z,
            z: hit.point.y,
          });
        return;
      }
      select.current(
        hit?.object.userData.selection ?? null,
        additiveSelection(e),
      );
    };
    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointerup", pointerUp);
    controls.update();
    state.current = {
      grid,
      modelKey: "",
      restoreOrFit,
      renderer,
      scene,
      camera,
      controls,
      model,
      memberAxes,
      materials,
      render,
      fit,
      applyPalette,
    };
    return () => {
      if (measured) {
        savedCamera.current = {
          modelKey: state.current!.modelKey,
          eye: camera.position.clone(),
          target: controls.target.clone(),
        };
      }
      state.current = null;
      controls.removeEventListener("change", render);
      overlay.domElement.remove();
      resize.disconnect();
      controls.dispose();
      clearModel(model);
      clearModel(memberAxes);
      for (const material of Object.values(materials)) material.dispose();
      grid.dispose();
      axes.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointerup", pointerUp);
    };
  }, []);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    clearModel(s.model);
    const nodes = new Map(project.nodes.map((n) => [n.id, n]));
    const selectedIds = new Set(
      selection.map((item) => `${item.kind}:${item.id}`),
    );
    const pattern = project.loadPatterns.find(({ id }) => id === patternId);
    const wind =
      layers.loads && pattern ? patternWind(nodes, project.mode, pattern) : [];
    const nodalActions = [
      ...(pattern?.nodal ?? []),
      ...wind.flatMap((w) => w.loads),
    ];
    for (const w of wind) {
      s.model.add(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(w.corners.map(scenePoint)),
          s.materials.load,
        ),
      );
      if (layers.labels)
        annotate(s.model, scenePoint(w.center), [
          `${w.name} · ${w.area.toLocaleString("pt-BR")} m²`,
        ]);
      for (const load of w.loads)
        if (load.fx || load.fy)
          drawPointAction(
            s.model,
            s.materials.load,
            scenePoint(nodes.get(load.nodeId)!),
            { x: load.fx, y: load.fy, z: 0 },
            w.corners[1].z - w.corners[0].z,
            "force",
          );
    }
    for (const slab of project.slabs) {
      const z = project.guides.z.find(
        ({ id }) => id === slab.levelId,
      )!.position;
      const surface = slabSurface(
        slab,
        z,
        selectedIds.has(`slab:${slab.id}`)
          ? s.materials.selectedSlab
          : s.materials.slab,
      );
      s.model.add(surface);
      const pressure =
        layers.loads &&
        pattern?.pressure.find((load) => load.slabId === slab.id)?.pz;
      annotate(
        s.model,
        surface.position,
        [
          ...(layers.labels ? [slab.name] : []),
          ...(pressure ? [`PZ ${formatResult(pressure / 1000)} kN/m²`] : []),
        ],
        selectedIds.has(`slab:${slab.id}`),
      );
    }
    if (layers.mesh) {
      const layout = beamMeshLayout(project);
      const regular: THREE.Vector3[] = [];
      const joints = new Map<string, { id: string; at: THREE.Vector3 }>();
      const markJoint = (id: string, at: THREE.Vector3) =>
        joints.set(JSON.stringify([id, at.x, at.y, at.z]), { id, at });
      for (const { nodeId } of layout.rigidLinks)
        markJoint(nodeId, scenePoint(nodes.get(nodeId)!));
      for (const m of project.members) {
        const a = nodes.get(m.start)!,
          b = nodes.get(m.end)!;
        const axis = memberAxis(m, a, b);
        for (const { t, nodeId } of layout.stations.get(m.id)!.slice(1, -1)) {
          const at = scenePoint(interpolate(axis.faceI, axis.faceJ, t));
          if (nodeId) markJoint(nodeId, at);
          else regular.push(at);
        }
      }
      if (regular.length) {
        const markers = new THREE.Points(
          new THREE.BufferGeometry().setFromPoints(regular),
          s.materials.meshStation,
        );
        markers.renderOrder = 2;
        s.model.add(markers);
      }
      for (const { id, at } of joints.values()) {
        const element = document.createElement("span");
        element.className = "scene-mesh-joint";
        element.dataset.meshJoint = id;
        const ring = new CSS2DObject(element);
        ring.position.copy(at);
        s.model.add(ring);
      }
    }
    for (const m of project.members) {
      const a = nodes.get(m.start)!,
        b = nodes.get(m.end)!;
      const axis = memberAxis(m, a, b);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          scenePoint(axis.faceI),
          scenePoint(axis.faceJ),
        ]),
        selectedIds.has(`member:${m.id}`)
          ? s.materials.selectedMember
          : s.materials.member,
      );
      line.userData.selection = { kind: "member", id: m.id };
      s.model.add(line);
      const activeDofs =
        project.mode === "spatial"
          ? (["ux", "uy", "uz", "rx", "ry", "rz"] as const)
          : (["ux", "uz", "ry"] as const);
      for (const [end, connection, point] of [
        ["i", m.connectionI, a],
        ["j", m.connectionJ, b],
      ] as const) {
        if (!connection) continue;
        const released = activeDofs.filter(
          (dof) => connection[dof].kind !== "rigid",
        );
        if (!released.length) continue;
        const element = document.createElement("span");
        const details = released.map(
          (dof) =>
            `${dof.toUpperCase()} ${connection[dof].kind === "free" ? "livre" : "elástica"}`,
        );
        element.className = "scene-connection-release";
        element.dataset.memberConnectionEnd = end;
        element.setAttribute(
          "aria-label",
          `Ligação ${end} liberada: ${details.join(", ")}`,
        );
        element.title = `Ligação ${end}: ${details.join(", ")}`;
        element.textContent = "○";
        const marker = new CSS2DObject(element);
        marker.position.copy(scenePoint(point));
        s.model.add(marker);
      }
      if (m.offsets) {
        if (distance(a, axis.start) || distance(b, axis.end)) {
          const launch = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              scenePoint(a),
              scenePoint(b),
            ]),
            s.materials.launchAxis,
          );
          launch.computeLineDistances();
          s.model.add(launch);
        }
        for (const [joint, insertion, face, side] of [
          [a, axis.start, axis.faceI, "i"],
          [b, axis.end, axis.faceJ, "j"],
        ] as const) {
          if (!distance(joint, insertion) && !distance(insertion, face))
            continue;
          const arm = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(
              [joint, insertion, face].map(scenePoint),
            ),
            s.materials.rigidArm,
          );
          arm.userData.selection = line.userData.selection;
          s.model.add(arm);
          const marker = new THREE.Points(
            new THREE.BufferGeometry().setFromPoints([scenePoint(face)]),
            s.materials.meshStation,
          );
          s.model.add(marker);
          if (selectedIds.has(`member:${m.id}`) && layers.labels) {
            annotate(s.model, scenePoint(face), [`Face ${side}`]);
          }
        }
      }
      const loads = layers.loads
        ? (pattern?.uniform.filter((load) => load.memberId === m.id) ?? [])
        : [];
      annotate(
        s.model,
        scenePoint(interpolate(axis.start, axis.end, 0.5)),
        [
          ...(layers.labels ? [m.name] : []),
          ...loadComponents(
            loads,
            ["qx", "qy", "qz"],
            "distributedLoad",
            units,
          ),
        ],
        selectedIds.has(`member:${m.id}`),
      );
      if (layers.loads) {
        const axes = beamAxes(axis.start, axis.end, m.roll, project.mode);
        const temperature = pattern?.thermal?.find((f) => f.memberId === m.id);
        if (temperature && thermalLabel(temperature)) {
          const at = scenePoint(interpolate(axis.faceI, axis.faceJ, 0.62));
          const size = Math.min(Math.max(axis.span * 0.12, 0.18), 1.1);
          const labelAt = at.clone();
          for (const [i, delta] of [
            temperature.deltaY,
            temperature.deltaZ,
          ].entries()) {
            if (!delta) continue;
            const vector = scale(axes[i + 1], Math.sign(delta));
            const dir = scenePoint(vector);
            drawPointAction(
              s.model,
              s.materials.load,
              at.clone().addScaledVector(dir, size),
              vector,
              axis.span,
              "force",
            );
            labelAt.addScaledVector(dir, size);
          }
          const label = annotate(s.model, labelAt, [
            thermalLabel(temperature),
          ])!;
          label.element.dataset.thermalMember = m.id;
        }
        for (const load of pattern?.distributed ?? []) {
          if (load.memberId !== m.id) continue;
          const samples = distributedArrows(load, axis, axes),
            tails: THREE.Vector3[] = [];
          const size = Math.min(Math.max(axis.span * 0.12, 0.18), 1.1);
          for (const sample of samples) {
            const at = scenePoint(sample.at),
              vector = scenePoint(sample.direction);
            tails.push(at.clone().addScaledVector(vector, -size));
            if (vector.length() > 1e-12)
              drawPointAction(
                s.model,
                s.materials.load,
                at,
                sample.direction,
                axis.span,
                "force",
                vector.length(),
              );
          }
          s.model.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(tails),
              s.materials.load,
            ),
          );
          const label = annotate(
            s.model,
            tails[0].clone().lerp(tails.at(-1)!, 0.5),
            [distributedLoadLabel(load, axis.span, units)],
          )!;
          label.element.classList.add("scene-point-load");
          label.element.dataset.distributedLoad = load.id;
        }
        for (const load of pattern?.points ?? []) {
          if (load.memberId !== m.id) continue;
          const at = scenePoint(
            interpolate(
              axis.start,
              axis.end,
              pointFraction(load.position, axis.span),
            ),
          );
          drawPointAction(
            s.model,
            s.materials.load,
            at,
            actionVector(load, axes),
            axis.span,
            load.kind,
          );
          const label = annotate(s.model, at, [
            pointLoadLabel(load, axis.span, units),
          ])!;
          label.element.classList.add("scene-point-load");
          label.element.dataset.pointLoad = load.id;
        }
      }
      const stations = result?.members[m.id];
      if (stations) {
        const positions = stations.map((v) => {
          const p = interpolate(axis.faceI, axis.faceJ, v.t);
          return scenePoint({
            x: p.x + v.ux * deformationScale,
            y: p.y + v.uy * deformationScale,
            z: p.z + v.uz * deformationScale,
          });
        });
        s.model.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(positions),
            s.materials.deformed,
          ),
        );
      }
    }
    for (const n of project.nodes) {
      const selected = selectedIds.has(`node:${n.id}`);
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 0.095 : 0.06, 12, 8),
        selected ? s.materials.selectedNode : s.materials.node,
      );
      sphere.position.set(n.x, n.z, -n.y);
      sphere.userData.selection = { kind: "node", id: n.id };
      s.model.add(sphere);
      const loads = layers.loads
        ? nodalActions.filter((load) => load.nodeId === n.id)
        : [];
      const blocked = restrainedDofs(n.restraints);
      annotate(
        s.model,
        sphere.position,
        [
          ...(layers.labels ? [n.name] : []),
          ...loadComponents(loads, ["fx", "fy", "fz"], "force", units),
          ...loadComponents(loads, ["mx", "my", "mz"], "moment", units),
          ...(n.supportFrame && blocked.length && (layers.labels || selected)
            ? [`${blocked.map((key) => key.toUpperCase()).join(", ")} local`]
            : []),
        ],
        selected,
      );
      if (blocked.length) {
        const translations = (["z", "x", "y"] as const).filter(
          (axis) => n.restraints[`u${axis}`],
        );
        const rotation = n.supportFrame && !translations.length;
        const support = new THREE.Mesh(
          rotation
            ? new THREE.TorusGeometry(0.09, 0.009, 4, 12)
            : new THREE.ConeGeometry(0.16, 0.22, 4),
          s.materials.support,
        );
        if (n.supportFrame) {
          const basis = supportBasis(n.supportFrame);
          const axis =
            translations[0] ??
            (n.restraints.rz ? "z" : n.restraints.rx ? "x" : "y");
          const normal = scenePoint(basis[axis]).normalize();
          support.quaternion.setFromUnitVectors(
            rotation ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0),
            normal,
          );
          support.position.copy(sphere.position);
          if (!rotation) support.position.addScaledVector(normal, -0.13);
        } else support.position.set(n.x, n.z - 0.13, -n.y);
        s.model.add(support);
      }
    }
    s.render();
  }, [
    project,
    selection,
    result,
    deformationScale,
    patternId,
    layers.labels,
    layers.loads,
    units,
    layers.mesh,
  ]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    clearModel(s.memberAxes);
    if (showMemberAxes) {
      const selected = new Set(
        selection.filter(({ kind }) => kind === "member").map(({ id }) => id),
      );
      const nodes = new Map(project.nodes.map((node) => [node.id, node]));
      for (const member of project.members) {
        if (selected.size && !selected.has(member.id)) continue;
        const a = nodes.get(member.start)!,
          b = nodes.get(member.end)!;
        const axis = memberAxis(member, a, b);
        drawMemberAxes(
          s.memberAxes,
          s.materials,
          member,
          { ...a, ...axis.faceI },
          { ...b, ...axis.faceJ },
          project.mode,
        );
      }
    }
    s.render();
  }, [project, selection, showMemberAxes]);
  useEffect(() => {
    const s = state.current;
    if (s) {
      s.grid.visible = layers.grid;
      s.render();
    }
  }, [layers.grid]);
  useEffect(() => {
    state.current?.applyPalette();
  }, [theme]);
  useEffect(() => {
    const s = state.current;
    if (s) {
      s.modelKey = JSON.stringify([project.id, project.slabs[0]?.id]);
      s.restoreOrFit();
    }
  }, [project.id, project.slabs[0]?.id]);
  const zoom = (factor: number) => {
    const s = state.current;
    if (!s) return;
    s.camera.position
      .sub(s.controls.target)
      .multiplyScalar(factor)
      .add(s.controls.target);
    s.controls.update();
    s.render();
  };
  return (
    <section
      className="viewport spatial"
      aria-label="Perspectiva 3D"
      tabIndex={0}
      data-active={active}
      onFocusCapture={onActivate}
      onPointerDownCapture={onActivate}
    >
      <div className="view-heading">
        <span>
          <i className="view-dot mint" />
          Perspectiva 3D <small>{result ? "DEFORMADA" : "MODELO"}</small>
        </span>
        <div className="view-actions">
          <button
            aria-label="Afastar perspectiva"
            title="Afastar perspectiva"
            onClick={() => zoom(1.2)}
          >
            <Minus size={14} />
          </button>
          <button
            aria-label="Aproximar perspectiva"
            title="Aproximar perspectiva"
            onClick={() => zoom(1 / 1.2)}
          >
            <Plus size={14} />
          </button>
          <button
            title="Enquadrar vista 3D"
            aria-label="Enquadrar vista 3D"
            onClick={() => state.current?.fit()}
          >
            <Maximize size={14} />
          </button>
          <ViewLayers layers={layers} setLayers={setLayers} />
        </div>
      </div>
      <div ref={container} className="three-container" />
      {error && (
        <div className="webgl-error">
          WebGL indisponível. Use o plano de trabalho para modelar.
        </div>
      )}
      <div className="spatial-compass">
        <span className="axis-z">Z</span>
        <span className="axis-x">X</span>
        <span className="axis-y">Y</span>
      </div>
      <div className="view-foot">
        <span>Arraste para orbitar · Scroll para zoom</span>
        <span>
          {result
            ? `×${deformationScale.toFixed(1)}`
            : project.mode === "planar"
              ? "Y = 0"
              : `XYZ · ${units.length}`}
        </span>
      </div>
    </section>
  );
}
