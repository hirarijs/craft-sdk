import { join } from "node:path";
import { runJavaProcess } from "./platform/process.js";
import { findJavaExecutable } from "./platform/java.js";
import { getLibrariesDir } from "./platform/paths.js";
import type { LaunchOptions } from "./models/options.js";
import type { VersionMetadata } from "./models/version.js";

function isRuleAllowed(rule?: { action?: string; os?: { name: string } }): boolean {
  if (!rule || !rule.action) {
    return true;
  }

  if (!rule.os || !rule.os.name) {
    return rule.action === "allow";
  }

  const os = process.platform;
  const matches = (rule.os.name === "windows" && os === "win32") || (rule.os.name === "osx" && os === "darwin") || (rule.os.name === "linux" && os === "linux");
  return rule.action === "allow" ? matches : !matches;
}

function shouldIncludeEntry(entry?: { rules?: Array<{ action: string; os?: { name: string } }> }): boolean {
  if (!entry?.rules || entry.rules.length === 0) {
    return true;
  }

  let allowed = false;
  for (const rule of entry.rules) {
    if (isRuleAllowed(rule)) {
      allowed = rule.action === "allow";
    }
  }

  return allowed;
}

function resolveArgumentEntry(value: string | string[]): string[] {
  return typeof value === "string" ? [value] : value;
}

function buildMetadataGameArguments(metadata: VersionMetadata): string[] {
  const values: string[] = [];

  for (const argument of metadata.arguments?.game ?? []) {
    if (typeof argument === "string") {
      values.push(argument);
      continue;
    }

    if (Array.isArray(argument)) {
      values.push(...argument);
      continue;
    }

    if (argument.rules && !shouldIncludeEntry(argument)) {
      continue;
    }

    values.push(...resolveArgumentEntry(argument.value));
  }

  return values;
}

function buildClasspath(metadata: VersionMetadata, options: LaunchOptions): string[] {
  const classpath: string[] = [];
  const versionJar = join(options.versionDirectory, `${metadata.id}.jar`);
  classpath.push(versionJar);

  const librariesDir = options.librariesDirectory ?? getLibrariesDir(options.gameDirectory);
  for (const library of metadata.libraries ?? []) {
    const artifact = library.downloads?.artifact;
    if (!artifact?.path) {
      continue;
    }

    classpath.push(join(librariesDir, artifact.path));
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

  const classpath = buildClasspath(metadata, options);
  args.push("-cp", classpath.join(process.platform === "win32" ? ";" : ":"));
  args.push(metadata.mainClass);
  args.push(...buildMetadataGameArguments(metadata));

  args.push("--username", options.authSession?.selectedProfile?.name ?? "Player");
  args.push("--version", metadata.id);
  args.push("--gameDir", options.gameDirectory);
  args.push("--assetsDir", options.assetsDirectory);
  args.push("--assetIndex", metadata.assetIndex.id);

  if (options.authSession) {
    args.push("--uuid", options.authSession.selectedProfile?.id ?? "0");
    args.push("--accessToken", options.authSession.accessToken);
    if (options.authSession.clientToken) {
      args.push("--clientId", options.authSession.clientToken);
    }
  }

  if (options.gameArgs) {
    args.push(...options.gameArgs);
  }

  return args;
}

export class GameLauncher {
  async launch(options: LaunchOptions, metadata: VersionMetadata): Promise<number> {
    const javaExecutable = options.javaPath ?? findJavaExecutable();
    if (!javaExecutable) {
      throw new Error("Java executable not found on the system.");
    }

    const args = buildArguments(options, metadata);
    const runOptions: { javaExecutable: string; args: string[]; cwd?: string; env?: Record<string, string> } = {
      javaExecutable,
      args,
      cwd: options.gameDirectory,
    };
    if (options.extraEnvironment) runOptions.env = options.extraEnvironment;
    return runJavaProcess(runOptions);
  }
}
