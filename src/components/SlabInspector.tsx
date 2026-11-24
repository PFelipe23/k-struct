import { SlidersHorizontal } from "lucide-react";
import type { Project, Slab } from "../domain/model";
import { NumberField } from "./Inspector";

const edgeLabels = {
  xMin: "X mínimo",
  xMax: "X máximo",
  yMin: "Y mínimo",
  yMax: "Y máximo",
} as const;
const refinements = Array.from({ length: 16 }, (_, index) => 2 * (index + 1));

export default function SlabInspector({
  project,
  slab,
  patternId,
  edit,
}: {
  project: Project;
  slab: Slab;
  patternId: string;
  edit: (update: (project: Project) => void) => void;
}) {
  const material = project.materials.find(({ id }) => id === slab.materialId)!;
  const pattern = project.loadPatterns.find(({ id }) => id === patternId)!;
  const pressure = pattern.pressures.find(({ slabId }) => slabId === slab.id);
  const changeSlab = (change: Partial<Slab>) =>
    edit((p) =>
      Object.assign(p.slabs.find(({ id }) => id === slab.id)!, change),
    );
  const changeMaterial = (change: Partial<typeof material>) =>
    edit((p) =>
      Object.assign(p.materials.find(({ id }) => id === material.id)!, change),
    );

  return (
    <aside className="inspector">
      <div className="panel-title">
        <SlidersHorizontal size={15} /> Propriedades
      </div>
      <div className="inspector-scroll" key={slab.id}>
        <div className="object-heading">
          <h3>{slab.name} · Laje retangular</h3>
        </div>
        <h4>Geometria</h4>
        <NumberField
          label="Origem X"
          unit="m"
          value={slab.x}
          onChange={(x) => changeSlab({ x })}
        />
        <NumberField
          label="Origem Y"
          unit="m"
          value={slab.y}
          onChange={(y) => changeSlab({ y })}
        />
        <NumberField
          label="Cota Z"
          unit="m"
          value={slab.z}
          onChange={(z) => changeSlab({ z })}
        />
        <NumberField
          label="Dimensão X"
          unit="m"
          min={1e-6}
          value={slab.lengthX}
          onChange={(lengthX) => changeSlab({ lengthX })}
        />
        <NumberField
          label="Dimensão Y"
          unit="m"
          min={1e-6}
          value={slab.lengthY}
          onChange={(lengthY) => changeSlab({ lengthY })}
        />
        <NumberField
          label="Espessura"
          unit="cm"
          min={1e-6}
          value={slab.thickness * 100}
          onChange={(value) => changeSlab({ thickness: value / 100 })}
        />
        <h4>Material</h4>
        <label className="slab-property">
          Material da laje
          <select
            value={material.id}
            onChange={(event) => changeSlab({ materialId: event.target.value })}
          >
            {project.materials.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Módulo E"
          unit="GPa"
          min={1e-6}
          value={material.E / 1e9}
          onChange={(value) => changeMaterial({ E: value * 1e9 })}
        />
        <NumberField
          label="Coeficiente de Poisson"
          min={0}
          max={0.499999}
          value={material.nu}
          onChange={(nu) => changeMaterial({ nu })}
        />
        <NumberField
          label="Densidade"
          unit="kg/m³"
          min={1e-6}
          value={material.density}
          onChange={(density) => changeMaterial({ density })}
        />
        <h4>Malha QDKT</h4>
        {(["nx", "ny"] as const).map((key) => (
          <label className="slab-property" key={key}>
            {key === "nx" ? "Subdivisões X" : "Subdivisões Y"}
            <select
              value={slab[key]}
              onChange={(event) =>
                changeSlab({ [key]: Number(event.target.value) })
              }
            >
              {refinements.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        ))}
        <h4>Apoio simples nas bordas</h4>
        <div className="slab-supports">
          {(Object.keys(edgeLabels) as (keyof typeof edgeLabels)[]).map(
            (key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={slab.supports[key]}
                  onChange={(event) =>
                    changeSlab({
                      supports: {
                        ...slab.supports,
                        [key]: event.target.checked,
                      },
                    })
                  }
                />
                {edgeLabels[key]}
              </label>
            ),
          )}
        </div>
        <p className="help">
          A análise requer apoio simples nas quatro bordas.
        </p>
        <h4>Pressão · {pattern.name}</h4>
        <NumberField
          label="Pressão uniforme Z"
          unit="kN/m²"
          value={(pressure?.qz ?? 0) / 1000}
          onChange={(value) =>
            edit((p) => {
              const target = p.loadPatterns.find(({ id }) => id === patternId)!;
              target.pressures = [{ slabId: slab.id, qz: value * 1000 }];
            })
          }
        />
        <p className="help">Valores negativos atuam para baixo.</p>
      </div>
    </aside>
  );
}
