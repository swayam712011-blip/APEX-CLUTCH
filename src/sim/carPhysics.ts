import * as THREE from 'three';
import type {
  CarSpec,
  CarSpecId,
  DamageState,
  Gear,
  TelemetrySnapshot,
  WeatherCondition,
} from '../types/sim';
import { computeSpawnTransform, queryTrackAt, type SampledTrack } from './trackSystem';

export const CAR_SPECS: Record<CarSpecId, CarSpec> = {
  'gt-coupe': {
    id: 'gt-coupe',
    name: 'Apex GT-R6',
    engineLabel: '3.4L Flat-6 NA',
    massKg: 1320,
    redlineRpm: 7800,
    idleRpm: 880,
    stallRpm: 420,
    peakTorqueNm: 365,
    peakTorqueRpm: 5400,
    finalDrive: 3.89,
    gearRatios: {
      R: -3.28,
      N: 0,
      '1': 3.58,
      '2': 2.19,
      '3': 1.54,
      '4': 1.18,
      '5': 0.94,
      '6': 0.77,
    },
    wheelRadius: 0.33,
    dragCoeff: 0.32,
    gripMu: 1.32,
    defaultColor: '#e11d48',
  },
  'touring-rs': {
    id: 'touring-rs',
    name: 'Touring RS4',
    engineLabel: '2.5L Turbo I5',
    massKg: 1410,
    redlineRpm: 7100,
    idleRpm: 850,
    stallRpm: 400,
    peakTorqueNm: 445,
    peakTorqueRpm: 4200,
    finalDrive: 3.72,
    gearRatios: {
      R: -3.15,
      N: 0,
      '1': 3.42,
      '2': 2.08,
      '3': 1.46,
      '4': 1.11,
      '5': 0.89,
      '6': 0.73,
    },
    wheelRadius: 0.335,
    dragCoeff: 0.34,
    gripMu: 1.38,
    defaultColor: '#0284c7',
  },
  'track-v8': {
    id: 'track-v8',
    name: 'Monza V8 Track',
    engineLabel: '4.5L V8 Dry-Sump',
    massKg: 1275,
    redlineRpm: 8400,
    idleRpm: 950,
    stallRpm: 460,
    peakTorqueNm: 495,
    peakTorqueRpm: 6200,
    finalDrive: 4.05,
    gearRatios: {
      R: -3.4,
      N: 0,
      '1': 3.68,
      '2': 2.32,
      '3': 1.64,
      '4': 1.26,
      '5': 1.01,
      '6': 0.84,
    },
    wheelRadius: 0.33,
    dragCoeff: 0.36,
    gripMu: 1.42,
    defaultColor: '#f59e0b',
  },
};

export interface WeatherPhysicsParams {
  gripMultiplier: number;
  brakeMultiplier: number;
  aeroDensity: number;
  hydroplaneCoeff: number;
  crosswindAmp: number;
}

export const WEATHER_PHYSICS: Record<WeatherCondition, WeatherPhysicsParams> = {
  clear: {
    gripMultiplier: 1.0,
    brakeMultiplier: 1.0,
    aeroDensity: 1.225,
    hydroplaneCoeff: 0,
    crosswindAmp: 0,
  },
  fog: {
    gripMultiplier: 0.9,
    brakeMultiplier: 0.88,
    aeroDensity: 1.26,
    hydroplaneCoeff: 0.04,
    crosswindAmp: 0,
  },
  rain: {
    gripMultiplier: 0.72,
    brakeMultiplier: 0.68,
    aeroDensity: 1.29,
    hydroplaneCoeff: 0.16,
    crosswindAmp: 120,
  },
  storm: {
    gripMultiplier: 0.56,
    brakeMultiplier: 0.54,
    aeroDensity: 1.34,
    hydroplaneCoeff: 0.28,
    crosswindAmp: 360,
  },
};

export interface CarInputState {
  throttle: boolean;
  brake: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  clutchHeld: boolean;
  handbrake: boolean;
  manualClutchOverride: number | null; // 0..1 when dragging pedal on HUD
  manualThrottleOverride: number | null;
  manualBrakeOverride: number | null;
}

export interface PhysicsCallbacks {
  onGearShift?: (gear: Gear) => void;
  onGearGrind?: (attemptedGear: Gear) => void;
  onStall?: () => void;
  onStarterCrank?: () => void;
  onEngineStart?: () => void;
  onBackfire?: () => void;
  onCollision?: (intensity: number) => void;
  onLapComplete?: (lapTimeMs: number, newLap: number) => void;
}

