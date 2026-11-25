import { test, expect, type Page } from "@playwright/test";

async function svgCoords(page: Page, kind: "XZ" | "XY", u: number, v: number) {
  const svg = page.getByRole("application", {
    name: `Área de lançamento ${kind}`,
  });
  const pos = await svg.evaluate(
    (el, { u, v }) => {
      const lines = Array.from(
        el.querySelectorAll<SVGLineElement>(".grid line"),
      );
      // Determine x(u) and y(v) using any two vertical and two horizontal grid lines
      const verticals = lines
        .filter((l) => l.getAttribute("x1") === l.getAttribute("x2"))
        .map((l) => ({
          px: Number(l.getAttribute("x1")),
          val: Number(l.parentElement?.querySelector("text")?.textContent),
        }))
        .filter((item) => Number.isFinite(item.val));
      const horizontals = lines
        .filter((l) => l.getAttribute("y1") === l.getAttribute("y2"))
        .map((l) => ({
          px: Number(l.getAttribute("y1")),
          val: Number(l.parentElement?.querySelector("text")?.textContent),
        }))
        .filter((item) => Number.isFinite(item.val));
      const v0 = verticals[0];
      const v1 = verticals[verticals.length - 1];
      const h0 = horizontals[0];
      const h1 = horizontals[horizontals.length - 1];
      const scaleU = (v1.px - v0.px) / (v1.val - v0.val);
      const scaleV = (h1.px - h0.px) / (h1.val - h0.val);
      return {
        x: v0.px + (u - v0.val) * scaleU,
        y: h0.px + (v - h0.val) * scaleV,
      };
    },
    { u, v },
  );
  return { svg, pos };
}

test("captura ponto médio e pé da perpendicular no plano XZ", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page.getByRole("button", { name: "Barra B", exact: true }).click();
  const deltaX = page.getByLabel("ΔX (m)");
  const deltaZ = page.getByLabel("ΔZ (m)");
  // Barra de (0, 0) até (4, 0): ponto médio em (2, 0), dentro da área visível
  await deltaX.fill("0");
  await deltaZ.fill("0");
  await deltaZ.press("Enter");
  await deltaX.fill("4");
  await deltaZ.fill("0");
  await deltaZ.press("Enter");
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");

  // Capturar ponto médio em (2, 0) com o mouse e confirmar início do montante
  const midTarget = await svgCoords(page, "XZ", 2.04, 0.04);
  await midTarget.svg.hover({ position: midTarget.pos });
  const indicator = midTarget.svg.locator(".snap-indicator");
  await expect(indicator).toHaveAttribute("data-snap-kind", "midpoint");
  await expect(indicator).toContainText("Ponto médio (B1)");
  await midTarget.svg.click({ position: midTarget.pos });

  await deltaX.fill("0");
  await deltaZ.fill("3");
  await deltaZ.press("Enter");
  await expect(page.locator(".model-count")).toHaveText("4 nós · 2 barras");

  // Iniciar em (1, 3) e capturar pé da perpendicular em (1, 0)
  await deltaX.fill("1");
  await deltaZ.fill("3");
  await deltaZ.press("Enter");
  const perpTarget = await svgCoords(page, "XZ", 1.04, 0.04);
  await perpTarget.svg.hover({ position: perpTarget.pos });
  await expect(indicator).toHaveAttribute("data-snap-kind", "perpendicular");
  await expect(indicator).toContainText("Perpendicular (B1)");
  await expect(indicator).toContainText("3,00 m");
  await perpTarget.svg.click({ position: perpTarget.pos });
  await expect(page.locator(".model-count")).toHaveText("6 nós · 3 barras");

  // Projeção fora do segmento a partir de (5, 3) não deve oferecer perpendicular
  await deltaX.fill("5");
  await deltaZ.fill("3");
  await deltaZ.press("Enter");
  const outsideTarget = await svgCoords(page, "XZ", 5.04, 0.04);
  await outsideTarget.svg.hover({ position: outsideTarget.pos });
  await expect(indicator).not.toHaveAttribute(
    "data-snap-kind",
    "perpendicular",
  );
  await outsideTarget.svg.press("Escape");

  await page.getByRole("button", { name: "Selecionar V", exact: true }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "N3", exact: true })
    .click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Z", { exact: true })).toHaveValue("0");
  await page
    .locator(".explorer")
    .getByRole("button", { name: "N6", exact: true })
    .click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Z", { exact: true })).toHaveValue("0");
  expect(errors).toEqual([]);
});

