import { AuthManager, type AuthOptions, type MicrosoftDeviceCodeLoginOptions } from "./auth.js";
import { Downloader, type DownloaderOptions } from "./downloader.js";
import { Installer, type InstallerOptions } from "./installer.js";
import { GameLauncher } from "./launcher.js";
import { resolve } from "node:path";
import { API_SOURCE, type ApiSource } from "./constant.js";
import type { LaunchOptions } from "./models/options.js";
import type { AuthSession } from "./models/profile.js";
import type { VersionMetadata } from "./models/version.js";
import type { DownloadProcessCallback, DownloadProcessOptions } from "./utils/downloader.js";

export interface CraftSdkOptions extends DownloadProcessOptions {
  apiSource?: ApiSource;
  timeoutMs?: number;
  sessionFile?: string;
  microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
}

export type GameLoaderType = "vanilla" | "forge" | "fabric" | "quilt";

export interface GameDirectoryOptions {
  runtimeDirectory?: string;
  versionDirectory?: string;
  loaderVersionDirectory?: string;
  assetsDirectory?: string;
  librariesDirectory?: string;
  modsDirectory?: string;
}

export interface GameAuthOptions {
  accessToken?: string;
  clientToken?: string;
  profileId?: string;
  profileName?: string;
  microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
}

export interface GameRuntimeOptions {
  memory?: { min?: string; max?: string };
  jvmArgs?: string[];
  gameArgs?: string[];
  javaPath?: string;
  extraEnvironment?: Record<string, string>;
}

export interface InstallGameOptions extends DownloadProcessOptions, GameDirectoryOptions {
  version: string;
  gameDirectory: string;
  loader?: GameLoaderType;
  loaderVersion?: string;
  javaPath?: string;
  validate?: boolean;
  mods?: Array<{ id: string; name: string; version: string; sourceUrl: string; fileName?: string; loader?: string }>;
}

export interface InstalledGame {
  metadata: VersionMetadata;
  loader: GameLoaderType;
  baseDirectory: string;
  gameDirectory: string;
  assetsDirectory: string;
  librariesDirectory: string;
  versionDirectory: string;
  clientJarPath: string;
}

export interface LaunchGameOptions extends GameAuthOptions, GameRuntimeOptions {
  metadata: VersionMetadata;
  gameDirectory: string;
  assetsDirectory: string;
  librariesDirectory: string;
  versionDirectory: string;
  clientJarPath?: string;
  nativesDirectory?: string;
  loader?: GameLoaderType;
}

export interface PlayGameOptions extends InstallGameOptions, GameAuthOptions, GameRuntimeOptions {
  nativesDirectory?: string;
}

export class CraftSDK {
  public auth: AuthManager;
  public downloader: Downloader;
  public installer: Installer;
  public launcher: GameLauncher;
  private microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
  private process?: DownloadProcessCallback;

  constructor(options?: CraftSdkOptions) {
    const authOptions: AuthOptions = {};
    if (options?.sessionFile) authOptions.sessionFile = options.sessionFile;
    if (options?.microsoftAuth) authOptions.microsoftAuth = options.microsoftAuth;
    if (options?.microsoftAuth) this.microsoftAuth = options.microsoftAuth;
    if (options?.process) this.process = options.process;

    const sharedOptions: DownloaderOptions & InstallerOptions = {
      apiSource: options?.apiSource ?? API_SOURCE.MOJANG,
    };
    if (options?.timeoutMs) sharedOptions.timeoutMs = options.timeoutMs;
    if (options?.process) sharedOptions.process = options.process;

    this.auth = new AuthManager(authOptions);
    this.downloader = new Downloader(sharedOptions);
    this.installer = new Installer(sharedOptions);
    this.launcher = new GameLauncher();
  }

