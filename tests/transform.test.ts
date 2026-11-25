import { rectangle } from "./fixtures/project-v8";
import { describe, expect, it } from "vitest";
import { addMember } from "../src/domain/editing";
import {
  beamAxes,
  coordinates,
  cross,
  origin,
  type Point3,
} from "../src/domain/geometry";
import {
  addPoint,
  createProject,
  free,
  nodalLoad,
  uniformLoad,
  type Project,
} from "../src/domain/model";
import { geometryOnly, planTransform } from "../src/domain/transform";

const zAxis = { ...origin, z: 1 },
  yzMirror = {
    kind: "mirror",
    center: origin,
    normal: { ...origin, x: 1 },
  } as const;
const rotate = {
  kind: "rotate",
  center: origin,
  axis: zAxis,
  degrees: 90,
  copies: 1,
} as const;
const member = (id: string) => ({ kind: "member" as const, id });
const node = (id: string) => ({ kind: "node" as const, id });
function near(p: Point3, q: Point3) {
  for (const k of coordinates) expect(p[k]).toBeCloseTo(q[k], 10);
}
function fixture(mode: Project["mode"] = "spatial") {
  const p = createProject(mode);
  const b = addMember(p, { ...origin, x: 2 }, { x: 3, y: 0, z: 1 });
  const c = addMember(p, { x: 3, y: 0, z: 1 }, { x: 5, y: 0, z: 1 });
  return { p, b, c };
}
describe("transformações de seleção", () => {
  it("gira cada réplica a partir do original, mantendo o nó comum e as extremidades", () => {
    const { p, b, c } = fixture(),
      old = structuredClone(p);
    const plan = planTransform(p, [member(b.id), member(c.id)], {
      ...rotate,
      copies: 2,
    });
    expect(plan.project.nodes).toHaveLength(9);
    expect(new Set(plan.project.members.map((m) => m.id)).size).toBe(6);
    for (const [i, map] of plan.maps.entries()) {
      const B = plan.project.members.find(
        (m) => m.id === map.members.get(b.id),
      )!;
      const C = plan.project.members.find(
        (m) => m.id === map.members.get(c.id),
      )!;
      expect(B.end).toBe(C.start);
      expect(B.start).toBe(map.nodes.get(b.start));
      near(
        plan.project.nodes.find((n) => n.id === B.start)!,
        i === 0 ? { x: 0, y: 2, z: 0 } : { x: -2, y: 0, z: 0 },
      );
    }
    expect(p).toEqual(old);
  });
  it("reflete a base da seção retangular, conserva z físico e recompõe uma tríade dextrógira", () => {
    const p = createProject("spatial");
    const b = addMember(
      p,
      { x: 2, y: 1, z: 0 },
      { x: 4, y: 3, z: 1 },
      { sectionId: p.sections[0].id, roll: 27 },
    );
    const section = rectangle(p.sections[0]);
    expect(section.width).not.toBe(section.height);
    const plan = planTransform(p, [member(b.id)], yzMirror);
    const [a, c, A, C] = plan.project.nodes;
    near(A, { x: -2, y: 1, z: 0 });
    near(C, { x: -4, y: 3, z: 1 });
    const B = plan.project.members[1];
    expect(B.sectionId).toBe(b.sectionId);
    const basis = beamAxes(a, c, b.roll);
    const [x, y, z] = beamAxes(A, C, B.roll);
    const r = (v: Point3) => ({ x: -v.x, y: v.y, z: v.z });
    near(x, r(basis[0]));
    near(y, { x: basis[1].x, y: -basis[1].y, z: -basis[1].z });
    near(z, r(basis[2]));
    near(cross(x, y), z);
  });
  it("copia apoios e cargas de padrões independentemente, com sinais polares e axiais", () => {
    const { p, b } = fixture();
    const a = p.nodes[0],
      end = p.nodes[1];
    a.restraints.ux = true;
    p.loadPatterns[0].nodal.push({
      ...nodalLoad(end.id),
      fx: 5,
      fy: 3,
      mx: 4,
      my: 7,
      mz: -9,
    });
    p.loadPatterns[0].uniform.push({ ...uniformLoad(b.id), qx: 2, qz: 4 });
    p.loadPatterns.push({
      ...structuredClone(p.loadPatterns[0]),
      id: "W",
      name: "Vento",
    });
    for (const supports of [false, true])
      for (const patterns of [[], ["G"]]) {
        const plan = planTransform(p, [member(b.id)], yzMirror, {
          ...geometryOnly,
          supports,
          patterns,
        });
        const map = plan.maps[0];
        expect(
          plan.project.nodes.find((n) => n.id === map.nodes.get(a.id))!
            .restraints,
        ).toEqual({ ...free(), ux: supports });
        expect(plan.loads).toBe(patterns.length * 2);
        const [g, w] = plan.project.loadPatterns;
        expect(w).toEqual(p.loadPatterns[1]);
        expect(g.nodal.length).toBe(1 + patterns.length);
        if (patterns.length) {
          expect(g.nodal[1]).toEqual({
            ...nodalLoad(map.nodes.get(end.id)!),
            fx: -5,
            fy: 3,
            mx: 4,
            my: -7,
            mz: 9,
          });
          expect(g.uniform[1]).toMatchObject({
            memberId: map.members.get(b.id),
            qx: -2,
            qz: 4,
          });
        }
      }
  });
  it("pede decisão sobre apoio e carga coincidentes e aplica o tratamento ao padrão correto", () => {
    const { p, b } = fixture();
    const a = p.nodes[0],
      target = addPoint(p, { x: 0, y: 2, z: 0 });
    a.restraints.ux = true;
    target.restraints.uz = true;
    p.loadPatterns[0].nodal = [
      { ...nodalLoad(a.id), fx: 20 },
      { ...nodalLoad(target.id), fy: 5 },
    ];
    for (const conflicts of ["ask", "keep", "combine"] as const) {
      const plan = planTransform(p, [member(b.id)], rotate, {
        supports: true,
        patterns: ["G"],
        conflicts,
      });
      expect(plan.reused.has(target.id)).toBe(true);
      expect(plan.conflicts).toHaveLength(2);
      expect(plan.ready).toBe(conflicts !== "ask");
      expect(
        plan.project.nodes.find((n) => n.id === target.id)!.restraints,
      ).toEqual({ ...free(), uy: conflicts === "combine", uz: true });
      expect(
        plan.project.loadPatterns[0].nodal.find((l) => l.nodeId === target.id)!
          .fy,
      ).toBeCloseTo(conflicts === "combine" ? 25 : 5);
    }
    expect(p.nodes.find((n) => n.id === target.id)!.restraints.uy).toBe(false);
  });
  it("detecta vínculos inclinados e aceita um subespaço que permanece representável", () => {
    const { p, b } = fixture(),
      spec = { ...rotate, degrees: 45 },
      opts = { ...geometryOnly, supports: true };
    p.nodes[0].restraints.ux = true;
    expect(() => planTransform(p, [member(b.id)], spec, opts)).toThrow(
      /direção inclinada/,
    );
    p.nodes[0].restraints.uy = true;
    expect(
      planTransform(p, [member(b.id)], spec, opts).project.nodes[3].restraints,
    ).toEqual({ ...free(), ux: true, uy: true });
  });
  it("move um nó compartilhado sem trocar IDs e rejeita colisão, barra nula ou duplicada", () => {
    const { p, b, c } = fixture("planar"),
      snapshot = structuredClone(p);
    const joint = p.nodes[1],
      move = { kind: "move", offset: { ...origin, z: 2 } } as const;
    const plan = planTransform(p, [node(joint.id)], move);
    expect(plan.affected).toEqual([b.id, c.id]);
    expect(plan.project.members).toEqual(p.members);
    expect(plan.project.nodes[1]).toMatchObject({ id: joint.id, x: 3, z: 3 });
    expect(() =>
      planTransform(p, [node(joint.id)], {
        ...move,
        offset: { ...origin, x: 2 },
      }),
    ).toThrow(/comprimento nulo/);
    expect(() =>
      planTransform(p, [node(p.nodes[0].id)], {
        ...move,
        offset: { ...origin, x: 3, z: 1 },
      }),
    ).toThrow(/Colisão/);
    expect(() =>
      planTransform(p, [member(b.id)], {
        ...yzMirror,
        normal: { ...origin, y: 1 },
      }),
    ).toThrow(/existe uma barra/);
    expect(() =>
      planTransform(p, [node(joint.id)], {
        ...move,
        offset: { ...origin, y: 1 },
      }),
    ).toThrow(/XZ/);
    expect(p).toEqual(snapshot);
  });
  it("espelha por uma reta inclinada no XZ e gira em torno de centro e eixo arbitrários", () => {
    const { p } = fixture("planar"),
      a = p.nodes[0];
    const mirror = planTransform(p, [node(a.id)], {
      ...yzMirror,
      normal: { x: 1, y: 0, z: -1 },
    });
    near(mirror.project.nodes.at(-1)!, { ...origin, z: 2 });
    const sp = createProject("spatial"),
      n = addPoint(sp, { x: 2, y: 2, z: 3 });
    const plan = planTransform(sp, [node(n.id)], {
      ...rotate,
      axis: { x: 1, y: 1, z: 1 },
      center: { x: 1, y: 2, z: 3 },
      degrees: 120,
    });
    near(plan.project.nodes.at(-1)!, { x: 1, y: 3, z: 3 });
  });
});
