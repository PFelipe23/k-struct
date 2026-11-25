import {
  sectionProperties,
  shapeNames,
  type SectionGeometry,
} from "../domain/sections";

const number = new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 7 });
function Outline({ geometry: g }: { geometry: SectionGeometry }) {
  if (g.shape === "circle") return <circle r={40} />;
  if (g.shape === "tube") {
    const ri = 40 * (1 - (2 * g.thickness) / g.outerDiameter);
    return (
      <path
        fillRule="evenodd"
        d={`M -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 Z M ${-ri} 0 a ${ri} ${ri} 0 1 0 ${2 * ri} 0 a ${ri} ${ri} 0 1 0 ${-2 * ri} 0 Z`}
      />
    );
  }
  const scale = 80 / Math.max(g.width, g.height);
  const b = (g.width * scale) / 2,
    h = (g.height * scale) / 2;
  if (g.shape === "rectangle")
    return <rect x={-b} y={-h} width={2 * b} height={2 * h} />;
  const y = (g.webThickness * scale) / 2,
    z = h - g.flangeThickness * scale;
  return (
    <path
      d={`M ${-b} ${-h} H ${b} V ${-z} H ${y} V ${z} H ${b} V ${h} H ${-b} V ${z} H ${-y} V ${-z} H ${-b} Z`}
    />
  );
}

export default function SectionPreview({
  geometry,
  roll,
}: {
  geometry: SectionGeometry;
  roll?: number;
}) {
  const { A, Iy, Iz, J } = sectionProperties(geometry);
  const equal = Math.abs(Iy - Iz) <= 1e-12 * Math.max(Iy, Iz);
  return (
    <div className="section-properties">
      <svg
        viewBox="-64 -61 130 118"
        role="img"
        aria-label={`Contorno da seção ${shapeNames[geometry.shape]} com eixos locais y e z`}
      >
        <g className="section-outline">
          <Outline geometry={geometry} />
        </g>
        <g className="section-axes">
          <path d="M -46 0 H 54 l -5 -3 M 54 0 l -5 3 M 0 46 V -52 l -3 5 M 0 -52 l 3 5" />
        </g>
        <g className="section-axis-label">
          <text x="57" y="4">
            y
          </text>
          <text x="5" y="-48">
            z
          </text>
        </g>
      </svg>
      <dl
        className="material-values"
        aria-label="Propriedades geométricas da seção"
      >
        {(
          [
            ["A", A, 1e4, "cm²"],
            ["Iy", Iy, 1e8, "cm⁴"],
            ["Iz", Iz, 1e8, "cm⁴"],
            ["J", J, 1e8, "cm⁴"],
          ] as const
        ).map(([key, value, scale, unit]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              {number.format(value * scale)} {unit}
            </dd>
          </div>
        ))}
      </dl>
      <p className="help">
        {equal
          ? "Iy = Iz nos eixos locais."
          : Iy > Iz
            ? "Eixo forte y · eixo fraco z."
            : "Eixo forte z · eixo fraco y."}{" "}
        Vista a partir de +x. O eixo x vai de i para j.
        {roll !== undefined &&
          ` Rotação da seção em torno de x: ${number.format(roll)}°.`}
      </p>
    </div>
  );
}
