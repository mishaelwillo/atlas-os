// Empty shared types placeholder package
export interface HealthStatus {
  ok: boolean;
  version: string;
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
