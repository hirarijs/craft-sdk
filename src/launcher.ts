import { join } from "node:path";
import { runJavaProcess } from "./platform/process.js";
import { findJavaExecutable } from "./platform/java.js";
import { getLibrariesDir } from "./platform/paths.js";
import { getMavenArtifactPath } from "./utils/maven.js";
import { ensureDir } from "./utils/fs.js";
import type { LaunchOptions } from "./models/options.js";
import type { VersionMetadata } from "./models/version.js";

type ArgumentEntry = string | string[] | { rules?: Array<{ action: string; os?: { name?: string; arch?: string }; features?: Record<string, boolean> }>; value: string | string[] };

function isRuleAllowed(rule?: { action?: string; os?: { name?: string; arch?: string }; features?: Record<string, boolean> }): boolean {
  if (!rule || !rule.action) {
    return true;
  }

  if (rule.features) {
    return false;
  }

  if (!rule.os) {
    return rule.action === "allow";
  }

  const osMatches = !rule.os.name ||
    (rule.os.name === "windows" && process.platform === "win32") ||
    (rule.os.name === "osx" && process.platform === "darwin") ||
    (rule.os.name === "linux" && process.platform === "linux");
  const archMatches = !rule.os.arch ||
    (rule.os.arch === "x86" && process.arch === "ia32") ||
    (rule.os.arch === "x64" && process.arch === "x64") ||
    (rule.os.arch === "arm64" && process.arch === "arm64");
  const matches = osMatches && archMatches;
  return rule.action === "allow" ? matches : !matches;
}

function shouldIncludeEntry(entry?: { rules?: Array<{ action: string; os?: { name?: string; arch?: string }; features?: Record<string, boolean> }> }): boolean {
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

function buildArgumentVariables(options: LaunchOptions, metadata: VersionMetadata, classpath: string[], versionName = metadata.id): Record<string, string> {
  const classpathSeparator = process.platform === "win32" ? ";" : ":";
  const librariesDir = options.librariesDirectory ?? getLibrariesDir(options.gameDirectory);
  const nativesDirectory = options.nativesDirectory ?? join(options.gameDirectory, "natives", metadata.id);

  return {
    auth_access_token: options.authSession?.accessToken ?? "0",
    auth_player_name: options.authSession?.selectedProfile?.name ?? "Player",
    auth_uuid: options.authSession?.selectedProfile?.id ?? "0",
    auth_xuid: "",
    assets_index_name: metadata.assetIndex.id,
    assets_root: options.assetsDirectory,
    clientid: options.authSession?.clientToken ?? "",
    classpath: classpath.join(classpathSeparator),
    classpath_separator: classpathSeparator,
    game_directory: options.gameDirectory,
    launcher_name: "craft-sdk",
    launcher_version: "1.0.0",
    library_directory: librariesDir,
    natives_directory: nativesDirectory,
    user_type: "mojang",
    version_name: versionName,
    version_type: "release",
  };
}

function replaceArgumentVariables(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, name: string) => variables[name] ?? match);
}

function buildMetadataArguments(argumentsList: ArgumentEntry[] | undefined, variables: Record<string, string>): string[] {
  const values: string[] = [];

  for (const argument of argumentsList ?? []) {
    if (typeof argument === "string") {
      values.push(replaceArgumentVariables(argument, variables));
      continue;
    }

    if (Array.isArray(argument)) {
      values.push(...argument.map((value) => replaceArgumentVariables(value, variables)));
      continue;
    }

    if (argument.rules && !shouldIncludeEntry(argument)) {
      continue;
    }

    values.push(...resolveArgumentEntry(argument.value).map((value) => replaceArgumentVariables(value, variables)));
  }

  return values;
}

function buildMetadataGameArguments(metadata: VersionMetadata, options: LaunchOptions, classpath: string[]): string[] {
  return buildMetadataArguments(metadata.arguments?.game, buildArgumentVariables(options, metadata, classpath));
}

function buildDefaultGameArguments(options: LaunchOptions, metadata: VersionMetadata): string[] {
  const args = [
    "--username",
    options.authSession?.selectedProfile?.name ?? "Player",
    "--version",
    metadata.id,
    "--gameDir",
    options.gameDirectory,
    "--assetsDir",
    options.assetsDirectory,
    "--assetIndex",
    metadata.assetIndex.id,
  ];

  if (options.authSession) {
    args.push("--uuid", options.authSession.selectedProfile?.id ?? "0");
    args.push("--accessToken", options.authSession.accessToken);
    if (options.authSession.clientToken) {
      args.push("--clientId", options.authSession.clientToken);
    }
  }

  return args;
}

function buildMetadataJvmArguments(metadata: VersionMetadata, options: LaunchOptions, classpath: string[]): string[] {
  const versionName = metadata.jar ?? metadata.inheritsFrom ?? metadata.id;
  return buildMetadataArguments(metadata.arguments?.jvm, buildArgumentVariables(options, metadata, classpath, versionName));
}

function buildClasspath(metadata: VersionMetadata, options: LaunchOptions): string[] {
  const classpath: string[] = [];
  const versionJar = options.clientJarPath ?? join(options.versionDirectory, `${metadata.jar ?? metadata.id}.jar`);
  classpath.push(versionJar);

  const librariesDir = options.librariesDirectory ?? getLibrariesDir(options.gameDirectory);
  for (const library of metadata.libraries ?? []) {
    if (!shouldIncludeEntry(library)) {
      continue;
    }

    const artifactPath = library.downloads?.artifact?.path ?? getMavenArtifactPath(library.name).path;
    classpath.push(join(librariesDir, artifactPath));
  }

  return classpath;
}

function buildArguments(options: LaunchOptions, metadata: VersionMetadata): string[] {
  const args: string[] = [];
  const classpath = buildClasspath(metadata, options);

  if (options.jvmArgs) {
    args.push(...options.jvmArgs);
  }

  if (options.memory) {
    if (options.memory.min) args.push(`-Xms${options.memory.min}`);
    if (options.memory.max) args.push(`-Xmx${options.memory.max}`);
  }

  if (metadata.arguments?.jvm) {
    args.push(...buildMetadataJvmArguments(metadata, options, classpath));
  } else {
    args.push("-cp", classpath.join(process.platform === "win32" ? ";" : ":"));
  }

  args.push(metadata.mainClass);
  args.push(...(metadata.arguments?.game ? buildMetadataGameArguments(metadata, options, classpath) : buildDefaultGameArguments(options, metadata)));

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

    ensureDir(options.gameDirectory);
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
