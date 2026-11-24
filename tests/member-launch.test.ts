import { expect, it } from "vitest";
import { createProject } from "../src/domain/model";
import { addMember } from "../src/domain/editing";
import { pickGuideSpan } from "../src/domain/guideSpan";

it("resolve o vão nas guias reais, inclusive fora de ordem, e rejeita cruzamentos ou eixos próximos", () => {
  const project = createProject("spatial");
  project.guides.x[2].position = 10;
  project.guides.x.reverse();
  const plane = { kind: "XY", offset: 3 } as const;
  const span = (u: number, v: number) =>
    pickGuideSpan(project.guides, plane, u, v, 0.1);
  expect(span(7, 0.06)).toEqual([
    { x: 4, y: 0, z: 3 },
    { x: 10, y: 0, z: 3 },
  ]);
  expect(span(4.08, 2)).toEqual([
    { x: 4, y: 0, z: 3 },
    { x: 4, y: 4, z: 3 },
  ]);
  for (const [u, v] of [
    [4, 0],
    [4.03, 0.04],
    [11, 0],
    [7, 2],
  ])
    expect(span(u, v)).toBeNull();
  project.guides.y.push({ id: "close", name: "Próximo", position: 0.12 });
  expect(span(7, 0.06)).toBeNull();
  expect(
    pickGuideSpan(project.guides, { kind: "YZ", offset: 10 }, 2, 3, 0.1),
  ).toEqual([
    { x: 10, y: 0.12, z: 3 },
    { x: 10, y: 4, z: 3 },
  ]);
});
it("compartilha o nó entre trechos, aplica seção e rotação e recusa a barra inversa", () => {
  const project = createProject("spatial");
  project.sections.push({ ...project.sections[0], id: "r2", name: "R2" });
  const props = { sectionId: "r2", roll: 30 };
  const a = { x: 0, y: 0, z: 0 },
    b = { x: 4, y: 0, z: 0 },
    c = { x: 4, y: 4, z: 0 };
  const first = addMember(project, a, b, props);
  const next = addMember(project, b, c, props);
  expect(first.end).toBe(next.start);
  expect(project.nodes).toHaveLength(3);
  expect(project.members).toEqual([
    expect.objectContaining(props),
    expect.objectContaining(props),
  ]);
  expect(() => addMember(project, c, b, props)).toThrow(/Já existe/);
  expect(project.members).toHaveLength(2);
});
