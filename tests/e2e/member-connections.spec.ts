import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  defaultEndConnection,
  parseProject,
  serializeProject,
  type EndConnection,
} from "../../src/domain/model";

test("edita, representa e salva ligações independentes nas pontas i/j", async ({
  page,
}) => {
  const project = beamExample();
  const connectionI: EndConnection = defaultEndConnection();
  connectionI.ry = { kind: "free" };
  const connectionJ: EndConnection = defaultEndConnection();
  connectionJ.ry = { kind: "elastic", stiffness: 2400 };
  project.members[0].connectionI = connectionI;
  project.members[0].connectionJ = connectionJ;

  await page.addInitScript(
    (source) => localStorage.setItem("kstruct.draft.v27", source),
    serializeProject(project),
  );
  await page.goto("/");
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();

  const iRotation = page.getByRole("combobox", { name: "Ligação i · Ry" });
  const jRotation = page.getByRole("combobox", { name: "Ligação j · Ry" });
  await expect(iRotation).toHaveValue("free");
  await expect(jRotation).toHaveValue("elastic");
  await expect(page.getByLabel("Rigidez j · Ry")).toHaveValue("2.4");
  for (const end of ["i", "j"] as const) {
    await expect(
      page.locator(
        `g.connection-release-marker[data-member-connection-end="${end}"]`,
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        `span.scene-connection-release[data-member-connection-end="${end}"]`,
      ),
    ).toBeVisible();
  }

  await iRotation.selectOption("elastic");
  const field = page.getByLabel("Rigidez i · Ry");
  await field.fill("4,2");
  await field.press("Enter");
  const saving = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const savedDownload = await saving;
  const saved = parseProject(
    await readFile((await savedDownload.path())!, "utf8"),
  );
  expect(saved.members[0].connectionI?.ry).toEqual({
    kind: "elastic",
    stiffness: 4200,
  });
  expect(saved.members[0].connectionJ?.ry).toEqual({
    kind: "elastic",
    stiffness: 2400,
  });
});
