export type LoaderType = "forge" | "fabric" | "quilt" | "vanilla";

export interface ModPackage {
  id: string;
  name: string;
  version: string;
  loader: LoaderType;
  sourceUrl: string;
  fileName?: string;
  installDir?: string;
}

export interface ModInstallTarget {
  gameDirectory: string;
  loader: LoaderType;
  modsDirectory?: string;
  installPath?: string;
}
