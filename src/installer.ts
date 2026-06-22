import { join, dirname } from "node:path";
import { readdirSync } from "node:fs";
import { ensureDir, pathExists, readJson, writeJson } from "./utils/fs.js";
import {
  downloadFile,
  type DownloadFileOptions,
  type DownloadProcessCallback,
  type DownloadProcessOptions,
} from "./utils/downloader.js";
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

export interface InstallerOptions extends DownloadProcessOptions {
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

export interface VersionDirectoryOptions {
  versionDirectory?: string;
}

export interface LoaderVersionDirectoryOptions extends VersionDirectoryOptions {
  loaderVersionDirectory?: string;
}

export interface AssetDirectoryOptions {
  assetsDirectory?: string;
}

export interface LibraryDirectoryOptions {
  librariesDirectory?: string;
}

export interface InstallDirectoryOptions extends VersionDirectoryOptions, AssetDirectoryOptions, LibraryDirectoryOptions {}

export interface PrepareVersionOptions extends DownloadProcessOptions, InstallDirectoryOptions {
  validate?: boolean;
}

export interface DownloadVersionMetadataOptions extends DownloadProcessOptions, VersionDirectoryOptions {}

export type LoaderInstallType = "forge" | "fabric" | "quilt";

export interface InstallLoaderOptions extends PrepareVersionOptions {
  loader: LoaderInstallType;
  minecraftVersion: string;
  baseDirectory: string;
  loaderVersion?: string;
  javaPath?: string;
  loaderVersionDirectory?: string;
}

export interface PreparedVersion {
  metadata: VersionMetadata;
  versionDirectory: string;
  assetsDirectory: string;
  librariesDirectory: string;
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
  private process?: DownloadProcessCallback;

