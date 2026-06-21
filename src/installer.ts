import { join, dirname } from "node:path";
import { readdirSync } from "node:fs";
import { ensureDir, pathExists, readJson, writeJson } from "./utils/fs.js";
import { downloadFile } from "./utils/downloader.js";
import { sha1File } from "./utils/checksum.js";
import { getMavenArtifactPath } from "./utils/maven.js";
import { resolveApiUrl } from "./utils/api.js";
import { findJavaExecutable } from "./platform/java.js";
import { runJavaProcess } from "./platform/process.js";
import type { DownloadOptions, InstallOptions } from "./models/options.js";
import type { ModPackage, ModInstallTarget } from "./models/mod.js";
import { getVersionDir, getModsDir, getLibrariesDir, getAssetsDir } from "./platform/paths.js";
import type { VersionManifest, VersionMetadata, LibraryEntry } from "./models/version.js";
import { API_ENDPOINTS, API_SOURCE, type ApiSource } from "./constant.js";

export interface InstallerOptions {
  apiSource?: ApiSource;
  timeoutMs?: number;
}

export interface FileValidationResult {
  filePath: string;
  valid: boolean;
  reason?: "missing" | "checksum_mismatch";
  expectedSha1?: string;
  actualSha1?: string;
}

export interface PrepareVersionOptions {
  validate?: boolean;
}

export type LoaderInstallType = "forge" | "fabric" | "quilt";

export interface InstallLoaderOptions extends PrepareVersionOptions {
  loader: LoaderInstallType;
  minecraftVersion: string;
  baseDirectory: string;
  loaderVersion?: string;
  javaPath?: string;
}

export interface PreparedVersion {
  metadata: VersionMetadata;
  versionDirectory: string;
  clientJarPath: string;
}

interface AssetObject {
  hash: string;
  size: number;
}

interface AssetIndexData {
  objects: Record<string, AssetObject>;
}

interface LauncherProfileEntry {
  name: string;
  type: string;
  created: string;
  lastUsed: string;
  lastVersionId: string;
}

interface LauncherProfilesFile {
  profiles?: Record<string, LauncherProfileEntry>;
  settings?: Record<string, unknown>;
  version?: number;
}

