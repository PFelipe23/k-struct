import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  createProject,
  parseProject,
  serializeProject,
} from "../../src/domain/model";
import { rollerAngle } from "../fixtures/inclined-beam";
import { runDeck } from "../fixtures/solve-oofem";

test("atribui rolete inclinado, confere os referenciais no CSV e recupera o apoio ao reabrir", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const original = beamExample();
  await page.addInitScript(
    (source) => localStorage.setItem("kstruct.draft.v11", source),
    serializeProject(original),
  );
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const node = page.locator(".explorer").getByRole("button", { name: /^N2/ });
  await node.click();
  const frame = page.getByRole("combobox", {
    name: "Referencial do apoio",
    exact: true,
  });
  await expect(frame).toHaveValue("global");
  await frame.selectOption("local");
  const angle = page.getByLabel("Ângulo da tangente (°)");
  await expect(angle).toHaveValue("0");
  await angle.fill(String(rollerAngle).replace(".", ","));
  await expect(
    page.getByRole("img", { name: "Prévia da tangente e da normal" }),
  ).toBeVisible();
  await button("Aplicar referencial").click();
  const glyph = page.getByRole("img", { name: "N2: apoio local, UZ" });
  await expect(glyph.locator("g")).toHaveAttribute(
    "transform",
    /rotate\(36\.869/,
  );
  await expect(
    page.getByRole("checkbox", { name: "Restringir uz local" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Restringir ux local" }),
  ).not.toBeChecked();
  await button("Desfazer").click();
  await node.click();
  await expect(angle).toHaveValue("0");
  await button("Refazer").click();
  await node.click();
  await expect(angle).toHaveValue(String(rollerAngle));

  const saving = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const path = (await (await saving).path())!;
  const saved = parseProject(await readFile(path, "utf8"));
  expect(saved.nodes[1].supportFrame).toEqual({
    kind: "planar",
    angle: rollerAngle,
  });
  expect(saved.loadPatterns).toEqual(original.loadPatterns);
  await page.locator("input[type=file]").setInputFiles(path);
  await node.click();
  await expect(angle).toHaveValue(String(rollerAngle));

  const solver = process.env.OOFEM_BIN;
  if (solver) {
    await page.exposeFunction("solveSupportDeck", (deck: string) =>
      runDeck(deck, solver),
    );
    await page.evaluate(() => {
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
            if (cmd !== "start_oofem") throw new Error(cmd);
            const output = await (
              window as unknown as {
                solveSupportDeck: (deck: string) => Promise<string>;
              }
            ).solveSupportDeck(args.deck);
            args.response.onmessage({
              output,
              log: {
                summary: {
                  ...args.runContext,
                  status: "completed",
                  message: "OOFEM concluído.",
                },
              },
              historyError: null,
            });
          },
        },
      });
    });
    await button("Análise").click();
    await button("Analisar").click();
    await expect(page.getByRole("status")).toContainText("Análise concluída");
    await button("Reações").click();
    const row = page
      .locator(".results-body tbody tr")
      .filter({ hasText: "N2" });
    await expect(
      row.getByRole("cell", { name: "22,5", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("cell", { name: "37,5", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "RX global (kN)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "RZ local (kN)" }),
    ).toBeVisible();
    await page.evaluate(() => Object.assign(window, { isTauri: false }));
    const downloading = page.waitForEvent("download");
    await button("CSV").click();
    const csv = await readFile((await (await downloading).path())!, "utf8");
    expect(csv).toContain('"RX global (kN)";"RZ global (kN)"');
    expect(csv).toContain('"RX local (kN)";"RZ local (kN)"');
    const [, fx, fz, , ft, fn] = csv
      .split("\n")
      .find((line) => line.startsWith('"N2";'))!
      .split(";");
    for (const [actual, expected] of [
      [fx, 22.5],
      [fz, 30],
      [ft, 0],
      [fn, 37.5],
    ] as const)
      expect(Number(actual)).toBeCloseTo(expected, 9);

    await angle.fill("0");
    await button("Aplicar referencial").click();
    await expect(
      page.getByText("Execute uma análise para consultar", { exact: false }),
    ).toBeVisible();
    await page.evaluate(() => Object.assign(window, { isTauri: true }));
    await button("Analisar").click();
    await expect(
      row.getByRole("cell", { name: "30", exact: true }),
    ).toHaveCount(2);
    await expect(
      row.getByRole("cell", { name: "37,5", exact: true }),
    ).toHaveCount(0);
  }
});

test("mostra a base espacial corrigida e rejeita duas direções colineares", async ({
  page,
}) => {
  const model = createProject("spatial");
  model.nodes.push(beamExample().nodes[0]);
  await page.addInitScript(
    (source) => localStorage.setItem("kstruct.draft.v11", source),
    serializeProject(model),
  );
  await page.goto("/");
  await page.locator(".explorer").getByRole("button", { name: /^N1/ }).click();
  await page.getByLabel("Referencial do apoio").selectOption("local");
  const button = page.getByRole("button", { name: "Aplicar referencial" });
  await page.getByLabel("y local · Y").fill("0");
  await expect(page.getByRole("alert")).toContainText("não nulas");
  await page.getByLabel("y local · X").fill("1");
  await expect(page.getByRole("alert")).toContainText("colineares");
  await expect(button).toBeDisabled();
  await page.getByLabel("y local · Z").fill("1");
  await expect(page.getByLabel("Prévia da base nodal")).toContainText(
    "(0 / -1 / 0)",
  );
  await button.click();
  await expect(button).toBeDisabled();
});
