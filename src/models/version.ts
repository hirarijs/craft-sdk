export interface LibraryRule {
  action: "allow" | "disallow";
  os?: { name?: string; arch?: string };
  features?: Record<string, boolean>;
}

export interface LibraryArtifact {
  path: string;
  sha1?: string;
  size?: number;
  url?: string;
}

export interface LibraryEntry {
  name: string;
  url?: string;
  downloads?: {
    artifact?: LibraryArtifact;
    classifiers?: Record<string, LibraryArtifact>;
  };
  rules?: LibraryRule[];
  natives?: Record<string, string>;
  extract?: {
    exclude?: string[];
  };
}

export interface AssetIndex {
  id: string;
  sha1: string;
  size: number;
  totalSize: number;
  url: string;
}

export interface VersionManifestEntry {
  id: string;
  type: string;
  time: string;
  releaseTime: string;
  url: string;
  sha1: string;
}

export interface VersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: VersionManifestEntry[];
}

export interface VersionMetadata {
  id: string;
  assets: string;
  assetIndex: AssetIndex;
  downloads: {
    client: LibraryArtifact;
    server?: LibraryArtifact;
    client_mappings?: LibraryArtifact;
    server_mappings?: LibraryArtifact;
  };
  libraries: LibraryEntry[];
  mainClass: string;
  arguments?: {
    game?: Array<string | { rules?: LibraryRule[]; value: string | string[] }>;
    jvm?: Array<string | { rules?: LibraryRule[]; value: string | string[] }>;
  };
  minimumLauncherVersion: number;
  inheritsFrom?: string;
  jar?: string;
}

export interface LocalVersionInfo {
  id: string;
  releaseTime: string;
  type: string;
  jarPath: string;
}
