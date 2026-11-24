import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { spatialBenchmark } from "../fixtures/spatial-benchmark";

const button = (panel: Page | Locator, name: string) =>
  panel.getByRole("button", { name, exact: true });

async function gridPoint(svg: Locator, x: number, y: number) {
  return svg.evaluate(
    (el, { x, y }) => {
      const axis = (name: string, v: number) =>
        Number(
          el
            .querySelector(`line[data-axis="${name}"][data-position="${v}"]`)!
            .getAttribute(name + "1"),
        );
      return { x: axis("x", x), y: axis("y", y) };
    },
    { x, y },
  );
}

test("planta, elevação e perspectiva mantêm câmera, camadas e seleção", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const model = spatialBenchmark();
  model.name = "Pórtico espacial de dois pavimentos";
  model.guides.x[1].position = 4.5;
  model.guides.y[1].position = 3.5;
  model.guides.z[1].position = 2.8;
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "portico.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(model)),
  });
  await button(page, "Exibição").click();
  const layout = page.getByLabel("Arranjo de vistas");
  await layout.selectOption("triple");
  const plan = page.getByRole("region", { name: "Planta XY", exact: true });
  const elevation = page.getByRole("region", {
    name: "Elevação XZ",
    exact: true,
  });
  const perspective = page.getByRole("region", {
    name: "Perspectiva 3D",
    exact: true,
  });
  const canvas = perspective.locator("canvas");
  const svg = plan.getByRole("application");
  await page.getByLabel("Pavimento ativo").selectOption("level2");
  await expect(page.getByLabel("Vista ativa")).toHaveText(
    "Planta XY · Z = 6 m",
  );
  for (const panel of [plan, elevation, perspective])
    for (const control of await panel.getByRole("button").all())
      await expect(control).toBeInViewport({ ratio: 1 });
  await button(elevation, "Enquadrar modelo").click();
  await button(plan, "Enquadrar modelo").click();
  const member = (panel: Locator) => panel.locator('line[data-member-id="B3"]');
  const before = await member(elevation).getAttribute("x2");
  const beforePlan = await member(plan).getAttribute("x2");
  await button(plan, "Aumentar zoom").click();
  await expect(member(plan)).not.toHaveAttribute("x2", beforePlan!);
  await button(plan, "Nomes dos objetos").click();
  await button(plan, "Grelha").click();
  await expect(plan.locator(".member-label")).toHaveCount(0);
  await expect(elevation.locator(".member-label").first()).toBeVisible();
  await expect(elevation.locator(".grid")).toHaveCSS("visibility", "visible");
  await expect(plan.locator(".grid")).toHaveCSS("visibility", "hidden");
  await button(plan, "Cargas").click();
  await expect(plan.locator(".load-shape")).toHaveCount(0);
  await button(perspective, "Nomes dos objetos").click();
  await button(perspective, "Cargas").click();
  await expect(
    perspective.locator(".scene-label").filter({ hasText: "FY 12 kN" }),
  ).toHaveCount(1);
  const eye = await canvas.screenshot();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.4,
    bounds.y + bounds.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.55,
    bounds.y + bounds.height * 0.52,
    { steps: 5 },
  );
  await page.mouse.up();
  expect((await canvas.screenshot()).equals(eye)).toBe(false);
  await expect(member(elevation)).toHaveAttribute("x2", before!);
  const center = await member(plan).evaluate((el) => {
    const line = el as SVGLineElement;
    return {
      x: (line.x1.baseVal.value + line.x2.baseVal.value) / 2,
      y: line.y1.baseVal.value,
    };
  });
  await svg.click({ position: center });
  await expect(button(page.locator(".explorer"), "B3")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "B3", exact: true }),
  ).toBeVisible();
  await expect(member(elevation)).toHaveAttribute(
    "stroke",
    "var(--geometry-selected)",
  );
  await expect(perspective.locator(".scene-label.selected")).toHaveText("B3");
  await expect(button(page, "Desfazer")).toBeDisabled();
  // Capture the real editor with a shared selection for the PR and the user guide.
  await page.setViewportSize({ width: 1440, height: 900 });
  await button(perspective, "Enquadrar vista 3D").click();
  await button(elevation, "Enquadrar modelo").click();
  await button(plan, "Enquadrar modelo").click();
  await button(plan, "Grelha").click();
  await button(plan, "Nomes dos objetos").click();
  await button(perspective, "Cargas").click();
  await plan.focus();
  await page.mouse.move(2, 2);
  await button(perspective, "Nomes dos objetos").click();
  await button(perspective, "Aproximar perspectiva").click();
  await button(perspective, "Aproximar perspectiva").click();
  await page.locator(".explorer summary").filter({hasText: /^Nós/}).click();
  await button(page.locator(".explorer"), "B3").scrollIntoViewIfNeeded();
  await plan.focus();
  await page.screenshot({ path: info.outputPath("ks09-tres-vistas.png") });
  await button(perspective, "Nomes dos objetos").click();
  await layout.selectOption("planes");
  await expect(canvas).toHaveCount(0);
  await layout.selectOption("triple");
  await expect(canvas).toBeVisible();
  await expect(perspective.locator(".scene-label.selected")).toHaveText("B3");
  await button(page, "Modelo").click();
  await svg.focus();
  await page.keyboard.press("b");
  const click = async (x: number, y: number) =>
    svg.click({ position: await gridPoint(svg, x, y) });
  await click(0, 0);
  await elevation.focus();
  await plan.focus();
  await click(8, 0);
  await expect(page.locator(".model-count")).toHaveText("9 nós · 11 barras");
  await click(8, 8);
  await expect(page.locator(".model-count")).toHaveText("11 nós · 12 barras");
  const file = page.waitForEvent("download");
  await button(page, "Salvar projeto").click();
  const saved = parseProject(
    await readFile((await (await file).path())!, "utf8"),
  );
  const bar = saved.members.at(-1)!;
  expect(
    [bar.start, bar.end].map((id) => {
      const { x, y, z } = saved.nodes.find((n) => n.id === id)!;
      return [x, y, z];
    }),
  ).toEqual([
    [8, 0, 6],
    [8, 8, 6],
  ]);
});

test("projeto plano oferece XZ com ou sem a perspectiva", async ({ page }) => {
  await page.goto("/");
  await button(page, "Exibição").click();
  const layout = page.getByLabel("Arranjo de vistas");
  await expect(layout.locator("option")).toHaveCount(2);
  await layout.selectOption("single");
  await expect(
    page.getByRole("application", { name: "Área de lançamento XZ" }),
  ).toBeVisible();
  await expect(page.locator(".spatial")).toHaveCount(0);
  await layout.selectOption("dual");
  await expect(page.locator(".spatial canvas")).toBeVisible();
});
