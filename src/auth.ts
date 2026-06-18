import { writeJson, readJson, pathExists } from "./utils/fs.js";
import type { AuthSession, UserProfile } from "./models/profile.js";

export interface AuthOptions {
  sessionFile?: string;
}

export class AuthManager {
  private sessionFile: string;

  constructor(options?: AuthOptions) {
    this.sessionFile = options?.sessionFile ?? "craft-sdk-session.json";
  }

  async loginWithToken(accessToken: string, clientToken: string, profileId: string, profileName: string): Promise<AuthSession> {
    const session: AuthSession = {
      accessToken,
      clientToken,
      selectedProfile: { id: profileId, name: profileName },
      profile: { id: profileId, name: profileName },
      timestamp: Date.now(),
    };
    this.saveSession(session);
    return session;
  }

  saveSession(session: AuthSession): void {
    writeJson(this.sessionFile, session);
  }

  loadSession(): AuthSession | undefined {
    if (!pathExists(this.sessionFile)) {
      return undefined;
    }
    return readJson<AuthSession>(this.sessionFile);
  }

  createProfile(username: string, session?: AuthSession): UserProfile {
    const profile: UserProfile = { username };
    if (session) profile.session = session;
    return profile;
  }
}