type VersionMetadataInput = Partial<VersionMetadata> & Pick<VersionMetadata, "id">;

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

  getAssetsBase(): string {
    return API_ENDPOINTS[this.apiSource].assetsBase;
  }

  getFabricMetaBase(): string {
    return API_ENDPOINTS[this.apiSource].fabricMetaBase;
  }

  getQuiltMetaBase(): string {
    return API_ENDPOINTS[this.apiSource].quiltMetaBase;
  }

  getForgeMavenBase(): string {
    return API_ENDPOINTS[this.apiSource].forgeMavenBase;
  }

  async installLoader(options: InstallLoaderOptions): Promise<PreparedVersion> {
    if (options.loader === "fabric") {
      return this.installFabricLoader(options);
    }

    if (options.loader === "quilt") {
      return this.installQuiltLoader(options);
    }

    return this.installForgeLoader(options);
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
    await downloadFile(this.resolveUrl(url), targetPath, this.timeoutMs);
    return readJson<VersionMetadata>(targetPath);
  }

  async downloadVersionMetadataById(versionId: string, baseDirectory: string): Promise<VersionMetadata> {
    const manifest = await this.downloadMinecraftVersionManifest(baseDirectory);
    const versionEntry = manifest.versions.find((entry) => entry.id === versionId);
    if (!versionEntry) {
      throw new Error(`Version ${versionId} not found in manifest.`);
    }
    const versionDir = join(getVersionDir(baseDirectory), versionId);
    return this.downloadVersionMetadata(this.resolveUrl(versionEntry.url), versionDir);
  }

  async downloadClientJar(metadata: VersionMetadata, versionDirectory: string): Promise<string> {
    const clientJar = metadata.downloads.client;
    const jarPath = join(versionDirectory, `${metadata.id}.jar`);
    const validation = await this.validateFile(jarPath, clientJar.sha1);
    if (validation.valid) {
      return jarPath;
    }

    await downloadFile(this.resolveUrl(clientJar.url ?? ""), jarPath, this.timeoutMs);

    if (clientJar.sha1) {
      const checksum = await sha1File(jarPath);
      if (checksum !== clientJar.sha1) {
        throw new Error(`Downloaded client jar SHA1 mismatch: expected ${clientJar.sha1}, got ${checksum}`);
      }
    }

    return jarPath;
  }

  async validateFile(filePath: string, expectedSha1?: string): Promise<FileValidationResult> {
    if (!pathExists(filePath)) {
      const result: FileValidationResult = { filePath, valid: false, reason: "missing" };
      if (expectedSha1) result.expectedSha1 = expectedSha1;
      return result;
    }

    if (!expectedSha1) {
      return { filePath, valid: true };
    }

    const actualSha1 = await sha1File(filePath);
    if (actualSha1 !== expectedSha1) {
      return {
        filePath,
        valid: false,
        reason: "checksum_mismatch",
        expectedSha1,
        actualSha1,
      };
    }

    return { filePath, valid: true, expectedSha1, actualSha1 };
  }

  async validateVersionFiles(metadata: VersionMetadata, baseDirectory: string, versionDirectory: string, clientJarPath?: string): Promise<void> {
    const clientJar = clientJarPath ?? join(versionDirectory, `${metadata.jar ?? metadata.id}.jar`);
    await this.assertValidFile(clientJar, metadata.downloads.client.sha1, `client jar ${metadata.id}`);

    const librariesDir = getLibrariesDir(baseDirectory);
    for (const library of metadata.libraries ?? []) {
      const artifact = library.downloads?.artifact;
      const artifactPath = artifact?.path ?? getMavenArtifactPath(library.name).path;

      await this.assertValidFile(join(librariesDir, artifactPath), artifact?.sha1, `library ${library.name}`);
    }

    await this.validateAssets(metadata, baseDirectory);
  }

  async downloadAssetIndex(metadata: VersionMetadata, baseDirectory: string): Promise<string> {
    const indexesDir = join(getAssetsDir(baseDirectory), "indexes");
    const indexPath = join(indexesDir, `${metadata.assetIndex.id}.json`);
    const validation = await this.validateFile(indexPath, metadata.assetIndex.sha1);
    if (validation.valid) {
      return indexPath;
    }

    ensureDir(indexesDir);
    await downloadFile(this.resolveUrl(metadata.assetIndex.url), indexPath, this.timeoutMs);
    await this.assertValidFile(indexPath, metadata.assetIndex.sha1, `asset index ${metadata.assetIndex.id}`);
    return indexPath;
  }

  async downloadAssets(metadata: VersionMetadata, baseDirectory: string): Promise<string[]> {
    const indexPath = await this.downloadAssetIndex(metadata, baseDirectory);
    const assetIndex = readJson<AssetIndexData>(indexPath);
    const assetsDir = getAssetsDir(baseDirectory);
    const assets = Object.entries(assetIndex.objects);

    return this.mapWithConcurrency(assets, 16, async ([assetName, asset]) => {
      return this.downloadAssetObject(assetName, asset, assetsDir);
    });
  }

  async validateAssets(metadata: VersionMetadata, baseDirectory: string): Promise<void> {
    const assetsDir = getAssetsDir(baseDirectory);
    const indexPath = join(assetsDir, "indexes", `${metadata.assetIndex.id}.json`);
    await this.assertValidFile(indexPath, metadata.assetIndex.sha1, `asset index ${metadata.assetIndex.id}`);

    const assetIndex = readJson<AssetIndexData>(indexPath);
    for (const [assetName, asset] of Object.entries(assetIndex.objects)) {
      await this.assertValidFile(this.getAssetObjectPath(assetsDir, asset.hash), asset.hash, `asset ${assetName}`);
    }
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
    const artifactPath = artifact?.path ?? getMavenArtifactPath(library.name).path;

    const targetPath = join(librariesDirectory, artifactPath);
    if (pathExists(targetPath)) {
      const validation = await this.validateFile(targetPath, artifact?.sha1);
      if (validation.valid) {
        return targetPath;
      }
    }

    ensureDir(dirname(targetPath));
    const baseUrl = this.ensureTrailingSlash(this.resolveUrl(library.url ?? this.getLibrariesBase()));
    const url = artifact?.url ? this.resolveUrl(artifact.url) : `${baseUrl}${artifactPath}`;
    await downloadFile(url, targetPath, this.timeoutMs);

    if (artifact?.sha1) {
      const checksum = await sha1File(targetPath);
      if (checksum !== artifact.sha1) {
        throw new Error(`Library checksum mismatch for ${library.name}: expected ${artifact.sha1}, got ${checksum}`);
      }
    }

    return targetPath;
  }

  private async installFabricLoader(options: InstallLoaderOptions): Promise<PreparedVersion> {
    const baseVersion = await this.prepareVersion(options.minecraftVersion, options.baseDirectory, options);
    const loaderVersion = options.loaderVersion ?? await this.getLatestFabricLoaderVersion(options.minecraftVersion);
    const metadata = await this.fetchJson<VersionMetadataInput>(
      `${this.getFabricMetaBase()}/versions/loader/${encodeURIComponent(options.minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
    );
    return this.installProfileLoaderVersion(metadata, baseVersion, options.baseDirectory, options);
  }

  private async installQuiltLoader(options: InstallLoaderOptions): Promise<PreparedVersion> {
    const baseVersion = await this.prepareVersion(options.minecraftVersion, options.baseDirectory, options);
    const loaderVersion = options.loaderVersion ?? await this.getLatestQuiltLoaderVersion(options.minecraftVersion);
    const metadata = await this.fetchJson<VersionMetadataInput>(
      `${this.getQuiltMetaBase()}/versions/loader/${encodeURIComponent(options.minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
    );
    return this.installProfileLoaderVersion(metadata, baseVersion, options.baseDirectory, options);
  }

  private async installForgeLoader(options: InstallLoaderOptions): Promise<PreparedVersion> {
    const baseVersion = await this.prepareVersion(options.minecraftVersion, options.baseDirectory, options);
    const forgeVersion = await this.resolveForgeVersion(options.minecraftVersion, options.loaderVersion);
    const forgeId = `${options.minecraftVersion}-forge-${forgeVersion.replace(`${options.minecraftVersion}-`, "")}`;
    let versionDirectory = join(getVersionDir(options.baseDirectory), forgeId);

    if (!this.hasVersionMetadata(versionDirectory, forgeId)) {
      const installerDir = join(options.baseDirectory, "installers");
      ensureDir(installerDir);
      const installerPath = join(installerDir, `forge-${forgeVersion}-installer.jar`);
      const installerUrl = `${this.getForgeMavenBase()}net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
      await downloadFile(installerUrl, installerPath, this.timeoutMs);
      this.ensureLauncherProfiles(options.baseDirectory, options.minecraftVersion);

      const javaExecutable = options.javaPath ?? findJavaExecutable();
      if (!javaExecutable) {
        throw new Error("Java executable not found on the system.");
      }

      const exitCode = await runJavaProcess({
        javaExecutable,
        args: ["-jar", installerPath, "--installClient", options.baseDirectory],
        cwd: options.baseDirectory,
      });
      if (exitCode !== 0) {
        throw new Error(`Forge installer exited with code ${exitCode}.`);
      }
    }

    if (!this.hasVersionMetadata(versionDirectory, forgeId)) {
      versionDirectory = this.findInstalledForgeVersionDirectory(options.minecraftVersion, options.baseDirectory);
    }

    const forgeMetadata = this.readVersionMetadataFromDirectory(versionDirectory, forgeId);
    const metadata = this.mergeVersionMetadata(baseVersion.metadata, forgeMetadata);
    await this.downloadLibraries(metadata, options.baseDirectory);
    if (options.validate ?? true) {
      await this.validateVersionFiles(metadata, options.baseDirectory, baseVersion.versionDirectory, baseVersion.clientJarPath);
    }

    return { metadata, versionDirectory, clientJarPath: baseVersion.clientJarPath };
  }

  private async installProfileLoaderVersion(
    loaderMetadata: VersionMetadataInput,
    baseVersion: PreparedVersion,
    baseDirectory: string,
    options?: PrepareVersionOptions
  ): Promise<PreparedVersion> {
    const metadata = this.mergeVersionMetadata(baseVersion.metadata, loaderMetadata);
    const versionDirectory = join(getVersionDir(baseDirectory), loaderMetadata.id);
    ensureDir(versionDirectory);
    writeJson(join(versionDirectory, "version.json"), loaderMetadata);
    writeJson(join(versionDirectory, `${loaderMetadata.id}.json`), loaderMetadata);

    await this.downloadLibraries(metadata, baseDirectory);
    if (options?.validate ?? true) {
      await this.validateVersionFiles(metadata, baseDirectory, baseVersion.versionDirectory, baseVersion.clientJarPath);
    }

    return { metadata, versionDirectory, clientJarPath: baseVersion.clientJarPath };
  }

  private mergeVersionMetadata(parent: VersionMetadata, child: VersionMetadataInput): VersionMetadata {
    const parentArguments = parent.arguments ?? {};
    const childArguments = child.arguments ?? {};
    const argumentsValue: NonNullable<VersionMetadata["arguments"]> = {
      jvm: [...(parentArguments.jvm ?? []), ...(childArguments.jvm ?? [])],
    };
    const gameArguments = childArguments.game
      ? [...(parentArguments.game ?? []), ...childArguments.game]
      : parentArguments.game;
    if (gameArguments) {
      argumentsValue.game = gameArguments;
    }

    return {
      ...parent,
      ...child,
      id: child.id,
      assets: child.assets ?? parent.assets,
      assetIndex: child.assetIndex ?? parent.assetIndex,
      downloads: child.downloads ? { ...parent.downloads, ...child.downloads } : parent.downloads,
      libraries: [...(parent.libraries ?? []), ...(child.libraries ?? [])],
      mainClass: child.mainClass ?? parent.mainClass,
      arguments: argumentsValue,
      minimumLauncherVersion: child.minimumLauncherVersion ?? parent.minimumLauncherVersion,
      jar: child.jar ?? child.inheritsFrom ?? parent.id,
    };
  }

  private async getLatestFabricLoaderVersion(minecraftVersion: string): Promise<string> {
    const versions = await this.fetchJson<Array<{ loader?: { version?: string; stable?: boolean } }>>(
      `${this.getFabricMetaBase()}/versions/loader/${encodeURIComponent(minecraftVersion)}`
    );
    const version = versions.find((entry) => entry.loader?.stable)?.loader?.version ?? versions[0]?.loader?.version;
    if (!version) {
      throw new Error(`No Fabric loader version found for Minecraft ${minecraftVersion}.`);
    }
    return version;
  }

  private async getLatestQuiltLoaderVersion(minecraftVersion: string): Promise<string> {
    const versions = await this.fetchJson<Array<{ loader?: { version?: string } }>>(
      `${this.getQuiltMetaBase()}/versions/loader/${encodeURIComponent(minecraftVersion)}`
    );
    const version = versions[0]?.loader?.version;
    if (!version) {
      throw new Error(`No Quilt loader version found for Minecraft ${minecraftVersion}.`);
    }
    return version;
  }

  private async resolveForgeVersion(minecraftVersion: string, loaderVersion?: string): Promise<string> {
    if (loaderVersion) {
      return loaderVersion.startsWith(`${minecraftVersion}-`) ? loaderVersion : `${minecraftVersion}-${loaderVersion}`;
    }

    const metadata = await this.fetchText(`${this.getForgeMavenBase()}net/minecraftforge/forge/maven-metadata.xml`);
    const versions = Array.from(metadata.matchAll(/<version>([^<]+)<\/version>/g), (match) => match[1]).filter(
      (version): version is string => !!version?.startsWith(`${minecraftVersion}-`)
    );
    const version = versions.at(-1);
    if (!version) {
      throw new Error(`No Forge loader version found for Minecraft ${minecraftVersion}.`);
    }
    return version;
  }

  private readVersionMetadataFromDirectory(versionDirectory: string, versionId: string): VersionMetadataInput {
    const versionJson = join(versionDirectory, "version.json");
    if (pathExists(versionJson)) {
      return readJson<VersionMetadataInput>(versionJson);
    }

    const standardJson = join(versionDirectory, `${versionId}.json`);
    if (pathExists(standardJson)) {
      return readJson<VersionMetadataInput>(standardJson);
    }

    throw new Error(`Version metadata not found in ${versionDirectory}.`);
  }

  private hasVersionMetadata(versionDirectory: string, versionId: string): boolean {
    return pathExists(join(versionDirectory, "version.json")) || pathExists(join(versionDirectory, `${versionId}.json`));
  }

  private findInstalledForgeVersionDirectory(minecraftVersion: string, baseDirectory: string): string {
    const versionsDir = getVersionDir(baseDirectory);
    const forgePrefix = `${minecraftVersion}-forge-`;
    const candidates = Array.from(this.readDirectoryNames(versionsDir)).filter((name) => name.startsWith(forgePrefix));
    const versionId = candidates.at(-1);
    if (!versionId) {
      throw new Error(`Installed Forge version for Minecraft ${minecraftVersion} not found.`);
    }
    return join(versionsDir, versionId);
  }

  private ensureLauncherProfiles(baseDirectory: string, minecraftVersion: string): void {
    const profilePath = join(baseDirectory, "launcher_profiles.json");
    const now = new Date().toISOString();
    const profileId = `craft-sdk-${minecraftVersion}`;
    const profiles = pathExists(profilePath)
      ? readJson<LauncherProfilesFile>(profilePath)
      : {};

    profiles.profiles ??= {};
    profiles.settings ??= {};
    profiles.version ??= 3;
    profiles.profiles[profileId] ??= {
      name: `Craft SDK ${minecraftVersion}`,
      type: "custom",
      created: now,
      lastUsed: now,
      lastVersionId: minecraftVersion,
    };

    writeJson(profilePath, profiles);
  }

  private async downloadAssetObject(assetName: string, asset: AssetObject, assetsDir: string): Promise<string> {
    const targetPath = this.getAssetObjectPath(assetsDir, asset.hash);
    const validation = await this.validateFile(targetPath, asset.hash);
    if (validation.valid) {
      return targetPath;
    }

    ensureDir(dirname(targetPath));
    const path = `${asset.hash.slice(0, 2)}/${asset.hash}`;
    await downloadFile(`${this.getAssetsBase()}${path}`, targetPath, this.timeoutMs);
    await this.assertValidFile(targetPath, asset.hash, `asset ${assetName}`);
    return targetPath;
  }

  async prepareVersion(versionId: string, baseDirectory: string, options?: PrepareVersionOptions): Promise<PreparedVersion> {
    const metadata = await this.downloadVersionMetadataById(versionId, baseDirectory);
    const versionDirectory = join(getVersionDir(baseDirectory), versionId);
    const clientJarPath = await this.downloadClientJar(metadata, versionDirectory);
    await this.downloadLibraries(metadata, baseDirectory);
    await this.downloadAssets(metadata, baseDirectory);
    if (options?.validate ?? true) {
      await this.validateVersionFiles(metadata, baseDirectory, versionDirectory);
    }
    return { metadata, versionDirectory, clientJarPath };
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

  private getAssetObjectPath(assetsDir: string, hash: string): string {
    return join(assetsDir, "objects", hash.slice(0, 2), hash);
  }

  private async mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let index = 0;

    async function runWorker() {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        const item = items[currentIndex];
        if (item) {
          results[currentIndex] = await worker(item);
        }
      }
    }

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
  }

  private readDirectoryNames(directory: string): string[] {
    if (!pathExists(directory)) {
      return [];
    }

    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const text = await this.fetchText(url);
    return JSON.parse(text) as T;
  }

  private async fetchText(url: string): Promise<string> {
    const resolvedUrl = this.resolveUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(resolvedUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${resolvedUrl}: ${response.status}`);
      }
      return response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveUrl(url: string): string {
    return resolveApiUrl(url, this.apiSource);
  }

  private ensureTrailingSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
  }

  private async assertValidFile(filePath: string, expectedSha1: string | undefined, label: string): Promise<void> {
    const validation = await this.validateFile(filePath, expectedSha1);
    if (validation.valid) {
      return;
    }

    if (validation.reason === "checksum_mismatch") {
      throw new Error(`${label} checksum mismatch: expected ${validation.expectedSha1}, got ${validation.actualSha1}`);
    }

    throw new Error(`${label} missing: ${filePath}`);
  }
}
