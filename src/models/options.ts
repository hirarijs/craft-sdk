import type { AuthSession } from "./profile.js";
import type { ModPackage, ModInstallTarget } from "./mod.js";

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
  gameDirectory: string;
  assetsDirectory: string;
  versionDirectory: string;
  extraEnvironment?: Record<string, string>;
}

export interface DownloadOptions {
  version: string;
  targetDirectory: string;
  timeoutMs?: number;
}

export interface InstallOptions {
  modPackages: ModPackage[];
  installTarget: ModInstallTarget;
}