const GEAR_ORDER: Gear[] = ['R', 'N', '1', '2', '3', '4', '5', '6'];

function createPristineDamage(): DamageState {
  return {
    body: 0,
    engine: 0,
    transmission: 0,
    tires: [0, 0, 0, 0],
    suspension: [0, 0, 0, 0],
    zones: { front: 0, rear: 0, left: 0, right: 0 },
  };
}

export class CarPhysics {
  public spec: CarSpec;
  public x = 0;
  public y = 0;
  public z = 0;
  public yaw = 0;
  public pitch = 0;
  public roll = 0;
  public bankRoll = 0;
  public roadPitch = 0;

  public vx = 0;
  public vz = 0;
  public yawRate = 0;

  public steerAngle = 0;
  public wheelOmega = 0;
  public wheelSpinAngle = 0;

  public gear: Gear = 'N';
  public rpm = 880;
  public clutch = 0; // 0 = released/engaged, 1 = depressed/disengaged
  public throttle = 0;
  public brake = 0;
  public ignitionOn = true;
  public stalled = false;
  public crankingTimer = 0;

  public wheelSpinSlip = 0;
  public lateralSlip = 0;
  public surface: 'asphalt' | 'curb' | 'offtrack' = 'asphalt';
  public effectiveGripPercent = 100;
  public headlightsOn = false;

  public weather: WeatherCondition = 'clear';
  public damage: DamageState = createPristineDamage();

  public lap = 1;
  public currentLapMs = 0;
  public bestLapMs: number | null = null;
  public lastLapMs: number | null = null;
  public progress = 0;

  private trackHintIdx = -1;
  private maxProgressThisLap = 0;
  private grindMessage: string | null = null;
  private grindMsgTimer = 0;
  private fuelCutTimer = 0;
  private stallGraceTimer = 0;
  private collisionCooldown = 0;
  private simTime = 0;
  private callbacks: PhysicsCallbacks;

  constructor(specId: CarSpecId = 'gt-coupe', callbacks: PhysicsCallbacks = {}) {
    this.spec = CAR_SPECS[specId];
    this.rpm = this.spec.idleRpm;
    this.callbacks = callbacks;
  }

  public setSpec(specId: CarSpecId) {
    this.spec = CAR_SPECS[specId];
    if (this.ignitionOn && !this.stalled) {
      this.rpm = Math.max(this.rpm, this.spec.idleRpm);
    }
  }

  public setWeather(weather: WeatherCondition) {
    this.weather = weather;
  }

  public repairAll() {
    this.damage = createPristineDamage();
    this.grindMessage = 'Pit Repair Complete — 100% Condition';
    this.grindMsgTimer = 1.6;
  }

  public resetOnTrack(track: SampledTrack, gridSlot = 0) {
    const spawn = computeSpawnTransform(track, gridSlot);
    this.x = spawn.x;
    this.y = spawn.y;
    this.z = spawn.z;
    this.yaw = spawn.yaw;
    this.trackHintIdx = spawn.sampleIndex;

    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.steerAngle = 0;
    this.wheelOmega = 0;

    this.gear = 'N';
    this.clutch = 0;
    this.throttle = 0;
    this.brake = 0;
    this.ignitionOn = true;
    this.stalled = false;
    this.crankingTimer = 0;
    this.rpm = this.spec.idleRpm;

    this.damage = createPristineDamage();
    this.wheelSpinSlip = 0;
    this.lateralSlip = 0;
    this.lap = 1;
    this.currentLapMs = 0;
    this.bestLapMs = null;
    this.lastLapMs = null;
    this.progress = track.samples[spawn.sampleIndex]?.t ?? 0;
    this.maxProgressThisLap = 0;
    this.grindMessage = null;
    this.grindMsgTimer = 0;
    this.stallGraceTimer = 0;
  }

