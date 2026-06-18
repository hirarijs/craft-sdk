import { join } from "node:path";
import { runJavaProcess } from "./platform/process.js";
import { findJavaExecutable } from "./platform/java.js";
import type { LaunchOptions } from "./models/options.js";
import type { VersionMetadata } from "./models/version.js";

function buildClasspath(metadata: VersionMetadata, versionDirectory: string): string[] {
  const classpath: string[] = [];

  if (metadata.downloads.client) {
    classpath.push(join(versionDirectory, `${metadata.id}.jar`));
  }

  for (const library of metadata.libraries ?? []) {
    if (library.downloads?.artifact?.path) {
      classpath.push(join(versionDirectory, library.downloads.artifact.path));
    }
  }

  return classpath;
}

function buildArguments(options: LaunchOptions, metadata: VersionMetadata): string[] {
  const args: string[] = [];

  if (options.jvmArgs) {
    args.push(...options.jvmArgs);
  }

  if (options.memory) {
    if (options.memory.min) args.push(`-Xms${options.memory.min}`);
    if (options.memory.max) args.push(`-Xmx${options.memory.max}`);
  }

  args.push("-cp", buildClasspath(metadata, options.versionDirectory).join(process.platform === "win32" ? ";" : ":"));
  args.push(metadata.mainClass);

  if (options.gameArgs) {
    args.push(...options.gameArgs);
  }

  return args;
}

export async function launchGame(options: LaunchOptions, metadata: VersionMetadata): Promise<number> {
  const javaExecutable = options.javaPath ?? findJavaExecutable();
  if (!javaExecutable) {
    throw new Error("Java executable not found on the system.");
  }

  const args = buildArguments(options, metadata);
  return runJavaProcess({ javaExecutable, args, cwd: options.gameDirectory, env: options.extraEnvironment });
}
