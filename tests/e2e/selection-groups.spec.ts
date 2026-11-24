import { expect, test, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addMember } from "../../src/domain/editing";
import {
  createProject,
  parseProject,
  serializeProject,
} from "../../src/domain/model";

const button = (root: Page | Locator, name: string) =>
  root.getByRole("button", { name, exact: true });
function example() {
  const p = createProject("spatial");
  p.sections.push({ ...p.sections[0], id: "other", name: "Seção secundária" });
  p.materials.push({
    ...p.materials[0],
    id: "other-material",
    name: "Outro material",
  });
  p.sections[1].materialId = "other-material";
  const point = (x: number, y: number, z = 3) => ({ x, y, z });
  const inner = addMember(p, point(1, 0), point(3, 0));
  const crossing = addMember(p, point(-2, 1.5), point(6, 1.5));
  crossing.sectionId = "other";
  addMember(p, point(1, 0, 6), point(3, 0, 6));
  addMember(p, point(7, 0, 0), point(7, 0));
  return { p, inner, crossing };
}
async function point(svg: Locator, x: number, y: number) {
  return svg.evaluate(
    (s, { x, y }) => {
      const guide = (axis: string, value: number) =>
        Number(
          s
            .querySelector(
              `line[data-axis="${axis}"][data-position="${value}"]`,
            )!
            .getAttribute(axis + "1"),
        );
      const rect = s.getBoundingClientRect();
      return {
        x:
          rect.left + guide("x", 0) + (x * (guide("x", 4) - guide("x", 0))) / 4,
        y: rect.top + guide("y", 0) + (y * (guide("y", 4) - guide("y", 0))) / 4,
      };
    },
    { x, y },
  );
}
async function openModel(page: Page, buffer: Buffer) {
  await page.locator("input[type=file]").setInputFiles({
    name: "selecao.kstruct.json",
    mimeType: "application/json",
    buffer,
  });
}
test("janela, cruzamento, Ctrl e cancelamento preservam a seleção compartilhada", async ({
  page,
}) => {
  const { p, inner, crossing } = example();
  await page.goto("/");
  await openModel(page, Buffer.from(serializeProject(p)));
  await page.getByLabel("Pavimento ativo").selectOption("level1");
  const svg = page.getByRole("application", { name: "Área de lançamento XY" });
  await button(page, "Enquadrar modelo").click();
  const left = await point(svg, 0, -0.5),
    right = await point(svg, 4, 2.2);
  const tree = page.locator(".explorer");
  const bar = (name: string) => button(tree, name);
  async function drag(
    a: typeof left,
    b: typeof left,
    label: string,
    cancel = false,
  ) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await expect(svg.locator(".selection-window")).toHaveAttribute(
      "aria-label",
      label,
    );
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(svg.locator(".selection-window")).toHaveCount(0);
  }
  await drag(left, right, "Janela de contenção");
  await expect(bar(inner.name)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(crossing.name)).toHaveAttribute("aria-pressed", "false");
  await drag(right, left, "Cruzamento", true);
  await expect(bar(inner.name)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(crossing.name)).toHaveAttribute("aria-pressed", "false");
  await drag(right, left, "Cruzamento");
  await expect(bar(crossing.name)).toHaveAttribute("aria-pressed", "true");
  await expect(bar("B3")).toHaveAttribute("aria-pressed", "false");
  await bar("B3").click();
  await page.keyboard.down("Control");
  await drag(left, right, "Janela de contenção");
  await page.keyboard.up("Control");
  await expect(bar("B3")).toHaveAttribute("aria-pressed", "true");
  await expect(bar(inner.name)).toHaveAttribute("aria-pressed", "true");
  const guide = svg.locator('line[data-axis="x"][data-position="0"]');
  const x = await guide.getAttribute("x1");
  await page.mouse.move(right.x, right.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(right.x + 20, right.y - 10, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await expect(guide).not.toHaveAttribute("x1", x!);
  await expect(bar(inner.name)).toHaveAttribute("aria-pressed", "true");
  await expect(bar("B3")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Desfazer")).toBeDisabled();
});

test("filtra, salva, renomeia e recupera um grupo nas vistas após reabrir e usar o histórico", async ({
  page,
}) => {
  const { p, inner } = example();
  await page.goto("/");
  await openModel(page, Buffer.from(serializeProject(p)));
  await button(page, "Exibição").click();
  await page.getByLabel("Arranjo de vistas").selectOption("triple");
  await page.getByLabel("Pavimento ativo").selectOption("level1");
  const dialog = page.getByRole("dialog", { name: "Seleção e grupos" });
  const open = () => button(page, "Seleção e grupos").click();
  await open();
  await dialog
    .getByRole("combobox", { name: "Tipo de objeto", exact: true })
    .selectOption("member");
  await dialog
    .getByRole("combobox", { name: "Material", exact: true })
    .selectOption("steel");
  await dialog
    .getByRole("combobox", { name: "Seção", exact: true })
    .selectOption("rect");
  await dialog
    .getByRole("combobox", { name: "Pavimento", exact: true })
    .selectOption("level1");
  await expect(dialog).toContainText(
    "1 objeto encontrado · 1 na seleção após aplicar",
  );
  await button(dialog, "Aplicar critérios").click();
  await dialog.getByLabel("Nome do grupo").fill("Pavimento");
  await button(dialog, "Salvar seleção como grupo").click();
  await dialog.getByLabel("Nome do grupo").fill("Vigas de borda");
  await button(dialog, "Renomear grupo").click();
  await button(dialog, "Recuperar grupo").click();
  for (const view of ["Planta XY", "Elevação XZ"]) {
    const selected = page
      .getByRole("region", { name: view, exact: true })
      .locator(`[data-member-id="${inner.id}"]`);
    await expect(selected).toHaveAttribute(
      "stroke",
      "var(--geometry-selected)",
    );
  }
  await page.getByLabel("Nome da barra").fill("Viga norte");
  await page.getByLabel("Nome da barra").press("Enter");
  const download = page.waitForEvent("download");
  await button(page, "Salvar projeto").click();
  const bytes = await readFile((await (await download).path())!);
  const stored = parseProject(bytes.toString("utf8"));
  expect(stored.selectionGroups[0]).toMatchObject({
    name: "Vigas de borda",
    objects: [{ kind: "member", id: inner.id }],
  });
  await openModel(page, bytes);
  await open();
  await button(dialog, "Recuperar grupo").click();
  await expect(
    page.getByRole("heading", { name: "Viga norte", exact: true }),
  ).toBeVisible();
  await expect(button(page.locator(".explorer"), "Viga norte")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(button(page, "Desfazer")).toBeDisabled();
  await button(page, "Modelo").click();
  await button(page, "Excluir").click();
  async function count(n: number) {
    await open();
    await expect(
      dialog
        .getByRole("combobox", { name: "Grupo salvo", exact: true })
        .locator("option:checked"),
    ).toHaveText(`Vigas de borda (${n})`);
    await button(dialog, "Fechar").click();
  }
  await count(0);
  await button(page, "Desfazer").click();
  await count(1);
  await button(page, "Refazer").click();
  await count(0);
  await open();
  await button(dialog, "Excluir grupo").click();
  await expect(
    dialog
      .getByRole("combobox", { name: "Grupo salvo", exact: true })
      .locator("option"),
  ).toHaveCount(1);
});