  /**
   * Strict manual shifting (NO automatic shifting anywhere):
   * - Shifting into R or 1..6 requires depressing the clutch pedal (clutch >= 0.62 or clutch key held).
   * - Damaged transmission synchros require deeper clutch press (>= 0.78).
   */
  public requestShift(targetGear: Gear, clutchHeld = false): boolean {
    if (targetGear === this.gear) return true;

    const requiredClutch = this.damage.transmission > 0.45 ? 0.78 : 0.62;
    const needsClutch = targetGear !== 'N';
    const clutchPressed = this.clutch >= requiredClutch || clutchHeld;

    if (needsClutch && !clutchPressed) {
      this.damage.transmission = Math.min(1, this.damage.transmission + 0.045);
      this.grindMessage = `Hold Clutch [Space] to engage ${targetGear}`;
      this.grindMsgTimer = 1.65;
      this.callbacks.onGearGrind?.(targetGear);
      return false;
    }

    if (clutchHeld && this.clutch < 0.85) {
      this.clutch = 0.85;
    }

    const forwardSpeed = this.getForwardSpeed();
    if (targetGear === 'R' && forwardSpeed > 4.5) {
      this.damage.transmission = Math.min(1, this.damage.transmission + 0.06);
      this.grindMessage = 'Slow down before engaging Reverse';
      this.grindMsgTimer = 1.65;
      this.callbacks.onGearGrind?.(targetGear);
      return false;
    }

    if (
      this.ignitionOn &&
      this.rpm > this.spec.redlineRpm * 0.78 &&
      GEAR_ORDER.indexOf(targetGear) > GEAR_ORDER.indexOf(this.gear)
    ) {
      this.callbacks.onBackfire?.();
    }

    this.gear = targetGear;
    this.grindMessage = null;
    this.grindMsgTimer = 0;
    this.callbacks.onGearShift?.(targetGear);
    return true;
  }

  public shiftUp(clutchHeld = false): boolean {
    const idx = GEAR_ORDER.indexOf(this.gear);
    if (idx < GEAR_ORDER.length - 1) {
      return this.requestShift(GEAR_ORDER[idx + 1], clutchHeld);
    }
    return false;
  }

  public shiftDown(clutchHeld = false): boolean {
    const idx = GEAR_ORDER.indexOf(this.gear);
    if (idx > 0) {
      return this.requestShift(GEAR_ORDER[idx - 1], clutchHeld);
    }
    return false;
  }

  public crankIgnition() {
    if (this.ignitionOn && !this.stalled) {
      this.ignitionOn = false;
      this.stalled = false;
      return;
    }
    if (this.gear !== 'N' && this.clutch < 0.62) {
      this.grindMessage = 'Shift to N or hold Clutch [Space] to crank engine';
      this.grindMsgTimer = 1.8;
      return;
    }
    if (this.damage.engine >= 0.98) {
      this.grindMessage = 'Engine Wrecked — Press [F] for Pit Repair';
      this.grindMsgTimer = 2.2;
      return;
    }
    if (this.crankingTimer <= 0) {
      this.crankingTimer = 0.38 + this.damage.engine * 0.3;
      this.callbacks.onStarterCrank?.();
    }
  }

  public getForwardSpeed(): number {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    return this.vx * fx + this.vz * fz;
  }

