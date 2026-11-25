import { expect, test, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  free,
  parseProject,
  serializeProject,
} from "../../src/domain/model";
import { exportOofem } from "../../src/solver/oofem";
import { runDeck } from "../fixtures/solve-oofem";

test("exibe i/j e a tríade nas duas vistas, inverte e grava a conectividade", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const project = beamExample();
  project.mode = "spatial";
  project.nodes[0].restraints = {
    ux: true,
    uy: true,
    uz: true,
    rx: true,
    ry: true,
    rz: true,
  };
  project.nodes[1].restraints = free();
  project.nodes[1].y = 2;
  project.members[0].roll = 27;
  Object.assign(project.loadPatterns[0].uniform[0], { qx: 1000, qy: -1000 });
  await page.addInitScript(
    (source) => localStorage.setItem("kstruct.draft.v10", source),
    serializeProject(project),
  );
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const member = page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true });
  const plan = page.getByRole("region", { name: "Planta XY", exact: true });
  const perspective = page.getByRole("region", {
    name: "Perspectiva 3D",
    exact: true,
  });
  const triad = (direction: string) =>
    plan.getByRole("img", { name: `Eixos locais de B1: ${direction}` });
  const inverted = () => expect(triad("i N2, j N1")).toBeVisible();
  const roll = page.getByRole("textbox", {
    name: "Rotação em torno de x local",
  });
  const load = page.getByLabel("Projeção local da carga distribuída");

  await member.click();
  await button("Exibição").click();
  await expect(triad("i N1, j N2")).toHaveCount(0);
  await button("Eixos locais").click();
  await expect(button("Eixos locais")).toHaveAttribute("aria-pressed", "true");
  await expect(button("Desfazer")).toBeDisabled();
  await expect(
    triad("i N1, j N2").getByText("i", { exact: true }),
  ).toBeVisible();
  await expect(
    triad("i N1, j N2").getByText("j", { exact: true }),
  ).toBeVisible();
  for (const axis of ["x", "y", "z"])
    await expect(
      perspective.getByLabel(`Eixo local ${axis} de B1`),
    ).toBeVisible();
  await expect(perspective.getByLabel("B1: i N1")).toBeVisible();
  await expect(load).toContainText("0,63246 kN/m");

  if (process.env.OOFEM_BIN) {
    const { deck } = exportOofem(project, "EL");
    const output = runDeck(deck, process.env.OOFEM_BIN);
    await page.evaluate(
      ({ deck, output }) => {
        let callback = 0;
        Object.assign(window, {
          isTauri: true,
          __TAURI_INTERNALS__: {
            transformCallback: () => ++callback,
            invoke: async (
              cmd: string,
              args: {
                deck: string;
                runContext: Record<string, string>;
                response: { onmessage: (payload: unknown) => void };
              },
            ) => {
              if (cmd !== "start_oofem" || args.deck !== deck)
                throw new Error("Entrada OOFEM divergente.");
              args.response.onmessage({
                output,
                log: {
                  summary: {
                    ...args.runContext,
                    status: "completed",
                    message: "OOFEM concluído.",
                  },
                  historyError: null,
                },
              });
            },
          },
        });
      },
      { deck, output },
    );
    await button("Análise").click();
    await button("Analisar").click();
    await expect(page.getByRole("status")).toContainText("Análise concluída");
    await page.evaluate(() => Object.assign(window, { isTauri: false }));
    await page.getByLabel("Visualização dos resultados").selectOption("n");
    await expect(
      plan.getByRole("img", { name: /B1, i, N .* kN/ }),
    ).toBeVisible();
    await expect(
      plan.getByRole("img", { name: /B1, j, N .* kN/ }),
    ).toContainText(/j · .+ kN/);
    await button("Exibição").click();
    await button("Eixos locais").click();
    await expect(page.getByRole("status")).toContainText("Análise concluída");
    await button("Eixos locais").click();
  }

  await button("Inverter i/j").click();
  await inverted();
  await expect(perspective.getByLabel("B1: i N2")).toBeVisible();
  await expect(perspective.getByLabel("B1: i N1")).toHaveCount(0);
  await expect(roll).toHaveValue("-27");
  await expect(load).toContainText("-0,63246 kN/m");
  await expect(page.getByRole("status")).toContainText("Modelo em edição");
  await button("Desfazer").click();
  await expect(triad("i N1, j N2")).toBeVisible();
  await button("Refazer").click();
  await inverted();
  await member.click();
  await expect(roll).toHaveValue("-27");
  await roll.fill("90");
  await roll.press("Enter");
  await inverted();
  await expect(roll).toHaveValue("90");
  await button("Desfazer").click();
  await member.click();
  await expect(roll).toHaveValue("-27");

  const saving = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const path = (await (await saving).path())!;
  const saved = parseProject(await readFile(path, "utf8"));
  expect(saved.members).toEqual([
    { ...project.members[0], start: "B", end: "A", roll: -27 },
  ]);
  expect(saved.loadPatterns).toEqual(project.loadPatterns);
  await page.locator("input[type=file]").setInputFiles(path);
  await member.click();
  await inverted();
  await expect(roll).toHaveValue("-27");
});

test("separa as marcas i e j de duas barras que compartilham o mesmo nó", async ({
  page,
}) => {
  const p = beamExample();
  p.mode = "spatial";
  p.nodes.push({
    ...p.nodes[1],
    id: "C",
    name: "N3",
    x: 12,
    restraints: free(),
  });
  p.members.push({
    ...p.members[0],
    id: "V2",
    name: "B2",
    start: "B",
    end: "C",
  });
  await page.addInitScript(
    (source) => localStorage.setItem("kstruct.draft.v10", source),
    serializeProject(p),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Exibição", exact: true }).click();
  await page.getByRole("button", { name: "Eixos locais", exact: true }).click();
  const plan = page.getByRole("region", { name: "Planta XY", exact: true });
  const space = page.getByRole("region", {
    name: "Perspectiva 3D",
    exact: true,
  });
  const planJoint = (member: string, end: string) =>
    plan
      .getByRole("img", { name: new RegExp(`Eixos locais de ${member}:`) })
      .getByText(end, { exact: true });
  async function checkJoint(a: Locator, b: Locator) {
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    await expect
      .poll(async () => {
        const [ra, rb] = await Promise.all([a.boundingBox(), b.boundingBox()]);
        if (!ra || !rb) return false;
        return (
          ra.x + ra.width <= rb.x ||
          rb.x + rb.width <= ra.x ||
          ra.y + ra.height <= rb.y ||
          rb.y + rb.height <= ra.y
        );
      })
      .toBe(true);
  }
  await checkJoint(planJoint("B1", "j"), planJoint("B2", "i"));
  await checkJoint(space.getByLabel("B1: j N2"), space.getByLabel("B2: i N2"));
});
