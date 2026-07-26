// Empty shared types placeholder package
export interface HealthStatus {
  ok: boolean;
  service: 'atlas-api';
  appVersion: string;
  gitSha: string;
  buildTime: string;
  schemaVersion: string;
  registryVersion: number;
}

export interface MissionControlCard {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

export interface MissionControlStatus {
  ok: boolean;
  cards: MissionControlCard[];
}
