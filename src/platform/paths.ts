import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { getPlatformInfo } from "./platform.js";

export function ensureDirectory(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  return path;
}

export function getMinecraftBaseDir(): string {
  const platform = getPlatformInfo();

  if (platform.isWindows) {
    return process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, ".minecraft") : join(process.cwd(), ".minecraft");
  }

  if (platform.isMac) {
    return join(process.env.HOME ?? process.cwd(), "Library", "Application Support", "minecraft");
  }

  return join(process.env.HOME ?? process.cwd(), ".minecraft");
}

export function getVersionDir(baseDir?: string): string {
  const dir = join(baseDir ?? getMinecraftBaseDir(), "versions");
  return ensureDirectory(dir);
}

export function getAssetsDir(baseDir?: string): string {
  const dir = join(baseDir ?? getMinecraftBaseDir(), "assets");
  return ensureDirectory(dir);
}

export function getLibrariesDir(baseDir?: string): string {
  const dir = join(baseDir ?? getMinecraftBaseDir(), "libraries");
  return ensureDirectory(dir);
}

export function getModsDir(baseDir?: string): string {
  const dir = join(baseDir ?? getMinecraftBaseDir(), "mods");
  return ensureDirectory(dir);
}

export function getRuntimeDir(baseDir?: string): string {
  const dir = join(baseDir ?? getMinecraftBaseDir(), "runtime");
  return ensureDirectory(dir);
}
