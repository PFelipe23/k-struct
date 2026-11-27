import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cantileverPanel, foldedPanels } from "./fixtures/spatial-panels";
import { runDeck } from "./fixtures/solve-oofem";
import {
  analysisErrors,
  parseProject,
  serializeProject,
  type Project,
} from "../src/domain/model";
import {
  panelGeometry,
  inGlobal,
  type Basis,
} from "../src/domain/surfacePanel";
import { panelAngle } from "../src/domain/panelStiffness";
import { add, distance, scale } from "../src/domain/geometry";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";

const executable = process.env.OOFEM_BIN;
const loadRoof = () =>
  parseProject(
    readFileSync(
      new URL("../examples/cobertura-direcional.kstruct.json", import.meta.url),
      "utf8",
    ),
  );
function solve(p: Project) {
  const input = exportOofem(p, "EL"),
    raw = runDeck(input.deck, executable!);
  return { input, raw, result: parseOofemOutput(raw, input).panels! };
}
const inclined: Basis = [
  { x: 1 / 3, y: 2 / 3, z: 2 / 3 },
  { x: 2 / 3, y: 1 / 3, z: -2 / 3 },
  { x: -2 / 3, y: 2 / 3, z: -1 / 3 },
];

it("preserva a v28 sem modificadores e identifica fatores incompatíveis pelo nome", () => {
  const p = cantileverPanel(),
    source = { ...p, schemaVersion: 28 };
  const migrated = parseProject(JSON.stringify(source));
  expect(migrated).toEqual(p);
  const deck = exportOofem(migrated, "EL").deck;
  p.surfacePanels![0].stiffness = { n11: 1, m12: 1 };
  p.surfacePanels![0].angleDeg = 90;
  expect(exportOofem(p, "EL").deck).toBe(deck);
  expect(panelAngle(450)).toBe(90);
  expect(panelAngle(-270)).toBe(90);
  expect(panelGeometry(p.surfacePanels![0]).materialAxes[0]).toEqual({
    x: 0,
    y: 1,
    z: 0,
  });
  const roof = loadRoof();
  expect(parseProject(serializeProject(roof))).toEqual(roof);
  const g = roof.surfacePanels![0];
  g.kind = "membrane";
  expect(analysisErrors(roof).join(" ")).toMatch(/M11.*incompatível/);
  g.stiffness = { n11: 0 };
  expect(() => parseProject(JSON.stringify(roof))).toThrow(/N11/);
  g.stiffness = { n22: 1e308 };
  expect(analysisErrors(roof).join(" ")).toContain("intervalo numérico");
});
it.skipIf(!executable)(
  "OOFEM · cupons de extensão e flexão e superposição em casca com fatores independentes",
  () => {
    for (const kind of ["membrane", "plate", "shell"] as const)
      for (const angle of [0, 90]) {
        const p = cantileverPanel(kind, inclined),
          g = p.surfacePanels![0];
        g.angleDeg = angle;
        g.stiffness = {
          ...(kind === "plate" ? {} : { n11: 0.5, n22: 2 }),
          ...(kind === "membrane" ? {} : { m11: 4 }),
        };
        const { input, result } = solve(p),
          r = result.panels[0],
          tip = r.nodes[8];
        expect(
          distance(
            tip.global,
            inGlobal(
              {
                x: kind === "plate" ? 0 : 0.0001 / (angle === 0 ? 0.5 : 2),
                y: 0,
                z: kind === "membrane" ? 0 : -0.0036 / (angle === 0 ? 4 : 1),
              },
              inclined,
            ),
          ),
        ).toBeLessThan(1.2e-5);
        expect(r.samples).toHaveLength(4 * input.panels!.mesh.elements.length);
        for (const s of r.samples) {
          if (kind !== "plate") {
            expect(Math.abs(s.geometricFields.nxx! - 100000)).toBeLessThan(12);
            expect(
              Math.abs(s.fields[angle === 0 ? "nxx" : "nyy"]! - 100000),
            ).toBeLessThan(12);
          } else expect(s.fields.nxx).toBeUndefined();
          if (kind === "membrane") expect(s.fields.mxx).toBeUndefined();
        }
      }
  },
);
it.skipIf(!executable)(
  "OOFEM · constitutiva oblíqua da membrana e da placa inclui cisalhamento e torção assinados",
  () => {
    const p = cantileverPanel(),
      g = p.surfacePanels![0];
    g.angleDeg = 32;
    g.d.x += 0.4;
    p.materials[0].nu = 0.23;
    g.stiffness = {
      n11: 2.6,
      n22: 0.65,
      n12: 0.37,
      m11: 0.8,
      m22: 2.1,
      m12: 1.7,
    };
    const { raw, result, input } = solve(p),
      resultPanel = result.panels[0];
    const c = Math.cos((32 * Math.PI) / 180),
      s = Math.sin((32 * Math.PI) / 180);
    // Independently resolve the printed global engineering strains/curvatures
    // along the material directions, then apply the principal constitutive law.
    const blocks = [
      ...raw.matchAll(
        /^element\s+(\d+)\s+\(\s*\d+\)\s*:\s*GP\s+1\.1\s*:\s*strains\s*([^\n]*)\n\s*curvatures[ \t]*([^\n]*)/gm,
      ),
    ];
    expect(blocks).toHaveLength(input.panels!.sources.length);
    for (const block of blocks) {
      const src = input.panels!.sources[Number(block[1]) - 1],
        b = src.kind === "plate",
        v = block[b ? 3 : 2].trim().split(/\s+/).map(Number);
      const ex = c * c * v[0] + s * s * v[1] + c * s * v[5],
        ey = s * s * v[0] + c * c * v[1] - c * s * v[5],
        gam = 2 * c * s * (v[1] - v[0]) + (c * c - s * s) * v[5];
      const [f1, f2, f12] = b ? [0.8, 2.1, 1.7] : [2.6, 0.65, 0.37],
        nu = 0.23,
        E = 30e9,
        h = b ? 0.1 ** 3 / 12 : 0.1;
      const q = E / (1 - nu * nu),
        coupled = nu * q * Math.sqrt(f1 * f2),
        field = resultPanel.samples[src.triangle * 4].fields;
      const wanted = [
        h * (q * f1 * ex + coupled * ey),
        h * (coupled * ex + q * f2 * ey),
        ((h * f12 * E) / (2 * (1 + nu))) * gam,
      ];
      const found = b
        ? [field.mxx!, field.myy!, field.mxy!]
        : [field.nxx!, field.nyy!, field.nxy!];
      for (let i = 0; i < 3; i++)
        expect(Math.abs(found[i] - wanted[i])).toBeLessThan(
          Math.max(1, ...wanted.map(Math.abs)) * 0.00045 + 0.015,
        );
    }
  },
);
it.skipIf(!executable)(
  "OOFEM · cobertura engastada em 0°, 45° e 90° converge para Ritz",
  () => {
    const roof = loadRoof(),
      g = roof.surfacePanels![0];
    // From roof-ritz.py (12 basis functions per direction), in the fixed AB frame.
    for (const [angle, w, mx, my, mxy] of [
      [0, -0.20379317, -1.80239457, -1.69634247, 0],
      [45, -0.11974193, -1.11837239, -1.80862852, -0.70972548],
      [90, -0.05943456, -0.18825531, -1.90274595, 0],
    ]) {
      g.angleDeg = angle;
      let coarse = 0;
      for (const n of [8, 32]) {
        g.nu = n;
        g.nv = n / 2;
        const { result, input } = solve(roof),
          p = result.panels[0],
          tip = p.nodes.find((v) => v.point.x === 3 && v.point.y === 1.5)!;
        const error = Math.abs(1000 * tip.global.z - w);
        expect(Math.abs(result.applied.z + 90000)).toBeLessThan(0.00001);
        expect(Math.abs(result.force.z - 90000)).toBeLessThan(0.8);
        if (n === 8) {
          coarse = error;
          continue;
        }
        expect(error).toBeLessThan(coarse / 4);
        expect(error).toBeLessThan(Math.abs(w) * 0.009);
        const ids = new Set(
          input.panels!.mesh.elements.flatMap((e, i) =>
            e.nodes.includes(tip.id) ? [i + 1] : [],
          ),
        );
        const near = p.samples.filter((sample) => ids.has(sample.element));
        const means = (["mxx", "myy", "mxy"] as const).map(
          (k) =>
            near.reduce((sum, v) => sum + v.geometricFields[k]!, 0) /
            near.length /
            1000,
        );
        for (const [i, target] of [mx, my, mxy].entries())
          expect(Math.abs(means[i] - target)).toBeLessThan(
            Math.max(0.003, Math.abs(target) * 0.025),
          );
      }
    }
  },
  30000,
);
it.skipIf(!executable)(
  "OOFEM · giro isotrópico e peso próprio preservam as ações físicas no par parede–laje",
  () => {
    const p = foldedPanels();
    p.loadPatterns[0].selfWeight.enabled = true;
    const original = solve(p);
    for (const panel of p.surfacePanels!) panel.angleDeg = 37;
    const turned = solve(p);
    expect(turned.input.deck).toBe(original.input.deck);
    expect(
      turned.result.panels.map((s) => s.nodes.map((n) => n.global)),
    ).toEqual(original.result.panels.map((s) => s.nodes.map((n) => n.global)));
    p.surfacePanels![0].stiffness = { n22: 0.8, m12: 0.7 };
    p.surfacePanels![1].stiffness = { m22: 1.4 };
    const changed = solve(p);
    expect(changed.result.applied).toEqual(original.result.applied);
    expect(
      distance(changed.result.force, scale(original.result.applied, -1)),
    ).toBeLessThan(1);
    expect(changed.result.panels[0].nodes[8].global).not.toEqual(
      original.result.panels[0].nodes[8].global,
    );
    for (const id of changed.result.shared) {
      const u = changed.result.panels.map(
        (s) => s.nodes.find((n) => n.id === id)!.global,
      );
      expect(distance(u[0], u[1])).toBe(0);
    }
    const p1 = p.surfacePanels![0];
    p1.stiffness = { n11: 4 };
    p1.angleDeg = 41;
    const translated = structuredClone(p);
    for (const panel of translated.surfacePanels!)
      for (const k of ["a", "b", "d"] as const)
        panel[k] = add(panel[k], { x: 8, y: 9, z: 10 });
    expect(solve(translated).result.force).toEqual(solve(p).result.force);
  },
);
