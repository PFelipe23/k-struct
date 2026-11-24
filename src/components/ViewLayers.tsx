import { Grid2X2, ArrowDownToLine, Tags } from "lucide-react";
import { useState } from "react";

export function useViewLayers(showAnnotations = true) {
  return useState({
    labels: showAnnotations,
    grid: true,
    loads: showAnnotations,
  });
}

export type LayerControls = {
  layers: ReturnType<typeof useViewLayers>[0];
  setLayers: ReturnType<typeof useViewLayers>[1];
};

export function ViewLayers({ layers, setLayers }: LayerControls) {
  const items = [
    ["labels", "Nomes dos objetos", Tags],
    ["grid", "Grelha", Grid2X2],
    ["loads", "Cargas", ArrowDownToLine],
  ] as const;
  return items.map(([key, label, Icon]) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={layers[key]}
      onClick={() => setLayers((v) => ({ ...v, [key]: !v[key] }))}
    >
      <Icon size={13} />
    </button>
  ));
}
