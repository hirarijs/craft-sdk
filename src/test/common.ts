import { CraftSDK, API_SOURCE } from "../index.js";
import { findJavaExecutable } from "../platform/java.js";
import type { PlayGameOptions } from "../sdk.js";

export type TestName = "vanilla" | "fabric" | "forge";

export interface LaunchTestConfig {
  name: TestName;
  loader: NonNullable<PlayGameOptions["loader"]>;
  loaderVersion?: string;
}

const DEFAULT_VERSION = "1.20.1";
const DEFAULT_GAME_DIRECTORY = ".minecraft";

function getVersion(): string {
  return process.env.MC_VERSION ?? DEFAULT_VERSION;
}

function getGameDirectory(): string {
  return process.env.MC_GAME_DIR ?? DEFAULT_GAME_DIRECTORY;
}

function getPlayerName(): string {
  return process.env.MC_PROFILE_NAME ?? "TestPlayer";
}

function buildAuthOptions() {
  return {
    accessToken: process.env.MC_ACCESS_TOKEN ?? "test-access-token-12345",
    clientToken: process.env.MC_CLIENT_TOKEN ?? "test-client-token-12345",
    profileId: process.env.MC_PROFILE_ID ?? "test-profile-id-12345",
    profileName: getPlayerName(),
  };
}

export async function runLaunchTest(config: LaunchTestConfig): Promise<number> {
  console.log(`Craft SDK test: ${config.name}`);
  console.log(`Minecraft version: ${getVersion()}`);
  console.log(`Game directory: ${getGameDirectory()}`);

  const javaPath = findJavaExecutable();
  if (!javaPath) {
    throw new Error("Java executable not found. Install Java and make it available on PATH.");
  }
  console.log(`Java: ${javaPath}`);

  const sdk = new CraftSDK({
    apiSource: API_SOURCE.BMCLAPI,
    sessionFile: "./craft-sdk-session.json",
    timeoutMs: 120000,
  });

  const auth = buildAuthOptions();
  await sdk.auth.loginWithToken(auth.accessToken, auth.clientToken, auth.profileId, auth.profileName);

  const options: PlayGameOptions = {
    version: getVersion(),
    gameDirectory: getGameDirectory(),
    javaPath,
    loader: config.loader,
    memory: { min: "512M", max: "2G" },
    jvmArgs: ["-XX:+UseG1GC", "-XX:+UnlockExperimentalVMOptions"],
    ...auth,
  };
  if (config.loaderVersion) {
    options.loaderVersion = config.loaderVersion;
  }

  const exitCode = await sdk.playGame(options);
  console.log(`Game exited with code: ${exitCode}`);
  return exitCode;
}