  /**
   * Apply directional collision damage from a barrier or vehicle impact
   */
  public applyCollisionDamage(normalX: number, normalZ: number, intensity: number) {
    const sev = THREE.MathUtils.clamp(intensity, 0.08, 1);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    // Impact incoming direction relative to car body
    const frontness = -(normalX * fx + normalZ * fz); // >0 means front hit, <0 means rear hit
    const rightness = -(normalX * rx + normalZ * rz); // >0 means right hit, <0 means left hit

    this.damage.body = Math.min(1, this.damage.body + sev * 0.24);

    if (frontness > 0.25) {
      this.damage.zones.front = Math.min(1, this.damage.zones.front + sev * 0.36);
      this.damage.engine = Math.min(1, this.damage.engine + sev * 0.28);
      if (rightness <= 0.25) {
        this.damage.tires[0] = Math.min(1, this.damage.tires[0] + sev * 0.26);
        this.damage.suspension[0] = Math.min(1, this.damage.suspension[0] + sev * 0.3);
      }
      if (rightness >= -0.25) {
        this.damage.tires[1] = Math.min(1, this.damage.tires[1] + sev * 0.26);
        this.damage.suspension[1] = Math.min(1, this.damage.suspension[1] + sev * 0.3);
      }
    } else if (frontness < -0.25) {
      this.damage.zones.rear = Math.min(1, this.damage.zones.rear + sev * 0.36);
      this.damage.transmission = Math.min(1, this.damage.transmission + sev * 0.2);
      if (rightness <= 0.25) {
        this.damage.tires[2] = Math.min(1, this.damage.tires[2] + sev * 0.24);
        this.damage.suspension[2] = Math.min(1, this.damage.suspension[2] + sev * 0.28);
      }
      if (rightness >= -0.25) {
        this.damage.tires[3] = Math.min(1, this.damage.tires[3] + sev * 0.24);
        this.damage.suspension[3] = Math.min(1, this.damage.suspension[3] + sev * 0.28);
      }
    }

    if (rightness > 0.2) {
      this.damage.zones.right = Math.min(1, this.damage.zones.right + sev * 0.34);
      this.damage.tires[1] = Math.min(1, this.damage.tires[1] + sev * 0.22);
      this.damage.tires[3] = Math.min(1, this.damage.tires[3] + sev * 0.22);
      this.damage.suspension[1] = Math.min(1, this.damage.suspension[1] + sev * 0.25);
      this.damage.suspension[3] = Math.min(1, this.damage.suspension[3] + sev * 0.25);
    } else if (rightness < -0.2) {
      this.damage.zones.left = Math.min(1, this.damage.zones.left + sev * 0.34);
      this.damage.tires[0] = Math.min(1, this.damage.tires[0] + sev * 0.22);
      this.damage.tires[2] = Math.min(1, this.damage.tires[2] + sev * 0.22);
      this.damage.suspension[0] = Math.min(1, this.damage.suspension[0] + sev * 0.25);
      this.damage.suspension[2] = Math.min(1, this.damage.suspension[2] + sev * 0.25);
    }

    // Severe transmission shock can pop gear out to Neutral
    if (sev > 0.72 && this.gear !== 'N' && this.damage.transmission > 0.55) {
      this.gear = 'N';
      this.grindMessage = 'Impact popped gearbox to Neutral!';
      this.grindMsgTimer = 2.0;
    }
  }

  private evaluateEngineTorque(rpm: number): number {
    const { peakTorqueNm, peakTorqueRpm, redlineRpm, idleRpm } = this.spec;
    if (!this.ignitionOn || this.stalled) return 0;
    if (this.fuelCutTimer > 0) return -18;
    if (rpm >= redlineRpm) {
      this.fuelCutTimer = 0.065;
      return -22;
    }

    const norm = THREE.MathUtils.clamp(rpm / peakTorqueRpm, 0, 1.5);
    let curveFactor: number;
    if (norm < 1) {
      curveFactor = 0.48 + 0.52 * Math.sin((norm * Math.PI) / 2);
    } else {
      const over = (rpm - peakTorqueRpm) / Math.max(1, redlineRpm - peakTorqueRpm);
      curveFactor = 1.0 - 0.24 * over * over;
    }
    if (rpm < idleRpm * 0.7) {
      curveFactor *= THREE.MathUtils.clamp(rpm / (idleRpm * 0.7), 0.2, 1);
    }

    // Engine performance degradation + cylinder misfire sputter when damaged
    const engineHealth = 1 - this.damage.engine * 0.58;
    let misfireFactor = 1;
    if (this.damage.engine > 0.35) {
      const sputter = Math.sin(this.simTime * 31) * Math.sin(this.simTime * 13);
      if (sputter > 0.55) {
        misfireFactor = 1 - this.damage.engine * 0.55;
      }
    }

    return peakTorqueNm * curveFactor * engineHealth * misfireFactor;
  }

