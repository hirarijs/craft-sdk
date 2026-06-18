import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { getPlatformInfo } from "./platform.js";

export function findJavaExecutable(preferred?: string): string | undefined {
  if (preferred) {
    try {
      accessSync(preferred, constants.X_OK);
      return preferred;
    } catch {
      // ignore invalid executable path
    }
  }

  const platform = getPlatformInfo();
  const paths: string[] = [];

  if (platform.isWindows) {
    paths.push("java.exe");
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    paths.push(join(programFiles, "Java", "bin", "java.exe"));
    paths.push(join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Java", "bin", "java.exe"));
  } else {
    paths.push("java");
    paths.push("/usr/bin/java");
    paths.push("/usr/local/bin/java");
  }

  for (const path of paths) {
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
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
