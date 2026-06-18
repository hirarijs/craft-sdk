import { loginWithToken, saveSession, loadSession, createProfile } from "./auth.js";

async function run() {
  const session = await loginWithToken("dummy-access-token", "dummy-client-token", "dummy-profile-id", "DummyPlayer");
  saveSession(session, "./temp-session.json");

  const loaded = loadSession("./temp-session.json");
  const profile = createProfile("DummyPlayer", loaded);

  console.log("Test session created:", session);
  console.log("Loaded session from disk:", loaded);
  console.log("User profile:", profile);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
