import { useMemo, useState } from "react";
import { tolerance } from "../domain/geometry";
import { createProject, type Project } from "../domain/model";
import {
  formatQuantity,
  formatUnitInput,
  parseUnitInput,
  unitLabel,
} from "../units";
import { useUnits } from "./Units";
import {
  generateParametricProject,
  inspectParametricTemplate,
  type ParametricPreview,
  type ParametricTemplateSpec,
} from "../domain/templates";

type TemplateChoice =
  | "empty-planar"
  | "empty-spatial"
  | "continuous-beam"
  | "regular-frame";

function DimensionListEditor({
  title,
  itemLabel,
  addLabel,
  removePrefix,
  values,
  defaultNewValue,
  onChange,
}: {
  title: string;
  itemLabel: string;
  addLabel: string;
  removePrefix: string;
  values: string[];
  defaultNewValue: string;
  onChange: (next: string[]) => void;
}) {
  const { units } = useUnits();
  const lengthUnit = unitLabel("length", units);
  return (
    <fieldset className="template-group">
      <legend>{title}</legend>
      <div className="template-list">
        {values.map((raw, index) => {
          const valueSI = parseUnitInput(raw, "length", units);
          const invalid = valueSI === null || valueSI <= tolerance;
          return (
            <div className="template-row" key={`${itemLabel}-${index}`}>
              <label>
                <span>
                  {itemLabel} {index + 1} ({lengthUnit})
                </span>
                <input
                  aria-label={`${itemLabel} ${index + 1} (${lengthUnit})`}
                  aria-invalid={invalid}
                  inputMode="decimal"
                  value={raw}
                  onChange={(e) =>
                    onChange(
                      values.map((item, i) =>
                        i === index ? e.target.value : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                disabled={values.length <= 1}
                aria-label={`${removePrefix} ${index + 1}`}
                onClick={() => onChange(values.filter((_, i) => i !== index))}
              >
                Remover
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        disabled={values.length >= 39}
        onClick={() => onChange([...values, defaultNewValue])}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}

function BeamPreviewSvg({ preview }: { preview: ParametricPreview }) {
  const { units } = useUnits();
  const lengthUnit = unitLabel("length", units);
  const formatLength = (valueSI: number) =>
    formatQuantity(valueSI, "length", units);
  const width = 340;
  const height = 104;
  const padX = 28;
  const total = Math.max(preview.totalLengthX, 1);
  const scaleX = (x: number) => padX + (x / total) * (width - 2 * padX);
  const y = 48;

  return (
    <svg
      className="template-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Prévia esquemática da viga contínua em XZ"
    >
      <line
        x1={scaleX(0)}
        y1={y}
        x2={scaleX(preview.totalLengthX)}
        y2={y}
        className="preview-beam"
      />
      {preview.axesX.slice(0, -1).map((x, index) => {
        const x1 = scaleX(x);
        const x2 = scaleX(preview.axesX[index + 1]);
        const span = preview.axesX[index + 1] - x;
        return (
          <text
            key={`span-${index}`}
            x={(x1 + x2) / 2}
            y={y - 12}
            textAnchor="middle"
            className="preview-dim"
          >
            {formatLength(span)} {lengthUnit}
          </text>
        );
      })}
      {preview.axesX.map((x, index) => {
        const cx = scaleX(x);
        return (
          <g key={`node-${index}`}>
            <circle cx={cx} cy={y} r={4} className="preview-node" />
            <text
              x={cx}
              y={y + 22}
              textAnchor="middle"
              className="preview-coord"
            >
              {formatLength(x)}
            </text>
          </g>
        );
      })}
      <text x={padX} y={16} className="preview-caption">
        Elevação XZ · abscissas X ({lengthUnit})
      </text>
    </svg>
  );
}

function FrameElevationSvg({ preview }: { preview: ParametricPreview }) {
  const { units } = useUnits();
  const lengthUnit = unitLabel("length", units);
  const formatLength = (valueSI: number) =>
    formatQuantity(valueSI, "length", units);
  const width = 260;
  const height = 148;
  const padX = 26;
  const padY = 24;
  const maxX = Math.max(preview.totalLengthX, 1);
  const maxZ = Math.max(preview.totalHeightZ, 1);
  const scale = Math.min((width - 2 * padX) / maxX, (height - 2 * padY) / maxZ);
  const offsetX = (width - maxX * scale) / 2;
  const baseY = height - padY;
  const px = (x: number) => offsetX + x * scale;
  const py = (z: number) => baseY - z * scale;

  return (
    <svg
      className="template-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Prévia esquemática da elevação XZ do pórtico"
    >
      {preview.axesX.map((x, i) => (
        <line
          key={`col-${i}`}
          x1={px(x)}
          y1={py(0)}
          x2={px(x)}
          y2={py(preview.totalHeightZ)}
          className="preview-column"
        />
      ))}
      {preview.levelsZ.slice(1).map((z, k) => (
        <line
          key={`beam-${k}`}
          x1={px(0)}
          y1={py(z)}
          x2={px(preview.totalLengthX)}
          y2={py(z)}
          className="preview-beam"
        />
      ))}
      {preview.levelsZ.map((z) =>
        preview.axesX.map((x, i) => (
          <circle
            key={`n-${z}-${i}`}
            cx={px(x)}
            cy={py(z)}
            r={3}
            className="preview-node"
          />
        )),
      )}
      <text x={8} y={14} className="preview-caption">
        Elevação XZ ({formatLength(preview.totalLengthX)} ×{" "}
        {formatLength(preview.totalHeightZ)} {lengthUnit})
      </text>
    </svg>
  );
}

function FramePlanSvg({ preview }: { preview: ParametricPreview }) {
  const { units } = useUnits();
  const lengthUnit = unitLabel("length", units);
  const formatLength = (valueSI: number) =>
    formatQuantity(valueSI, "length", units);
  const width = 260;
  const height = 148;
  const pad = 26;
  const maxX = Math.max(preview.totalLengthX, 1);
  const maxY = Math.max(preview.totalLengthY, 1);
  const scale = Math.min((width - 2 * pad) / maxX, (height - 2 * pad) / maxY);
  const offsetX = (width - maxX * scale) / 2;
  const baseY = height - pad;
  const px = (x: number) => offsetX + x * scale;
  const py = (y: number) => baseY - y * scale;

  return (
    <svg
      className="template-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Prévia esquemática da planta XY do pórtico espacial"
    >
      {preview.axesY.map((y, j) => (
        <line
          key={`bx-${j}`}
          x1={px(0)}
          y1={py(y)}
          x2={px(preview.totalLengthX)}
          y2={py(y)}
          className="preview-beam"
        />
      ))}
      {preview.axesX.map((x, i) => (
        <line
          key={`by-${i}`}
          x1={px(x)}
          y1={py(0)}
          x2={px(x)}
          y2={py(preview.totalLengthY)}
          className="preview-beam"
        />
      ))}
      {preview.axesY.map((y, j) =>
        preview.axesX.map((x, i) => (
          <circle
            key={`pn-${i}-${j}`}
            cx={px(x)}
            cy={py(y)}
            r={3}
            className="preview-node"
          />
        )),
      )}
      <text x={8} y={14} className="preview-caption">
        Planta XY ({formatLength(preview.totalLengthX)} ×{" "}
        {formatLength(preview.totalLengthY)} {lengthUnit})
      </text>
    </svg>
  );
}

export default function NewProjectDialog({
  onCreate,
  onClose,
}: {
  onCreate: (project: Project) => void;
  onClose: () => void;
}) {
  const { units } = useUnits();
  const lengthUnit = unitLabel("length", units);
  const formatLength = (valueSI: number) =>
    formatQuantity(valueSI, "length", units);
  const inputLength = (valueSI: number) =>
    formatUnitInput(valueSI, "length", units);
  const [choice, setChoice] = useState<TemplateChoice>("empty-planar");
  const [beamSpans, setBeamSpans] = useState<string[]>(() =>
    [4, 6].map(inputLength),
  );
  const [frameMode, setFrameMode] = useState<Project["mode"]>("planar");
  const [frameSpansX, setFrameSpansX] = useState<string[]>(() =>
    [4, 4].map(inputLength),
  );
  const [frameSpansY, setFrameSpansY] = useState<string[]>(() =>
    [4, 4].map(inputLength),
  );
  const [frameHeightsZ, setFrameHeightsZ] = useState<string[]>(() =>
    [3, 3].map(inputLength),
  );

  const spec: ParametricTemplateSpec | null = useMemo(() => {
    const parseLength = (raw: string) =>
      parseUnitInput(raw, "length", units) ?? Number.NaN;
    if (choice === "continuous-beam") {
      return {
        kind: "continuous-beam",
        spansX: beamSpans.map(parseLength),
      };
    }
    if (choice === "regular-frame") {
      return {
        kind: "regular-frame",
        mode: frameMode,
        spansX: frameSpansX.map(parseLength),
        spansY:
          frameMode === "spatial" ? frameSpansY.map(parseLength) : undefined,
        heightsZ: frameHeightsZ.map(parseLength),
      };
    }
    return null;
  }, [
    choice,
    beamSpans,
    frameMode,
    frameSpansX,
    frameSpansY,
    frameHeightsZ,
    units,
  ]);

  const validation = useMemo(
    () => (spec ? inspectParametricTemplate(spec) : null),
    [spec],
  );

  const isEmpty = choice === "empty-planar" || choice === "empty-spatial";
  const canGenerate = isEmpty || Boolean(validation?.ok);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (choice === "empty-planar") {
      onCreate(createProject("planar"));
      return;
    }
    if (choice === "empty-spatial") {
      onCreate(createProject("spatial"));
      return;
    }
    if (!spec || !validation?.ok) return;
    onCreate(generateParametricProject(spec));
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal launch-modal new-project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
      >
        <h2 id="new-project-title">Novo projeto</h2>
        <p>
          Escolha iniciar um projeto vazio ou gerar uma geometria paramétrica.
          Informe os comprimentos em {lengthUnit}. As peças geradas usam os
          mesmos nós, barras, seções e comandos do lançamento manual.
        </p>

        <div
          className="template-tabs"
          role="group"
          aria-label="Tipo de projeto"
        >
          {(
            [
              ["empty-planar", "Projeto vazio (XZ)"],
              ["empty-spatial", "Pórtico espacial vazio (XYZ)"],
              ["continuous-beam", "Viga contínua"],
              ["regular-frame", "Pórtico regular"],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={choice === key}
              onClick={() => setChoice(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="template-layout">
            <div className="template-inputs">
              {choice === "empty-planar" && (
                <p className="help">
                  Inicia um modelo vazio no plano XZ (graus UX, UZ e RY) pronto
                  para lançamento livre de nós e barras.
                </p>
              )}
              {choice === "empty-spatial" && (
                <p className="help">
                  Inicia um modelo espacial vazio XYZ (6 graus por nó) com eixos
                  X, Y e pavimentos iniciais.
                </p>
              )}
              {choice === "continuous-beam" && (
                <DimensionListEditor
                  title="Vãos sucessivos em X (plano XZ)"
                  itemLabel="Vão"
                  addLabel="Adicionar vão"
                  removePrefix="Remover vão"
                  values={beamSpans}
                  defaultNewValue={inputLength(4)}
                  onChange={setBeamSpans}
                />
              )}
              {choice === "regular-frame" && (
                <>
                  <div
                    className="guide-tabs"
                    role="group"
                    aria-label="Geometria do pórtico"
                  >
                    <button
                      type="button"
                      aria-pressed={frameMode === "planar"}
                      onClick={() => setFrameMode("planar")}
                    >
                      Plano XZ
                    </button>
                    <button
                      type="button"
                      aria-pressed={frameMode === "spatial"}
                      onClick={() => setFrameMode("spatial")}
                    >
                      Espacial XYZ
                    </button>
                  </div>
                  <DimensionListEditor
                    title="Vãos horizontais em X"
                    itemLabel="Vão X"
                    addLabel="Adicionar vão X"
                    removePrefix="Remover vão X"
                    values={frameSpansX}
                    defaultNewValue={inputLength(4)}
                    onChange={setFrameSpansX}
                  />
                  {frameMode === "spatial" && (
                    <DimensionListEditor
                      title="Vãos horizontais em Y (planta)"
                      itemLabel="Vão Y"
                      addLabel="Adicionar vão Y"
                      removePrefix="Remover vão Y"
                      values={frameSpansY}
                      defaultNewValue={inputLength(4)}
                      onChange={setFrameSpansY}
                    />
                  )}
                  <DimensionListEditor
                    title="Alturas por pavimento (Z)"
                    itemLabel="Pavimento"
                    addLabel="Adicionar pavimento"
                    removePrefix="Remover pavimento"
                    values={frameHeightsZ}
                    defaultNewValue={inputLength(3)}
                    onChange={setFrameHeightsZ}
                  />
                </>
              )}
            </div>

            <div className="template-preview" aria-label="Prévia do modelo">
              <h3>Prévia antes de gerar</h3>
              {isEmpty ? (
                <div className="template-summary">
                  <div>
                    <span>Geometria</span>
                    <b>
                      {choice === "empty-planar"
                        ? "Projeto plano (XZ)"
                        : "Projeto espacial (XYZ)"}
                    </b>
                  </div>
                  <div>
                    <span>Unidades</span>
                    <b>{lengthUnit}</b>
                  </div>
                  <div>
                    <span>Nós / Barras</span>
                    <b>0 nós · 0 barras</b>
                  </div>
                  <div>
                    <span>Apoios</span>
                    <b>Nenhum apoio</b>
                  </div>
                  <div>
                    <span>Cargas</span>
                    <b>Nenhuma carga (padrão inicial vazio)</b>
                  </div>
                </div>
              ) : validation && validation.ok ? (
                <>
                  <div
                    className={`template-diagrams ${validation.preview.mode === "spatial" ? "spatial" : ""}`}
                  >
                    {choice === "continuous-beam" ? (
                      <BeamPreviewSvg preview={validation.preview} />
                    ) : (
                      <>
                        {validation.preview.mode === "spatial" && (
                          <FramePlanSvg preview={validation.preview} />
                        )}
                        <FrameElevationSvg preview={validation.preview} />
                      </>
                    )}
                  </div>
                  <div className="template-summary">
                    <div>
                      <span>Geometria</span>
                      <b>
                        {validation.preview.mode === "spatial"
                          ? "Espacial XYZ (planta XY + elevações)"
                          : "Plana XZ"}
                      </b>
                    </div>
                    <div>
                      <span>Unidades</span>
                      <b>{lengthUnit}</b>
                    </div>
                    <div>
                      <span>Eixos X ({lengthUnit})</span>
                      <b>
                        {validation.preview.axesX.map(formatLength).join(", ")}
                      </b>
                    </div>
                    {validation.preview.mode === "spatial" && (
                      <div>
                        <span>Eixos Y ({lengthUnit})</span>
                        <b>
                          {validation.preview.axesY
                            .map(formatLength)
                            .join(", ")}
                        </b>
                      </div>
                    )}
                    {choice === "regular-frame" && (
                      <div>
                        <span>Níveis Z ({lengthUnit})</span>
                        <b>
                          {validation.preview.levelsZ
                            .map(formatLength)
                            .join(", ")}
                        </b>
                      </div>
                    )}
                    <div>
                      <span>Quantidade de nós</span>
                      <b>{validation.preview.nodeCount} nós</b>
                    </div>
                    <div>
                      <span>Quantidade de barras</span>
                      <b>
                        {validation.preview.memberCount} barras
                        {choice === "regular-frame"
                          ? validation.preview.mode === "spatial"
                            ? ` (${validation.preview.columnCount} pilares · ${validation.preview.beamXCount} vigas X · ${validation.preview.beamYCount} vigas Y)`
                            : ` (${validation.preview.columnCount} pilares · ${validation.preview.beamCount} vigas)`
                          : ""}
                      </b>
                    </div>
                    <div>
                      <span>Apoios</span>
                      <b>{validation.preview.supportsSummary}</b>
                    </div>
                    <div>
                      <span>Cargas</span>
                      <b>{validation.preview.loadsSummary}</b>
                    </div>
                  </div>
                </>
              ) : (
                <div role="alert" className="launch-error template-errors">
                  {validation?.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={!canGenerate}>
              {isEmpty ? "Criar projeto" : "Gerar projeto"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
