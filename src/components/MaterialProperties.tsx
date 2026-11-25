import type { Material } from "../domain/model";
import { formatQuantity, unitLabel } from "../units";
import { useUnits } from "./Units";

// Input and inspection use the same units; the project and the solver use SI.
export const materialFields = [
  { key: "E", label: "Módulo E", unit: "", quantity: "modulus" },
  { key: "nu", label: "Poisson ν", unit: "", quantity: undefined },
  {
    key: "density",
    label: "Massa específica ρ",
    unit: "kg/m³",
    quantity: undefined,
  },
  {
    key: "alpha",
    label: "Dilatação linear α",
    unit: "1/K",
    quantity: undefined,
  },
] as const;

const format = new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 12 });

export default function MaterialProperties({
  material,
}: {
  material: Material;
}) {
  const { units } = useUnits();
  return (
    <dl className="material-values" aria-label="Propriedades do material">
      {materialFields.map(({ key, label, unit, quantity }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {quantity
              ? formatQuantity(material[key], quantity, units)
              : format.format(material[key])}{" "}
            {quantity ? unitLabel(quantity, units) : unit}
          </dd>
        </div>
      ))}
    </dl>
  );
}
