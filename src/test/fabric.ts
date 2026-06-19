import { runLaunchTest } from "./common.js";

export function runFabricTest(): Promise<number> {
  const loaderVersion = process.env.FABRIC_LOADER_VERSION;
  return runLaunchTest({
    name: "fabric",
    loader: "fabric",
    ...(loaderVersion ? { loaderVersion } : {}),
  });
}