  async installGame(options: InstallGameOptions): Promise<InstalledGame> {
    const baseDirectory = resolve(options.gameDirectory);
    const runtimeDirectory = this.resolveOptionalPath(options.runtimeDirectory) ?? baseDirectory;
    const loader = options.loader ?? "vanilla";
    const processCallback = options.process ?? this.process;
    const versionDirectory = this.resolveOptionalPath(options.versionDirectory);
    const loaderVersionDirectory = this.resolveOptionalPath(options.loaderVersionDirectory);
    const assetsDirectory = this.resolveOptionalPath(options.assetsDirectory);
    const librariesDirectory = this.resolveOptionalPath(options.librariesDirectory);

    const preparedVersion = loader === "vanilla"
      ? await this.installer.prepareVersion(options.version, baseDirectory, {
          ...(versionDirectory ? { versionDirectory } : {}),
          ...(assetsDirectory ? { assetsDirectory } : {}),
          ...(librariesDirectory ? { librariesDirectory } : {}),
          ...(options.validate !== undefined ? { validate: options.validate } : {}),
          ...(processCallback ? { process: processCallback } : {}),
        })
      : await this.installer.installLoader({
          loader,
          minecraftVersion: options.version,
          baseDirectory,
          ...(options.loaderVersion ? { loaderVersion: options.loaderVersion } : {}),
          ...(versionDirectory ? { versionDirectory } : {}),
          ...(loaderVersionDirectory ? { loaderVersionDirectory } : {}),
          ...(assetsDirectory ? { assetsDirectory } : {}),
          ...(librariesDirectory ? { librariesDirectory } : {}),
          ...(options.validate !== undefined ? { validate: options.validate } : {}),
          ...(options.javaPath ? { javaPath: options.javaPath } : {}),
          ...(processCallback ? { process: processCallback } : {}),
        });

    if (options.mods && options.mods.length > 0) {
      const modPackages = options.mods.map((mod) => ({
        ...mod,
        loader: (mod.loader ?? loader) as "vanilla" | "forge" | "fabric" | "quilt",
      }));
      await this.installer.installMods({
        modPackages,
        installTarget: {
          gameDirectory: runtimeDirectory,
          loader,
          ...(options.modsDirectory ? { modsDirectory: resolve(options.modsDirectory) } : {}),
        },
        ...(processCallback ? { process: processCallback } : {}),
      });
    }

    return {
      metadata: preparedVersion.metadata,
      loader,
      baseDirectory,
      gameDirectory: runtimeDirectory,
      assetsDirectory: preparedVersion.assetsDirectory,
      librariesDirectory: preparedVersion.librariesDirectory,
      versionDirectory: preparedVersion.versionDirectory,
      clientJarPath: preparedVersion.clientJarPath,
    };
  }

  async launchGame(options: LaunchGameOptions): Promise<number> {
    const session = await this.resolveSession(options);
    const launchOptions: LaunchOptions = {
      version: options.metadata.id,
      gameDirectory: resolve(options.gameDirectory),
      assetsDirectory: resolve(options.assetsDirectory),
      librariesDirectory: resolve(options.librariesDirectory),
      versionDirectory: resolve(options.versionDirectory),
      authSession: session,
      ...(options.clientJarPath ? { clientJarPath: resolve(options.clientJarPath) } : {}),
      ...(options.nativesDirectory ? { nativesDirectory: resolve(options.nativesDirectory) } : {}),
      ...(options.loader ? { loader: options.loader } : {}),
    };
    if (options.javaPath) launchOptions.javaPath = options.javaPath;
    if (options.memory) launchOptions.memory = options.memory;
    if (options.jvmArgs) launchOptions.jvmArgs = options.jvmArgs;
    if (options.gameArgs) launchOptions.gameArgs = options.gameArgs;
    if (options.extraEnvironment) launchOptions.extraEnvironment = options.extraEnvironment;

    return this.launcher.launch(launchOptions, options.metadata);
  }

  async playGame(options: PlayGameOptions): Promise<number> {
    const installed = await this.installGame(options);
    return this.launchGame({
      metadata: installed.metadata,
      gameDirectory: installed.gameDirectory,
      assetsDirectory: installed.assetsDirectory,
      librariesDirectory: installed.librariesDirectory,
      versionDirectory: installed.versionDirectory,
      clientJarPath: installed.clientJarPath,
      loader: installed.loader,
      ...(options.nativesDirectory ? { nativesDirectory: options.nativesDirectory } : {}),
      ...(options.accessToken ? { accessToken: options.accessToken } : {}),
      ...(options.clientToken ? { clientToken: options.clientToken } : {}),
      ...(options.profileId ? { profileId: options.profileId } : {}),
      ...(options.profileName ? { profileName: options.profileName } : {}),
      ...(options.microsoftAuth ? { microsoftAuth: options.microsoftAuth } : {}),
      ...(options.javaPath ? { javaPath: options.javaPath } : {}),
      ...(options.memory ? { memory: options.memory } : {}),
      ...(options.jvmArgs ? { jvmArgs: options.jvmArgs } : {}),
      ...(options.gameArgs ? { gameArgs: options.gameArgs } : {}),
      ...(options.extraEnvironment ? { extraEnvironment: options.extraEnvironment } : {}),
    });
  }

  private async resolveSession(options: GameAuthOptions): Promise<AuthSession> {
    let session = this.auth.loadSession();
    const microsoftAuth = options.microsoftAuth ?? this.microsoftAuth;
    if (options.accessToken && options.clientToken && options.profileId && options.profileName) {
      session = await this.auth.loginWithToken(
        options.accessToken,
        options.clientToken,
        options.profileId,
        options.profileName
      );
    }
    if (session && this.auth.isSessionExpired(session)) {
      if (session.refreshToken) {
        session = await this.auth.refreshMicrosoftSession(session, microsoftAuth);
      } else {
        session = undefined;
      }
    }
    if (!session && microsoftAuth) {
      session = await this.auth.loginWithMicrosoftDeviceCode(microsoftAuth);
    }
    if (!session) {
      throw new Error("No valid session found. Please provide authentication credentials.");
    }

    return session;
  }

  private resolveOptionalPath(path?: string): string | undefined {
    return path ? resolve(path) : undefined;
  }
}
