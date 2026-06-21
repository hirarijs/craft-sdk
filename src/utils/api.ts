import { API_ENDPOINTS, API_SOURCE, type ApiSource } from "../constant.js";

interface UrlReplacement {
  from: string;
  to: string;
}

function buildBmclapiReplacements(): UrlReplacement[] {
  const endpoints = API_ENDPOINTS[API_SOURCE.BMCLAPI];
  const mirrorRoot = "https://bmclapi2.bangbang93.com/";

  return [
    { from: "https://launchermeta.mojang.com/", to: mirrorRoot },
    { from: "http://launchermeta.mojang.com/", to: mirrorRoot },
    { from: "https://launcher.mojang.com/", to: mirrorRoot },
    { from: "http://launcher.mojang.com/", to: mirrorRoot },
    { from: "https://piston-meta.mojang.com/", to: mirrorRoot },
    { from: "https://piston-data.mojang.com/", to: mirrorRoot },
    { from: "https://libraries.minecraft.net/", to: endpoints.librariesBase },
    { from: "http://libraries.minecraft.net/", to: endpoints.librariesBase },
    { from: "https://resources.download.minecraft.net/", to: endpoints.assetsBase },
    { from: "http://resources.download.minecraft.net/", to: endpoints.assetsBase },
    { from: "https://maven.minecraftforge.net/", to: endpoints.forgeMavenBase },
    { from: "https://files.minecraftforge.net/maven/", to: endpoints.forgeMavenBase },
    { from: "https://maven.fabricmc.net/", to: endpoints.librariesBase },
    { from: "https://maven.quiltmc.org/repository/release/", to: endpoints.librariesBase },
    { from: "https://maven.neoforged.net/releases/", to: endpoints.librariesBase },
    { from: "https://meta.fabricmc.net/", to: "https://bmclapi2.bangbang93.com/fabric-meta/" },
    { from: "https://meta.quiltmc.org/", to: "https://bmclapi2.bangbang93.com/quilt-meta/" },
    { from: "https://authlib-injector.yushi.moe/", to: "https://bmclapi2.bangbang93.com/mirrors/authlib-injector/" },
  ];
}

const BMCLAPI_REPLACEMENTS = buildBmclapiReplacements();

export function resolveApiUrl(url: string, apiSource: ApiSource): string {
  if (apiSource !== API_SOURCE.BMCLAPI) {
    return url;
  }

  const replacement = BMCLAPI_REPLACEMENTS.find((entry) => url.startsWith(entry.from));
  if (!replacement) {
    return url;
  }

  return `${replacement.to}${url.slice(replacement.from.length)}`;
}
