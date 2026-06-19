import { runLaunchTest } from "./common.js";

export function runVanillaTest(): Promise<number> {
  return runLaunchTest({
    name: "vanilla",
    loader: "vanilla",
  });
}
