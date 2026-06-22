import { runFabricTest } from "./fabric.js";
import { runForgeTest } from "./forge.js";
import type { TestName } from "./common.js";
import { runVanillaTest } from "./vanilla.js";

const tests = {
  vanilla: runVanillaTest,
  fabric: runFabricTest,
  forge: runForgeTest,
} satisfies Record<TestName, () => Promise<number>>;

function printUsage(): void {
  console.log("Usage: yarn test [vanilla|fabric|forge|all]");
  console.log("");
  console.log("Environment overrides:");
  console.log("  MC_VERSION=1.20.1          Minecraft version");
  console.log("  MC_GAME_DIR=.minecraft     Base install directory");
  console.log("  MC_RUNTIME_DIR=            Runtime dir (saves, config, etc.)");
  console.log("  MC_ASSETS_DIR=             Assets directory");
  console.log("  MC_LIBRARIES_DIR=          Libraries directory");
  console.log("  MC_VERSIONS_DIR=           Versions directory");
  console.log("  MC_MODS_DIR=               Mods directory");
  console.log("  FABRIC_LOADER_VERSION=0.16.14");
  console.log("  FORGE_LOADER_VERSION=47.4.0 or 1.20.1-47.4.0");
}

async function runSelectedTests(): Promise<number> {
  const selected = process.argv[2] ?? "vanilla";
  if (selected === "--help" || selected === "-h") {
    printUsage();
    return 0;
  }

  if (selected === "all") {
    for (const runTest of Object.values(tests)) {
      const exitCode = await runTest();
      if (exitCode !== 0) {
        return exitCode;
      }
    }
    return 0;
  }

  if (!isTestName(selected)) {
    console.error(`Unknown test target: ${selected}`);
    printUsage();
    return 1;
  }

  return tests[selected]();
}

function isTestName(value: string): value is TestName {
  return value === "vanilla" || value === "fabric" || value === "forge";
}

runSelectedTests()
  .then((exitCode) => process.exit(exitCode))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