  constructor(options?: InstallerOptions) {
    this.apiSource = options?.apiSource ?? API_SOURCE.MOJANG;
    this.timeoutMs = options?.timeoutMs ?? 30000;
    if (options?.process) {
      this.process = options.process;
    }
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

  async downloadMinecraftVersionManifest(
    targetDirectory: string,
    options?: DownloadProcessOptions
  ): Promise<VersionManifest> {
    ensureDir(targetDirectory);
    const manifestPath = join(targetDirectory, "version_manifest_v2.json");
    await downloadFile(this.getVersionManifestUrl(), manifestPath, this.getDownloadOptions(options));
    return readJson<VersionManifest>(manifestPath);
  }

  async downloadVersionMetadata(
    url: string,
    targetDirectory: string,
    options?: DownloadProcessOptions
  ): Promise<VersionMetadata> {
    ensureDir(targetDirectory);
    const targetPath = join(targetDirectory, "version.json");
    await downloadFile(this.resolveUrl(url), targetPath, this.getDownloadOptions(options));
    return readJson<VersionMetadata>(targetPath);
  }

  async downloadVersionMetadataById(
    versionId: string,
    baseDirectory: string,
    options?: DownloadVersionMetadataOptions
  ): Promise<VersionMetadata> {
    const manifest = await this.downloadMinecraftVersionManifest(baseDirectory, options);
    const versionEntry = manifest.versions.find((entry) => entry.id === versionId);
    if (!versionEntry) {
      throw new Error(`Version ${versionId} not found in manifest.`);
    }
    const versionDir = this.getVersionDirectory(baseDirectory, versionId, options);
    return this.downloadVersionMetadata(this.resolveUrl(versionEntry.url), versionDir, options);
  }

  async downloadClientJar(
    metadata: VersionMetadata,
    versionDirectory: string,
    options?: DownloadProcessOptions
  ): Promise<string> {
    const clientJar = metadata.downloads.client;
    const jarPath = join(versionDirectory, `${metadata.id}.jar`);
    const validation = await this.validateFile(jarPath, clientJar.sha1);
    if (validation.valid) {
      return jarPath;
    }

    await downloadFile(this.resolveUrl(clientJar.url ?? ""), jarPath, this.getDownloadOptions(options));

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

  async validateVersionFiles(
    metadata: VersionMetadata,
    baseDirectory: string,
    versionDirectory: string,
    clientJarPath?: string,
    options?: AssetDirectoryOptions & LibraryDirectoryOptions
  ): Promise<void> {
    const clientJar = clientJarPath ?? join(versionDirectory, `${metadata.jar ?? metadata.id}.jar`);
    await this.assertValidFile(clientJar, metadata.downloads.client.sha1, `client jar ${metadata.id}`);

    const librariesDir = this.getLibrariesDirectory(baseDirectory, options);
    for (const library of metadata.libraries ?? []) {
      const artifact = library.downloads?.artifact;
      const artifactPath = artifact?.path ?? getMavenArtifactPath(library.name).path;

      await this.assertValidFile(join(librariesDir, artifactPath), artifact?.sha1, `library ${library.name}`);
    }

    await this.validateAssets(metadata, baseDirectory, options);
  }

  async downloadAssetIndex(
    metadata: VersionMetadata,
    baseDirectory: string,
    options?: DownloadProcessOptions & AssetDirectoryOptions
  ): Promise<string> {
    const indexesDir = join(this.getAssetsDirectory(baseDirectory, options), "indexes");
    const indexPath = join(indexesDir, `${metadata.assetIndex.id}.json`);
    const validation = await this.validateFile(indexPath, metadata.assetIndex.sha1);
    if (validation.valid) {
      return indexPath;
    }

    ensureDir(indexesDir);
    await downloadFile(this.resolveUrl(metadata.assetIndex.url), indexPath, this.getDownloadOptions(options));
    await this.assertValidFile(indexPath, metadata.assetIndex.sha1, `asset index ${metadata.assetIndex.id}`);
    return indexPath;
  }

  async downloadAssets(
    metadata: VersionMetadata,
    baseDirectory: string,
    options?: DownloadProcessOptions & AssetDirectoryOptions
  ): Promise<string[]> {
    const indexPath = await this.downloadAssetIndex(metadata, baseDirectory, options);
    const assetIndex = readJson<AssetIndexData>(indexPath);
    const assetsDir = this.getAssetsDirectory(baseDirectory, options);
    const assets = Object.entries(assetIndex.objects);

    return this.mapWithConcurrency(assets, 16, async ([assetName, asset]) => {
      return this.downloadAssetObject(assetName, asset, assetsDir, options);
    });
  }

  async validateAssets(
    metadata: VersionMetadata,
    baseDirectory: string,
    options?: AssetDirectoryOptions
  ): Promise<void> {
    const assetsDir = this.getAssetsDirectory(baseDirectory, options);
    const indexPath = join(assetsDir, "indexes", `${metadata.assetIndex.id}.json`);
    await this.assertValidFile(indexPath, metadata.assetIndex.sha1, `asset index ${metadata.assetIndex.id}`);

    const assetIndex = readJson<AssetIndexData>(indexPath);
    for (const [assetName, asset] of Object.entries(assetIndex.objects)) {
      await this.assertValidFile(this.getAssetObjectPath(assetsDir, asset.hash), asset.hash, `asset ${assetName}`);
    }
  }

  async downloadLibraries(
    metadata: VersionMetadata,
    baseDirectory: string,
    options?: DownloadProcessOptions & LibraryDirectoryOptions
  ): Promise<string[]> {
    const librariesDir = this.getLibrariesDirectory(baseDirectory, options);
    const installed: string[] = [];

    for (const library of metadata.libraries ?? []) {
      const libraryPath = await this.downloadLibraryArtifact(library, librariesDir, options);
      installed.push(libraryPath);
    }

    return installed;
  }

  private async downloadLibraryArtifact(
    library: LibraryEntry,
    librariesDirectory: string,
    options?: DownloadProcessOptions
  ): Promise<string> {
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
    await downloadFile(url, targetPath, this.getDownloadOptions(options));

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
    const defaultVersionDirectory = this.getDefaultVersionDirectory(options.baseDirectory, forgeId);
    const versionDirectory = this.getLoaderVersionDirectory(options.baseDirectory, forgeId, options);

    if (!this.hasVersionMetadata(versionDirectory, forgeId) && !this.hasVersionMetadata(defaultVersionDirectory, forgeId)) {
      const installerDir = join(options.baseDirectory, "installers");
      ensureDir(installerDir);
      const installerPath = join(installerDir, `forge-${forgeVersion}-installer.jar`);
      const installerUrl = `${this.getForgeMavenBase()}net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
      await downloadFile(installerUrl, installerPath, this.getDownloadOptions(options));
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
      const installedVersionDirectory = this.hasVersionMetadata(defaultVersionDirectory, forgeId)
        ? defaultVersionDirectory
        : this.findInstalledForgeVersionDirectory(options.minecraftVersion, options.baseDirectory);
      const installedMetadata = this.readVersionMetadataFromDirectory(installedVersionDirectory, forgeId);
      this.writeVersionMetadata(versionDirectory, forgeId, installedMetadata);
    }

    const forgeMetadata = this.readVersionMetadataFromDirectory(versionDirectory, forgeId);
    const metadata = this.mergeVersionMetadata(baseVersion.metadata, forgeMetadata);
    await this.downloadLibraries(metadata, options.baseDirectory, options);
    if (options.validate ?? true) {
      await this.validateVersionFiles(metadata, options.baseDirectory, baseVersion.versionDirectory, baseVersion.clientJarPath, options);
    }

    return {
      metadata,
      versionDirectory,
      assetsDirectory: baseVersion.assetsDirectory,
      librariesDirectory: baseVersion.librariesDirectory,
      clientJarPath: baseVersion.clientJarPath,
    };
  }

  private async installProfileLoaderVersion(
    loaderMetadata: VersionMetadataInput,
    baseVersion: PreparedVersion,
    baseDirectory: string,
    options: InstallLoaderOptions
  ): Promise<PreparedVersion> {
    const metadata = this.mergeVersionMetadata(baseVersion.metadata, loaderMetadata);
    const versionDirectory = this.getLoaderVersionDirectory(baseDirectory, loaderMetadata.id, options);
    this.writeVersionMetadata(versionDirectory, loaderMetadata.id, loaderMetadata);

    await this.downloadLibraries(metadata, baseDirectory, options);
    if (options.validate ?? true) {
      await this.validateVersionFiles(metadata, baseDirectory, baseVersion.versionDirectory, baseVersion.clientJarPath, options);
    }

    return {
      metadata,
      versionDirectory,
      assetsDirectory: baseVersion.assetsDirectory,
      librariesDirectory: baseVersion.librariesDirectory,
      clientJarPath: baseVersion.clientJarPath,
    };
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
    for (const metadataPath of [join(versionDirectory, "version.json"), join(versionDirectory, `${versionId}.json`)]) {
      if (!pathExists(metadataPath)) {
        continue;
      }

      const metadata = readJson<VersionMetadataInput>(metadataPath);
      if (metadata.id === versionId) {
        return metadata;
      }
    }

    throw new Error(`Version metadata for ${versionId} not found in ${versionDirectory}.`);
  }

  private writeVersionMetadata(versionDirectory: string, versionId: string, metadata: VersionMetadataInput): void {
    ensureDir(versionDirectory);
    writeJson(join(versionDirectory, "version.json"), metadata);
    writeJson(join(versionDirectory, `${versionId}.json`), metadata);
  }

  private hasVersionMetadata(versionDirectory: string, versionId: string): boolean {
    return this.isVersionMetadataFile(join(versionDirectory, "version.json"), versionId) ||
      this.isVersionMetadataFile(join(versionDirectory, `${versionId}.json`), versionId);
  }

  private isVersionMetadataFile(filePath: string, versionId: string): boolean {
    if (!pathExists(filePath)) {
      return false;
    }

    try {
      return readJson<VersionMetadataInput>(filePath).id === versionId;
    } catch {
      return false;
    }
  }

  private getVersionDirectory(
    baseDirectory: string,
    versionId: string,
    options?: VersionDirectoryOptions
  ): string {
    return this.ensureVersionDirectory(options?.versionDirectory ?? this.getDefaultVersionDirectory(baseDirectory, versionId));
  }

  private getLoaderVersionDirectory(
    baseDirectory: string,
    versionId: string,
    options?: LoaderVersionDirectoryOptions
  ): string {
    return this.ensureVersionDirectory(options?.loaderVersionDirectory ?? this.getDefaultVersionDirectory(baseDirectory, versionId));
  }

  private getDefaultVersionDirectory(baseDirectory: string, versionId: string): string {
    return join(getVersionDir(baseDirectory), versionId);
  }

  private ensureVersionDirectory(versionDirectory: string): string {
    ensureDir(versionDirectory);
    return versionDirectory;
  }

  private getAssetsDirectory(baseDirectory: string, options?: AssetDirectoryOptions): string {
    const assetsDirectory = options?.assetsDirectory ?? getAssetsDir(baseDirectory);
    ensureDir(assetsDirectory);
    return assetsDirectory;
  }

  private getLibrariesDirectory(baseDirectory: string, options?: LibraryDirectoryOptions): string {
    const librariesDirectory = options?.librariesDirectory ?? getLibrariesDir(baseDirectory);
    ensureDir(librariesDirectory);
    return librariesDirectory;
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

  private async downloadAssetObject(
    assetName: string,
    asset: AssetObject,
    assetsDir: string,
    options?: DownloadProcessOptions
  ): Promise<string> {
    const targetPath = this.getAssetObjectPath(assetsDir, asset.hash);
    const validation = await this.validateFile(targetPath, asset.hash);
    if (validation.valid) {
      return targetPath;
    }

    ensureDir(dirname(targetPath));
    const path = `${asset.hash.slice(0, 2)}/${asset.hash}`;
    await downloadFile(`${this.getAssetsBase()}${path}`, targetPath, this.getDownloadOptions(options));
    await this.assertValidFile(targetPath, asset.hash, `asset ${assetName}`);
    return targetPath;
  }

  async prepareVersion(versionId: string, baseDirectory: string, options?: PrepareVersionOptions): Promise<PreparedVersion> {
    const metadata = await this.downloadVersionMetadataById(versionId, baseDirectory, options);
    const versionDirectory = this.getVersionDirectory(baseDirectory, versionId, options);
    const assetsDirectory = this.getAssetsDirectory(baseDirectory, options);
    const librariesDirectory = this.getLibrariesDirectory(baseDirectory, options);
    const clientJarPath = await this.downloadClientJar(metadata, versionDirectory, options);
    await this.downloadLibraries(metadata, baseDirectory, options);
    await this.downloadAssets(metadata, baseDirectory, options);
    if (options?.validate ?? true) {
      await this.validateVersionFiles(metadata, baseDirectory, versionDirectory, undefined, options);
    }
    return { metadata, versionDirectory, assetsDirectory, librariesDirectory, clientJarPath };
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

      await downloadFile(mod.sourceUrl, destination, this.getDownloadOptions(options));
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

  private getDownloadOptions(options?: DownloadProcessOptions): DownloadFileOptions {
    const downloadOptions: DownloadFileOptions = {
      timeoutMs: this.timeoutMs,
    };
    const processCallback = options?.process ?? this.process;
    if (processCallback) {
      downloadOptions.process = processCallback;
    }
    return downloadOptions;
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
