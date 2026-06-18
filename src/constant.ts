export const API_SOURCE = {
  MOJANG: "mojang",
  BMCLAPI: "bmclapi",
} as const;

export type ApiSource = (typeof API_SOURCE)[keyof typeof API_SOURCE];

export interface ApiEndpoints {
  versionManifest: string;
  librariesBase: string;
  assetsBase: string;
  javaRuntimeBase?: string;
}

export const API_ENDPOINTS: Record<ApiSource, ApiEndpoints> = {
  mojang: {
    versionManifest: "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    librariesBase: "https://libraries.minecraft.net/",
    assetsBase: "https://resources.download.minecraft.net/",
  },
  bmclapi: {
    versionManifest: "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json",
    librariesBase: "https://bmclapi2.bangbang93.com/maven/",
    assetsBase: "https://bmclapi2.bangbang93.com/assets/",
  },
};
