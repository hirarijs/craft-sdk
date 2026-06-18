import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getPlatformInfo } from "./platform.js";

function pathExistsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findInPath(executable: string): string | undefined {
  const platform = getPlatformInfo();
  if (platform.isWindows) {
    const where = spawnSync("where", [executable], { encoding: "utf8" });
    if (where.status === 0 && where.stdout) {
      return where.stdout.split(/\r?\n/).find(Boolean);
    }
  } else {
    const which = spawnSync("which", [executable], { encoding: "utf8" });
    if (which.status === 0 && which.stdout) {
      return which.stdout.split(/\r?\n/).find(Boolean);
    }
  }
  return undefined;
}

export function findJavaExecutable(preferred?: string): string | undefined {
  if (preferred && pathExistsExecutable(preferred)) {
    return preferred;
  }

  const platform = getPlatformInfo();
  const paths: string[] = [];

  if (platform.isWindows) {
    paths.push(join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Java", "bin", "java.exe"));
    paths.push(join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Java", "bin", "java.exe"));
  } else {
    paths.push("/usr/bin/java");
    paths.push("/usr/local/bin/java");
  }

  for (const path of paths) {
    if (pathExistsExecutable(path)) {
      return path;
    }
  }

  const pathFound = findInPath(platform.isWindows ? "java.exe" : "java");
  if (pathFound && pathExistsExecutable(pathFound)) {
    return pathFound;
  }

  return undefined;
}

export function getBundledJavaDownloadUrl(): string {
  const platform = getPlatformInfo();
  if (platform.isWindows) {
    return "https://example.com/java/windows/java.zip";
  }
  if (platform.isMac) {
    return "https://example.com/java/macos/java.tar.gz";
  }
  return "https://example.com/java/linux/java.tar.gz";
}
