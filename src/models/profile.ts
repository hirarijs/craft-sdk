export interface AuthSession {
  accessToken: string;
  clientToken: string;
  selectedProfile?: {
    id: string;
    name: string;
  };
  profile?: {
    id: string;
    name: string;
  };
  userProperties?: Record<string, unknown>;
  availableProfiles?: Array<{ id: string; name: string }>;
  timestamp: number;
}

export interface UserProfile {
  username: string;
  uuid?: string;
  email?: string;
  session?: AuthSession;
}

export interface LaunchProfile {
  name: string;
  version: string;
  javaPath?: string;
  gameDirectory: string;
  assetsDirectory: string;
  profileProperties?: Record<string, unknown>;
}
