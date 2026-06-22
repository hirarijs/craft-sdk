import { CraftSDK, API_SOURCE } from "../index.js";
import { findJavaExecutable } from "../platform/java.js";
import type { GameLoaderType, InstallGameOptions, LaunchGameOptions } from "../sdk.js";
import type { DownloadProgress } from "../utils/downloader.js";
import path from "path";
import cliProgress from "cli-progress";

export type TestName = "vanilla" | "fabric" | "forge";

export interface LaunchTestConfig {
  name: TestName;
  loader: GameLoaderType;
  loaderVersion?: string;
}

const DEFAULT_VERSION = "1.20.1";
const DEFAULT_GAME_DIRECTORY = ".minecraft";

// 进度条管理类
class ProgressBarManager {
  private bars: Map<string, cliProgress.SingleBar> = new Map();
  private multiBar: cliProgress.MultiBar;

  constructor() {
    this.multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: "{filename} | {bar} | {percentage}% | {value}/{total} bytes",
        barCompleteChar: "█",
        barIncompleteChar: "░",
      },
      cliProgress.Presets.shades_grey
    );
  }

  handleProgress(progress: DownloadProgress): void {
    const key = progress.filePath;
    const total = progress.totalBytes ?? 0;

    if (!this.bars.has(key)) {
      const filename = path.basename(progress.filePath);
      const bar = this.multiBar.create(total > 0 ? total : 100, 0, {
        filename: filename.length > 30 ? filename.substring(0, 27) + "..." : filename,
      });
      this.bars.set(key, bar);
    }

    const bar = this.bars.get(key)!;
    bar.update(progress.downloadedBytes, {
      filename: path.basename(progress.filePath),
    });
  }

  stop(): void {
    this.multiBar.stop();
  }
}

function getVersion(): string {
  return process.env.MC_VERSION ?? DEFAULT_VERSION;
}

function getGameDirectory(): string {
  return process.env.MC_GAME_DIR ?? DEFAULT_GAME_DIRECTORY;
}

function getRuntimeDirectory(): string | undefined {
  // return process.env.MC_RUNTIME_DIR;
  return path.join(process.cwd(), ".minecraft/test-runtime");
}

function getAssetsDirectory(): string | undefined {
  return process.env.MC_ASSETS_DIR;
}

function getLibrariesDirectory(): string | undefined {
  return process.env.MC_LIBRARIES_DIR;
}

function getVersionsDirectory(): string | undefined {
  return process.env.MC_VERSIONS_DIR;
}

function getModsDirectory(): string | undefined {
  return process.env.MC_MODS_DIR;
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
  const runtimeDirectory = getRuntimeDirectory();
  const assetsDirectory = getAssetsDirectory();
  const librariesDirectory = getLibrariesDirectory();
  const versionsDirectory = getVersionsDirectory();
  const modsDirectory = getModsDirectory();
  if (runtimeDirectory) console.log(`Runtime directory: ${runtimeDirectory}`);
  if (assetsDirectory) console.log(`Assets directory: ${assetsDirectory}`);
  if (librariesDirectory) console.log(`Libraries directory: ${librariesDirectory}`);
  if (versionsDirectory) console.log(`Versions directory: ${versionsDirectory}`);
  if (modsDirectory) console.log(`Mods directory: ${modsDirectory}`);

  const javaPath = findJavaExecutable();
  if (!javaPath) {
    throw new Error("Java executable not found. Install Java and make it available on PATH.");
  }
  console.log(`Java: ${javaPath}`);

  // 创建进度条管理器
  const progressManager = new ProgressBarManager();

  const sdk = new CraftSDK({
    apiSource: API_SOURCE.BMCLAPI,
    sessionFile: "./craft-sdk-session.json",
    timeoutMs: 120000,
    process: (progress) => progressManager.handleProgress(progress),
  });

  const auth = buildAuthOptions();
  await sdk.auth.loginWithToken(auth.accessToken, auth.clientToken, auth.profileId, auth.profileName);

  const installOptions: InstallGameOptions = {
    version: getVersion(),
    gameDirectory: getGameDirectory(),
    loader: config.loader,
    javaPath,
    ...(runtimeDirectory ? { runtimeDirectory } : {}),
    ...(assetsDirectory ? { assetsDirectory } : {}),
    ...(librariesDirectory ? { librariesDirectory } : {}),
    ...(versionsDirectory ? { versionDirectory: versionsDirectory } : {}),
    ...(modsDirectory ? { modsDirectory } : {}),
  };
  if (config.loaderVersion) {
    installOptions.loaderVersion = config.loaderVersion;
  }

  const installed = await sdk.installGame(installOptions);

  const launchOptions: LaunchGameOptions = {
    metadata: installed.metadata,
    gameDirectory: installed.gameDirectory,
    assetsDirectory: installed.assetsDirectory,
    librariesDirectory: installed.librariesDirectory,
    versionDirectory: installed.versionDirectory,
    clientJarPath: installed.clientJarPath,
    javaPath,
    loader: config.loader,
    memory: { min: "512M", max: "2G" },
    jvmArgs: ["-XX:+UseG1GC", "-XX:+UnlockExperimentalVMOptions"],
    ...auth,
  };

  const exitCode = await sdk.launchGame(launchOptions);
  console.log(`Game exited with code: ${exitCode}`);
  progressManager.stop();
  return exitCode;
}
