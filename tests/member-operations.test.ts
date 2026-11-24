import { describe, expect, it } from "vitest";
import { addMember } from "../src/domain/editing";
import { distance, origin } from "../src/domain/geometry";
import {
  planMemberEdit,
  memberIntensity,
  type MemberCommand,
} from "../src/domain/memberOperations";
import {
  addPoint,
  beamExample,
  createProject,
  free,
  nodalLoad,
  parseProject,
  serializeProject,
  uniformLoad,
  type Project,
} from "../src/domain/model";

const split: MemberCommand = {
  kind: "split",
  id: "V1",
  reference: { kind: "distance", metres: 2 },
};
const resize = (
  kind: "trim" | "extend",
  value: number,
  end: "start" | "end" = "end",
): MemberCommand => ({
  kind,
  id: "V1",
  end,
  reference: { kind: "coordinate", axis: "x", value },
});
function spans(p: Project) {
  return p.members.map((m) =>
    distance(
      p.nodes.find((n) => n.id === m.start)!,
      p.nodes.find((n) => n.id === m.end)!,
    ),
  );
}
function totalZ(p: Project, pattern = 0) {
  return spans(p).reduce(
    (v, span, i) =>
      v + span * memberIntensity(p.loadPatterns[pattern], p.members[i].id).z,
    0,
  );
}
describe("edição de barras físicas", () => {
  it("divide em 2 e 4 m, reaproveita o nó e redistribui todos os padrões e grupos", () => {
    const p = beamExample(),
      existing = addPoint(p, { ...origin, x: 2 });
    p.selectionGroups = [
      { id: "grp", name: "Viga", objects: [{ kind: "member", id: "V1" }] },
    ];
    p.loadPatterns.push({
      id: "W",
      name: "Vento",
      nodal: [],
      pressure: [],
      uniform: [{ ...uniformLoad("V1"), qz: 1500 }],
    });
    const snapshot = structuredClone(p),
      plan = planMemberEdit(p, split),
      q = plan.project;
    expect(p).toEqual(snapshot);
    expect(spans(q)).toEqual([2, 4]);
    expect(q.nodes.length).toBe(3);
    expect(q.members[0]).toMatchObject({ id: "V1", end: existing.id });
    expect(q.members[1].start).toBe(existing.id);
    expect(q.loadPatterns[0].uniform.map((l) => l.qz)).toEqual([
      -10000, -10000,
    ]);
    expect(totalZ(q)).toBe(-60000);
    expect(totalZ(q, 1)).toBe(9000);
    expect(q.selectionGroups[0].objects.map((o) => o.id)).toEqual(plan.after);
    for (const ids of [plan.after, [...plan.after].reverse()]) {
      const merged = planMemberEdit(q, { kind: "join", ids }).project;
      expect(merged.members).toEqual(p.members);
      expect(merged.selectionGroups).toEqual(p.selectionGroups);
      expect(merged.loadPatterns).toEqual(p.loadPatterns);
      expect(merged.nodes.map((n) => n.id)).toEqual(["A", "B"]);
      expect(parseProject(serializeProject(merged))).toEqual(merged);
    }
  });
  it("bloqueia a união que perderia apoio, carga, incidência ou intensidade por padrão", () => {
    const plan = planMemberEdit(beamExample(), split),
      join: MemberCommand = { kind: "join", ids: plan.after };
    const joint = plan.project.members[0].end;
    const changed = (fn: (p: Project) => void) => {
      const p = structuredClone(plan.project);
      fn(p);
      const snapshot = structuredClone(p);
      return () => {
        try {
          planMemberEdit(p, join);
        } finally {
          expect(p).toEqual(snapshot);
        }
      };
    };
    expect(
      changed((p) => {
        p.nodes.find((n) => n.id === joint)!.restraints.uz = true;
      }),
    ).toThrow(/apoio/);
    expect(
      changed((p) => {
        p.loadPatterns.push({
          id: "Q",
          name: "Vento",
          nodal: [{ ...nodalLoad(joint), my: 5 }],
          uniform: [],
          pressure: [],
        });
      }),
    ).toThrow(/carga nodal.*Vento/);
    expect(
      changed((p) => {
        addMember(p, { ...origin, x: 2 }, { x: 2, y: 0, z: 3 });
      }),
    ).toThrow(/conecta B3/);
    expect(
      changed((p) => {
        p.loadPatterns[0].uniform[1].qz = 10000;
      }),
    ).toThrow(/intensidades/);
    expect(
      changed((p) => {
        p.sections.push({ ...p.sections[0], id: "B" });
        p.members[1].sectionId = "B";
      }),
    ).toThrow(/mesma seção/);
  });
  it("compara a orientação física de barras invertidas, inclusive em cadeias com mais de dois trechos", () => {
    const p = createProject("spatial"),
      pts = [0, 2, 4, 6].map((x) => ({ x, y: 0, z: 1 }));
    const add = (a: number, b: number, roll: number) =>
      addMember(p, pts[a], pts[b], { sectionId: p.sections[0].id, roll });
    const middle = add(2, 1, -27),
      first = add(0, 1, 27),
      last = add(2, 3, 27);
    const cmd: MemberCommand = {
      kind: "join",
      ids: [last.id, first.id, middle.id],
    };
    const merged = planMemberEdit(p, cmd).project;
    expect(merged.members[0]).toMatchObject({
      id: middle.id,
      start: last.end,
      end: first.start,
      roll: -27,
    });
    p.members[1].roll = -27;
    expect(() => planMemberEdit(p, cmd)).toThrow(/orientações/);
    p.members[1].roll = 27;
    p.nodes.find((n) => n.id === last.end)!.y = 0.1;
    expect(() => planMemberEdit(p, cmd)).toThrow(/colinear/);
  });
  it("rejeita lacunas e nós coincidentes com identidades diferentes na união", () => {
    const p = createProject(),
      a = addMember(p, origin, { ...origin, x: 2 }),
      b = addMember(p, { ...origin, x: 3 }, { ...origin, x: 5 });
    const join: MemberCommand = { kind: "join", ids: [b.id, a.id] };
    expect(() => planMemberEdit(p, join)).toThrow(/lacuna/);
    p.nodes.find((n) => n.id === b.start)!.x = 2;
    expect(() => planMemberEdit(p, join)).toThrow(/lacuna|coincidentes/);
  });
  it("apara e prolonga preservando o ID da ponta livre e a intensidade, bloqueia cortar a ponta apoiada", () => {
    const p = beamExample();
    p.nodes[1].restraints = free();
    const trim = planMemberEdit(p, resize("trim", 4)).project;
    expect(spans(trim)).toEqual([4]);
    expect(totalZ(trim)).toBe(-40000);
    expect(trim.nodes[1]).toMatchObject({ id: "B", x: 4 });
    expect(planMemberEdit(trim, resize("extend", 6)).project).toEqual(p);
    expect(() => planMemberEdit(p, resize("trim", 2, "start"))).toThrow(
      /apoio/,
    );
    expect(() => planMemberEdit(p, resize("trim", 0))).toThrow(
      /extremidade oposta/,
    );
    expect(() => planMemberEdit(p, resize("extend", 4))).toThrow(/além/);
    p.nodes[0].restraints = free();
    const atStart = planMemberEdit(p, resize("trim", 2, "start")).project;
    expect(atStart.nodes[0].x).toBe(2);
    expect(
      planMemberEdit(atStart, resize("extend", 0, "start")).project,
    ).toEqual(p);
  });
  it("bloqueia deslocar nó compartilhado ou carregado e conserva as referências ao reutilizar outro nó", () => {
    const p = beamExample();
    p.nodes[1].restraints = free();
    p.loadPatterns[0].nodal.push({ ...nodalLoad("B"), fz: -10 });
    expect(() => planMemberEdit(p, resize("trim", 4))).toThrow(/carga nodal/);
    p.loadPatterns[0].nodal = [];
    const target = addPoint(p, { ...origin, x: 4 });
    target.restraints.uz = true;
    p.selectionGroups = [
      {
        id: "g",
        name: "Nós",
        objects: [
          { kind: "node", id: "B" },
          { kind: "node", id: target.id },
        ],
      },
    ];
    const q = planMemberEdit(p, resize("trim", 4)).project;
    expect(q.members[0].end).toBe(target.id);
    expect(q.nodes.find((n) => n.id === target.id)!.restraints.uz).toBe(true);
    expect(q.selectionGroups[0].objects).toEqual([
      { kind: "node", id: target.id },
    ]);
    addMember(p, { ...origin, x: 6 }, { x: 6, y: 0, z: 2 });
    expect(() => planMemberEdit(p, resize("trim", 4))).toThrow(/conecta/);
  });
  it("corta as duas barras num cruzamento real e recusa projeção ou referência fora do segmento", () => {
    const p = createProject("spatial");
    const m = addMember(p, origin, { ...origin, x: 6 }),
      ref = addMember(p, { x: 2, y: -2, z: 0 }, { x: 2, y: 2, z: 0 });
    p.loadPatterns[0].uniform = [
      { ...uniformLoad(m.id), qz: -10000 },
      { ...uniformLoad(ref.id), qy: 20 },
    ];
    const cmd: MemberCommand = {
      kind: "split",
      id: m.id,
      reference: { kind: "member", id: ref.id },
    };
    const q = planMemberEdit(p, cmd).project;
    expect(q.nodes).toHaveLength(5);
    expect(q.members).toHaveLength(4);
    const joint = q.nodes.at(-1)!;
    expect(
      q.members.every((m) => m.start === joint.id || m.end === joint.id),
    ).toBe(true);
    expect(q.loadPatterns[0].uniform.map((l) => l.qy)).toEqual([0, 0, 20, 20]);
    for (const n of p.nodes.filter((n) => [ref.start, ref.end].includes(n.id)))
      n.z = 1;
    expect(() => planMemberEdit(p, cmd)).toThrow(/interseção real/);
    for (const n of p.nodes.filter((n) =>
      [ref.start, ref.end].includes(n.id),
    )) {
      n.z = 0;
      n.y += 4;
    }
    expect(() => planMemberEdit(p, cmd)).toThrow(/interseção real/);
  });
  it("prolonga até uma barra e a subdivide, recusa sobreposição ou nó intermediário", () => {
    const p = createProject(),
      a = addMember(p, origin, { ...origin, x: 4 }),
      b = addMember(p, { x: 6, y: 0, z: -1 }, { x: 6, y: 0, z: 1 });
    const cmd: MemberCommand = {
      kind: "extend",
      id: a.id,
      end: "end",
      reference: { kind: "member", id: b.id },
    };
    const q = planMemberEdit(p, cmd).project;
    expect(q.members).toHaveLength(3);
    expect(q.members.every((m) => m.start === a.end || m.end === a.end)).toBe(
      true,
    );
    addPoint(p, { ...origin, x: 5 });
    expect(() => planMemberEdit(p, cmd)).toThrow(/um nó entre/);
    const duplicate = structuredClone(p);
    addMember(duplicate, { ...origin, x: 4 }, { ...origin, x: 5 });
    expect(() => planMemberEdit(duplicate, cmd)).toThrow(/conecta/);
    const overlap = beamExample();
    addMember(overlap, { ...origin, x: 3 }, { ...origin, x: 5 });
    expect(() => planMemberEdit(overlap, split)).toThrow(/sobreporia/);
  });
});
