import {
  add,
  cross,
  dot,
  scale,
  subtract,
  tolerance,
  type Point3,
} from "./geometry";
import { memberAxis } from "./memberOffsets";
import type { DistributedLoad } from "./memberDistributedLoads";
import type { LoadPanel, Project, TributaryLoad } from "./model";
import { slabRings, type XY } from "./slabPolygon";

export const distributionNames = {
  spanAB: "Uma direção · vão AB",
  spanAD: "Uma direção · vão AD",
  twoWay: "Duas direções · 45°",
};
const sides = ["AB", "BC", "CD", "DA"] as const;
type Side = (typeof sides)[number];
type WidthSegment = {
  start: number;
  end: number;
  widthStart: number;
  widthEnd: number;
};
export type BeamShare = {
  side: Side;
  memberId: string;
  name: string;
  span: number;
  area: number;
  segments: WidthSegment[];
};
export function loadPanelGeometry(p: Project, panel: LoadPanel) {
  const [a, b, d] = [panel.a, panel.b, panel.d].map((id) =>
    p.nodes.find((n) => n.id === id),
  );
  if (!a || !b || !d)
    throw new Error(
      "O painel precisa de três nós existentes A, B e D. Edite o painel antes de remover um desses nós.",
    );
  if (Math.max(Math.abs(b.z - a.z), Math.abs(d.z - a.z)) > tolerance)
    throw new Error("A, B e D devem estar na mesma cota Z.");
  const ab = { x: b.x - a.x, y: b.y - a.y, z: 0 },
    ad = { x: d.x - a.x, y: d.y - a.y, z: 0 };
  const width = Math.hypot(ab.x, ab.y),
    height = Math.hypot(ad.x, ad.y);
  if (Math.min(width, height) <= tolerance || !Number.isFinite(width * height))
    throw new Error(
      "Informe dois lados de comprimento positivo para o painel.",
    );
  const u = scale(ab, 1 / width),
    v = scale(ad, 1 / height);
  if (Math.abs(dot(u, v)) * Math.max(width, height) > tolerance)
    throw new Error("Os lados AB e AD devem formar um retângulo em planta.");
  const point = (x: number, y: number) => add(a, add(scale(u, x), scale(v, y)));
  const corners = [
    point(0, 0),
    point(width, 0),
    point(width, height),
    point(0, height),
  ];
  return {
    width,
    height,
    area: width * height,
    corners,
    center: point(width / 2, height / 2),
    u,
    v,
  };
}
type Rectangle = ReturnType<typeof loadPanelGeometry>;

