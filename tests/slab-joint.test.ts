import { addPolygonSlab, newSlabRing } from "../src/domain/editing";
import { analysisErrors } from "../src/domain/model";
import { it, expect } from "vitest";
import { jointedSlabs } from "./fixtures/jointed-slabs";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import {
  parseProject,
  serializeProject,
  createProject,
  removeSelection,
} from "../src/domain/model";
const bin = process.env.OOFEM_BIN;
it("preserva lados, viga, rigidez e migração do painel isolado", () => {
  const p = jointedSlabs();
  Object.assign(p.slabJoint!, { kind: "elastic", stiffness: 1e6 });
  expect(parseProject(serializeProject(p))).toEqual(p);
  const legacy = createProject("spatial");
  legacy.slabs = [p.slabs[0]];
  legacy.materials = p.materials;
  expect(
    parseProject(JSON.stringify({ ...legacy, schemaVersion: 26 })),
  ).toEqual(legacy);
  removeSelection(p, [{ kind: "member", id: p.members[0].id }]);
  expect(p.slabJoint?.support).toBe("none");
});
it.skipIf(!bin)(
  "OOFEM 3.0 · conserva carga, compatibilidade e ações nas duas faces ao variar rigidez e malha",
  () => {
    for (const n of [4, 8, 16, 32]) {
      const p = jointedSlabs(n),
        j = p.slabJoint!;
      const output: { moment: number; delta: number; beam: number }[] = [];
      for (const k of [0, 1, 1e6, 1e11, Infinity]) {
        j.kind =
          k === 0 ? "hinged" : Number.isFinite(k) ? "elastic" : "continuous";
        if (j.kind === "elastic") j.stiffness = k;
        else delete j.stiffness;
        const input = exportOofem(p, "EL"),
          r = parseOofemOutput(runDeck(input.deck, bin!), input);
        const f = r.floor!;
        expect(f.totalLoadZ).toBe(-60000);
        console.info(
          "KS-43",
          n,
          k,
          f.beamForce,
          f.momentA,
          f.momentB,
          f.deltaMax,
          r.reactions.reduce((sum, v) => sum + v.fz, 0),
        );
        const frame = r.reactions.reduce((sum, v) => sum + v.fz, 0);
        expect(Math.abs(f.outerReactionZ + frame - 60000)).toBeLessThan(3);
        expect(Math.abs(frame + f.beamForce)).toBeLessThan(1);
        expect(f.stations.reduce((sum, s) => sum + s.length, 0)).toBeCloseTo(
          3,
          12,
        );
        if (k === 1e6)
          expect(
            Math.abs(
              f.momentA -
                f.stations.reduce((sum, s) => sum + s.delta * k * s.length, 0),
            ),
          ).toBeLessThan(1);
        expect(f.panels[0].center.uz).toBeLessThan(0);
        output.push({
          moment: Math.abs(f.momentA),
          delta: f.deltaMax,
          beam: -f.beamForce,
        });
        expect(f.beamForce).toBeLessThan(-1000);
        expect(Math.abs(f.momentA + f.momentB)).toBeLessThan(2);
      }
      const [pin, soft, elastic, stiff, rigid] = output;
      expect(pin.moment).toBeLessThan(1e-6);
      expect(rigid.delta).toBeLessThan(1e-12);
      expect(Math.abs(soft.delta / pin.delta - 1)).toBeLessThan(1e-5);
      expect(elastic.moment).toBeGreaterThan(soft.moment);
      expect(elastic.moment).toBeLessThan(stiff.moment);
      expect(elastic.delta).toBeLessThan(soft.delta);
      expect(elastic.delta).toBeGreaterThan(stiff.delta);
      expect(Math.abs(stiff.moment / rigid.moment - 1)).toBeLessThan(0.001);
      expect(Math.abs(stiff.beam / rigid.beam - 1)).toBeLessThan(0.001);
    }
  },
  30000,
);

it.skipIf(!bin)(
  "compara a faixa cilíndrica com duas vigas de Euler–Bernoulli e uma mola distribuída",
  () => {
    const p = jointedSlabs(12);
    p.nodes = [];
    p.members = [];
    const joint = p.slabJoint!;
    joint.support = "line";
    delete joint.memberId;
    for (const slab of p.slabs) {
      if (!slab.polygon) {
        slab.supports.yMin = slab.supports.yMax = false;
        slab.divisionsY = 4;
      }
    }
    p.materials.find((m) => m.id === p.slabs[0].materialId)!.nu = 0;
    const D = (30e9 * 0.1 ** 3) / 12,
      L = 4,
      width = 3,
      q = 5000,
      freeAngle = (q * L ** 3) / (24 * D),
      flex = (2 * L) / (3 * D);
    for (const k of [0, 1e6, Infinity]) {
      joint.kind =
        k === 0 ? "hinged" : Number.isFinite(k) ? "elastic" : "continuous";
      if (joint.kind === "elastic") joint.stiffness = k;
      else delete joint.stiffness;
      const input = exportOofem(p, "EL"),
        { floor: f } = parseOofemOutput(runDeck(input.deck, bin!), input);
      const angle = k === Infinity ? 0 : freeAngle / (1 + k * flex),
        moment = ((freeAngle - angle) / flex) * width;
      console.info(
        "KS-43 faixa",
        k,
        angle,
        moment,
        f!.momentA,
        f!.deltaMax,
        f!.outerReactionZ,
      );
      expect(Math.abs(f!.outerReactionZ - 60000)).toBeLessThan(3);
      expect(Math.abs(Math.abs(f!.momentA) - moment)).toBeLessThan(
        0.03 * Math.max(moment, 1),
      );
      expect(Math.abs(f!.deltaMax - angle)).toBeLessThan(
        0.03 * Math.max(angle, 1e-9),
      );
    }
  },
);

