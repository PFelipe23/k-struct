import { describe, expect, it } from "vitest";
import {
  applyBatchAssignment,
  previewBatchAssignment,
  summarizeBatchSelection,
} from "../src/domain/batchAssign";
import { addMember } from "../src/domain/editing";
import {
  beamExample,
  createProject,
  patternLoadLimit,
  nodalLoad,
  uniformLoad,
  type SelectedObject,
} from "../src/domain/model";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";
import { runDeck } from "./fixtures/solve-oofem";
import { rollerAngle } from "./fixtures/inclined-beam";

describe("atribuição em lote de seção, apoios e cargas (KS-11)", () => {
  it("soma, substitui e remove componentes de carga preservando outros componentes e padrões", () => {
    const p = createProject("planar");
    const b1 = addMember(p, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
    const b2 = addMember(p, { x: 3, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    p.loadPatterns.push({
      id: "Q",
      name: "Sobrecarga",
      nodal: [],
      uniform: [{ ...uniformLoad(b1.id), qz: -9000 }],
      pressure: [],
      selfWeight: { ...p.loadPatterns[0].selfWeight },
    });
    p.loadPatterns[0].uniform = [
      { ...uniformLoad(b1.id), qx: 1500, qz: -2000 },
      { ...uniformLoad(b2.id), qz: -3000 },
    ];

    const selection: SelectedObject[] = [
      { kind: "member", id: b1.id },
      { kind: "member", id: b2.id },
    ];
    const summary = summarizeBatchSelection(p, selection, "G");
    expect(summary.uniform.qz).toEqual({
      kind: "mixed",
      min: -3000,
      max: -2000,
    });

    // Somar -1 kN/m em qZ -> -3 e -4 kN/m
    applyBatchAssignment(p, selection, "G", {
      uniformLoad: { operation: "add", values: { qz: -1000 } },
    });
    expect(
      p.loadPatterns[0].uniform.find((u) => u.memberId === b1.id),
    ).toMatchObject({
      qx: 1500,
      qz: -3000,
    });
    expect(
      p.loadPatterns[0].uniform.find((u) => u.memberId === b2.id),
    ).toMatchObject({
      qx: 0,
      qz: -4000,
    });

    // Substituir por -5 kN/m em qZ
    applyBatchAssignment(p, selection, "G", {
      uniformLoad: { operation: "replace", values: { qz: -5000 } },
    });
    expect(
      p.loadPatterns[0].uniform.find((u) => u.memberId === b1.id)?.qz,
    ).toBe(-5000);
    expect(
      p.loadPatterns[0].uniform.find((u) => u.memberId === b2.id)?.qz,
    ).toBe(-5000);

    // Remover qZ preserva qX de B1 e preserva o segundo padrão Q
    applyBatchAssignment(p, selection, "G", {
      uniformLoad: { operation: "remove", values: {}, removeKeys: ["qz"] },
    });
    expect(p.loadPatterns[0].uniform).toEqual([
      { memberId: b1.id, qx: 1500, qy: 0, qz: 0 },
    ]);
    expect(p.loadPatterns[1].uniform).toEqual([
      { memberId: b1.id, qx: 0, qy: 0, qz: -9000 },
    ]);
  });

  it("atribui seção às barras e restrição UZ aos nós em seleção mista conservando os demais graus", () => {
    const p = createProject("planar");
    p.sections.push({
      id: "sec2",
      name: "Retangular R2",
      shape: "rectangle",
      materialId: "steel",
      width: 0.2,
      height: 0.4,
    });
    const b1 = addMember(p, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
    const b2 = addMember(p, { x: 3, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    p.nodes[0].restraints.ux = true;
    p.nodes[2].restraints.ry = true; // nó fora da seleção

    const selection: SelectedObject[] = [
      { kind: "member", id: b1.id },
      { kind: "node", id: p.nodes[0].id },
      { kind: "node", id: p.nodes[1].id },
    ];
    const preview = previewBatchAssignment(p, selection, "G", {
      sectionId: "sec2",
      restraints: { uz: "restrict" },
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.hasChanges).toBe(true);
    expect(preview.affectedNodes).toBe(2);
    expect(preview.affectedMembers).toBe(1);

    applyBatchAssignment(p, selection, "G", {
      sectionId: "sec2",
      restraints: { uz: "restrict" },
    });
    expect(b1.sectionId).toBe("sec2");
    expect(b2.sectionId).toBe("rect");
    expect(p.nodes[0].restraints).toMatchObject({
      ux: true,
      uz: true,
      ry: false,
    });
    expect(p.nodes[1].restraints).toMatchObject({
      ux: false,
      uz: true,
      ry: false,
    });
    expect(p.nodes[2].restraints).toMatchObject({
      ux: false,
      uz: false,
      ry: true,
    });

    // Lote sem alteração reporta hasChanges = false
    const noop = previewBatchAssignment(p, selection, "G", {
      sectionId: "sec2",
      restraints: { uz: "restrict" },
    });
    expect(noop.ok).toBe(true);
    if (noop.ok) expect(noop.hasChanges).toBe(false);
  });

  it("preserva registros antigos, precisão e componentes fora da operação", () => {
    const p = beamExample();
    const pat = p.loadPatterns[0];
    const selection: SelectedObject[] = [
      { kind: "node", id: "A" },
      { kind: "member", id: "V1" },
    ];
    pat.nodal = [
      { ...nodalLoad("A"), fx: 0.123456789012345, fz: -1 },
      { ...nodalLoad("B"), fx: 12 },
      { ...nodalLoad("A"), fx: 1e-15, fz: -2 },
    ];
    pat.uniform = [
      { ...uniformLoad("V1"), qx: 1, qz: -1000 },
      { ...uniformLoad("V1"), qx: -1, qz: -2000 },
    ];
    const before = structuredClone(p);
    const noop = {
      nodalLoad: { operation: "add", values: { fx: 0 } },
      uniformLoad: { operation: "replace", values: { qz: -3000 } },
    } as const;
    expect(previewBatchAssignment(p, selection, "G", noop)).toMatchObject({
      ok: true,
      hasChanges: false,
    });
    expect(applyBatchAssignment(p, selection, "G", noop)).toEqual({
      changedNodes: 0,
      changedMembers: 0,
    });
    expect(p).toEqual(before);
    const edit = {
      nodalLoad: { operation: "remove", values: {}, removeKeys: ["fz"] },
      uniformLoad: { operation: "add", values: { qz: -1000 } },
    } as const;
    expect(previewBatchAssignment(p, selection, "G", edit)).toMatchObject({
      nodeNames: ["N1"],
      memberNames: ["B1"],
    });
    expect(p).toEqual(before);
    applyBatchAssignment(p, selection, "G", edit);
    expect(pat.nodal).toEqual([
      { ...nodalLoad("A"), fx: 0.123456789012345 },
      { ...nodalLoad("B"), fx: 12 },
      { ...nodalLoad("A"), fx: 1e-15 },
    ]);
    expect(pat.uniform).toEqual([
      { ...uniformLoad("V1"), qx: 1, qz: -4000 },
      { ...uniformLoad("V1"), qx: -1 },
    ]);
  });

  it("remove todas as parcelas da componente selecionada mesmo quando elas se anulam", () => {
    const p = beamExample();
    const pattern = p.loadPatterns[0];
    pattern.nodal = [
      { ...nodalLoad("A"), fx: 50, fz: 100 },
      { ...nodalLoad("A"), fz: -100 },
      { ...nodalLoad("B"), fz: 10 },
    ];
    pattern.uniform = [
      { ...uniformLoad("V1"), qx: 30, qz: -2000 },
      { ...uniformLoad("V1"), qz: 2000 },
    ];
    const selection: SelectedObject[] = [
      { kind: "node", id: "A" },
      { kind: "member", id: "V1" },
    ];
    const remove = {
      nodalLoad: { operation: "remove", values: {}, removeKeys: ["fz"] },
      uniformLoad: { operation: "remove", values: {}, removeKeys: ["qz"] },
    } as const;
    const before = structuredClone(p);
    expect(previewBatchAssignment(p, selection, "G", remove)).toMatchObject({
      ok: true,
      hasChanges: true,
      affectedNodes: 1,
      affectedMembers: 1,
    });
    expect(p).toEqual(before);
    applyBatchAssignment(p, selection, "G", remove);
    expect(pattern.nodal).toEqual([
      { ...nodalLoad("A"), fx: 50 },
      { ...nodalLoad("B"), fz: 10 },
    ]);
    expect(pattern.uniform).toEqual([{ ...uniformLoad("V1"), qx: 30 }]);
    expect(previewBatchAssignment(p, selection, "G", remove)).toMatchObject({
      ok: true,
      hasChanges: false,
    });
  });

  it("rejeita o lote inteiro antes de editar se a soma ou o número de registros excederem o limite", () => {
    const p = beamExample();
    const pat = p.loadPatterns[0];
    const selection: SelectedObject[] = [
      { kind: "node", id: "B" },
      { kind: "member", id: "V1" },
    ];
    const edit = {
      nodalLoad: { operation: "add", values: { fx: Number.MAX_VALUE } },
      uniformLoad: { operation: "remove", values: {}, removeKeys: ["qz"] },
      restraints: { ry: "restrict" },
    } as const;
    for (const records of [
      [{ ...nodalLoad("B"), fx: Number.MAX_VALUE }],
      Array.from({ length: patternLoadLimit }, () => ({
        ...nodalLoad("A"),
        fx: 1,
      })),
    ]) {
      pat.nodal = records;
      const before = structuredClone(p);
      expect(previewBatchAssignment(p, selection, "G", edit)).toMatchObject({
        ok: false,
      });
      expect(() => applyBatchAssignment(p, selection, "G", edit)).toThrow(
        /intervalo numérico|limite/,
      );
      expect(p).toEqual(before);
    }
  });

  it.each([undefined, rollerAngle])(
    "equipara entrada OOFEM e reações com atribuições individuais (ângulo %s)",
    (angle) => {
      const buildBase = () => {
        const p = createProject("planar");
        const b1 = addMember(p, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
        const b2 = addMember(p, { x: 3, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
        return { p, b1, b2 };
      };

      const batch = buildBase();
      if (angle !== undefined)
        batch.p.nodes[2].supportFrame = { kind: "planar", angle };
      const manual = structuredClone(batch);
      applyBatchAssignment(
        batch.p,
        [
          { kind: "node", id: batch.p.nodes[0].id },
          { kind: "node", id: batch.p.nodes[2].id },
          { kind: "member", id: batch.b1.id },
          { kind: "member", id: batch.b2.id },
        ],
        "G",
        {
          restraints: { uz: "restrict" },
          uniformLoad: { operation: "replace", values: { qz: -10000 } },
        },
      );
      applyBatchAssignment(
        batch.p,
        [{ kind: "node", id: batch.p.nodes[0].id }],
        "G",
        {
          restraints: { ux: "restrict" },
          nodalLoad: { operation: "add", values: { fz: -5000 } },
        },
      );

      manual.p.nodes[0].restraints.ux = true;
      manual.p.nodes[0].restraints.uz = true;
      manual.p.nodes[2].restraints.uz = true;
      manual.p.loadPatterns[0].nodal = [
        { ...nodalLoad(manual.p.nodes[0].id), fz: -5000 },
      ];
      manual.p.loadPatterns[0].uniform = [
        { ...uniformLoad(manual.b1.id), qz: -10000 },
        { ...uniformLoad(manual.b2.id), qz: -10000 },
      ];

      const batchInput = exportOofem(batch.p, "EL");
      const manualInput = exportOofem(manual.p, "EL");
      expect(batchInput.deck).toBe(manualInput.deck);

      if (process.env.OOFEM_BIN) {
        const rBatch = parseOofemOutput(
          runDeck(batchInput.deck, process.env.OOFEM_BIN),
          batchInput,
        );
        const rManual = parseOofemOutput(
          runDeck(manualInput.deck, process.env.OOFEM_BIN),
          manualInput,
        );
        expect(rBatch.reactions).toEqual(rManual.reactions);
        const [a, b] = rBatch.reactions;
        expect(a.fz).toBeCloseTo(35000, 2);
        expect(b.fz).toBeCloseTo(30000, 2);
        expect(a.fx).toBeCloseTo(angle === undefined ? 0 : -22500, 2);
        expect(b.fx).toBeCloseTo(angle === undefined ? 0 : 22500, 2);
      }
    },
  );
});
