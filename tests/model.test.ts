import { describe, expect, it } from "vitest";
import {
  addPoint,
  analysisErrors,
  beamExample,
  createProject,
  parseProject,
  removeSelection,
  serializeProject,
} from "../src/domain/model";
import { historyReducer } from "../src/domain/history";
import { exportOofem, parseOofemOutput } from "../src/solver/oofem";

describe("projeto versionado e edição", () => {
  it("salva e reabre sem alterar IDs, unidades ou cargas", () => {
    const p = beamExample();
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it("recusa versões futuras, propriedades estranhas e referências quebradas", () => {
    const p = beamExample();
    expect(() =>
      parseProject(JSON.stringify({ ...p, schemaVersion: 2 })),
    ).toThrow();
    expect(() =>
      parseProject(JSON.stringify({ ...p, executable: "/tmp/code" })),
    ).toThrow();
    p.members[0].start = "missing";
    expect(() => parseProject(JSON.stringify(p))).toThrow(/inexistente/);
  });
  it("remove cargas e barras dependentes ao remover um nó e desfaz integralmente", () => {
    const p = beamExample(),
      next = structuredClone(p);
    removeSelection(next, { kind: "node", id: "A" });
    expect(next.members).toHaveLength(0);
    expect(next.loadPatterns[0].uniform).toHaveLength(0);
    const h = historyReducer(
      { past: [], current: p, future: [] },
      { type: "change", project: next },
    );
    expect(historyReducer(h, { type: "undo" }).current).toEqual(p);
    expect(
      historyReducer(historyReducer(h, { type: "undo" }), { type: "redo" })
        .current,
    ).toEqual(next);
  });
  it("reutiliza o mesmo nó no snap e não cria duplicatas", () => {
    const p = createProject();
    const first = addPoint(p, 3, 2);
    expect(addPoint(p, 3, 2).id).toBe(first.id);
    expect(p.nodes).toHaveLength(1);
  });
});

describe("pré-validação e contrato do adaptador", () => {
  it("detecta apoios insuficientes em cada componente desconectado", () => {
    const p = beamExample();
    p.nodes[0].restraints.ux = false;
    expect(analysisErrors(p).join()).toMatch(/corpo rígido/);
  });
  it("recusa Y não nulo e nós no meio de barra sem subdivisão", () => {
    const p = beamExample();
    p.nodes[0].y = 1;
    expect(() => exportOofem(p, "EL")).toThrow(/XZ/);
    p.nodes[0].y = 0;
    addPoint(p, 3, 0);
    expect(analysisErrors(p).join()).toMatch(/interior/);
  });
  it("gera IDs separados para a malha sem alterar o modelo e transforma as cargas globais para eixos locais", () => {
    const p = beamExample(),
      before = serializeProject(p);
    const input = exportOofem(p, "EL");
    expect(input.elements).toHaveLength(8);
    expect(input.nodes).toHaveLength(9);
    expect(input.deck).toContain("csType 1");
    expect(serializeProject(p)).toBe(before);
    expect(exportOofem(p, "EL").deck).toBe(input.deck);
  });
  it("rejeita saída truncada ou sem dados, mesmo com uma mensagem de término", () => {
    const input = exportOofem(beamExample(), "EL");
    expect(() => parseOofemOutput("incomplete", input)).toThrow(/incompleta/);
    expect(() =>
      parseOofemOutput("Output for time 1\nFinishing analysis", input),
    ).toThrow(/ausentes/);
  });
});
