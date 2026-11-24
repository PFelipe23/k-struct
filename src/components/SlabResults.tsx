import type { SlabResult } from "../solver/slab";
import { formatResult } from "./resultFormatting";

export const slabComponents = {
  uz: {
    label: "Flecha Uz",
    unit: "mm",
    factor: 1000,
    sign: "Negativo para baixo",
  },
  mx: {
    label: "Momento Mx",
    unit: "kN·m/m",
    factor: 0.001,
    sign: "Positivo em flexão sagente",
  },
  my: {
    label: "Momento My",
    unit: "kN·m/m",
    factor: 0.001,
    sign: "Positivo em flexão sagente",
  },
} as const;
export type SlabComponent = keyof typeof slabComponents;

export default function SlabResults({
  result,
  slabName,
  caseName,
  component,
}: {
  result: SlabResult;
  slabName: string;
  caseName: string;
  component: SlabComponent;
}) {
  const { label, unit, factor, sign } = slabComponents[component];
  const values = result.cells.map((cell) => cell[component] * factor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const magnitude = Math.max(-min, max) || 1;
  const color = (value: number) => {
    const level = Math.abs(value / magnitude);
    return `hsl(${value < 0 ? 210 : 31} ${20 + level * 60}% ${25 + level * 40}%)`;
  };
  const { nx, ny, lengthX, lengthY, center } = result;
  const dx = lengthX / nx;
  const dy = lengthY / ny;

  return (
    <section className="slab-results" aria-label="Resultados da laje">
      <header>
        <strong>
          {slabName} · {caseName}
        </strong>
        <span>
          {label} ({unit}) · {nx} × {ny} · {sign}
        </span>
      </header>
      <svg
        className="slab-map"
        viewBox={`0 0 ${lengthX} ${lengthY}`}
        role="img"
        aria-label={`Mapa de ${label}`}
      >
        <title>
          {label} por elemento ({unit}), X para a direita e Y para cima
        </title>
        {result.cells.map(({ number, i, j }, index) => (
          <rect
            key={number}
            x={i * dx}
            y={(ny - 1 - j) * dy}
            width={dx}
            height={dy}
            fill={color(values[index])}
            stroke="#1a2332"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          >
            <title>
              Elemento {number} · {formatResult(values[index])} {unit}
            </title>
          </rect>
        ))}
      </svg>
      <div className="slab-result-legend">
        <span>
          Mínimo {formatResult(min)} {unit}
        </span>
        <i
          aria-hidden="true"
          style={{
            background: `linear-gradient(to right, ${color(min)}, ${color((min + max) / 2)}, ${color(max)})`,
          }}
        />
        <span>
          Máximo {formatResult(max)} {unit}
        </span>
      </div>
      <dl className="slab-summary">
        <div>
          <dt>Uz no centro</dt>
          <dd>{formatResult(center.uz * 1000)} mm</dd>
        </div>
        <div>
          <dt>Mx no centro</dt>
          <dd>{formatResult(center.mx / 1000)} kN·m/m</dd>
        </div>
        <div>
          <dt>My no centro</dt>
          <dd>{formatResult(center.my / 1000)} kN·m/m</dd>
        </div>
        <div>
          <dt>Σ Rz nos apoios</dt>
          <dd>{formatResult(result.rz / 1000)} kN</dd>
        </div>
        <div>
          <dt>Carga total em Z</dt>
          <dd>{formatResult(result.appliedZ / 1000)} kN</dd>
        </div>
      </dl>
    </section>
  );
}
