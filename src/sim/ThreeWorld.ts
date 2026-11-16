import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  DamageState,
  EnvironmentConfig,
  RemotePlayerTelemetry,
  TimeOfDay,
  TrackTheme,
  WeatherCondition,
} from '../types/sim';
import type { SampledTrack } from './trackSystem';

export type CameraMode = 'chase' | 'hood' | 'bumper' | 'orbit';

interface WheelRig {
  steerPivot: THREE.Group;
  spinGroup: THREE.Group;
  isFront: boolean;
}

interface CarMeshRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  paintMaterial: THREE.MeshPhysicalMaterial;
  tailLightMat: THREE.MeshStandardMaterial;
  headlightMat: THREE.MeshStandardMaterial;
  splitter: THREE.Mesh;
  diffuser: THREE.Mesh;
  wingGroup: THREE.Group;
  exhaustFlash: THREE.Mesh;
  headlightSpotL: THREE.SpotLight | null;
  headlightSpotR: THREE.SpotLight | null;
  headlightConeL: THREE.Mesh | null;
  headlightConeR: THREE.Mesh | null;
  wheels: WheelRig[];
  shadowPlane: THREE.Mesh;
  baseColorHex: string;
}

interface SmokeParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
}

interface RemoteCarEntry {
  rig: CarMeshRig;
  target: RemotePlayerTelemetry;
  curX: number;
  curY: number;
  curZ: number;
  curYaw: number;
  curPitch: number;
  curRoll: number;
  curSteer: number;
  curWheelSpin: number;
  color: string;
}

export interface ProjectedTag {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3C = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3();
const _skyColor = new THREE.Color();
const _fogColor = new THREE.Color();
const _sunColor = new THREE.Color();
const _hemiSkyColor = new THREE.Color();
const _hemiGroundColor = new THREE.Color();
const _paintTint = new THREE.Color();

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#24272d';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 28 + Math.floor(Math.random() * 34);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const groove = ctx.createLinearGradient(0, 0, 512, 0);
  groove.addColorStop(0, 'rgba(12,13,16,0.35)');
  groove.addColorStop(0.22, 'rgba(18,19,22,0)');
  groove.addColorStop(0.5, 'rgba(10,11,14,0.28)');
  groove.addColorStop(0.78, 'rgba(18,19,22,0)');
  groove.addColorStop(1, 'rgba(12,13,16,0.35)');
  ctx.fillStyle = groove;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = 'rgba(236, 240, 244, 0.85)';
  ctx.fillRect(16, 0, 8, 512);
  ctx.fillRect(488, 0, 8, 512);

  ctx.fillStyle = 'rgba(225, 228, 232, 0.42)';
  ctx.fillRect(253, 30, 6, 170);
  ctx.fillRect(253, 286, 6, 170);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createCurbTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d92626';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 128, 128, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 0, 14, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createCheckerTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const sq = 32;
  for (let y = 0; y < 128; y += sq) {
    for (let x = 0; x < 512; x += sq) {
      const dark = ((x / sq + y / sq) & 1) === 0;
      ctx.fillStyle = dark ? '#111317' : '#f8fafc';
      ctx.fillRect(x, y, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 22, 128, 128, 124);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.36)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTerrainTexture(theme: TrackTheme, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const base =
    theme === 'desert-canyon'
      ? [156, 108, 72]
      : theme === 'alpine-dusk'
        ? [52, 74, 58]
        : [58, 86, 52];

  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const delta = Math.floor((Math.random() - 0.5) * 28);
    ctx.fillStyle = `rgb(${base[0] + delta},${base[1] + delta},${base[2] + delta})`;
    ctx.fillRect(x, y, 3, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 36);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function getThemePalette(theme: TrackTheme) {
  if (theme === 'alpine-dusk') {
    return {
      treeColorA: 0x254233,
      treeColorB: 0x355442,
      barrierColor: 0xcbd5e1,
    };
  }
  if (theme === 'desert-canyon') {
    return {
      treeColorA: 0x8b4c2f,
      treeColorB: 0xa6623d,
      barrierColor: 0xe2c7aa,
    };
  }
  return {
    treeColorA: 0x2d5a34,
    treeColorB: 0x3d6e3f,
    barrierColor: 0xd8dee6,
  };
}

interface SolarKeyframe {
  sky: number;
  fog: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunHeight: number;
  sunAzimuth: number;
}

const TIME_KEYFRAMES: Record<TimeOfDay, SolarKeyframe> = {
  dawn: {
    sky: 0x6c7399,
    fog: 0x918398,
    sun: 0xffb074,
    sunIntensity: 1.9,
    hemiSky: 0x8ca0cc,
    hemiGround: 0x38343a,
    hemiIntensity: 0.65,
    sunHeight: 24,
    sunAzimuth: 1.2,
  },
  midday: {
    sky: 0x8db6d8,
    fog: 0x9ec0dc,
    sun: 0xfff4df,
    sunIntensity: 2.55,
    hemiSky: 0xb4d6f4,
    hemiGround: 0x3b4d37,
    hemiIntensity: 0.78,
    sunHeight: 88,
    sunAzimuth: 0.65,
  },
  dusk: {
    sky: 0x2b3654,
    fog: 0x483f59,
    sun: 0xff7b47,
    sunIntensity: 1.75,
    hemiSky: 0x62739e,
    hemiGround: 0x24262b,
    hemiIntensity: 0.55,
    sunHeight: 18,
    sunAzimuth: -1.1,
  },
  night: {
    sky: 0x070a14,
    fog: 0x0a0f1c,
    sun: 0x8ea9dc,
    sunIntensity: 0.6,
    hemiSky: 0x233052,
    hemiGround: 0x0d1016,
    hemiIntensity: 0.36,
    sunHeight: 62,
    sunAzimuth: -0.4,
  },
};

const WEATHER_FOG_DENSITY: Record<WeatherCondition, number> = {
  clear: 0.0018,
  rain: 0.0068,
  storm: 0.0115,
  fog: 0.023,
};

export class ThreeWorld {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private envMap: THREE.Texture;

  private trackGroup = new THREE.Group();
  private roadMaterial: THREE.MeshStandardMaterial | null = null;
  private gantryLights: THREE.Mesh[] = [];
  private disposableTrackItems: { dispose: () => void }[] = [];

  private playerRig: CarMeshRig;
  private remoteCars = new Map<string, RemoteCarEntry>();
  private contactShadowTex: THREE.CanvasTexture;
  private asphaltTex: THREE.CanvasTexture;
  private curbTex: THREE.CanvasTexture;
  private checkerTex: THREE.CanvasTexture;

  // Pooled smoke / spray particles
  private smokeMesh: THREE.InstancedMesh;
  private smokeParticles: SmokeParticle[] = [];
  private smokeCursor = 0;

  // 3D Rain streaks buffer
  private rainLines: THREE.LineSegments;
  private rainPositions: Float32Array;
  private rainCount = 850;
  private lightningTimer = 6;
  private lightningFlash = 0;

  private environment: EnvironmentConfig = {
    weather: 'clear',
    timeOfDay: 'midday',
    dynamicCycle: false,
  };
  private cyclePhase = 0.25; // 0=dawn, 0.25=midday, 0.5=dusk, 0.75=night
  private sunOffsetX = 55;
  private sunOffsetY = 85;
  private sunOffsetZ = 40;

  private cameraMode: CameraMode = 'chase';
  private camPos = new THREE.Vector3(0, 6, 12);
  private camLook = new THREE.Vector3(0, 1, 0);
  private shakeIntensity = 0;
  private backfireTimer = 0;
  private orbitAngle = 0.6;

  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private onFrameCallback?: (dt: number) => void;
  private onThunderCallback?: () => void;

  constructor(
    container: HTMLElement,
    carColor: string,
    onFrame?: (dt: number) => void,
    onThunder?: () => void,
  ) {
    this.container = container;
    this.onFrameCallback = onFrame;
    this.onThunderCallback = onThunder;
    this.isSoftwareGl = detectSoftwareGl();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8db6d8);
    this.scene.fog = new THREE.FogExp2(0x9ec0dc, 0.0018);

    this.camera = new THREE.PerspectiveCamera(58, width / height, 0.2, 950);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();

    this.hemiLight = new THREE.HemisphereLight(0xb4d6f4, 0x3b4d37, 0.78);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff4df, 2.55);
    this.sunLight.position.set(55, 85, 40);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 230;
    const d = 58;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.asphaltTex = createAsphaltTexture(maxAniso);
    this.curbTex = createCurbTexture(maxAniso);
    this.checkerTex = createCheckerTexture(maxAniso);
    this.contactShadowTex = createContactShadowTexture();

    this.scene.add(this.trackGroup);

    // Player composite car rig with real SpotLight headlights
    this.playerRig = this.createCarRig(carColor, true);
    this.scene.add(this.playerRig.root);

    // Pooled smoke / spray / dust particles
    const smokeCount = 110;
    const smokeGeo = new THREE.IcosahedronGeometry(0.42, 1);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xd4d4d8,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, smokeCount);
    this.smokeMesh.frustumCulled = false;
    this.scene.add(this.smokeMesh);
    for (let i = 0; i < smokeCount; i++) {
      this.smokeParticles.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        scale: 0,
      });
      _mat4.makeScale(0, 0, 0);
      this.smokeMesh.setMatrixAt(i, _mat4);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;

