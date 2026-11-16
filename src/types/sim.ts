export type Gear = 'R' | 'N' | '1' | '2' | '3' | '4' | '5' | '6';

export type TrackTheme = 'gp-asphalt' | 'alpine-dusk' | 'desert-canyon';

export interface TrackNode {
  x: number;
  y: number;
  z: number;
  bank?: number; // degrees, positive banks inward
}

export interface TrackDefinition {
  id: string;
  name: string;
  width: number;
  theme: TrackTheme;
  nodes: TrackNode[];
  totalLaps: number;
  isCustom?: boolean;
}

export type CarSpecId = 'gt-coupe' | 'touring-rs' | 'track-v8';

export interface CarSpec {
  id: CarSpecId;
  name: string;
  engineLabel: string;
  massKg: number;
  redlineRpm: number;
  idleRpm: number;
  stallRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  finalDrive: number;
  gearRatios: Record<Gear, number>;
  wheelRadius: number;
  dragCoeff: number;
  gripMu: number;
  defaultColor: string;
}

export type WeatherCondition = 'clear' | 'fog' | 'rain' | 'storm';

export type TimeOfDay = 'dawn' | 'midday' | 'dusk' | 'night';

export interface EnvironmentConfig {
  weather: WeatherCondition;
  timeOfDay: TimeOfDay;
  dynamicCycle: boolean;
}

export interface DamageState {
  body: number; // 0..1
  engine: number; // 0..1
  transmission: number; // 0..1
  tires: [number, number, number, number]; // FL, FR, RL, RR (0..1)
  suspension: [number, number, number, number]; // FL, FR, RL, RR (0..1)
  zones: {
    front: number;
    rear: number;
    left: number;
    right: number;
  };
}

export interface TelemetrySnapshot {
  rpm: number;
  redlineRpm: number;
  speedKmh: number;
  gear: Gear;
  clutch: number; // 0 = engaged/released, 1 = depressed
  throttle: number;
  brake: number;
  ignitionOn: boolean;
  stalled: boolean;
  cranking: boolean;
  wheelSpinSlip: number;
  surface: 'asphalt' | 'curb' | 'offtrack';
  gripPercent: number;
  headlightsOn: boolean;
  damage: DamageState;
  lap: number;
  totalLaps: number;
  currentLapMs: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  grindMessage: string | null;
  progress: number;
  x: number;
  z: number;
  yaw: number;
}

export interface RemotePlayerTelemetry {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  speedKmh: number;
  steerAngle: number;
  wheelSpin: number;
  rpm: number;
  gear: Gear;
  braking: boolean;
  headlightsOn: boolean;
  ts: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  carSpec: CarSpecId;
  ready: boolean;
  lap: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  finished: boolean;
  finishTimeMs: number | null;
  progress: number;
}

export type RoomStatus = 'lobby' | 'countdown' | 'racing' | 'finished';

export interface RoomState {
  code: string;
  name: string;
  hostId: string;
  status: RoomStatus;
  countdownSec: number;
  track: TrackDefinition;
  environment: EnvironmentConfig;
  players: RoomPlayer[];
  createdAt: number;
}

export interface RoomSummary {
  code: string;
  name: string;
  playerCount: number;
  trackName: string;
  status: RoomStatus;
}

export type ClientWsMessage =
  | {
      type: 'room:create';
      roomName: string;
      playerName: string;
      color: string;
      carSpec: CarSpecId;
      track: TrackDefinition;
      environment: EnvironmentConfig;
    }
  | {
      type: 'room:join';
      code: string;
      playerName: string;
      color: string;
      carSpec: CarSpecId;
    }
  | { type: 'room:leave' }
  | { type: 'room:updateTrack'; track: TrackDefinition }
  | { type: 'room:updateEnvironment'; environment: EnvironmentConfig }
  | {
      type: 'room:updatePlayer';
      playerName?: string;
      color?: string;
      carSpec?: CarSpecId;
      ready?: boolean;
    }
  | { type: 'room:startRace' }
  | { type: 'room:resetLobby' }
  | {
      type: 'player:telemetry';
      telemetry: Omit<RemotePlayerTelemetry, 'id' | 'ts'>;
      progress: number;
    }
  | { type: 'player:lap'; lapTimeMs: number; lap: number };

export type ServerWsMessage =
  | { type: 'ws:welcome'; playerId: string }
  | { type: 'room:joined'; playerId: string; room: RoomState }
  | { type: 'room:state'; room: RoomState }
  | { type: 'room:left' }
  | { type: 'room:error'; message: string }
  | { type: 'player:telemetry'; telemetry: RemotePlayerTelemetry }
  | { type: 'player:disconnected'; playerId: string };