test("coordenadas relativas após zoom e pan e cancelamento de entrada incompleta", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page.getByRole("button", { name: "Barra B", exact: true }).click();
  const deltaX = page.getByLabel("ΔX (m)");
  const deltaZ = page.getByLabel("ΔZ (m)");
  await deltaX.fill("1");
  await deltaZ.fill("2");
  await deltaZ.press("Enter");

  // Zoom e pan antes de informar o incremento relativo
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  const svg = page.getByRole("application", { name: "Área de lançamento XZ" });
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 - 30,
  );
  await page.mouse.up({ button: "middle" });

  // Entrada incompleta + Esc não altera o modelo
  await deltaX.fill("3,25");
  await deltaX.press("Enter");
  await expect(page.locator(".relative-error")).toBeVisible();
  await deltaX.press("Escape");
  await expect(deltaX).toHaveValue("");
  await expect(deltaZ).toHaveValue("");
  await expect(page.locator(".model-count")).toHaveText("0 nós · 0 barras");

  // Entrada completa com vírgula e ponto
  await deltaX.fill("3,25");
  await deltaZ.fill("-0.5");
  await deltaZ.press("Enter");
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");

  await page.getByRole("button", { name: /^Selecionar/ }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "N2", exact: true })
    .click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("4.25");
  await expect(page.getByLabel("Z", { exact: true })).toHaveValue("1.5");
  expect(errors).toEqual([]);
});

test("captura em modelo espacial XYZ escolhe apenas referências do pavimento ativo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page.getByRole("button", { name: "Novo pórtico espacial" }).click();
  await page.getByRole("button", { name: "Barra B", exact: true }).click();

  const deltaX = page.getByLabel("ΔX (m)");
  const deltaY = page.getByLabel("ΔY (m)");
  // Barra na base (z = 0): (0,0,0) -> (6,0,0)
  await deltaX.fill("0");
  await deltaY.fill("0");
  await deltaY.press("Enter");
  await deltaX.fill("6");
  await deltaY.fill("0");
  await deltaY.press("Enter");

  // Troca para Pav. 1 (z = 3) e lança barra (0,2,3) -> (6,2,3)
  await page.getByLabel("Pavimento ativo").selectOption("level1");
  await deltaX.fill("0");
  await deltaY.fill("2");
  await deltaY.press("Enter");
  await deltaX.fill("6");
  await deltaY.fill("0");
  await deltaY.press("Enter");
  await expect(page.locator(".model-count")).toHaveText("4 nós · 2 barras");

  // No pavimento z = 3, passar sobre (3, 0) não deve capturar ponto médio da barra de z = 0
  const lowerProj = await svgCoords(page, "XY", 3.04, 0.04);
  await lowerProj.svg.hover({ position: lowerProj.pos });
  const indicator = lowerProj.svg.locator(".snap-indicator");
  await expect(indicator).not.toHaveAttribute("data-snap-kind", "midpoint");

  // Passar sobre (3, 2) captura o ponto médio da barra no pavimento ativo z = 3
  const upperMid = await svgCoords(page, "XY", 3.04, 2.04);
  await upperMid.svg.hover({ position: upperMid.pos });
  await expect(indicator).toHaveAttribute("data-snap-kind", "midpoint");
  await expect(indicator).toContainText("Ponto médio (B2)");
  await upperMid.svg.click({ position: upperMid.pos });
  await deltaX.fill("0");
  await deltaY.fill("2");
  await deltaY.press("Enter");
  await expect(page.locator(".model-count")).toHaveText("6 nós · 3 barras");

  await page.getByRole("button", { name: "Selecionar V", exact: true }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "N5", exact: true })
    .click();
  await expect(page.getByLabel("Z", { exact: true })).toHaveValue("3");
  expect(errors).toEqual([]);
});

test("o lançamento relativo usa a mesma unidade da tabela de nós e da prévia TSV", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("kstruct.units", JSON.stringify({ length: "cm" })),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Barra B", exact: true }).click();
  const dx = page.getByLabel("ΔX (cm)", { exact: true });
  const dz = page.getByLabel("ΔZ (cm)", { exact: true });
  await dx.fill("0");
  await dz.fill("0");
  await dz.press("Enter");
  await dx.fill("350,5");
  await dz.fill("0");
  await dz.press("Enter");
  await page
    .getByRole("button", { name: "Tabela de nós", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Tabela de nós" });
  await expect(dialog.getByLabel("X de N2")).toHaveValue("350.5");
  await dialog.getByRole("tab", { name: "Colar planilha (TSV)" }).click();
  await expect(dialog.getByLabel("Unidade das coordenadas")).toHaveValue("cm");
  await dialog.getByLabel("Colar nós (TSV)").fill("C\tC\t400\t0");
  await expect(
    dialog.getByRole("table", { name: "Prévia de nós" }),
  ).toContainText("400,00");
});
