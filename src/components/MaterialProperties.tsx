import type { Material } from "../domain/model";

// Input and inspection use the same units; the project and the solver use SI.
export const materialFields = [
  { key: "E", label: "Módulo E", unit: "GPa", scale: 1e9 },
  { key: "nu", label: "Poisson ν", unit: "", scale: 1 },
  { key: "density", label: "Massa específica ρ", unit: "kg/m³", scale: 1 },
  { key: "alpha", label: "Dilatação linear α", unit: "1/K", scale: 1 },
] as const;

const format = new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 12 });

export default function MaterialProperties({
  material,
}: {
  material: Material;
}) {
  return (
    <dl className="material-values" aria-label="Propriedades do material">
      {materialFields.map(({ key, label, unit, scale }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {format.format(material[key] / scale)} {unit}
          </dd>
        </div>
      ))}
    </dl>
  );
}
