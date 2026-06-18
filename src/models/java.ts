export interface JavaRuntimeInfo {
  javaExecutable: string;
  version?: string;
  vendor?: string;
  os: NodeJS.Platform;
  arch: string;
  isBundled?: boolean;
}

export interface JavaDownloadConfig {
  platform: NodeJS.Platform;
  arch: string;
  targetDirectory: string;
  preferBundled?: boolean;
}
