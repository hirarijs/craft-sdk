import type { AuthSession } from "./profile.js";
import type { ModPackage, ModInstallTarget } from "./mod.js";
import type { DownloadProcessOptions } from "../utils/downloader.js";

export interface LaunchOptions {
  version: string;
  javaPath?: string;
  memory?: {
    min?: string;
    max?: string;
  };
  jvmArgs?: string[];
  gameArgs?: string[];
  loader?: "vanilla" | "forge" | "fabric" | "quilt";
  mods?: ModPackage[];
  modInstallTarget?: ModInstallTarget;
  authSession?: AuthSession;
  librariesDirectory?: string;
  clientJarPath?: string;
  gameDirectory: string;
  assetsDirectory: string;
  versionDirectory: string;
  extraEnvironment?: Record<string, string>;
}

export interface DownloadOptions extends DownloadProcessOptions {
  version: string;
  targetDirectory: string;
  versionDirectory?: string;
  timeoutMs?: number;
}

export interface InstallOptions extends DownloadProcessOptions {
  modPackages: ModPackage[];
  installTarget: ModInstallTarget;
}
