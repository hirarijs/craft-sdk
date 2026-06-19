import { runLaunchTest } from "./common.js";

export function runForgeTest(): Promise<number> {
  const loaderVersion = process.env.FORGE_LOADER_VERSION;
  return runLaunchTest({
    name: "forge",
    loader: "forge",
    ...(loaderVersion ? { loaderVersion } : {}),
  });
}
