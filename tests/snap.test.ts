import { describe, expect, it } from "vitest";
import {
  midpoint,
  parseDecimalInput,
  perpendicularFootOnSegment,
  relativePointOnPlane,
  type WorkPlane,
} from "../src/domain/geometry";
import { resolveWorkPlaneSnap } from "../src/domain/snap";

const xzPlane: WorkPlane = { kind: "XZ", offset: 0 };

describe("geometria auxiliar, captura e coordenadas relativas (KS-07)", () => {
  it("calcula ponto médio e pé da perpendicular válido e rejeita projeções fora do segmento", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 6, y: 0, z: 0 };
    expect(midpoint(a, b)).toEqual({ x: 3, y: 0, z: 0 });
    expect(perpendicularFootOnSegment({ x: 2, y: 0, z: 3 }, a, b)).toEqual({
      x: 2,
      y: 0,
      z: 0,
    });
    expect(perpendicularFootOnSegment({ x: 7, y: 0, z: 3 }, a, b)).toBeNull();
    expect(perpendicularFootOnSegment({ x: -1, y: 0, z: 3 }, a, b)).toBeNull();
    expect(perpendicularFootOnSegment({ x: 2, y: 0, z: 0 }, a, b)).toBeNull();

    expect(
      perpendicularFootOnSegment(
        { x: 0, y: 4, z: 3 },
        { x: 0, y: 0, z: 3 },
        { x: 4, y: 4, z: 3 },
      ),
    ).toEqual({ x: 2, y: 2, z: 3 });
  });

  it("captura ponto médio e pé da perpendicular no plano XZ e respeita prioridade em pixels", () => {
    const nodes = [
      { id: "n1", name: "N1", x: 0, y: 0, z: 0 },
      { id: "n2", name: "N2", x: 6, y: 0, z: 0 },
    ];
    const members = [{ id: "m1", name: "B1", start: "n1", end: "n2" }];
    const base = {
      plane: xzPlane,
      spatial: false,
      orthogonal: true,
      shiftKey: false,
      tool: "member" as const,
      nodes,
      members,
      uGuides: [],
      vGuides: [],
    };

    const midSnap = resolveWorkPlaneSnap({
      ...base,
      rawU: 3.05,
      rawV: 0.05,
      scale: 60,
      anchor: null,
    });
    expect(midSnap.kind).toBe("midpoint");
    expect(midSnap.point).toEqual({ x: 3, y: 0, z: 0 });
    expect(midSnap.label).toContain("Ponto médio");

    const perpSnap = resolveWorkPlaneSnap({
      ...base,
      rawU: 2.02,
      rawV: 0.04,
      scale: 60,
      anchor: { x: 2, y: 0, z: 3 },
    });
    expect(perpSnap.kind).toBe("perpendicular");
    expect(perpSnap.point).toEqual({ x: 2, y: 0, z: 0 });
    expect(perpSnap.distance).toBe(3);

    // Prioridade em pixels: nó (12 px) vence ponto médio e guia mesmo que esteja mais longe dentro de 12 px
    const nearNodeAndMid = resolveWorkPlaneSnap({
      ...base,
      spatial: true,
      rawU: 0.1,
      rawV: 0,
      scale: 60, // 6 px de N1
      anchor: null,
      uGuides: [{ position: 0.1 }],
      vGuides: [],
    });
    expect(nearNodeAndMid.kind).toBe("node");
    expect(nearNodeAndMid.point).toEqual({ x: 0, y: 0, z: 0 });

    // Comportamento dependente do zoom (distância medida em pixels)
    const zoomedOut = resolveWorkPlaneSnap({
      ...base,
      rawU: 3.3,
      rawV: 0,
      scale: 20, // 0,3 * 20 = 6 px < 12 px -> captura ponto médio
      anchor: null,
    });
    expect(zoomedOut.kind).toBe("midpoint");

    const zoomedIn = resolveWorkPlaneSnap({
      ...base,
      rawU: 3.3,
      rawV: 0,
      scale: 100, // 0,3 * 100 = 30 px >= 12 px -> cai na malha 0,50 m
      anchor: null,
    });
    expect(zoomedIn.kind).toBe("grid");
    expect(zoomedIn.point).toEqual({ x: 3.5, y: 0, z: 0 });
  });

  it("preserva Orto, inversão por Shift e isola referências ao pavimento ativo em XYZ", () => {
    const xyLevel1: WorkPlane = { kind: "XY", offset: 3 };
    const nodes = [
      { id: "a0", name: "N1", x: 0, y: 0, z: 0 },
      { id: "b0", name: "N2", x: 6, y: 0, z: 0 },
      { id: "a1", name: "N3", x: 0, y: 2, z: 3 },
      { id: "b1", name: "N4", x: 6, y: 2, z: 3 },
    ];
    const members = [
      { id: "m0", name: "B1", start: "a0", end: "b0" },
      { id: "m1", name: "B2", start: "a1", end: "b1" },
    ];

    // Sobre a projeção de B1 (z = 0) enquanto o plano ativo é XY z = 3: não captura ponto médio de B1
    const ignoredLowerLevel = resolveWorkPlaneSnap({
      rawU: 3,
      rawV: 0,
      scale: 60,
      plane: xyLevel1,
      spatial: true,
      orthogonal: false,
      shiftKey: false,
      tool: "member",
      anchor: null,
      nodes,
      members,
      uGuides: [],
      vGuides: [],
    });
    expect(ignoredLowerLevel.kind).toBe("grid");
    expect(ignoredLowerLevel.point).toEqual({ x: 3, y: 0, z: 3 });

    // Sobre B2 (z = 3): captura ponto médio no pavimento ativo
    const activeLevel = resolveWorkPlaneSnap({
      rawU: 3.04,
      rawV: 2.02,
      scale: 60,
      plane: xyLevel1,
      spatial: true,
      orthogonal: false,
      shiftKey: false,
      tool: "member",
      anchor: null,
      nodes,
      members,
      uGuides: [],
      vGuides: [],
    });
    expect(activeLevel.kind).toBe("midpoint");
    expect(activeLevel.point).toEqual({ x: 3, y: 2, z: 3 });

    // Orto ativo trava eixo menor; Shift inverte temporariamente
    const orthoLocked = resolveWorkPlaneSnap({
      rawU: 4.2,
      rawV: 2.8,
      scale: 60,
      plane: xyLevel1,
      spatial: true,
      orthogonal: true,
      shiftKey: false,
      tool: "member",
      anchor: { x: 0, y: 2, z: 3 },
      nodes,
      members,
      uGuides: [],
      vGuides: [],
    });
    expect(orthoLocked.point).toEqual({ x: 4, y: 2, z: 3 });

    const shiftInverted = resolveWorkPlaneSnap({
      rawU: 4.2,
      rawV: 2.8,
      scale: 60,
      plane: xyLevel1,
      spatial: true,
      orthogonal: true,
      shiftKey: true,
      tool: "member",
      anchor: { x: 0, y: 2, z: 3 },
      nodes,
      members,
      uGuides: [],
      vGuides: [],
    });
    expect(shiftInverted.point).toEqual({ x: 4, y: 3, z: 3 });
  });

  it("calcula coordenadas relativas preservando a cota normal e aceita vírgula ou ponto", () => {
    const du = parseDecimalInput("3,25");
    const dv = parseDecimalInput("−0,5");
    expect(du).toBe(3.25);
    expect(dv).toBe(-0.5);
    expect(Number.isNaN(parseDecimalInput(""))).toBe(true);
    expect(Number.isNaN(parseDecimalInput("Infinity"))).toBe(true);

    expect(relativePointOnPlane({ x: 1, y: 0, z: 2 }, du, dv, xzPlane)).toEqual(
      { x: 4.25, y: 0, z: 1.5 },
    );

    expect(
      relativePointOnPlane(
        { x: 1, y: 2, z: 3 },
        parseDecimalInput("2.5"),
        parseDecimalInput("-1,25"),
        { kind: "XY", offset: 3 },
      ),
    ).toEqual({ x: 3.5, y: 0.75, z: 3 });
  });
});