// Clip each material ring in the rectangle's local plane. Subtracting the
// holes retains cutouts, concave contours and the zero-area shared edges.
function overlap(rect: Rectangle, rings: XY[][]) {
  function clippedArea(ring: XY[]) {
    let poly = ring.map((v) => {
      const x = v.x - rect.corners[0].x,
        y = v.y - rect.corners[0].y;
      return { x: x * rect.u.x + y * rect.u.y, y: x * rect.v.x + y * rect.v.y };
    });
    for (const [axis, sign, limit] of [
      ["x", 1, 0],
      ["x", -1, rect.width],
      ["y", 1, 0],
      ["y", -1, rect.height],
    ] as const) {
      const next: XY[] = [];
      for (const [i, a] of poly.entries()) {
        const b = poly[(i + 1) % poly.length],
          da = sign * (a[axis] - limit),
          db = sign * (b[axis] - limit);
        if (da >= 0) next.push(a);
        if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
          const t = da / (da - db);
          next.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      poly = next;
    }
    if (poly.length < 3) return 0;
    const o = poly[0];
    let twice = 0;
    for (let i = 1; i + 1 < poly.length; i++)
      twice +=
        (poly[i].x - o.x) * (poly[i + 1].y - o.y) -
        (poly[i].y - o.y) * (poly[i + 1].x - o.x);
    return Math.abs(twice) / 2;
  }
  const area = rings.reduce(
    (sum, r, i) => sum + (i === 0 ? 1 : -1) * clippedArea(r),
    0,
  );
  return area > Math.max(tolerance ** 2, 64 * Number.EPSILON * rect.area);
}
export function checkLoadPanelLocation(
  p: Project,
  panel: LoadPanel,
  rect: Rectangle,
) {
  const atLevel = (z: number) => Math.abs(rect.center.z - z) <= tolerance;
  for (const slab of p.slabs) {
    const level = p.guides.z.find((l) => l.id === slab.levelId);
    if (level && atLevel(level.position) && overlap(rect, slabRings(slab)))
      throw new Error(
        "Sobreposição com a laje resistente " +
          slab.name +
          ". Escolha apenas uma representação da área carregada.",
      );
  }
  for (const shell of p.surfacePanels ?? []) {
    if (
      [shell.a, shell.b, shell.d].every((v) => atLevel(v.z)) &&
      overlap(rect, [
        [shell.a, shell.b, add(shell.b, subtract(shell.d, shell.a)), shell.d],
      ])
    )
      throw new Error(
        "Sobreposição com o painel resistente " + shell.name + ".",
      );
  }
  for (const other of p.loadPanels ?? []) {
    if (other.id === panel.id) continue;
    const adjacent = loadPanelGeometry(p, other);
    if (atLevel(adjacent.center.z) && overlap(rect, [adjacent.corners]))
      throw new Error(
        "A área se sobrepõe ao painel de carga " +
          other.name +
          ". Use padrões diferentes no mesmo painel para somar ações.",
      );
  }
}

function memberLines(p: Project) {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  return p.members.flatMap((member) => {
    const a = nodes.get(member.start),
      b = nodes.get(member.end);
    if (!a || !b) return [];
    return [{ member, ...memberAxis(member, a, b) }];
  });
}

export function distributeLoadPanel(
  p: Project,
  panel: LoadPanel,
  rect = loadPanelGeometry(p, panel),
) {
  const { corners, width, height } = rect;
  const lines = memberLines(p),
    shares: BeamShare[] = [];
  const regions: { side: Side; points: Point3[] }[] = [];
  for (const [i, side] of sides.entries()) {
    const alongAB = i % 2 === 0;
    if (
      (panel.distribution === "spanAB" && alongAB) ||
      (panel.distribution === "spanAD" && !alongAB)
    )
      continue;
    const a = corners[i],
      b = corners[(i + 1) % 4],
      edgeLength = alongAB ? width : height,
      depth = alongAB ? height : width;
    const axis = scale(subtract(b, a), 1 / edgeLength),
      inward = scale(subtract(corners[(i + 3) % 4], a), 1 / depth);
    const rampLength = Math.min(depth, edgeLength) / 2;
    const influenceWidth =
      panel.distribution === "twoWay"
        ? (s: number) => Math.min(s, edgeLength - s, depth / 2)
        : () => depth / 2;
    const breaks =
      panel.distribution !== "twoWay"
        ? [0, edgeLength]
        : edgeLength - 2 * rampLength <= 16 * Number.EPSILON * edgeLength
          ? [0, edgeLength / 2, edgeLength]
          : [0, rampLength, edgeLength - rampLength, edgeLength];
    const at = (s: number, w: number) =>
      add(a, add(scale(axis, s), scale(inward, w)));
    regions.push({
      side,
      points: [
        a,
        b,
        ...breaks
          .slice()
          .reverse()
          .filter((s) => influenceWidth(s) > 0)
          .map((s) => at(s, influenceWidth(s))),
      ],
    });
    const receivers = lines
      .flatMap((line) => {
        // The physical insertion axis must coincide with the edge; a crossing
        // beam or a beam on the floor immediately above carries no edge strip.
        const from = subtract(line.start, a),
          to = subtract(line.end, a);
        if (
          [from, to].some(
            (v) =>
              Math.abs(v.z) > tolerance ||
              Math.abs(cross(axis, v).z) > tolerance,
          )
        )
          return [];
        const si = dot(from, axis),
          sj = dot(to, axis),
          lo = Math.max(0, Math.min(si, sj)),
          hi = Math.min(edgeLength, Math.max(si, sj));
        return hi - lo > tolerance ? [{ line, si, sj, lo, hi }] : [];
      })
      .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    let cursor = 0;
    for (const { line, si, sj, lo, hi } of receivers) {
      if (lo > cursor + tolerance)
        throw new Error(
          "Borda " +
            side +
            " sem viga em toda a extensão. Complete a linha de apoio.",
        );
      if (lo < cursor - tolerance)
        throw new Error(
          "Vigas sobrepostas na borda " +
            side +
            ". Há mais de uma receptora no mesmo trecho.",
        );
      const end = edgeLength - hi <= tolerance ? edgeLength : hi;
      const cuts = [
        cursor,
        ...breaks.filter((s) => s > cursor && s < end),
        end,
      ];
      const fraction = (s: number) =>
        Math.max(0, Math.min(1, (s - si) / (sj - si)));
      const segments: WidthSegment[] = [];
      let area = 0;
      for (let k = 1; k < cuts.length; k++) {
        const x = cuts[k - 1],
          y = cuts[k],
          w0 = influenceWidth(x),
          w1 = influenceWidth(y);
        area += ((y - x) * (w0 + w1)) / 2;
        const start = fraction(x),
          end = fraction(y);
        if (start < end)
          segments.push({ start, end, widthStart: w0, widthEnd: w1 });
        else
          segments.push({
            start: end,
            end: start,
            widthStart: w1,
            widthEnd: w0,
          });
      }
      shares.push({
        side,
        memberId: line.member.id,
        name: line.member.name,
        span: line.span,
        area,
        segments: segments.sort((a, b) => a.start - b.start),
      });
      cursor = end;
    }
    if (edgeLength - cursor > tolerance)
      throw new Error(
        "Borda " +
          side +
          " sem viga em toda a extensão. Complete a linha de apoio.",
      );
  }
  return { rect, shares, regions };
}

export function loadPanelErrors(p: Project) {
  const panels = p.loadPanels ?? [],
    errors: string[] = [];
  if (panels.length && p.mode !== "spatial")
    errors.push("Painéis de carga exigem um pórtico espacial.");
  const loadScales = new Map<string, number>();
  for (const panel of panels) {
    try {
      const rect = loadPanelGeometry(p, panel);
      checkLoadPanelLocation(p, panel, rect);
      distributeLoadPanel(p, panel, rect);
      const peakWidth =
        (panel.distribution === "spanAB"
          ? rect.width
          : panel.distribution === "spanAD"
            ? rect.height
            : Math.min(rect.width, rect.height)) / 2;
      loadScales.set(panel.id, Math.max(rect.area, peakWidth));
    } catch (e) {
      errors.push(panel.name + " · " + (e as Error).message);
    }
  }
  for (const pattern of p.loadPatterns) {
    const seen = new Set<string>();
    for (const load of pattern.tributaryLoads ?? []) {
      if (!panels.some((v) => v.id === load.panelId) || seen.has(load.panelId))
        errors.push(
          pattern.name +
            " · carga de área duplicada ou sem painel correspondente.",
        );
      if (!Number.isFinite(load.pressure * (loadScales.get(load.panelId) ?? 1)))
        errors.push(
          pattern.name + " · carga de painel fora do intervalo numérico.",
        );
      seen.add(load.panelId);
    }
  }
  return errors;
}
export function tributaryForce(axis: TributaryLoad["axis"], value: number) {
  return {
    x: axis === "X" ? value : 0,
    y: axis === "Y" ? value : 0,
    z: axis === "Z" ? value : 0,
  };
}
// The editable patterns contain only the pressure. Generated linear loads are
// ephemeral and keep their physical member ID and its insertion-axis fractions.
export function tributaryProfiles(p: Project) {
  const result = new Map<string, DistributedLoad[]>();
  const shares = new Map<string, BeamShare[]>();
  for (const pattern of p.loadPatterns) {
    const profiles: DistributedLoad[] = [];
    for (const load of pattern.tributaryLoads ?? []) {
      if (!load.pressure) continue;
      let parts = shares.get(load.panelId);
      if (!parts) {
        const panel = p.loadPanels?.find((v) => v.id === load.panelId);
        if (!panel) throw new Error("Painel de carga inexistente.");
        parts = distributeLoadPanel(p, panel).shares;
        shares.set(panel.id, parts);
      }
      for (const part of parts)
        for (const [index, s] of part.segments.entries()) {
          profiles.push({
            id: `${load.panelId}/${part.side}/${part.memberId}/${index}`,
            memberId: part.memberId,
            measure: "relative",
            start: s.start,
            end: s.end,
            system: "global",
            qStart: tributaryForce(load.axis, s.widthStart * load.pressure),
            qEnd: tributaryForce(load.axis, s.widthEnd * load.pressure),
          });
        }
    }
    if (profiles.length) result.set(pattern.id, profiles);
  }
  return result;
}
