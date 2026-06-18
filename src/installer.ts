import { join } from "node:path";
import { writeJson, ensureDir, pathExists } from "./utils/fs.js";
import { downloadFile } from "./utils/downloader.js";
import { sha1File } from "./utils/checksum.js";
import type { DownloadOptions, InstallOptions } from "./models/options.js";
import type { ModPackage, ModInstallTarget } from "./models/mod.js";
import { getVersionDir, getModsDir } from "./platform/paths.js";
import type { VersionMetadata } from "./models/version.js";

export async function downloadVersionMetadata(url: string, targetDirectory: string): Promise<VersionMetadata> {
  ensureDir(targetDirectory);
  const targetPath = join(targetDirectory, "version.json");
  await downloadFile(url, targetPath);
  const metadata = JSON.parse(await import(`file://${targetPath}`)) as VersionMetadata;
  return metadata;
}

export async function downloadClientJar(metadata: VersionMetadata, versionDirectory: string): Promise<string> {
  const clientJar = metadata.downloads.client;
  const jarPath = join(versionDirectory, `${metadata.id}.jar`);
  await downloadFile(clientJar.url ?? "", jarPath);

  if (clientJar.sha1) {
    const checksum = await sha1File(jarPath);
    if (checksum !== clientJar.sha1) {
      throw new Error(`Downloaded client jar SHA1 mismatch: expected ${clientJar.sha1}, got ${checksum}`);
    }
  }

  return jarPath;
}

function getModInstallDir(target: ModInstallTarget): string {
  if (target.installPath) {
    return target.installPath;
  }

  if (target.modsDirectory) {
    return target.modsDirectory;
  }

  return getModsDir(target.gameDirectory);
}

export async function installMods(options: InstallOptions): Promise<string[]> {
  const installed: string[] = [];

  for (const mod of options.modPackages) {
    const installDir = getModInstallDir(options.installTarget);
    ensureDir(installDir);
    const fileName = mod.fileName ?? `${mod.id}-${mod.version}.jar`;
    const destination = join(installDir, fileName);

    if (pathExists(destination)) {
      installed.push(destination);
      continue;
    }

    await downloadFile(mod.sourceUrl, destination);
    installed.push(destination);
  }

  return installed;
}

export async function findOrDownloadVersion(options: DownloadOptions): Promise<VersionMetadata> {
  const versionDir = getVersionDir(options.targetDirectory);
  const manifestPath = join(versionDir, "version.json");

  if (pathExists(manifestPath)) {
    return JSON.parse(await import(`file://${manifestPath}`)) as VersionMetadata;
  }

  throw new Error("Version metadata not found locally. Please provide URL for metadata download.");
}
