import { describe, expect, it } from "vitest";
import {
  addPoint,
  beamExample,
  parseProject,
  referenceErrors,
  serializeProject,
} from "../src/domain/model";
import { setStiffnessFactor } from "../src/domain/memberStiffness";
import { centeredOffsets } from "../src/domain/memberOffsets";
import { splitMembers } from "../src/domain/editing";
import { planTransform } from "../src/domain/transform";
import { exportOofem } from "../src/solver/oofem";
import { stiffnessCantilevers } from "./fixtures/member-stiffness";

describe("modificadores de rigidez", () => {
  it("migra v12 com os mesmos IDs, excentricidades, vínculos e entrada OOFEM", () => {
    const p = beamExample();
    const member = p.members[0];
    member.offsets = structuredClone(centeredOffsets);
    member.offsets.i.eccentricity.z = 0.1;
    member.offsets.j.rigidLength = 0.4;
    const legacy = parseProject(JSON.stringify({ ...p, schemaVersion: 12 }));
    expect(legacy).toEqual(p);
    member.stiffness = { ea: 1, eiy: 1, eiz: 1, gj: 1 };
    expect(exportOofem(p, "EL").deck).toBe(exportOofem(legacy, "EL").deck);
    setStiffnessFactor(member, "eiy", 0.5);
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it("rejeita fatores nulos, negativos, não finitos ou fora da faixa numérica", () => {
    const p = beamExample();
    for (const ea of [0, -0.5, NaN, Infinity]) {
      p.members[0].stiffness = { ea };
      expect(() => serializeProject(p)).toThrow();
    }
    p.members[0].stiffness = { ea: 1e300 };
    expect(referenceErrors(p).join()).toContain(
      "rigidez fora do intervalo numérico",
    );
    expect(() => exportOofem(p, "EL")).toThrow(/rigidez fora do intervalo/);
  });

  it("identifica a barra, o componente e o mecanismo ao abrir um arquivo com fator zero", () => {
    const p = stiffnessCantilevers();
    const bar = p.members[1];
    bar.name = "Pilar P2";
    bar.stiffness = { gj: 0 };
    expect(() => parseProject(JSON.stringify(p))).toThrow(
      /Pilar P2 .*GJ.*mecanismo/,
    );
  });

  it("preserva os fatores ao copiar e dividir e repõe a condição original ao voltar a 1", () => {
    const p = stiffnessCantilevers();
    const [member] = p.members;
    setStiffnessFactor(member, "ea", 0.5);
    const plan = planTransform(p, [{ kind: "member", id: member.id }], {
      kind: "translate",
      offset: { x: 0, y: 0, z: 3 },
      copies: 1,
    });
    const copy = plan.project.members.find(
      ({ id }) => id === plan.maps[0].members.get(member.id),
    )!;
    expect(copy.stiffness).toEqual({ ea: 0.5 });
    const midpoint = addPoint(p, { x: 1.5, y: 0, z: 0 });
    const children = splitMembers(p, new Map([[member.id, [midpoint.id]]])).get(
      member.id,
    )!;
    for (const id of children)
      expect(p.members.find((m) => m.id === id)?.stiffness).toEqual({
        ea: 0.5,
      });
    const first = p.members.find((m) => m.id === children[0])!;
    setStiffnessFactor(first, "ea", 1);
    expect(first.stiffness).toBeUndefined();
    expect(p.members.find((m) => m.id === children[1])?.stiffness).toEqual({
      ea: 0.5,
    });
  });

  it("mantém a área e os dados de material e usa a seção equivalente apenas no conjunto da barra", () => {
    const p = stiffnessCantilevers();
    const [member] = p.members;
    const baseline = structuredClone(p);
    member.stiffness = { ea: 0.5, eiy: 0.75 };
    const input = exportOofem(p, "EL");
    const deck = input.deck;
    expect(input.project.sections).toEqual(baseline.sections);
    expect(input.project.materials).toEqual(baseline.materials);
    expect(input.project.loadPatterns).toEqual(baseline.loadPatterns);
    expect(deck).toMatch(
      /^IsoLE 1 d 7850 E 200000000000 n 0\.3 tAlpha 0\.000012$/m,
    );
    expect(deck).toMatch(
      /^IsoLE 2 d 7850 E 100000000000 n 0\.3 tAlpha 0\.000012$/m,
    );
    const sections = [
      ...deck.matchAll(
        /^SimpleCS (\d+) area (\S+) .* material (\d+) set (\d+)$/gm,
      ),
    ];
    expect(
      sections.map(([, , area, material]) => [Number(area), Number(material)]),
    ).toEqual([
      [0.03, 1],
      [0.03, 2],
    ]);
    for (const [i, [, , , , set]] of sections.entries()) {
      const physical = i === 0 ? p.members[1].id : member.id;
      const ids = input.elements
        .filter(({ memberId }) => memberId === physical)
        .map(({ number }) => number);
      expect(deck.split("\n")).toContain(
        `Set ${set} elements ${ids.length} ${ids.join(" ")}`,
      );
    }
    p.members[1].stiffness = { ea: 0.5, eiy: 0.75 };
    const both = exportOofem(p, "EL").deck;
    expect(both.match(/^SimpleCS /gm)).toHaveLength(2);
    expect(both.match(/^IsoLE /gm)).toHaveLength(2);
  });

  it("mantém EIz e GJ inativos em XZ", () => {
    const p = beamExample();
    const before = exportOofem(p, "EL").deck;
    p.members[0].stiffness = { eiz: 0.5, gj: 2 };
    expect(exportOofem(p, "EL").deck).toBe(before);
  });
});