    // 3D Rain LineSegments buffer
    this.rainPositions = new Float32Array(this.rainCount * 2 * 3);
    for (let i = 0; i < this.rainCount; i++) {
      const rx = (Math.random() - 0.5) * 44;
      const ry = Math.random() * 22;
      const rz = (Math.random() - 0.5) * 44;
      const base = i * 6;
      this.rainPositions[base] = rx;
      this.rainPositions[base + 1] = ry;
      this.rainPositions[base + 2] = rz;
      this.rainPositions[base + 3] = rx;
      this.rainPositions[base + 4] = ry + 0.85;
      this.rainPositions[base + 5] = rz;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.rainLines.visible = false;
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);

    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
  }

  public startLoop() {
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
    this.clock.start();
    const tick = () => {
      if (this.disposed) return;
      const rawDt = this.clock.getDelta();
      const dt = Math.min(rawDt, 0.05);

      this.onFrameCallback?.(dt);
      this.updateEnvironmentVisuals(dt);
      this.updateSmoke(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };
    tick();
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
  };

  public setEnvironment(env: EnvironmentConfig) {
    this.environment = env;
    if (!env.dynamicCycle) {
      const map: Record<TimeOfDay, number> = {
        dawn: 0,
        midday: 0.25,
        dusk: 0.5,
        night: 0.75,
      };
      this.cyclePhase = map[env.timeOfDay];
    }
  }

  private updateEnvironmentVisuals(dt: number) {
    if (this.environment.dynamicCycle) {
      // Full solar cycle in ~90s
      this.cyclePhase = (this.cyclePhase + dt / 90) % 1;
    }

    const order: TimeOfDay[] = ['dawn', 'midday', 'dusk', 'night'];
    const scaled = this.cyclePhase * 4;
    const i0 = Math.floor(scaled) % 4;
    const i1 = (i0 + 1) % 4;
    const frac = scaled - Math.floor(scaled);
    const k0 = TIME_KEYFRAMES[order[i0]];
    const k1 = TIME_KEYFRAMES[order[i1]];

    _skyColor.setHex(k0.sky).lerp(_fogColor.setHex(k1.sky), frac);
    _fogColor.setHex(k0.fog).lerp(_sunColor.setHex(k1.fog), frac);
    _sunColor.setHex(k0.sun).lerp(_hemiSkyColor.setHex(k1.sun), frac);
    _hemiSkyColor.setHex(k0.hemiSky).lerp(_hemiGroundColor.setHex(k1.hemiSky), frac);
    _hemiGroundColor.setHex(k0.hemiGround).lerp(new THREE.Color(k1.hemiGround), frac);

    const w = this.environment.weather;
    // Overcast / storm darkens & desaturates sky slightly
    if (w === 'rain' || w === 'storm') {
      const darken = w === 'storm' ? 0.45 : 0.68;
      _skyColor.multiplyScalar(darken);
      _fogColor.multiplyScalar(darken);
    } else if (w === 'fog') {
      _fogColor.lerp(new THREE.Color(0xb8c2cc), 0.35);
      _skyColor.copy(_fogColor);
    }

    // Lightning flash in storm
    if (w === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5 + Math.random() * 9;
        this.lightningFlash = 1.0;
        this.onThunderCallback?.();
      }
      if (this.lightningFlash > 0) {
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.8);
        _skyColor.lerp(new THREE.Color(0xe2e8f0), this.lightningFlash * 0.65);
      }
    } else {
      this.lightningFlash = 0;
    }

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(_skyColor);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(_fogColor);
      this.scene.fog.density = WEATHER_FOG_DENSITY[w];
    }

    const sunScale = w === 'storm' ? 0.32 : w === 'rain' ? 0.55 : w === 'fog' ? 0.65 : 1.0;
    this.sunLight.color.copy(_sunColor);
    this.sunLight.intensity =
      THREE.MathUtils.lerp(k0.sunIntensity, k1.sunIntensity, frac) * sunScale +
      this.lightningFlash * 3.2;

    this.hemiLight.color.copy(_hemiSkyColor);
    this.hemiLight.groundColor.copy(_hemiGroundColor);
    this.hemiLight.intensity =
      THREE.MathUtils.lerp(k0.hemiIntensity, k1.hemiIntensity, frac) +
      this.lightningFlash * 1.4;

    const az = THREE.MathUtils.lerp(k0.sunAzimuth, k1.sunAzimuth, frac);
    const sh = THREE.MathUtils.lerp(k0.sunHeight, k1.sunHeight, frac);
    this.sunOffsetX = Math.sin(az) * 75;
    this.sunOffsetY = sh;
    this.sunOffsetZ = Math.cos(az) * 75;

    // Wet asphalt reflections in rain/storm
    if (this.roadMaterial) {
      const targetRoughness =
        w === 'storm' ? 0.17 : w === 'rain' ? 0.27 : w === 'fog' ? 0.58 : 0.84;
      const targetEnv = w === 'storm' ? 1.85 : w === 'rain' ? 1.55 : 0.85;
      this.roadMaterial.roughness = THREE.MathUtils.lerp(
        this.roadMaterial.roughness,
        targetRoughness,
        1 - Math.exp(-3 * dt),
      );
      this.roadMaterial.envMapIntensity = THREE.MathUtils.lerp(
        this.roadMaterial.envMapIntensity,
        targetEnv,
        1 - Math.exp(-3 * dt),
      );
    }

    // Rain particle streak update centered around camera
    const isRaining = w === 'rain' || w === 'storm';
    this.rainLines.visible = isRaining;
    if (isRaining) {
      const fallSpeed = w === 'storm' ? 38 : 26;
      const slantX = w === 'storm' ? -5.5 : -1.8;
      const cx = this.camera.position.x;
      const cy = this.camera.position.y;
      const cz = this.camera.position.z;

      for (let i = 0; i < this.rainCount; i++) {
        const base = i * 6;
        let x = this.rainPositions[base] + slantX * dt;
        let y = this.rainPositions[base + 1] - fallSpeed * dt;
        let z = this.rainPositions[base + 2];

        if (y < cy - 5 || Math.abs(x - cx) > 25 || Math.abs(z - cz) > 25) {
          x = cx + (Math.random() - 0.5) * 44;
          y = cy + 12 + Math.random() * 12;
          z = cz + (Math.random() - 0.5) * 44;
        }
        this.rainPositions[base] = x;
        this.rainPositions[base + 1] = y;
        this.rainPositions[base + 2] = z;
        this.rainPositions[base + 3] = x - slantX * 0.032;
        this.rainPositions[base + 4] = y + (w === 'storm' ? 1.25 : 0.85);
        this.rainPositions[base + 5] = z;
      }
      (this.rainLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  public isDarkOrLowVis(): boolean {
    return (
      this.environment.timeOfDay === 'night' ||
      this.environment.timeOfDay === 'dusk' ||
      this.environment.timeOfDay === 'dawn' ||
      this.environment.weather !== 'clear' ||
      (this.environment.dynamicCycle && (this.cyclePhase > 0.42 || this.cyclePhase < 0.08))
    );
  }

  public setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
  }

  public getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  public setPlayerColor(hex: string) {
    this.playerRig.baseColorHex = hex;
    this.playerRig.paintMaterial.color.set(hex);
  }

  public triggerShake(intensity: number) {
    this.shakeIntensity = Math.min(0.65, Math.max(this.shakeIntensity, intensity * 0.45));
  }

  public triggerBackfireFlash() {
    this.backfireTimer = 0.09;
  }

  public updateGantryLights(countdownSec: number, active: boolean) {
    this.gantryLights.forEach((mesh, idx) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!active) {
        mat.color.setHex(0x1f2937);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        return;
      }
      if (countdownSec > 0) {
        const lit = idx < 4 - countdownSec + 2;
        mat.color.setHex(lit ? 0xef4444 : 0x262626);
        mat.emissive.setHex(lit ? 0xef4444 : 0x000000);
        mat.emissiveIntensity = lit ? 2.6 : 0;
      } else {
        mat.color.setHex(0x22c55e);
        mat.emissive.setHex(0x22c55e);
        mat.emissiveIntensity = 2.4;
      }
    });
  }

  private createCarRig(paintHex: string, withSpotLights: boolean): CarMeshRig {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const paintMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(paintHex),
      metalness: 0.68,
      roughness: 0.24,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x181a1f,
      roughness: 0.62,
      metalness: 0.18,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      metalness: 0.1,
      roughness: 0.08,
      clearcoat: 1.0,
      transparent: true,
      opacity: this.isSoftwareGl ? 0.55 : 0.78,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.94,
      roughness: 0.16,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff5d6,
      emissiveIntensity: 1.6,
      roughness: 0.1,
    });
    const tailLightMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      emissive: 0xef4444,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });

    // 1. Primary Silhouette
    const profile = new THREE.Shape();
    profile.moveTo(-2.15, 0.22);
    profile.lineTo(2.12, 0.2);
    profile.lineTo(2.22, 0.45);
    profile.lineTo(1.75, 0.72);
    profile.lineTo(0.82, 0.82);
    profile.lineTo(0.18, 1.24);
    profile.lineTo(-0.78, 1.24);
    profile.lineTo(-1.75, 0.92);
    profile.lineTo(-2.2, 0.84);
    profile.lineTo(-2.22, 0.34);
    profile.closePath();

    const bodyGeo = new THREE.ExtrudeGeometry(profile, {
      depth: 1.72,
      bevelEnabled: true,
      bevelThickness: 0.11,
      bevelSize: 0.08,
      bevelSegments: 3,
      steps: 1,
    });
    bodyGeo.translate(0, 0, -0.86);
    bodyGeo.rotateY(Math.PI / 2);
    const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyGroup.add(bodyMesh);

    // 2. Cockpit Glass Canopy
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(0.84, 0.82);
    canopyShape.lineTo(0.18, 1.23);
    canopyShape.lineTo(-0.76, 1.23);
    canopyShape.lineTo(-1.55, 0.93);
    canopyShape.lineTo(0.84, 0.82);
    const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, {
      depth: 1.44,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 2,
    });
    canopyGeo.translate(0, 0, -0.72);
    canopyGeo.rotateY(Math.PI / 2);
    const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
    canopyMesh.position.y = 0.02;
    bodyGroup.add(canopyMesh);

    // 3. Front Carbon Splitter & Side Skirts
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.07, 0.45), carbonMat);
    splitter.position.set(0, 0.19, -2.06);
    splitter.castShadow = true;
    bodyGroup.add(splitter);

    const skirtGeo = new THREE.BoxGeometry(0.12, 0.09, 2.55);
    const leftSkirt = new THREE.Mesh(skirtGeo, carbonMat);
    leftSkirt.position.set(-0.92, 0.21, 0);
    const rightSkirt = new THREE.Mesh(skirtGeo, carbonMat);
    rightSkirt.position.set(0.92, 0.21, 0);
    bodyGroup.add(leftSkirt, rightSkirt);

    // 4. Rear Diffuser
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.16, 0.36), carbonMat);
    diffuser.position.set(0, 0.22, 2.08);
    bodyGroup.add(diffuser);

    // 5. GT Rear Wing Group (tilts on rear collision damage)
    const wingGroup = new THREE.Group();
    const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.05, 0.34), carbonMat);
    wingBlade.position.set(0, 1.21, 1.98);
    wingBlade.rotation.x = 0.12;
    wingBlade.castShadow = true;
    const pylonGeo = new THREE.BoxGeometry(0.05, 0.34, 0.18);
    const pylonL = new THREE.Mesh(pylonGeo, carbonMat);
    pylonL.position.set(-0.46, 1.04, 1.96);
    const pylonR = new THREE.Mesh(pylonGeo, carbonMat);
    pylonR.position.set(0.46, 1.04, 1.96);
    wingGroup.add(wingBlade, pylonL, pylonR);
    bodyGroup.add(wingGroup);

    // 6. Front Projector Headlights + Real SpotLights & Beam Cones
    const hlGeo = new THREE.BoxGeometry(0.32, 0.1, 0.12);
    const hlLeft = new THREE.Mesh(hlGeo, headlightMat);
    hlLeft.position.set(-0.62, 0.62, -2.14);
    const hlRight = new THREE.Mesh(hlGeo, headlightMat);
    hlRight.position.set(0.62, 0.62, -2.14);
    bodyGroup.add(hlLeft, hlRight);

    let headlightSpotL: THREE.SpotLight | null = null;
    let headlightSpotR: THREE.SpotLight | null = null;
    let headlightConeL: THREE.Mesh | null = null;
    let headlightConeR: THREE.Mesh | null = null;

    if (withSpotLights) {
      headlightSpotL = new THREE.SpotLight(0xfff5db, 0, 75, 0.44, 0.55, 1.4);
      headlightSpotL.position.set(-0.62, 0.65, -2.15);
      headlightSpotL.target.position.set(-0.62, 0.1, -24);
      bodyGroup.add(headlightSpotL, headlightSpotL.target);

      headlightSpotR = new THREE.SpotLight(0xfff5db, 0, 75, 0.44, 0.55, 1.4);
      headlightSpotR.position.set(0.62, 0.65, -2.15);
      headlightSpotR.target.position.set(0.62, 0.1, -24);
      bodyGroup.add(headlightSpotR, headlightSpotR.target);

      const coneGeo = new THREE.ConeGeometry(2.3, 12, 16, 1, true);
      coneGeo.translate(0, -6, 0);
      coneGeo.rotateX(Math.PI / 2);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xfff3d1,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      headlightConeL = new THREE.Mesh(coneGeo, coneMat);
      headlightConeL.position.set(-0.62, 0.6, -2.15);
      headlightConeL.visible = false;

      headlightConeR = new THREE.Mesh(coneGeo, coneMat);
      headlightConeR.position.set(0.62, 0.6, -2.15);
      headlightConeR.visible = false;
      bodyGroup.add(headlightConeL, headlightConeR);
    }

    // 7. Rear LED Taillight Bar
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.08, 0.08), tailLightMat);
    tailBar.position.set(0, 0.72, 2.21);
    bodyGroup.add(tailBar);

    // 8. Twin Exhaust Tips + Backfire Flame Cone
    const tipGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.18, 12);
    tipGeo.rotateX(Math.PI / 2);
    const tipL = new THREE.Mesh(tipGeo, chromeMat);
    tipL.position.set(-0.42, 0.24, 2.24);
    const tipR = new THREE.Mesh(tipGeo, chromeMat);
    tipR.position.set(0.42, 0.24, 2.24);
    bodyGroup.add(tipL, tipR);

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0.9,
    });
    const exhaustFlash = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 8), flameMat);
    exhaustFlash.rotation.x = Math.PI / 2;
    exhaustFlash.position.set(0.42, 0.24, 2.48);
    exhaustFlash.visible = false;
    bodyGroup.add(exhaustFlash);

    // 9. 4 Multi-Part Wheel Assemblies
    const wheelOffsets: Array<{ x: number; z: number; front: boolean }> = [
      { x: -0.9, z: -1.36, front: true },
      { x: 0.9, z: -1.36, front: true },
      { x: -0.91, z: 1.32, front: false },
      { x: 0.91, z: 1.32, front: false },
    ];

    const tireGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 24);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x15171c,
      roughness: 0.88,
      metalness: 0.05,
    });
    const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.27, 16);
    rimGeo.rotateZ(Math.PI / 2);
    const rotorGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.28, 16);
    rotorGeo.rotateZ(Math.PI / 2);
    const rotorMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.35,
    });
    const spokeGeo = new THREE.BoxGeometry(0.28, 0.38, 0.045);

    const wheels: WheelRig[] = wheelOffsets.map((pos) => {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(pos.x, 0.33, pos.z);
      root.add(steerPivot);

      const spinGroup = new THREE.Group();
      steerPivot.add(spinGroup);

      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      spinGroup.add(tire);

      const rim = new THREE.Mesh(rimGeo, chromeMat);
      spinGroup.add(rim);

      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      spinGroup.add(rotor);

      for (let sp = 0; sp < 3; sp++) {
        const spoke = new THREE.Mesh(spokeGeo, chromeMat);
        spoke.rotation.x = (sp * Math.PI) / 3;
        spinGroup.add(spoke);
      }

      return { steerPivot, spinGroup, isFront: pos.front };
    });

    // 10. Contact Shadow Plane
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.contactShadowTex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.1), shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.03;
    root.add(shadowPlane);

    return {
      root,
      bodyGroup,
      paintMaterial: paintMat,
      tailLightMat,
      headlightMat,
      splitter,
      diffuser,
      wingGroup,
      exhaustFlash,
      headlightSpotL,
      headlightSpotR,
      headlightConeL,
      headlightConeR,
      wheels,
      shadowPlane,
      baseColorHex: paintHex,
    };
  }

  public buildTrackScene(sampled: SampledTrack) {
    while (this.trackGroup.children.length > 0) {
      this.trackGroup.remove(this.trackGroup.children[0]);
    }
    for (const item of this.disposableTrackItems) {
      item.dispose();
    }
    this.disposableTrackItems = [];
    this.gantryLights = [];
    this.roadMaterial = null;

    const theme = sampled.definition.theme;
    const palette = getThemePalette(theme);

    const minTrackY = Math.min(...sampled.samples.map((s) => s.point.y));
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const terrainTex = createTerrainTexture(theme, maxAniso);
    const terrainGeo = new THREE.PlaneGeometry(1800, 1800, 48, 48);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const gx = posAttr.getX(i);
      const gz = posAttr.getZ(i);
      const distFromTrackCenter = Math.hypot(
        gx - (sampled.minX + sampled.maxX) * 0.5,
        gz - (sampled.minZ + sampled.maxZ) * 0.5,
      );
      const hillFactor = THREE.MathUtils.smoothstep(distFromTrackCenter, 220, 620);
      const h =
        (Math.sin(gx * 0.015) * Math.cos(gz * 0.015) * 18 +
          Math.sin(gx * 0.04 + gz * 0.03) * 5) *
        hillFactor;
      posAttr.setY(i, minTrackY - 1.4 + h);
    }
    terrainGeo.computeVertexNormals();
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTex,
      roughness: 0.96,
      metalness: 0.0,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    this.trackGroup.add(terrainMesh);
    this.disposableTrackItems.push(terrainGeo, terrainMat, terrainTex);

    const { samples, halfWidth, curbWidth, barrierHalfWidth, totalLength } = sampled;
    const count = samples.length;

    const buildRibbon = (
      innerOffset: number,
      outerOffset: number,
      yBias: number,
      uvScaleX: number,
      uvRepeatPerMeter: number,
    ) => {
      const positions = new Float32Array((count + 1) * 2 * 3);
      const normals = new Float32Array((count + 1) * 2 * 3);
      const uvs = new Float32Array((count + 1) * 2 * 2);
      const indices: number[] = [];

      for (let i = 0; i <= count; i++) {
        const s = samples[i % count];
        const vCoord = (i === count ? totalLength : s.distFromStart) * uvRepeatPerMeter;

        const p0x = s.point.x + s.right.x * innerOffset;
        const p0y = s.point.y + innerOffset * Math.sin(s.bankRad) + yBias;
        const p0z = s.point.z + s.right.z * innerOffset;

        const p1x = s.point.x + s.right.x * outerOffset;
        const p1y = s.point.y + outerOffset * Math.sin(s.bankRad) + yBias;
        const p1z = s.point.z + s.right.z * outerOffset;

        const base = i * 6;
        positions[base] = p0x;
        positions[base + 1] = p0y;
        positions[base + 2] = p0z;
        positions[base + 3] = p1x;
        positions[base + 4] = p1y;
        positions[base + 5] = p1z;

        normals[base] = s.up.x;
        normals[base + 1] = s.up.y;
        normals[base + 2] = s.up.z;
        normals[base + 3] = s.up.x;
        normals[base + 4] = s.up.y;
        normals[base + 5] = s.up.z;

        const uvBase = i * 4;
        uvs[uvBase] = 0;
        uvs[uvBase + 1] = vCoord;
        uvs[uvBase + 2] = uvScaleX;
        uvs[uvBase + 3] = vCoord;

        if (i < count) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, b, c, b, d, c);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      return geo;
    };

    const roadGeo = buildRibbon(-halfWidth, halfWidth, 0.04, 1, 0.065);
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.asphaltTex,
      roughness: 0.84,
      metalness: 0.08,
      envMapIntensity: 0.9,
    });
    this.roadMaterial = roadMat;
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.trackGroup.add(roadMesh);
    this.disposableTrackItems.push(roadGeo, roadMat);

    const apronGeo = buildRibbon(-barrierHalfWidth, barrierHalfWidth, 0.0, 4, 0.05);
    const apronMat = new THREE.MeshStandardMaterial({
      color: theme === 'desert-canyon' ? 0x8e694d : 0x3b4939,
      roughness: 0.94,
      metalness: 0.0,
    });
    const apronMesh = new THREE.Mesh(apronGeo, apronMat);
    apronMesh.receiveShadow = true;
    this.trackGroup.add(apronMesh);
    this.disposableTrackItems.push(apronGeo, apronMat);

    const curbMat = new THREE.MeshStandardMaterial({
      map: this.curbTex,
      roughness: 0.72,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const leftCurbGeo = buildRibbon(-(halfWidth + curbWidth), -halfWidth + 0.1, 0.055, 1, 0.28);
    const rightCurbGeo = buildRibbon(halfWidth - 0.1, halfWidth + curbWidth, 0.055, 1, 0.28);
    const leftCurb = new THREE.Mesh(leftCurbGeo, curbMat);
    const rightCurb = new THREE.Mesh(rightCurbGeo, curbMat);
    leftCurb.receiveShadow = true;
    rightCurb.receiveShadow = true;
    this.trackGroup.add(leftCurb, rightCurb);
    this.disposableTrackItems.push(leftCurbGeo, rightCurbGeo, curbMat);

    const buildBarrierWall = (offset: number) => {
      const positions = new Float32Array((count + 1) * 2 * 3);
      const uvs = new Float32Array((count + 1) * 2 * 2);
      const indices: number[] = [];
      const wallHeight = 1.05;

      for (let i = 0; i <= count; i++) {
        const s = samples[i % count];
        const bx = s.point.x + s.right.x * offset;
        const by = s.point.y + offset * Math.sin(s.bankRad) - 0.1;
        const bz = s.point.z + s.right.z * offset;

        const base = i * 6;
        positions[base] = bx;
        positions[base + 1] = by;
        positions[base + 2] = bz;
        positions[base + 3] = bx;
        positions[base + 4] = by + wallHeight;
        positions[base + 5] = bz;

        const uvBase = i * 4;
        uvs[uvBase] = s.distFromStart * 0.2;
        uvs[uvBase + 1] = 0;
        uvs[uvBase + 2] = s.distFromStart * 0.2;
        uvs[uvBase + 3] = 1;

        if (i < count) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          if (offset > 0) {
            indices.push(a, c, b, b, c, d);
          } else {
            indices.push(a, b, c, b, d, c);
          }
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    const barrierMat = new THREE.MeshStandardMaterial({
      color: palette.barrierColor,
      roughness: 0.45,
      metalness: 0.55,
      side: THREE.DoubleSide,
    });
    const wallLGeo = buildBarrierWall(-barrierHalfWidth);
    const wallRGeo = buildBarrierWall(barrierHalfWidth);
    const wallL = new THREE.Mesh(wallLGeo, barrierMat);
    const wallR = new THREE.Mesh(wallRGeo, barrierMat);
    wallL.castShadow = true;
    wallR.castShadow = true;
    wallL.receiveShadow = true;
    wallR.receiveShadow = true;
    this.trackGroup.add(wallL, wallR);
    this.disposableTrackItems.push(wallLGeo, wallRGeo, barrierMat);

    // Start/Finish Checkered Strip + Overhead Gantry
    const s0 = samples[0];
    const startYaw = Math.atan2(-s0.tangent.x, -s0.tangent.z);

    const finishStripGeo = new THREE.PlaneGeometry(halfWidth * 2, 3.2);
    finishStripGeo.rotateX(-Math.PI / 2);
    const finishStripMat = new THREE.MeshStandardMaterial({
      map: this.checkerTex,
      roughness: 0.65,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const finishStrip = new THREE.Mesh(finishStripGeo, finishStripMat);
    finishStrip.position.set(s0.point.x, s0.point.y + 0.06, s0.point.z);
    finishStrip.rotation.y = startYaw;
    finishStrip.rotation.z = -s0.bankRad;
    finishStrip.receiveShadow = true;
    this.trackGroup.add(finishStrip);
    this.disposableTrackItems.push(finishStripGeo, finishStripMat);

    const gantryGroup = new THREE.Group();
    gantryGroup.position.set(s0.point.x, s0.point.y, s0.point.z);
    gantryGroup.rotation.y = startYaw;
    const gantryMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.72,
      roughness: 0.35,
    });
    const spanWidth = halfWidth * 2 + 3.4;
    const postGeo = new THREE.BoxGeometry(0.65, 7.2, 0.65);
    const postL = new THREE.Mesh(postGeo, gantryMat);
    postL.position.set(-spanWidth / 2, 3.6, 0);
    postL.castShadow = true;
    const postR = new THREE.Mesh(postGeo, gantryMat);
    postR.position.set(spanWidth / 2, 3.6, 0);
    postR.castShadow = true;
    const beamGeo = new THREE.BoxGeometry(spanWidth + 0.8, 1.15, 0.75);
    const beam = new THREE.Mesh(beamGeo, gantryMat);
    beam.position.set(0, 6.75, 0);
    beam.castShadow = true;

    const bannerGeo = new THREE.PlaneGeometry(spanWidth * 0.62, 0.88);
    const bannerMat = new THREE.MeshStandardMaterial({
      map: this.checkerTex,
      roughness: 0.5,
    });
    const bannerFront = new THREE.Mesh(bannerGeo, bannerMat);
    bannerFront.position.set(0, 6.75, 0.4);
    const bannerBack = new THREE.Mesh(bannerGeo, bannerMat);
    bannerBack.position.set(0, 6.75, -0.4);
    bannerBack.rotation.y = Math.PI;
    gantryGroup.add(postL, postR, beam, bannerFront, bannerBack);

    const lightPodGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 16);
    lightPodGeo.rotateX(Math.PI / 2);
    for (let li = 0; li < 5; li++) {
      const lMat = new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.25,
      });
      const pod = new THREE.Mesh(lightPodGeo, lMat);
      pod.position.set((li - 2) * 0.78, 5.95, 0.35);
      gantryGroup.add(pod);
      this.gantryLights.push(pod);
      this.disposableTrackItems.push(lMat);
    }

    this.trackGroup.add(gantryGroup);
    this.disposableTrackItems.push(postGeo, beamGeo, bannerGeo, bannerMat, gantryMat, lightPodGeo);

    // Instanced Natural Outdoor Props
    const treeCount = 150;
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 2.4, 7);
    trunkGeo.translate(0, 1.2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: theme === 'desert-canyon' ? 0x7c4728 : 0x4b3621,
      roughness: 0.92,
    });
    const canopyGeo =
      theme === 'desert-canyon'
        ? new THREE.DodecahedronGeometry(2.6, 0)
        : new THREE.ConeGeometry(2.3, 6.5, 7);
    canopyGeo.translate(0, theme === 'desert-canyon' ? 1.8 : 5.2, 0);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: palette.treeColorA,
      roughness: 0.85,
      metalness: 0.02,
    });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
    canopies.castShadow = !this.isSoftwareGl;
    canopies.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    let placed = 0;
    let attempts = 0;

    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const centerX = (sampled.minX + sampled.maxX) * 0.5;
    const centerZ = (sampled.minZ + sampled.maxZ) * 0.5;
    const span = Math.max(sampled.maxX - sampled.minX, sampled.maxZ - sampled.minZ) + 220;

    while (placed < treeCount && attempts < 1400) {
      attempts++;
      const px = centerX + (rand() - 0.5) * span;
      const pz = centerZ + (rand() - 0.5) * span;

      let minDistSq = Infinity;
      for (let i = 0; i < count; i += 2) {
        const sp = samples[i].point;
        const dSq = (px - sp.x) * (px - sp.x) + (pz - sp.z) * (pz - sp.z);
        if (dSq < minDistSq) minDistSq = dSq;
      }

      const clearance = barrierHalfWidth + 9;
      if (minDistSq < clearance * clearance) continue;

      const scale = 0.85 + rand() * 0.65;
      dummy.position.set(px, minTrackY - 1.4, pz);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(scale, scale * (0.9 + rand() * 0.3), scale);
      dummy.updateMatrix();

      if (theme !== 'desert-canyon') {
        trunks.setMatrixAt(placed, dummy.matrix);
      } else {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(placed, dummy.matrix);
        dummy.scale.set(scale * 1.4, scale * 1.1, scale * 1.3);
        dummy.updateMatrix();
      }
      canopies.setMatrixAt(placed, dummy.matrix);

      tint
        .setHex(rand() > 0.5 ? palette.treeColorA : palette.treeColorB)
        .offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.06);
      canopies.setColorAt(placed, tint);

      placed++;
    }
    trunks.count = placed;
    canopies.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    canopies.computeBoundingSphere();

    this.trackGroup.add(trunks, canopies);
    this.disposableTrackItems.push(trunkGeo, trunkMat, canopyGeo, canopyMat);
  }

  public emitSmoke(x: number, y: number, z: number, vx: number, vz: number, scale = 1) {
    const p = this.smokeParticles[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % this.smokeParticles.length;
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 0.35;
    p.y = y + 0.18;
    p.z = z + (Math.random() - 0.5) * 0.35;
    p.vx = vx * 0.2 + (Math.random() - 0.5) * 1.4;
    p.vy = 0.65 + Math.random() * 0.7;
    p.vz = vz * 0.2 + (Math.random() - 0.5) * 1.4;
    p.life = 0;
    p.maxLife = 0.55 + Math.random() * 0.35;
    p.scale = scale;
  }

  private updateSmoke(dt: number) {
    let anyChanged = false;
    for (let i = 0; i < this.smokeParticles.length; i++) {
      const p = this.smokeParticles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _mat4.makeScale(0, 0, 0);
        this.smokeMesh.setMatrixAt(i, _mat4);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const s = p.scale * (0.45 + t * 1.6) * (1 - t * 0.65);
      _vec3A.set(p.x, p.y, p.z);
      _scaleVec.set(s, s, s);
      _quat.identity();
      _mat4.compose(_vec3A, _quat, _scaleVec);
      this.smokeMesh.setMatrixAt(i, _mat4);
    }
    if (anyChanged) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public updatePlayerCar(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    roll: number,
    roadPitch: number,
    bankRoll: number,
    steerAngle: number,
    wheelSpinAngle: number,
    braking: boolean,
    headlightsOn: boolean,
    damage: DamageState,
    speedKmh: number,
    dt: number,
  ) {
    const rig = this.playerRig;
    rig.root.position.set(x, y, z);
    rig.root.rotation.order = 'YXZ';
    rig.root.rotation.set(roadPitch, yaw, bankRoll);

    // Apply suspension sag + body pitch/roll
    const avgSusp =
      (damage.suspension[0] +
        damage.suspension[1] +
        damage.suspension[2] +
        damage.suspension[3]) *
      0.25;
    rig.bodyGroup.position.y = -avgSusp * 0.075;
    rig.bodyGroup.rotation.order = 'ZXY';
    rig.bodyGroup.rotation.set(pitch, 0, roll);

    // Visual body damage: paint scuffing, bent front splitter, crooked rear wing & diffuser
    rig.paintMaterial.roughness = 0.24 + damage.body * 0.48;
    rig.paintMaterial.clearcoat = Math.max(0.15, 1.0 - damage.body * 0.85);
    _paintTint.set(rig.baseColorHex).multiplyScalar(1 - damage.body * 0.25);
    rig.paintMaterial.color.copy(_paintTint);

    rig.splitter.position.y = 0.19 - damage.zones.front * 0.06;
    rig.splitter.rotation.z = (damage.zones.left - damage.zones.right) * 0.14;
    rig.splitter.rotation.x = damage.zones.front * 0.12;

    rig.diffuser.rotation.z = (damage.zones.right - damage.zones.left) * 0.12;
    rig.wingGroup.rotation.z = damage.zones.rear * 0.16;
    rig.wingGroup.rotation.x = -damage.zones.rear * 0.14;
    rig.wingGroup.position.y = -damage.zones.rear * 0.05;

    // Headlights & Taillights
    rig.tailLightMat.emissiveIntensity = braking ? 3.2 : headlightsOn ? 1.4 : 0.75;
    rig.headlightMat.emissiveIntensity = headlightsOn ? 2.8 : 0.45;
    const spotIntensity = headlightsOn ? 115 : 0;
    if (rig.headlightSpotL) rig.headlightSpotL.intensity = spotIntensity;
    if (rig.headlightSpotR) rig.headlightSpotR.intensity = spotIntensity;
    if (rig.headlightConeL) rig.headlightConeL.visible = headlightsOn;
    if (rig.headlightConeR) rig.headlightConeR.visible = headlightsOn;

    if (this.backfireTimer > 0) {
      this.backfireTimer = Math.max(0, this.backfireTimer - dt);
      rig.exhaustFlash.visible = this.backfireTimer > 0;
    } else {
      rig.exhaustFlash.visible = false;
    }

    // Wheel steering, spinning, damaged camber & tire wobble
    rig.wheels.forEach((w, idx) => {
      const sideSign = idx % 2 === 0 ? -1 : 1;
      const suspDmg = damage.suspension[idx];
      const tireDmg = damage.tires[idx];
      const wobble =
        tireDmg > 0.2 && speedKmh > 6
          ? Math.sin(wheelSpinAngle * 1.4) * tireDmg * 0.08
          : 0;
      w.steerPivot.rotation.y = (w.isFront ? steerAngle : 0) + wobble;
      w.steerPivot.rotation.z = sideSign * suspDmg * 0.22;
      w.spinGroup.rotation.x = -wheelSpinAngle;
    });

    // Move sun shadow frustum with player car
    this.sunLight.position.set(
      x + this.sunOffsetX,
      y + this.sunOffsetY,
      z + this.sunOffsetZ,
    );
    this.sunLight.target.position.set(x, y, z);
    this.sunLight.target.updateMatrixWorld();

    if (this.shakeIntensity > 0) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.9);
    }

    if (this.cameraMode === 'orbit') {
      this.orbitAngle += dt * 0.24;
      const radius = 8.4;
      const cx = x + Math.sin(this.orbitAngle) * radius;
      const cz = z + Math.cos(this.orbitAngle) * radius;
      const cy = y + 2.85;
      this.camPos.lerp(_vec3A.set(cx, cy, cz), 1 - Math.exp(-5 * dt));
      this.camLook.lerp(_vec3B.set(x, y + 0.85, z), 1 - Math.exp(-6 * dt));
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 52, 1 - Math.exp(-5 * dt));
    } else if (this.cameraMode === 'hood') {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      this.camera.position.set(x + fx * 0.35, y + 1.18, z + fz * 0.35);
      _vec3B.set(x + fx * 18, y + 1.05 - roadPitch * 14, z + fz * 18);
      this.camera.lookAt(_vec3B);
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        62 + Math.min(14, speedKmh * 0.08),
        1 - Math.exp(-6 * dt),
      );
      this.camera.updateProjectionMatrix();
      return;
    } else if (this.cameraMode === 'bumper') {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      this.camera.position.set(x + fx * 2.1, y + 0.56, z + fz * 2.1);
      _vec3B.set(x + fx * 20, y + 0.55 - roadPitch * 16, z + fz * 20);
      this.camera.lookAt(_vec3B);
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        66 + Math.min(16, speedKmh * 0.09),
        1 - Math.exp(-6 * dt),
      );
      this.camera.updateProjectionMatrix();
      return;
    } else {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const dist = 6.6 + Math.min(1.4, speedKmh * 0.008);
      _vec3A.set(x - fx * dist, y + 2.45, z - fz * dist);
      _vec3B.set(x + fx * 6.5, y + 1.05, z + fz * 6.5);

      const posDamp = 1 - Math.exp(-9.5 * dt);
      const lookDamp = 1 - Math.exp(-12 * dt);
      this.camPos.lerp(_vec3A, posDamp);
      this.camLook.lerp(_vec3B, lookDamp);

      const targetFov = 58 + Math.min(15, speedKmh * 0.085);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-5 * dt));
    }

    const sx = (Math.random() - 0.5) * this.shakeIntensity;
    const sy = (Math.random() - 0.5) * this.shakeIntensity * 0.7;
    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  public syncRemotePlayers(
    players: Array<{ id: string; color: string }>,
    telemetries: Map<string, RemotePlayerTelemetry>,
    localId: string | null,
    dt: number,
  ): ProjectedTag[] {
    const activeIds = new Set<string>();
    const tags: ProjectedTag[] = [];
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    for (const p of players) {
      if (p.id === localId) continue;
      const tel = telemetries.get(p.id);
      if (!tel) continue;
      activeIds.add(p.id);

      let entry = this.remoteCars.get(p.id);
      if (!entry) {
        const rig = this.createCarRig(p.color || '#06b6d4', false);
        this.scene.add(rig.root);
        entry = {
          rig,
          target: tel,
          curX: tel.x,
          curY: tel.y,
          curZ: tel.z,
          curYaw: tel.yaw,
          curPitch: tel.pitch,
          curRoll: tel.roll,
          curSteer: tel.steerAngle,
          curWheelSpin: tel.wheelSpin,
          color: p.color,
        };
        this.remoteCars.set(p.id, entry);
      } else {
        entry.target = tel;
        if (entry.color !== p.color) {
          entry.color = p.color;
          entry.rig.baseColorHex = p.color;
          entry.rig.paintMaterial.color.set(p.color);
        }
      }

      const alpha = 1 - Math.exp(-14 * dt);
      entry.curX = THREE.MathUtils.lerp(entry.curX, tel.x, alpha);
      entry.curY = THREE.MathUtils.lerp(entry.curY, tel.y, alpha);
      entry.curZ = THREE.MathUtils.lerp(entry.curZ, tel.z, alpha);

      let dyaw = tel.yaw - entry.curYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      entry.curYaw += dyaw * alpha;

      entry.curPitch = THREE.MathUtils.lerp(entry.curPitch, tel.pitch, alpha);
      entry.curRoll = THREE.MathUtils.lerp(entry.curRoll, tel.roll, alpha);
      entry.curSteer = THREE.MathUtils.lerp(entry.curSteer, tel.steerAngle, alpha);
      entry.curWheelSpin = tel.wheelSpin;

      entry.rig.root.position.set(entry.curX, entry.curY, entry.curZ);
      entry.rig.root.rotation.set(0, entry.curYaw, 0);
      entry.rig.bodyGroup.rotation.set(entry.curPitch, 0, entry.curRoll);
      entry.rig.tailLightMat.emissiveIntensity = tel.braking ? 3.0 : tel.headlightsOn ? 1.4 : 0.75;
      entry.rig.headlightMat.emissiveIntensity = tel.headlightsOn ? 2.6 : 0.45;

      for (const w of entry.rig.wheels) {
        w.steerPivot.rotation.y = w.isFront ? entry.curSteer : 0;
        w.spinGroup.rotation.x = -entry.curWheelSpin;
      }

      _vec3C.set(entry.curX, entry.curY + 2.15, entry.curZ);
      _vec3C.project(this.camera);
      const visible = _vec3C.z > -1 && _vec3C.z < 1;
      tags.push({
        id: p.id,
        x: (_vec3C.x * 0.5 + 0.5) * width,
        y: (-_vec3C.y * 0.5 + 0.5) * height,
        visible,
      });
    }

    for (const [id, entry] of this.remoteCars.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.rig.root);
        this.remoteCars.delete(id);
      }
    }

    return tags;
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);

    for (const item of this.disposableTrackItems) {
      item.dispose();
    }
    this.rainLines.geometry.dispose();
    (this.rainLines.material as THREE.Material).dispose();
    this.asphaltTex.dispose();
    this.curbTex.dispose();
    this.checkerTex.dispose();
    this.contactShadowTex.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
