import { writeJson, readJson, pathExists } from "./utils/fs.js";
import type { AuthSession, UserProfile } from "./models/profile.js";

const SESSION_FILE = "craft-sdk-session.json";

export async function loginWithToken(accessToken: string, clientToken: string, profileId: string, profileName: string): Promise<AuthSession> {
  const session: AuthSession = {
    accessToken,
    clientToken,
    selectedProfile: { id: profileId, name: profileName },
    profile: { id: profileId, name: profileName },
    timestamp: Date.now(),
  };

  saveSession(session);
  return session;
}

export function saveSession(session: AuthSession, filePath = SESSION_FILE): void {
  writeJson(filePath, session);
}

export function loadSession(filePath = SESSION_FILE): AuthSession | undefined {
  if (!pathExists(filePath)) {
    return undefined;
  }

  return readJson<AuthSession>(filePath);
}

export function createProfile(username: string, session?: AuthSession): UserProfile {
  return { username, session };
}
