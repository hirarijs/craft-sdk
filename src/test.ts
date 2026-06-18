import { CraftSDK } from "./sdk.js";

async function run() {
  const sdk = new CraftSDK({ apiSource: "bmclapi", sessionFile: "./temp-session.json" });

  const session = await sdk.auth.loginWithToken("dummy-access-token", "dummy-client-token", "dummy-profile-id", "DummyPlayer");
  console.log("Session created:", session);

  const manifestPath = await sdk.downloader.downloadVersionManifest("./temp-version-manifest.json");
  console.log("Version manifest downloaded to:", manifestPath);

  try {
    const { metadata, versionDirectory } = await sdk.installer.prepareVersion("1.20.1", ".minecraft");
    console.log("Prepared version:", metadata.id, "at", versionDirectory);
  } catch (error) {
    console.warn("Version preparation skipped in test:", error);
  }

  console.log("Launcher ready:", sdk.launcher !== undefined);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});