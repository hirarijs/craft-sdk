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
  fabricMetaBase: string;
  quiltMetaBase: string;
  forgeMavenBase: string;
}

const BMCLAPI_BASE = "https://bmclapi2.bangbang93.com/";

export const API_ENDPOINTS: Record<ApiSource, ApiEndpoints> = {
  mojang: {
    versionManifest: "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    librariesBase: "https://libraries.minecraft.net/",
    assetsBase: "https://resources.download.minecraft.net/",
    fabricMetaBase: "https://meta.fabricmc.net/v2",
    quiltMetaBase: "https://meta.quiltmc.org/v3",
    forgeMavenBase: "https://maven.minecraftforge.net/",
  },
  bmclapi: {
    versionManifest: `${BMCLAPI_BASE}mc/game/version_manifest_v2.json`,
    librariesBase: `${BMCLAPI_BASE}maven/`,
    assetsBase: `${BMCLAPI_BASE}assets/`,
    fabricMetaBase: `${BMCLAPI_BASE}fabric-meta/v2`,
    quiltMetaBase: `${BMCLAPI_BASE}quilt-meta/v3`,
    forgeMavenBase: `${BMCLAPI_BASE}maven/`,
  },
};
