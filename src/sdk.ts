import { AuthManager, type AuthOptions } from "./auth.js";
import { Downloader, type DownloaderOptions } from "./downloader.js";
import { Installer, type InstallerOptions } from "./installer.js";
import { GameLauncher } from "./launcher.js";
import { join, resolve } from "node:path";
import { API_SOURCE, type ApiSource } from "./constant.js";
import type { LaunchOptions } from "./models/options.js";
import type { VersionMetadata } from "./models/version.js";

export interface CraftSdkOptions {
  apiSource?: ApiSource;
  timeoutMs?: number;
  sessionFile?: string;
}

export interface PlayGameOptions {
  version: string;
  gameDirectory: string;
  loader?: "vanilla" | "forge" | "fabric" | "quilt";
  loaderVersion?: string;
  accessToken?: string;
  clientToken?: string;
  profileId?: string;
  profileName?: string;
  memory?: { min?: string; max?: string };
  jvmArgs?: string[];
  gameArgs?: string[];
  javaPath?: string;
  mods?: Array<{ id: string; name: string; version: string; sourceUrl: string; fileName?: string; loader?: string }>;
}

export class CraftSDK {
  public auth: AuthManager;
  public downloader: Downloader;
  public installer: Installer;
  public launcher: GameLauncher;

  constructor(options?: CraftSdkOptions) {
    const authOptions: AuthOptions = {};
    if (options?.sessionFile) authOptions.sessionFile = options.sessionFile;

    const sharedOptions: DownloaderOptions & InstallerOptions = {
      apiSource: options?.apiSource ?? API_SOURCE.MOJANG,
    };
    if (options?.timeoutMs) sharedOptions.timeoutMs = options.timeoutMs;

    this.auth = new AuthManager(authOptions);
    this.downloader = new Downloader(sharedOptions);
    this.installer = new Installer(sharedOptions);
    this.launcher = new GameLauncher();
  }

  async playGame(options: PlayGameOptions): Promise<number> {
    const gameDir = resolve(options.gameDirectory);
    const assetsDir = join(gameDir, "assets");
    const loader = options.loader ?? "vanilla";

    // 1. Handle authentication
    let session = this.auth.loadSession();
    if (options.accessToken && options.clientToken && options.profileId && options.profileName) {
      session = await this.auth.loginWithToken(
        options.accessToken,
        options.clientToken,
        options.profileId,
        options.profileName
      );
    }
    if (!session) {
      throw new Error("No valid session found. Please provide authentication credentials.");
    }

    // 2. Download version metadata and install loader profile when needed
    const preparedVersion = loader === "vanilla"
      ? await this.installer.prepareVersion(options.version, gameDir)
      : await this.installer.installLoader({
          loader,
          minecraftVersion: options.version,
          baseDirectory: gameDir,
          ...(options.loaderVersion ? { loaderVersion: options.loaderVersion } : {}),
          ...(options.javaPath ? { javaPath: options.javaPath } : {}),
        });
    const { metadata, versionDirectory, clientJarPath } = preparedVersion;

    // 3. Install mods if provided
    if (options.mods && options.mods.length > 0) {
      const modPackages = options.mods.map((mod) => ({
        ...mod,
        loader: (mod.loader ?? loader) as "vanilla" | "forge" | "fabric" | "quilt",
      }));
      await this.installer.installMods({
        modPackages,
        installTarget: { gameDirectory: gameDir, loader },
      });
    }

    // 4. Launch game
    const launchOptions: LaunchOptions = {
      version: metadata.id,
      gameDirectory: gameDir,
      assetsDirectory: assetsDir,
      versionDirectory,
      clientJarPath,
      authSession: session,
      loader,
    };
    if (options.javaPath) launchOptions.javaPath = options.javaPath;
    if (options.memory) launchOptions.memory = options.memory;
    if (options.jvmArgs) launchOptions.jvmArgs = options.jvmArgs;
    if (options.gameArgs) launchOptions.gameArgs = options.gameArgs;

    return this.launcher.launch(launchOptions, metadata);
  }
}
