import { distance, interiorParameter, tolerance } from "./geometry";
import { memberAxis } from "./memberOffsets";
import type { Project } from "./model";

export type BeamStation = { t: number; nodeId?: string };
export type SectionLocation = { t: number; side?: "left" | "right" };

export function connectionStations(p: Project) {
  const byMember = new Map<string, { t: number; nodeId: string }[]>();
  if (!p.meshConnections.length) return byMember;
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const members = new Map(p.members.map((m) => [m.id, m]));
  for (const link of p.meshConnections) {
    const m = members.get(link.memberId),
      node = nodes.get(link.nodeId);
    if (!m || !node)
      throw new Error(
        "Uma conexão da malha referencia uma barra ou um nó inexistente.",
      );
    const a = nodes.get(m.start),
      b = nodes.get(m.end);
    const t = a && b ? interiorParameter(node, a, b) : null;
    if (t === null)
      throw new Error(
        `${node.name} precisa permanecer no interior de ${m.name}. Remova a conexão antes de afastar o nó da barra.`,
      );
    const stations = byMember.get(m.id) ?? [];
    stations.push({ t, nodeId: node.id });
    byMember.set(m.id, stations);
  }
  for (const [id, stations] of byMember) {
    stations.sort((a, b) => a.t - b.t);
    const member = members.get(id)!;
    const span = distance(nodes.get(member.start)!, nodes.get(member.end)!);
    if (
      stations.some(
        (s, i) => i > 0 && (s.t - stations[i - 1].t) * span <= tolerance,
      )
    )
      throw new Error(
        `Há conexões repetidas ou coincidentes em ${member.name}. Use um único nó nessa estação.`,
      );
  }
  return byMember;
}

// Editable nodes take precedence over a regular station within the geometric tolerance.
export function beamMeshLayout(p: Project) {
  const rigidLinks: { memberId: string; masterId: string; nodeId: string }[] =
    [];
  const links = connectionStations(p);
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const layout = new Map<string, BeamStation[]>();
  const count = p.mesh.segmentsPerMember;
  for (const m of p.members) {
    const axis = memberAxis(m, nodes.get(m.start)!, nodes.get(m.end)!);
    const span = axis.clear;
    const fixed: { t: number; nodeId: string }[] = [];
    for (const link of links.get(m.id) ?? []) {
      const t = m.offsets
        ? (link.t * axis.span - m.offsets.i.rigidLength) / span
        : link.t;
      if (t * span <= tolerance || (1 - t) * span <= tolerance) {
        rigidLinks.push({
          memberId: m.id,
          masterId: t < 0.5 ? m.start : m.end,
          nodeId: link.nodeId,
        });
      } else fixed.push({ t, nodeId: link.nodeId });
    }
    fixed.push({ t: 1, nodeId: m.end });
    const stations: BeamStation[] = [{ t: 0, nodeId: m.start }];
    let step = 1;
    for (const next of fixed) {
      while (step < count && step / count <= next.t) {
        const t = step++ / count;
        if (
          (t - stations.at(-1)!.t) * span > tolerance &&
          (next.t - t) * span > tolerance
        )
          stations.push({ t });
      }
      stations.push(next);
    }
    layout.set(m.id, stations);
  }
  return { stations: layout, rigidLinks };
}

export function beamStations(p: Project) {
  return beamMeshLayout(p).stations;
}

export function sectionLocations(stations: BeamStation[]): SectionLocation[] {
  return stations.flatMap(({ t, nodeId }): SectionLocation[] =>
    nodeId && t > 0 && t < 1
      ? [
          { t, side: "left" },
          { t, side: "right" },
        ]
      : [{ t }],
  );
}

export function nearestSection(stations: SectionLocation[], t: number) {
  let best = 0;
  for (let i = 1; i < stations.length; i++) {
    const delta = Math.abs(stations[i].t - t);
    if (
      delta < Math.abs(stations[best].t - t) ||
      (stations[i].t === stations[best].t &&
        stations[i].side === "right" &&
        t > stations[i].t)
    )
      best = i;
  }
  return best;
}
