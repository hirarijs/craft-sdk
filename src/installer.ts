import { join, dirname } from "node:path";
import { ensureDir, pathExists, readJson } from "./utils/fs.js";
import { downloadFile } from "./utils/downloader.js";
import { sha1File } from "./utils/checksum.js";
import type { DownloadOptions, InstallOptions } from "./models/options.js";
import type { ModPackage, ModInstallTarget } from "./models/mod.js";
import { getVersionDir, getModsDir, getLibrariesDir } from "./platform/paths.js";
import type { VersionManifest, VersionMetadata, LibraryEntry } from "./models/version.js";
import { API_ENDPOINTS, API_SOURCE, type ApiSource } from "./constant.js";

export interface InstallerOptions {
  apiSource?: ApiSource;
  timeoutMs?: number;
}

const DEFAULT_VERSION_MANIFEST_URL = API_ENDPOINTS[API_SOURCE.MOJANG].versionManifest;

export class Installer {
  private apiSource: ApiSource;
  private timeoutMs: number;

  constructor(options?: InstallerOptions) {
    this.apiSource = options?.apiSource ?? API_SOURCE.MOJANG;
    this.timeoutMs = options?.timeoutMs ?? 30000;
  }

  getVersionManifestUrl(): string {
    return API_ENDPOINTS[this.apiSource].versionManifest;
  }

  getLibrariesBase(): string {
    return API_ENDPOINTS[this.apiSource].librariesBase;
  }

  async downloadMinecraftVersionManifest(targetDirectory: string): Promise<VersionManifest> {
    ensureDir(targetDirectory);
    const manifestPath = join(targetDirectory, "version_manifest_v2.json");
    await downloadFile(this.getVersionManifestUrl(), manifestPath, this.timeoutMs);
    return readJson<VersionManifest>(manifestPath);
  }

  async downloadVersionMetadata(url: string, targetDirectory: string): Promise<VersionMetadata> {
    ensureDir(targetDirectory);
    const targetPath = join(targetDirectory, "version.json");
    await downloadFile(url, targetPath, this.timeoutMs);
    return readJson<VersionMetadata>(targetPath);
  }

  async downloadVersionMetadataById(versionId: string, baseDirectory: string): Promise<VersionMetadata> {
    const manifest = await this.downloadMinecraftVersionManifest(baseDirectory);
    const versionEntry = manifest.versions.find((entry) => entry.id === versionId);
    if (!versionEntry) {
      throw new Error(`Version ${versionId} not found in manifest.`);
    }
    const versionDir = join(getVersionDir(baseDirectory), versionId);
    return this.downloadVersionMetadata(versionEntry.url, versionDir);
  }

  async downloadClientJar(metadata: VersionMetadata, versionDirectory: string): Promise<string> {
    const clientJar = metadata.downloads.client;
    const jarPath = join(versionDirectory, `${metadata.id}.jar`);
    await downloadFile(clientJar.url ?? "", jarPath, this.timeoutMs);

    if (clientJar.sha1) {
      const checksum = await sha1File(jarPath);
      if (checksum !== clientJar.sha1) {
        throw new Error(`Downloaded client jar SHA1 mismatch: expected ${clientJar.sha1}, got ${checksum}`);
      }
    }

    return jarPath;
  }

  async downloadLibraries(metadata: VersionMetadata, baseDirectory: string): Promise<string[]> {
    const librariesDir = getLibrariesDir(baseDirectory);
    const installed: string[] = [];

    for (const library of metadata.libraries ?? []) {
      const libraryPath = await this.downloadLibraryArtifact(library, librariesDir);
      installed.push(libraryPath);
    }

    return installed;
  }

  private async downloadLibraryArtifact(library: LibraryEntry, librariesDirectory: string): Promise<string> {
    const artifact = library.downloads?.artifact;
    if (!artifact?.path) {
      throw new Error(`Library artifact path missing for ${library.name}`);
    }

    const targetPath = join(librariesDirectory, artifact.path);
    if (pathExists(targetPath)) {
      if (!artifact.sha1) {
        return targetPath;
      }

      const checksum = await sha1File(targetPath);
      if (checksum === artifact.sha1) {
        return targetPath;
      }
    }

    ensureDir(dirname(targetPath));
    const url = artifact.url ?? `${this.getLibrariesBase()}${artifact.path}`;
    await downloadFile(url, targetPath, this.timeoutMs);

    if (artifact.sha1) {
      const checksum = await sha1File(targetPath);
      if (checksum !== artifact.sha1) {
        throw new Error(`Library checksum mismatch for ${library.name}: expected ${artifact.sha1}, got ${checksum}`);
      }
    }

    return targetPath;
  }

  async prepareVersion(versionId: string, baseDirectory: string): Promise<{ metadata: VersionMetadata; versionDirectory: string }> {
    const metadata = await this.downloadVersionMetadataById(versionId, baseDirectory);
    const versionDirectory = join(getVersionDir(baseDirectory), versionId);
    await this.downloadClientJar(metadata, versionDirectory);
    await this.downloadLibraries(metadata, baseDirectory);
    return { metadata, versionDirectory };
  }

  async installMods(options: InstallOptions): Promise<string[]> {
    const installed: string[] = [];

    for (const mod of options.modPackages) {
      const installDir = this.getModInstallDir(options.installTarget);
      ensureDir(installDir);
      const fileName = mod.fileName ?? `${mod.id}-${mod.version}.jar`;
      const destination = join(installDir, fileName);

      if (pathExists(destination)) {
        installed.push(destination);
        continue;
      }

      await downloadFile(mod.sourceUrl, destination, this.timeoutMs);
      installed.push(destination);
    }

    return installed;
  }

  private getModInstallDir(target: ModInstallTarget): string {
    if (target.installPath) {
      return target.installPath;
    }

    if (target.modsDirectory) {
      return target.modsDirectory;
    }

    return getModsDir(target.gameDirectory);
  }
}