  public step(
    dt: number,
    input: CarInputState,
    track: SampledTrack,
    freezeMovement = false,
  ) {
    this.simTime += dt;
    if (this.grindMsgTimer > 0) {
      this.grindMsgTimer = Math.max(0, this.grindMsgTimer - dt);
      if (this.grindMsgTimer === 0) this.grindMessage = null;
    }
    if (this.fuelCutTimer > 0) {
      this.fuelCutTimer = Math.max(0, this.fuelCutTimer - dt);
    }
    if (this.collisionCooldown > 0) {
      this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    }

    // 1. Pedal smoothing
    if (input.manualClutchOverride !== null) {
      this.clutch = THREE.MathUtils.clamp(input.manualClutchOverride, 0, 1);
    } else {
      const targetClutch = input.clutchHeld ? 1 : 0;
      const rate = targetClutch > this.clutch ? 10.5 : 6.2;
      this.clutch = THREE.MathUtils.lerp(this.clutch, targetClutch, 1 - Math.exp(-rate * dt));
    }

    if (input.manualThrottleOverride !== null) {
      this.throttle = THREE.MathUtils.clamp(input.manualThrottleOverride, 0, 1);
    } else {
      const targetT = input.throttle ? 1 : 0;
      const rate = targetT > this.throttle ? 9.5 : 12;
      this.throttle = THREE.MathUtils.lerp(this.throttle, targetT, 1 - Math.exp(-rate * dt));
    }

    if (input.manualBrakeOverride !== null) {
      this.brake = THREE.MathUtils.clamp(input.manualBrakeOverride, 0, 1);
    } else {
      const targetB = input.brake ? 1 : 0;
      const rate = targetB > this.brake ? 12 : 14;
      this.brake = THREE.MathUtils.lerp(this.brake, targetB, 1 - Math.exp(-rate * dt));
    }

    if (this.crankingTimer > 0) {
      this.crankingTimer -= dt;
      this.rpm = 310 + Math.sin(this.crankingTimer * 42) * 45;
      if (this.crankingTimer <= 0) {
        this.crankingTimer = 0;
        this.ignitionOn = true;
        this.stalled = false;
        this.rpm = this.spec.idleRpm + 250;
        this.stallGraceTimer = 0.25;
        this.callbacks.onEngineStart?.();
      }
    }

    // 2. Steering angle with speed-sensitive reduction + damaged suspension alignment pull
    const speed = Math.hypot(this.vx, this.vz);
    const steerInput = (input.steerLeft ? 1 : 0) - (input.steerRight ? 1 : 0);
    const maxSteer = THREE.MathUtils.lerp(0.56, 0.22, THREE.MathUtils.clamp(speed / 55, 0, 1));
    const leftSuspDmg = (this.damage.suspension[0] + this.damage.suspension[2]) * 0.5;
    const rightSuspDmg = (this.damage.suspension[1] + this.damage.suspension[3]) * 0.5;
    const alignmentPullRad = (leftSuspDmg - rightSuspDmg) * 0.085;
    const targetSteer = steerInput * maxSteer + alignmentPullRad;

    this.steerAngle = THREE.MathUtils.lerp(
      this.steerAngle,
      targetSteer,
      1 - Math.exp(-9.5 * dt),
    );

    // 3. Query track surface & geometry
    const trackInfo = queryTrackAt(track, this.x, this.z, this.trackHintIdx);
    this.trackHintIdx = trackInfo.sampleIndex;
    this.surface = trackInfo.surface;

    // Weather + Tire Damage grip factors
    const wp = WEATHER_PHYSICS[this.weather];
    const avgTireDmg =
      (this.damage.tires[0] +
        this.damage.tires[1] +
        this.damage.tires[2] +
        this.damage.tires[3]) *
      0.25;
    const tireHealthMult = 1 - avgTireDmg * 0.48;
    const hydroplaneDrop =
      wp.hydroplaneCoeff * THREE.MathUtils.smoothstep(speed, 22, 62);

    const surfaceBaseGrip =
      this.surface === 'asphalt' ? 1.0 : this.surface === 'curb' ? 0.92 : 0.62;
    const combinedGrip = Math.max(
      0.25,
      surfaceBaseGrip * (wp.gripMultiplier - hydroplaneDrop) * tireHealthMult,
    );
    this.effectiveGripPercent = Math.round(combinedGrip * 100);

    // 4. Drivetrain & Engine Sub-stepping
    const subSteps = 4;
    const subDt = dt / subSteps;

    const gearRatio = this.spec.gearRatios[this.gear];
    const totalRatio = gearRatio * this.spec.finalDrive;
    const clutchEngagement = THREE.MathUtils.clamp(1 - (this.clutch - 0.14) / 0.6, 0, 1);

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    let forwardAccel = 0;
    let lateralAccel = 0;

    for (let s = 0; s < subSteps; s++) {
      let vForward = this.vx * fx + this.vz * fz;
      let vLateral = this.vx * rx + this.vz * rz;

      let omegaE = (this.rpm * Math.PI) / 30;
      const flywheelInertia = 0.24;

      let engineTorque = 0;
      if (this.ignitionOn && !this.stalled && this.crankingTimer <= 0) {
        const maxT = this.evaluateEngineTorque(this.rpm);
        const idleTarget = this.spec.idleRpm + this.damage.engine * 140;
        const idleError = idleTarget - this.rpm;
        const idleThrottle =
          idleError > 0 ? THREE.MathUtils.clamp(idleError / 360, 0, 0.44) : 0;
        const effectiveThrottle = Math.max(this.throttle, idleThrottle);
        const engineFriction = 14 + this.damage.engine * 12 + 0.025 * omegaE;
        engineTorque = maxT * effectiveThrottle - engineFriction * (1 - effectiveThrottle * 0.5);
      } else if (this.crankingTimer <= 0) {
        engineTorque = -35 - 0.05 * omegaE;
      }

      // Clutch coupling torque: zero if in Neutral ('N') or clutch fully depressed!
      let clutchTorque = 0;
      const inGear = gearRatio !== 0 && !freezeMovement;
      if (inGear && clutchEngagement > 0.005) {
        const transInputOmega = this.wheelOmega * totalRatio;
        const slipOmega = omegaE - transInputOmega;
        const maxClutchCap = 680 * clutchEngagement * (1 - this.damage.transmission * 0.22);
        clutchTorque = maxClutchCap * Math.tanh(slipOmega * 0.055);
      }

      if (this.crankingTimer <= 0) {
        const netEngineTorque = engineTorque - clutchTorque;
        omegaE += (netEngineTorque / flywheelInertia) * subDt;
        omegaE = THREE.MathUtils.clamp(omegaE, 0, ((this.spec.redlineRpm + 250) * Math.PI) / 30);
        this.rpm = (omegaE * 30) / Math.PI;
      }

      const effectiveStallRpm = this.spec.stallRpm + this.damage.engine * 110;
      if (this.stallGraceTimer > 0) {
        this.stallGraceTimer -= subDt;
      } else if (
        this.ignitionOn &&
        !this.stalled &&
        this.crankingTimer <= 0 &&
        this.rpm < effectiveStallRpm
      ) {
        this.stalled = true;
        this.ignitionOn = false;
        this.rpm = 0;
        this.grindMessage = 'Engine Stalled! Hold Clutch [Space] + Crank [I]';
        this.grindMsgTimer = 3.0;
        this.callbacks.onStall?.();
      }

      if (freezeMovement) {
        this.vx = 0;
        this.vz = 0;
        this.yawRate = 0;
        this.wheelOmega = 0;
        continue;
      }

      const baseRolling =
        this.surface === 'asphalt' ? 0.014 : this.surface === 'curb' ? 0.024 : 0.088;
      const rollingCoeff =
        baseRolling + avgTireDmg * 0.045 + (this.weather === 'storm' ? 0.014 : this.weather === 'rain' ? 0.007 : 0);

      const driveTorque = inGear ? clutchTorque * totalRatio * 0.92 : 0;
      const drivenWheelForce = driveTorque / this.spec.wheelRadius;

      const brakeDir = Math.abs(vForward) > 0.15 ? -Math.sign(vForward) : 0;
      // Weather + tire damage realistically lengthen braking distances!
      const brakeTraction = Math.max(0.32, wp.brakeMultiplier * tireHealthMult * surfaceBaseGrip);
      const brakeMaxForce = (this.brake * 13500 + (input.handbrake ? 8500 : 0)) * brakeTraction;

      const normalForce = this.spec.massKg * 9.81;
      const maxLongTraction = normalForce * this.spec.gripMu * combinedGrip * 0.85;

      let tireLongForce = THREE.MathUtils.clamp(
        drivenWheelForce,
        -maxLongTraction,
        maxLongTraction,
      );

      const excessTorque = Math.abs(drivenWheelForce) - maxLongTraction;
      if (excessTorque > 0 && inGear && clutchEngagement > 0.2) {
        this.wheelSpinSlip = THREE.MathUtils.clamp(excessTorque / 4200, 0, 1);
      } else {
        this.wheelSpinSlip = THREE.MathUtils.lerp(this.wheelSpinSlip, 0, 8 * subDt);
      }

      if (this.brake > 0.02 || input.handbrake) {
        if (Math.abs(vForward) < 0.35 && Math.abs(tireLongForce) < 600) {
          vForward = 0;
          tireLongForce = 0;
        } else {
          tireLongForce += brakeDir * brakeMaxForce;
        }
      }

      const effectiveDragCoeff = this.spec.dragCoeff * (1 + this.damage.body * 0.62);
      const aeroDrag =
        -0.5 * wp.aeroDensity * effectiveDragCoeff * 2.15 * vForward * Math.abs(vForward);
      const rollingDrag = -rollingCoeff * normalForce * Math.sign(vForward);
      const slopeForce = -normalForce * trackInfo.sample.tangent.y * 0.65;

      const netLongForce =
        tireLongForce + aeroDrag + (Math.abs(vForward) > 0.05 ? rollingDrag : 0) + slopeForce;
      const aLong = netLongForce / this.spec.massKg;
      forwardAccel = aLong;

      vForward += aLong * subDt;
      if (
        Math.abs(vForward) < 0.04 &&
        Math.abs(tireLongForce) < 250 &&
        Math.abs(slopeForce) < 350
      ) {
        vForward = 0;
      }

      const roadWheelOmega = vForward / this.spec.wheelRadius;
      const spinSign = gearRatio < 0 ? -1 : 1;
      const targetWheelOmega =
        roadWheelOmega + this.wheelSpinSlip * 26 * spinSign * (0.3 + this.throttle);
      this.wheelOmega = THREE.MathUtils.lerp(this.wheelOmega, targetWheelOmega, 18 * subDt);
      this.wheelSpinAngle += this.wheelOmega * subDt;

      // Lateral dynamics with weather grip + damaged suspension instability
      const avgSuspDmg =
        (this.damage.suspension[0] +
          this.damage.suspension[1] +
          this.damage.suspension[2] +
          this.damage.suspension[3]) *
        0.25;
      const wheelBase = 2.68;
      const speedAbs = Math.abs(vForward);
      if (speedAbs > 0.12) {
        const targetYawRate = (vForward / wheelBase) * Math.tan(this.steerAngle);
        const handbrakeFactor = input.handbrake ? 0.55 : 1.0;
        const gripResponse =
          9.5 * combinedGrip * handbrakeFactor * (1 - avgSuspDmg * 0.32);
        this.yawRate = THREE.MathUtils.lerp(
          this.yawRate,
          targetYawRate,
          1 - Math.exp(-gripResponse * subDt),
        );
      } else {
        this.yawRate = THREE.MathUtils.lerp(this.yawRate, 0, 1 - Math.exp(-12 * subDt));
      }

      this.yaw += this.yawRate * subDt;

      const lateralGrip =
        (input.handbrake ? 3.2 : 9.2) * combinedGrip * (1 - avgSuspDmg * 0.35);
      const prevLat = vLateral;
      vLateral *= Math.exp(-lateralGrip * subDt);

      // Storm crosswind gust buffeting at speed
      if (wp.crosswindAmp > 0 && speedAbs > 14) {
        const gust = Math.sin(this.simTime * 1.9) * wp.crosswindAmp;
        vLateral += (gust / this.spec.massKg) * subDt;
      }

      const cornerLoad = vForward * this.yawRate;
      const gripCap = 9.81 * this.spec.gripMu * combinedGrip * 0.92;
      if (Math.abs(cornerLoad) > gripCap) {
        const excessLat = (Math.abs(cornerLoad) - gripCap) * Math.sign(cornerLoad);
        vLateral += excessLat * 0.6 * subDt;
      }
      lateralAccel = cornerLoad + (vLateral - prevLat) / subDt;
      this.lateralSlip = THREE.MathUtils.clamp(Math.abs(vLateral) / 6.2, 0, 1);

      const nFx = -Math.sin(this.yaw);
      const nFz = -Math.cos(this.yaw);
      const nRx = Math.cos(this.yaw);
      const nRz = -Math.sin(this.yaw);
      this.vx = nFx * vForward + nRx * vLateral;
      this.vz = nFz * vForward + nRz * vLateral;

      this.x += this.vx * subDt;
      this.z += this.vz * subDt;
    }

    // 5. Barrier collisions + directional damage
    const postTrack = queryTrackAt(track, this.x, this.z, this.trackHintIdx);
    this.trackHintIdx = postTrack.sampleIndex;
    this.surface = postTrack.surface;

    if (postTrack.barrierHit) {
      this.x += postTrack.pushNormalX * postTrack.penetration;
      this.z += postTrack.pushNormalZ * postTrack.penetration;
      const vn = this.vx * postTrack.pushNormalX + this.vz * postTrack.pushNormalZ;
      if (vn < 0) {
        const impactIntensity = THREE.MathUtils.clamp(Math.abs(vn) / 22, 0.1, 1);
        this.vx -= 1.32 * vn * postTrack.pushNormalX;
        this.vz -= 1.32 * vn * postTrack.pushNormalZ;
        this.vx *= 0.8;
        this.vz *= 0.8;
        if (this.collisionCooldown <= 0 && impactIntensity > 0.14) {
          this.collisionCooldown = 0.25;
          this.applyCollisionDamage(postTrack.pushNormalX, postTrack.pushNormalZ, impactIntensity);
          this.callbacks.onCollision?.(impactIntensity);
        }
      }
    }

    // Ground height & suspension pitch/roll (damaged suspension bounces & leans unevenly)
    const avgSuspDmg =
      (this.damage.suspension[0] +
        this.damage.suspension[1] +
        this.damage.suspension[2] +
        this.damage.suspension[3]) *
      0.25;
    const suspBounce =
      avgSuspDmg > 0.15 && speed > 4
        ? Math.sin(this.simTime * 14) * avgSuspDmg * 0.025
        : 0;
    const unevenLean =
      ((this.damage.suspension[1] + this.damage.suspension[3]) -
        (this.damage.suspension[0] + this.damage.suspension[2])) *
      0.022;

    this.y = THREE.MathUtils.lerp(this.y, postTrack.groundY, 1 - Math.exp(-22 * dt));
    const targetPitch = THREE.MathUtils.clamp(forwardAccel * 0.0055 + suspBounce, -0.06, 0.06);
    const targetRoll = THREE.MathUtils.clamp(
      -lateralAccel * 0.006 * (1 + avgSuspDmg * 0.65) + unevenLean,
      -0.09,
      0.09,
    );
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, 1 - Math.exp(-10 * dt));
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, 1 - Math.exp(-10 * dt));

    const forwardDotTangent =
      -Math.sin(this.yaw) * postTrack.sample.tangent.x +
      -Math.cos(this.yaw) * postTrack.sample.tangent.z;
    const rightDotTangent =
      Math.cos(this.yaw) * postTrack.sample.tangent.x +
      -Math.sin(this.yaw) * postTrack.sample.tangent.z;

    this.roadPitch = THREE.MathUtils.lerp(
      this.roadPitch,
      postTrack.sample.tangent.y * forwardDotTangent,
      1 - Math.exp(-10 * dt),
    );
    this.bankRoll = THREE.MathUtils.lerp(
      this.bankRoll,
      -postTrack.sample.bankRad * forwardDotTangent +
        postTrack.sample.tangent.y * rightDotTangent,
      1 - Math.exp(-10 * dt),
    );

    // 6. Lap timing
    if (!freezeMovement) {
      this.currentLapMs += dt * 1000;
      const p = postTrack.progress;
      if (p > this.maxProgressThisLap && p - this.maxProgressThisLap < 0.35) {
        this.maxProgressThisLap = p;
      }
      if (this.progress > 0.85 && p < 0.15 && this.maxProgressThisLap > 0.72) {
        const completedLapMs = this.currentLapMs;
        if (completedLapMs > 4500) {
          this.lastLapMs = Math.round(completedLapMs);
          if (this.bestLapMs === null || this.lastLapMs < this.bestLapMs) {
            this.bestLapMs = this.lastLapMs;
          }
          this.lap += 1;
          this.currentLapMs = 0;
          this.maxProgressThisLap = p;
          this.callbacks.onLapComplete?.(this.lastLapMs, this.lap);
        }
      }
      this.progress = p;
    }
  }

  public getTelemetry(totalLaps: number): TelemetrySnapshot {
    return {
      rpm: Math.round(this.rpm),
      redlineRpm: this.spec.redlineRpm,
      speedKmh: Math.round(Math.abs(this.getForwardSpeed()) * 3.6),
      gear: this.gear,
      clutch: this.clutch,
      throttle: this.throttle,
      brake: this.brake,
      ignitionOn: this.ignitionOn,
      stalled: this.stalled,
      cranking: this.crankingTimer > 0,
      wheelSpinSlip: Math.max(this.wheelSpinSlip, this.lateralSlip),
      surface: this.surface,
      gripPercent: this.effectiveGripPercent,
      headlightsOn: this.headlightsOn,
      damage: {
        body: this.damage.body,
        engine: this.damage.engine,
        transmission: this.damage.transmission,
        tires: [...this.damage.tires] as [number, number, number, number],
        suspension: [...this.damage.suspension] as [number, number, number, number],
        zones: { ...this.damage.zones },
      },
      lap: this.lap,
      totalLaps,
      currentLapMs: Math.round(this.currentLapMs),
      bestLapMs: this.bestLapMs,
      lastLapMs: this.lastLapMs,
      grindMessage: this.grindMessage,
      progress: this.progress,
      x: this.x,
      z: this.z,
      yaw: this.yaw,
    };
  }
}
