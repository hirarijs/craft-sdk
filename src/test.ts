import { launchGame } from "./launcher.js";
import { loginWithToken } from "./auth.js";

async function run() {
  const session = await loginWithToken("dummy-access-token", "dummy-client-token", "dummy-profile-id", "DummyPlayer");
  console.log("Session created:", session);

  console.log("Launching game simulated... (actual launch requires valid Java and Minecraft assets)");

  const exitCode = await launchGame({
    version: "1.20.1",
    javaPath: "java",
    gameDirectory: ".minecraft",
    assetsDirectory: ".minecraft/assets",
    versionDirectory: ".minecraft/versions/1.20.1",
    authSession: session,
    loader: "vanilla",
    gameArgs: ["--username", session.selectedProfile?.name ?? "Player"],
  } as any, {
    id: "1.20.1",
    assets: "1.20",
    assetIndex: {
      id: "1.20",
      sha1: "",
      size: 0,
      totalSize: 0,
      url: "",
    },
    downloads: {
      client: {
        path: "client.jar",
        sha1: "",
        size: 0,
        url: "",
      },
    },
    libraries: [],
    mainClass: "net.minecraft.client.Main",
    minimumLauncherVersion: 1,
  });

  console.log("Launcher exit code:", exitCode);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
