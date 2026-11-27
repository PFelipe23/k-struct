import type { Point3 } from "../domain/geometry";

type Props = {
  name: string;
  samples: { point: Point3; value: number }[];
  direction: Point3;
  u: keyof Point3;
  v: keyof Point3;
  facing: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
};
export function PressureProjection({
  name,
  samples,
  direction,
  u,
  v,
  facing,
  sx,
  sy,
}: Props) {
  const maximum = Math.max(0, ...samples.map((s) => Math.abs(s.value)));
  if (!maximum) return null;
  return (
    <g
      role="img"
      aria-label={name + " · carga superficial"}
      className="pressure-projection"
    >
      {samples.map(({ point, value }, i) => {
        if (!value) return null;
        const scale = (24 * value) / maximum,
          dx = scale * direction[u],
          dy = -scale * direction[v],
          inPlane = Math.hypot(direction[u], direction[v]) > 1e-8;
        const r = 2 + (3 * Math.abs(value)) / maximum;
        return (
          <g key={i} transform={`translate(${sx(point[u])} ${sy(point[v])})`}>
            <title>{Number((value / 1000).toPrecision(5))} kN/m²</title>
            {inPlane ? (
              <path
                d={`M ${-dx} ${-dy} L 0 0 l ${(-dx + dy * 0.5) * 0.28} ${(-dy - dx * 0.5) * 0.28} M 0 0 l ${(-dx - dy * 0.5) * 0.28} ${(-dy + dx * 0.5) * 0.28}`}
              />
            ) : (
              <>
                <circle r={r} />
                {value * facing > 0 ? (
                  <circle r={r * 0.3} fill="currentColor" />
                ) : (
                  <path
                    d={`M ${-0.65 * r} ${-0.65 * r} l ${1.3 * r} ${1.3 * r} m ${-1.3 * r} 0 l ${1.3 * r} ${-1.3 * r}`}
                  />
                )}
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}
