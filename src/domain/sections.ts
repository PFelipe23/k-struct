import { z } from "zod";

const length = z.number().finite().positive();
export const geometrySchemas = {
  rectangle: z.strictObject({
    shape: z.literal("rectangle"),
    width: length,
    height: length,
  }),
  circle: z.strictObject({ shape: z.literal("circle"), diameter: length }),
  tube: z.strictObject({
    shape: z.literal("tube"),
    outerDiameter: length,
    thickness: length,
  }),
  i: z.strictObject({
    shape: z.literal("i"),
    height: length,
    width: length,
    flangeThickness: length,
    webThickness: length,
  }),
};
export type SectionShape = keyof typeof geometrySchemas;
export type SectionGeometry = z.infer<(typeof geometrySchemas)[SectionShape]>;
export const shapeNames = {
  rectangle: "Retangular maciça",
  circle: "Circular maciça",
  tube: "Tubular circular",
  i: "I duplamente simétrico",
} satisfies Record<SectionShape, string>;

export const defaultGeometry = {
  rectangle: { shape: "rectangle", width: 0.15, height: 0.2 },
  circle: { shape: "circle", diameter: 0.1 },
  tube: { shape: "tube", outerDiameter: 0.1, thickness: 0.01 },
  i: {
    shape: "i",
    height: 0.2,
    width: 0.1,
    flangeThickness: 0.01,
    webThickness: 0.006,
  },
} satisfies Record<SectionShape, SectionGeometry>;

const labels = {
  width: "Largura b",
  height: "Altura h",
  diameter: "Diâmetro d",
  outerDiameter: "Diâmetro externo D",
  thickness: "Espessura da parede t",
  flangeThickness: "Espessura da mesa tf",
  webThickness: "Espessura da alma tw",
};
export type Dimension = keyof typeof labels;
export function dimensions(geometry: SectionGeometry) {
  function field(key: Dimension, value: number) {
    return { key, label: labels[key], value };
  }
  switch (geometry.shape) {
    case "rectangle":
      return [field("width", geometry.width), field("height", geometry.height)];
    case "circle":
      return [field("diameter", geometry.diameter)];
    case "tube":
      return [
        field("outerDiameter", geometry.outerDiameter),
        field("thickness", geometry.thickness),
      ];
    case "i":
      return [
        field("height", geometry.height),
        field("width", geometry.width),
        field("flangeThickness", geometry.flangeThickness),
        field("webThickness", geometry.webThickness),
      ];
  }
}

function rectangleTorsion(width: number, height: number) {
  const a = Math.max(width, height),
    b = Math.min(width, height);
  // Saint-Venant torsion using the same 60 odd terms as legacy rectangles.
  let series = 0;
  for (let k = 1; k < 120; k += 2)
    series += Math.tanh((k * Math.PI * a) / (2 * b)) / k ** 5;
  return ((a * b ** 3) / 3) * (1 - ((192 * b) / (Math.PI ** 5 * a)) * series);
}

// SI. Width spans local y and depth spans local z.
export function sectionProperties(g: SectionGeometry) {
  switch (g.shape) {
    case "rectangle":
      return {
        A: g.width * g.height,
        Iy: (g.width * g.height ** 3) / 12,
        Iz: (g.height * g.width ** 3) / 12,
        J: rectangleTorsion(g.width, g.height),
      };
    case "circle": {
      const A = (Math.PI * g.diameter ** 2) / 4,
        I = (Math.PI * g.diameter ** 4) / 64;
      return { A, Iy: I, Iz: I, J: 2 * I };
    }
    case "tube": {
      const di = g.outerDiameter - 2 * g.thickness;
      // Factored difference of circles also retains precision for thin walls.
      const A = Math.PI * g.thickness * (g.outerDiameter - g.thickness);
      const I = (A * (g.outerDiameter ** 2 + di ** 2)) / 16;
      return { A, Iy: I, Iz: I, J: 2 * I };
    }
    case "i": {
      const { width: b, height: h, flangeThickness: tf, webThickness: tw } = g;
      const hw = h - 2 * tf,
        d = h - tf;
      // CISC, Torsional Section Properties of Steel Shapes, eqs. 6 and 8:
      // d is the flange centre-line spacing in J. Areas use the clear web.
      return {
        A: 2 * b * tf + hw * tw,
        Iy: (b * tf ** 3) / 6 + (b * tf * d ** 2) / 2 + (tw * hw ** 3) / 12,
        Iz: (2 * tf * b ** 3 + hw * tw ** 3) / 12,
        J: (2 * b * tf ** 3 + d * tw ** 3) / 3,
      };
    }
  }
}

// Project-specific applicability limit for the open thin-wall approximation.
const minPlateAspect = 10;
export function geometryErrors(g: SectionGeometry) {
  const errors: Partial<Record<Dimension, string>> = {};
  const fields = dimensions(g);
  for (const { key, value } of fields)
    if (!Number.isFinite(value) || value <= 0)
      errors[key] = "Informe uma dimensão finita maior que zero.";
  if (Object.keys(errors).length) return errors;
  if (g.shape === "tube" && 2 * g.thickness >= g.outerDiameter)
    errors.thickness =
      "A espessura deve ser menor que metade do diâmetro externo.";
  if (g.shape === "i") {
    const hw = g.height - 2 * g.flangeThickness;
    if (hw <= 0)
      errors.flangeThickness =
        "A altura livre da alma (h − 2tf) deve ser positiva.";
    else if (g.flangeThickness > g.width / minPlateAspect)
      errors.flangeThickness =
        "A mesa deve atender a b/tf ≥ 10 para o cálculo de J.";
    if (g.webThickness >= g.width)
      errors.webThickness = "A alma deve ser mais estreita que as mesas.";
    else if (hw > 0 && g.webThickness > hw / minPlateAspect)
      errors.webThickness =
        "A alma deve atender a (h − 2tf)/tw ≥ 10 para o cálculo de J.";
  }
  if (
    !Object.keys(errors).length &&
    Object.values(sectionProperties(g)).some(
      (v) => !Number.isFinite(v) || v <= 0,
    )
  )
    errors[fields[0].key] =
      "As dimensões excedem o intervalo numérico de cálculo.";
  return errors;
}