it.skipIf(!bin)(
  "sincroniza grades diferentes, triângulos e uma borda oblíqua invertendo a ordem da viga",
  () => {
    const p = jointedSlabs(6);
    if (p.slabs[1].polygon) throw Error("retângulo esperado");
    p.slabs[1].divisionsY = 5;
    p.slabs[0].formulation = "dkt";
    p.mesh.segmentsPerMember = 7;
    p.loadPatterns[0].pressure.push({ slabId: p.slabs[1].id, pz: 1000 });
    const m = p.members[0];
    [m.start, m.end] = [m.end, m.start];
    const get = () => {
      const deck = exportOofem(p, "EL");
      return parseOofemOutput(runDeck(deck.deck, bin!), deck).floor!;
    };
    const mixed = get();
    expect(mixed.stations.length).toBeGreaterThan(8);
    expect(mixed.totalLoadZ).toBe(-48000);
    const sides = [
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
    ];
    function polys(rotate: boolean) {
      p.nodes = [];
      p.members = [];
      p.slabs = [];
      delete p.slabJoint;
      const turn = (x: number, y: number) =>
        rotate
          ? { x: 10 + 0.8 * x - 0.6 * y, y: 2 + 0.6 * x + 0.8 * y }
          : { x, y };
      sides.forEach((side, i) => {
        const s = addPolygonSlab(p, "level1", [
          newSlabRing(
            side.map(([x, y]) => turn(x, y)),
            true,
          ),
        ]);
        s.polygon.refinements = i === 0 ? 1 : 2;
      });
      const j = p.slabJoint!;
      Object.assign(j, { support: "line", kind: "elastic", stiffness: 1e6 });
      p.loadPatterns[0].pressure = [{ slabId: p.slabs[0].id, pz: -5000 }];
      return get();
    }
    const plain = polys(false),
      turned = polys(true);
    expect(Math.abs(turned.outerReactionZ - 60000)).toBeLessThan(4);
    expect(Math.abs(turned.momentA / plain.momentA - 1)).toBeLessThan(0.001);
    expect(Math.abs(turned.deltaMax / plain.deltaMax - 1)).toBeLessThan(0.001);
  },
);
it("rejeita bordas incompatíveis e mecanismos localizados na laje articulada", () => {
  const p = jointedSlabs();
  p.nodes = [];
  p.members = [];
  p.slabJoint!.support = "none";
  delete p.slabJoint!.memberId;
  if (p.slabs[0].polygon || p.slabs[1].polygon)
    throw Error("retângulo esperado");
  p.slabs[0].supports = { xMin: false, xMax: false, yMin: false, yMax: false };
  expect(analysisErrors(p)).toContainEqual(
    expect.stringMatching(/corpo rígido/),
  );
  p.slabs[1].x += 1;
  expect(analysisErrors(p)).toContainEqual(
    expect.stringMatching(/borda externa inteira/),
  );
});

it.skipIf(!bin)(
  "soma a carga própria da viga e permite desvincular o apoio mantendo a flexão entre lajes",
  () => {
    const p = jointedSlabs(6);
    p.loadPatterns[0].uniform = [
      { memberId: p.members[0].id, qx: 0, qy: 0, qz: -1000 },
    ];
    for (const attach of [true, false]) {
      if (!attach) {
        p.slabJoint!.support = "none";
        delete p.slabJoint!.memberId;
      }
      const deck = exportOofem(p, "EL"),
        r = parseOofemOutput(runDeck(deck.deck, bin!), deck);
      const frame = r.reactions.reduce((sum, v) => sum + v.fz, 0);
      expect(Math.abs(frame + r.floor!.outerReactionZ - 63000)).toBeLessThan(4);
      expect(Math.abs(frame + r.floor!.beamForce - 3000)).toBeLessThan(2);
      if (!attach) expect(r.floor!.beamForce).toBe(0);
    }
  },
);

it.skipIf(!bin)(
  "usa o apoio exterior das lajes sem duplicar a reação no nó da viga",
  () => {
    const p = jointedSlabs(6);
    p.nodes.forEach((n) => {
      n.restraints.uz = false;
    });
    const input = exportOofem(p, "EL"),
      r = parseOofemOutput(runDeck(input.deck, bin!), input);
    expect(Math.abs(r.floor!.outerReactionZ - 60000)).toBeLessThan(3);
    expect(Math.abs(r.floor!.beamForce)).toBeLessThan(2);
    expect(r.floor!.stations.some((s) => s.beamForce < -100)).toBe(true);
  },
);

it.skipIf(!bin)(
  "conserva a face de referência e detecta reação de interface adulterada",
  () => {
    const p = jointedSlabs(6);
    p.slabJoint!.kind = "continuous";
    const first = exportOofem(p, "EL"),
      raw = runDeck(first.deck, bin!),
      base = parseOofemOutput(raw, first).floor!;
    p.slabs.reverse();
    const next = exportOofem(parseProject(serializeProject(p)), "EL");
    const result = parseOofemOutput(runDeck(next.deck, bin!), next).floor!;
    expect(result.panels[0].slabId).toBe(p.slabJoint!.a.slabId);
    expect(result.momentA).toBeCloseTo(base.momentA, 8);
    const probe = first.floor!.traces[2].faces[0].momentT;
    const pattern = new RegExp(
      "(Node\\s+" + probe + "\\s+iDof\\s+1\\s+reaction\\s+)(\\S+)",
    );
    expect(raw).toMatch(pattern);
    const broken = raw.replace(pattern, (_, prefix) => prefix + "1.0e7");
    expect(() => parseOofemOutput(broken, first)).toThrow(/equilíbrio|momento/);
  },
);
