import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const stage = fileURLToPath(new URL("./stage-oofem.mjs", import.meta.url));
const tauri = fileURLToPath(
  new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
);

execFileSync(process.execPath, [stage], { cwd: root, stdio: "inherit" });
execFileSync(
  process.execPath,
  [
    tauri,
    "build",
    "--config",
    "src-tauri/tauri.distribution.conf.json",
    ...process.argv.slice(2),
    "--",
    "--locked",
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);
