export interface PlatformInfo {
  os: NodeJS.Platform;
  arch: string;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
}

export function getPlatformInfo(): PlatformInfo {
  const os = process.platform;
  const arch = process.arch;

  return {
    os,
    arch,
    isWindows: os === "win32",
    isMac: os === "darwin",
    isLinux: os === "linux",
  };
}

export function isJavaSupportedPlatform(): boolean {
  const { os } = getPlatformInfo();
  return os === "win32" || os === "darwin" || os === "linux";
}
