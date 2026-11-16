import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Wrench, Users, Volume2, VolumeX, RotateCcw, Trophy } from 'lucide-react';
import type {
  CarSpecId,
  ClientWsMessage,
  EnvironmentConfig,
  Gear,
  RemotePlayerTelemetry,
  RoomState,
  ServerWsMessage,
  TelemetrySnapshot,
  TimeOfDay,
  TrackDefinition,
  WeatherCondition,
} from './types/sim';
import {
  PRESET_TRACKS,
  buildSampledTrack,
  deleteCustomTrack,
  loadCustomTracks,
  saveCustomTrack,
  type SampledTrack,
} from './sim/trackSystem';
import { CAR_SPECS, CarPhysics, type CarInputState } from './sim/carPhysics';
import { AudioEngine } from './sim/audioEngine';
import { ThreeWorld, type CameraMode, type ProjectedTag } from './sim/ThreeWorld';
import { DrivingHud, formatLapTime } from './components/DrivingHud';
import { TrackEditorModal } from './components/TrackEditorModal';
import { MultiplayerModal } from './components/MultiplayerModal';

type GamePhase = 'title' | 'playing' | 'paused' | 'finished';

const CAMERA_CYCLE: CameraMode[] = ['chase', 'hood', 'bumper'];

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [showTrackEditor, setShowTrackEditor] = useState(false);
  const [showMultiplayer, setShowMultiplayer] = useState(false);

  const [savedCustomTracks, setSavedCustomTracks] = useState<TrackDefinition[]>(() =>
    loadCustomTracks(),
  );
  const [activeTrack, setActiveTrack] = useState<TrackDefinition>(PRESET_TRACKS[0]);
  const [sampledTrack, setSampledTrack] = useState<SampledTrack>(() =>
    buildSampledTrack(PRESET_TRACKS[0]),
  );

  const [environment, setEnvironment] = useState<EnvironmentConfig>({
    weather: 'clear',
    timeOfDay: 'midday',
    dynamicCycle: false,
  });

  const [carSpec, setCarSpec] = useState<CarSpecId>('gt-coupe');
  const [carColor, setCarColor] = useState<string>(CAR_SPECS['gt-coupe'].defaultColor);
  const [playerName, setPlayerName] = useState<string>('Driver 01');

  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [muted, setMuted] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);

  // Multiplayer WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [mpError, setMpError] = useState<string | null>(null);
  const [projectedTags, setProjectedTags] = useState<ProjectedTag[]>([]);

  // Simulation refs isolated from React re-renders
  const phaseRef = useRef<GamePhase>('title');
  const showModalRef = useRef(false);
  const sampledTrackRef = useRef<SampledTrack>(sampledTrack);
  const envRef = useRef<EnvironmentConfig>(environment);
  const headlightManualRef = useRef<boolean | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const localPlayerIdRef = useRef<string | null>(null);
  const cameraModeRef = useRef<CameraMode>('chase');
  const remoteTelemetriesRef = useRef<Map<string, RemotePlayerTelemetry>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const worldRef = useRef<ThreeWorld | null>(null);
  const audioRef = useRef<AudioEngine>(new AudioEngine());

  const inputRef = useRef<CarInputState>({
    throttle: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    clutchHeld: false,
    handbrake: false,
    manualClutchOverride: null,
    manualThrottleOverride: null,
    manualBrakeOverride: null,
  });

  const physicsRef = useRef<CarPhysics | null>(null);
  if (!physicsRef.current) {
    physicsRef.current = new CarPhysics(carSpec, {
      onGearShift: () => {
        audioRef.current.playGearShiftClack();
      },
      onGearGrind: () => {
        audioRef.current.playGearGrind();
        worldRef.current?.triggerShake(0.28);
      },
      onStall: () => {
        audioRef.current.playStallChug();
        worldRef.current?.triggerShake(0.35);
      },
      onStarterCrank: () => {
        audioRef.current.playStarterCrank();
      },
      onBackfire: () => {
        audioRef.current.playBackfire();
        worldRef.current?.triggerBackfireFlash();
      },
      onCollision: (intensity) => {
        audioRef.current.playCollision(intensity);
        worldRef.current?.triggerShake(intensity);
      },
      onLapComplete: (lapTimeMs, newLap) => {
        const activeRoom = roomRef.current;
        if (activeRoom && wsRef.current?.readyState === WebSocket.OPEN) {
          const msg: ClientWsMessage = {
            type: 'player:lap',
            lapTimeMs,
            lap: newLap,
          };
          wsRef.current.send(JSON.stringify(msg));
        }
        if (newLap > sampledTrackRef.current.definition.totalLaps) {
          phaseRef.current = 'finished';
          setPhase('finished');
        }
      },
    });
    physicsRef.current.resetOnTrack(sampledTrack, 0);
  }

  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(() =>
    physicsRef.current!.getTelemetry(activeTrack.totalLaps),
  );

  useEffect(() => {
    phaseRef.current = phase;
    if (worldRef.current) {
      worldRef.current.setCameraMode(phase === 'title' ? 'orbit' : cameraModeRef.current);
    }
  }, [phase]);

  useEffect(() => {
    showModalRef.current = showTrackEditor || showMultiplayer;
  }, [showTrackEditor, showMultiplayer]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    localPlayerIdRef.current = localPlayerId;
  }, [localPlayerId]);

  const applyEnvironment = useCallback((next: EnvironmentConfig) => {
    envRef.current = next;
    setEnvironment(next);
    physicsRef.current?.setWeather(next.weather);
    worldRef.current?.setEnvironment(next);
  }, []);

  const sendWs = useCallback((msg: ClientWsMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const loadTrackIntoWorld = useCallback((track: TrackDefinition, gridSlot = 0) => {
    const nextSampled = buildSampledTrack(track);
    sampledTrackRef.current = nextSampled;
    setActiveTrack(track);
    setSampledTrack(nextSampled);
    worldRef.current?.buildTrackScene(nextSampled);
    physicsRef.current?.resetOnTrack(nextSampled, gridSlot);
    if (physicsRef.current) {
      setTelemetry(physicsRef.current.getTelemetry(track.totalLaps));
    }
  }, []);

  // WebSocket Multiplayer Connection
  useEffect(() => {
    let closedByUnmount = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (closedByUnmount) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setMpError(null);
      };

      ws.onmessage = (ev) => {
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerWsMessage;
        } catch {
          return;
        }

        if (msg.type === 'ws:welcome') {
          setLocalPlayerId(msg.playerId);
        } else if (msg.type === 'room:joined') {
          setLocalPlayerId(msg.playerId);
          setRoom(msg.room);
          setMpError(null);
          if (msg.room.environment) applyEnvironment(msg.room.environment);
          const mySlot = Math.max(
            0,
            msg.room.players.findIndex((p) => p.id === msg.playerId),
          );
          loadTrackIntoWorld(msg.room.track, mySlot);
        } else if (msg.type === 'room:state') {
          const prev = roomRef.current;
          setRoom(msg.room);
          if (msg.room.environment) applyEnvironment(msg.room.environment);

          if (
            !prev ||
            prev.track.id !== msg.room.track.id ||
            prev.track.nodes.length !== msg.room.track.nodes.length
          ) {
            const mySlot = Math.max(
              0,
              msg.room.players.findIndex((p) => p.id === localPlayerIdRef.current),
            );
            loadTrackIntoWorld(msg.room.track, mySlot);
          }

          if (prev?.status !== 'countdown' && msg.room.status === 'countdown') {
            const mySlot = Math.max(
              0,
              msg.room.players.findIndex((p) => p.id === localPlayerIdRef.current),
            );
            physicsRef.current?.resetOnTrack(sampledTrackRef.current, mySlot);
            setShowMultiplayer(false);
            setShowTrackEditor(false);
            phaseRef.current = 'playing';
            setPhase('playing');
          }

          worldRef.current?.updateGantryLights(
            msg.room.countdownSec,
            msg.room.status === 'countdown' || msg.room.status === 'racing',
          );
        } else if (msg.type === 'room:left') {
          setRoom(null);
          remoteTelemetriesRef.current.clear();
          setProjectedTags([]);
        } else if (msg.type === 'room:error') {
          setMpError(msg.message);
        } else if (msg.type === 'player:telemetry') {
          remoteTelemetriesRef.current.set(msg.telemetry.id, msg.telemetry);
        } else if (msg.type === 'player:disconnected') {
          remoteTelemetriesRef.current.delete(msg.playerId);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUnmount) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [applyEnvironment, loadTrackIntoWorld]);

  // Mount Three.js 3D Viewport ONCE inside isolated ref container
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    let hudAccum = 0;
    let netAccum = 0;

    const world = new ThreeWorld(
      mountEl,
      carColor,
      (dt) => {
        const phys = physicsRef.current!;
        const track = sampledTrackRef.current;
        const curPhase = phaseRef.current;
        const curRoom = roomRef.current;

        const freezeCar =
          curPhase !== 'playing' ||
          showModalRef.current ||
          (curRoom !== null && curRoom.status === 'countdown');

        if (curPhase === 'playing' && !showModalRef.current) {
          phys.step(dt, inputRef.current, track, freezeCar);
        } else if (curPhase === 'title') {
          phys.rpm = phys.spec.idleRpm + Math.sin(performance.now() * 0.004) * 18;
        }

        const speedKmh = Math.round(Math.abs(phys.getForwardSpeed()) * 3.6);
        const isBraking = phys.brake > 0.1 || inputRef.current.handbrake;

        const autoLights = world.isDarkOrLowVis();
        const headlightsOn =
          headlightManualRef.current !== null ? headlightManualRef.current : autoLights;
        phys.headlightsOn = headlightsOn;

        world.updatePlayerCar(
          phys.x,
          phys.y,
          phys.z,
          phys.yaw,
          phys.pitch,
          phys.roll,
          phys.roadPitch,
          phys.bankRoll,
          phys.steerAngle,
          phys.wheelSpinAngle,
          isBraking,
          headlightsOn,
          phys.damage,
          speedKmh,
          dt,
        );

        // Tire smoke, wet road spray, and damaged engine radiator steam/smoke
        if (curPhase === 'playing') {
          const wetWeather =
            envRef.current.weather === 'rain' || envRef.current.weather === 'storm';
          if (
            phys.wheelSpinSlip > 0.28 ||
            phys.lateralSlip > 0.32 ||
            (phys.surface === 'offtrack' && speedKmh > 18) ||
            (wetWeather && speedKmh > 38 && Math.random() < 0.45)
          ) {
            const rx = Math.cos(phys.yaw) * 0.85;
            const rz = -Math.sin(phys.yaw) * 0.85;
            const bx = Math.sin(phys.yaw) * 1.3;
            const bz = Math.cos(phys.yaw) * 1.3;
            world.emitSmoke(phys.x + bx - rx, phys.y, phys.z + bz - rz, phys.vx, phys.vz, 0.85);
            world.emitSmoke(phys.x + bx + rx, phys.y, phys.z + bz + rz, phys.vx, phys.vz, 0.85);
          }

          if (phys.damage.engine > 0.38 && Math.random() < phys.damage.engine * 0.5) {
            const fx = -Math.sin(phys.yaw) * 1.5;
            const fz = -Math.cos(phys.yaw) * 1.5;
            world.emitSmoke(
              phys.x + fx,
              phys.y + 0.72,
              phys.z + fz,
              phys.vx * 0.5,
              phys.vz * 0.5,
              0.7 + phys.damage.engine * 0.6,
            );
          }
        }

        // Continuous engine, tire & rain audio
        const rainIntensity =
          envRef.current.weather === 'storm'
            ? 1.0
            : envRef.current.weather === 'rain'
              ? 0.55
              : 0;
        if (curPhase === 'playing' && !showModalRef.current) {
          audioRef.current.updateContinuous(
            phys.rpm,
            phys.throttle,
            phys.ignitionOn,
            phys.stalled,
            Math.max(phys.wheelSpinSlip, phys.lateralSlip),
            speedKmh,
            rainIntensity,
          );
        } else {
          audioRef.current.updateContinuous(0, 0, false, false, 0, 0, 0);
        }

        let tags: ProjectedTag[] = [];
        if (curRoom) {
          tags = world.syncRemotePlayers(
            curRoom.players,
            remoteTelemetriesRef.current,
            localPlayerIdRef.current,
            dt,
          );
        }

        netAccum += dt;
        if (curRoom && netAccum >= 0.05 && wsRef.current?.readyState === WebSocket.OPEN) {
          netAccum = 0;
          const msg: ClientWsMessage = {
            type: 'player:telemetry',
            progress: phys.progress,
            telemetry: {
              x: phys.x,
              y: phys.y,
              z: phys.z,
              yaw: phys.yaw,
              pitch: phys.pitch,
              roll: phys.roll,
              speedKmh,
              steerAngle: phys.steerAngle,
              wheelSpin: phys.wheelSpinAngle,
              rpm: Math.round(phys.rpm),
              gear: phys.gear,
              braking: isBraking,
              headlightsOn,
            },
          };
          wsRef.current.send(JSON.stringify(msg));
        }

        hudAccum += dt;
        if (hudAccum >= 0.033) {
          hudAccum = 0;
          setTelemetry(phys.getTelemetry(track.definition.totalLaps));
          if (curRoom) setProjectedTags(tags);
        }
      },
      () => {
        if (phaseRef.current === 'playing') {
          audioRef.current.playThunder();
        }
      },
    );

    worldRef.current = world;
    world.buildTrackScene(sampledTrackRef.current);
    world.setEnvironment(envRef.current);
    world.setCameraMode(phaseRef.current === 'title' ? 'orbit' : cameraModeRef.current);
    world.startLoop();

    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    worldRef.current?.setPlayerColor(carColor);
  }, [carColor]);

  useEffect(() => {
    physicsRef.current?.setSpec(carSpec);
  }, [carSpec]);

  const startDriving = useCallback(() => {
    audioRef.current.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    phaseRef.current = 'playing';
    setPhase('playing');
    worldRef.current?.setCameraMode(cameraModeRef.current);
  }, []);

  const cycleCamera = useCallback(() => {
    const idx = CAMERA_CYCLE.indexOf(cameraModeRef.current);
    const next = CAMERA_CYCLE[(idx + 1) % CAMERA_CYCLE.length];
    cameraModeRef.current = next;
    setCameraMode(next);
    if (phaseRef.current === 'playing') {
      worldRef.current?.setCameraMode(next);
    }
  }, []);

  const toggleMute = useCallback(() => {
    audioRef.current.unlock();
    const next = !audioRef.current.isMuted();
    audioRef.current.setMuted(next);
    setMuted(next);
  }, []);

  const toggleHeadlights = useCallback(() => {
    const cur = physicsRef.current?.headlightsOn ?? false;
    headlightManualRef.current = !cur;
  }, []);

  const repairCar = useCallback(() => {
    physicsRef.current?.repairAll();
    if (physicsRef.current) {
      setTelemetry(physicsRef.current.getTelemetry(sampledTrackRef.current.definition.totalLaps));
    }
  }, []);

  const resetCar = useCallback(() => {
    const mySlot = roomRef.current
      ? Math.max(
          0,
          roomRef.current.players.findIndex((p) => p.id === localPlayerIdRef.current),
        )
      : 0;
    physicsRef.current?.resetOnTrack(sampledTrackRef.current, mySlot);
    if (physicsRef.current) {
      setTelemetry(physicsRef.current.getTelemetry(sampledTrackRef.current.definition.totalLaps));
    }
  }, []);

  const handleRequestShift = useCallback((gear: Gear) => {
    audioRef.current.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    physicsRef.current?.requestShift(gear, inputRef.current.clutchHeld);
    if (physicsRef.current) {
      setTelemetry(physicsRef.current.getTelemetry(sampledTrackRef.current.definition.totalLaps));
    }
  }, []);

  const handleCrankIgnition = useCallback(() => {
    audioRef.current.unlock();
    physicsRef.current?.crankIgnition();
  }, []);

  const handlePedalOverride = useCallback(
    (pedal: 'clutch' | 'brake' | 'throttle', value: number | null) => {
      audioRef.current.unlock();
      if (pedal === 'clutch') inputRef.current.manualClutchOverride = value;
      if (pedal === 'brake') inputRef.current.manualBrakeOverride = value;
      if (pedal === 'throttle') inputRef.current.manualThrottleOverride = value;
    },
    [],
  );

  const handleEnvironmentChange = useCallback(
    (next: EnvironmentConfig) => {
      headlightManualRef.current = null; // Re-enable smart auto-headlights on condition change
      applyEnvironment(next);
      if (roomRef.current && roomRef.current.hostId === localPlayerIdRef.current) {
        sendWs({ type: 'room:updateEnvironment', environment: next });
      }
    },
    [applyEnvironment, sendWs],
  );

  // Keyboard Controls
  useEffect(() => {
    const clearHeld = () => {
      inputRef.current.throttle = false;
      inputRef.current.brake = false;
      inputRef.current.steerLeft = false;
      inputRef.current.steerRight = false;
      inputRef.current.clutchHeld = false;
      inputRef.current.handbrake = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      audioRef.current.unlock();

      if (phaseRef.current === 'title' && !showModalRef.current && e.code === 'Enter') {
        e.preventDefault();
        startDriving();
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        if (showTrackEditor) {
          setShowTrackEditor(false);
          return;
        }
        if (showMultiplayer) {
          setShowMultiplayer(false);
          return;
        }
        if (phaseRef.current === 'playing') {
          clearHeld();
          phaseRef.current = 'paused';
          setPhase('paused');
        } else if (phaseRef.current === 'paused') {
          phaseRef.current = 'playing';
          setPhase('playing');
        }
        return;
      }

      if (phaseRef.current !== 'playing' || showModalRef.current) return;

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          inputRef.current.throttle = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          inputRef.current.brake = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          inputRef.current.steerLeft = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          inputRef.current.steerRight = true;
          break;
        case 'Space':
        case 'ShiftLeft':
        case 'KeyC':
          e.preventDefault();
          inputRef.current.clutchHeld = true;
          break;
        case 'KeyB':
          inputRef.current.handbrake = true;
          break;
      }

      if (!e.repeat) {
        const phys = physicsRef.current;
        if (!phys) return;
        const clutchHeld = inputRef.current.clutchHeld;
        let shiftedOrCranked = false;
        switch (e.code) {
          case 'Digit1':
          case 'Numpad1':
            phys.requestShift('1', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'Digit2':
          case 'Numpad2':
            phys.requestShift('2', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'Digit3':
          case 'Numpad3':
            phys.requestShift('3', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'Digit4':
          case 'Numpad4':
            phys.requestShift('4', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'Digit5':
          case 'Numpad5':
            phys.requestShift('5', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'Digit6':
          case 'Numpad6':
            phys.requestShift('6', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'Digit0':
          case 'Numpad0':
          case 'KeyN':
            phys.requestShift('N', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'KeyR':
          case 'Backquote':
            phys.requestShift('R', clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'KeyE':
            phys.shiftUp(clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'KeyQ':
            phys.shiftDown(clutchHeld);
            shiftedOrCranked = true;
            break;
          case 'KeyI':
            phys.crankIgnition();
            shiftedOrCranked = true;
            break;
          case 'KeyV':
            cycleCamera();
            break;
          case 'KeyM':
            toggleMute();
            break;
          case 'KeyL':
            toggleHeadlights();
            break;
          case 'KeyF':
            repairCar();
            break;
          case 'KeyH':
            setHudCollapsed((v) => !v);
            break;
          case 'Backspace':
            resetCar();
            break;
        }
        if (shiftedOrCranked) {
          setTelemetry(phys.getTelemetry(sampledTrackRef.current.definition.totalLaps));
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          inputRef.current.throttle = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          inputRef.current.brake = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          inputRef.current.steerLeft = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          inputRef.current.steerRight = false;
          break;
        case 'Space':
        case 'ShiftLeft':
        case 'KeyC':
          inputRef.current.clutchHeld = false;
          break;
        case 'KeyB':
          inputRef.current.handbrake = false;
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeld);
    };
  }, [
    cycleCamera,
    repairCar,
    resetCar,
    showMultiplayer,
    showTrackEditor,
    startDriving,
    toggleHeadlights,
    toggleMute,
  ]);

  const handleSaveCustomTrack = (track: TrackDefinition) => {
    const updated = saveCustomTrack(track);
    setSavedCustomTracks(updated);
    loadTrackIntoWorld(track, 0);
    if (room && localPlayerId && room.hostId === localPlayerId) {
      sendWs({ type: 'room:updateTrack', track });
    }
    setShowTrackEditor(false);
    startDriving();
  };

  const handleProfileChange = (name: string, color: string, spec: CarSpecId) => {
    setPlayerName(name);
    setCarColor(color);
    setCarSpec(spec);
    if (room) {
      sendWs({ type: 'room:updatePlayer', playerName: name, color, carSpec: spec });
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0B0D10]">
      {/* Isolated Full-Viewport 3D WebGL Canvas */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* TITLE SCREEN OVERLAY */}
      {phase === 'title' && (
        <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-8 sm:p-12">
          <div className="pointer-events-auto max-w-md bg-[#0B0D10]/86 border border-white/12 rounded-xl p-6 shadow-2xl">
            <svg
              viewBox="0 0 360 66"
              className="w-72 h-auto"
              aria-label="Apex Clutch Manual Car Simulator"
            >
              <rect x="0" y="8" width="5" height="46" fill="#F59E0B" />
              <text
                x="16"
                y="37"
                fill="#F8FAFC"
                fontFamily="Chakra Petch, sans-serif"
                fontWeight="700"
                fontSize="32"
                letterSpacing="2.5"
              >
                APEX CLUTCH
              </text>
              <text
                x="18"
                y="55"
                fill="#94A3B8"
                fontFamily="Plus Jakarta Sans, sans-serif"
                fontWeight="500"
                fontSize="11.5"
                letterSpacing="1.6"
              >
                PURE MANUAL TRANSMISSION SIMULATOR
              </text>
            </svg>

            <p className="mt-3 text-sm text-zinc-300 leading-relaxed">
              Full manual gearbox with clutch bite-point physics, dynamic weather grip, mechanical collision damage, custom circuits, and live multiplayer.
            </p>

            {/* Car, Track, Weather & Time Selectors */}
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Manual Machine</label>
                <select
                  value={carSpec}
                  onChange={(e) => {
                    const id = e.target.value as CarSpecId;
                    setCarSpec(id);
                    setCarColor(CAR_SPECS[id].defaultColor);
                  }}
                  className="w-full px-2.5 py-2 bg-[#141820] border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  {Object.values(CAR_SPECS).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Circuit</label>
                <select
                  value={activeTrack.id}
                  onChange={(e) => {
                    const found = [...PRESET_TRACKS, ...savedCustomTracks].find(
                      (t) => t.id === e.target.value,
                    );
                    if (found) loadTrackIntoWorld(found, 0);
                  }}
                  className="w-full px-2.5 py-2 bg-[#141820] border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  {[...PRESET_TRACKS, ...savedCustomTracks].map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Weather</label>
                <select
                  value={environment.weather}
                  onChange={(e) =>
                    handleEnvironmentChange({
                      ...environment,
                      weather: e.target.value as WeatherCondition,
                    })
                  }
                  className="w-full px-2.5 py-2 bg-[#141820] border border-white/15 rounded-lg text-xs text-white capitalize focus:outline-none focus:border-amber-400"
                >
                  <option value="clear">Clear (Dry)</option>
                  <option value="fog">Dense Fog</option>
                  <option value="rain">Rain (Wet)</option>
                  <option value="storm">Thunderstorm</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Time of Day</label>
                <select
                  value={environment.dynamicCycle ? 'cycle' : environment.timeOfDay}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'cycle') {
                      handleEnvironmentChange({ ...environment, dynamicCycle: true });
                    } else {
                      handleEnvironmentChange({
                        ...environment,
                        timeOfDay: val as TimeOfDay,
                        dynamicCycle: false,
                      });
                    }
                  }}
                  className="w-full px-2.5 py-2 bg-[#141820] border border-white/15 rounded-lg text-xs text-white capitalize focus:outline-none focus:border-amber-400"
                >
                  <option value="dawn">Dawn</option>
                  <option value="midday">Midday</option>
                  <option value="dusk">Dusk</option>
                  <option value="night">Night</option>
                  <option value="cycle">Dynamic Cycle</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={startDriving}
                className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Driving
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => setShowTrackEditor(true)}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/12 text-xs font-semibold text-zinc-100 transition-colors cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5 text-amber-400" />
                  Track Builder
                </button>
                <button
                  onClick={() => setShowMultiplayer(true)}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/12 text-xs font-semibold text-zinc-100 transition-colors cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  Multiplayer
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="pointer-events-auto bg-[#0B0D10]/85 border border-white/10 rounded-lg px-4 py-2 text-xs text-zinc-300">
              WASD Steer/Gas · Space Clutch · 1–6 / R / N Manual Shift · I Ignition · F Repair · V Camera · Esc Menu
            </div>
            <button
              onClick={toggleMute}
              className="pointer-events-auto p-2.5 rounded-lg bg-[#0B0D10]/85 border border-white/12 text-zinc-200 hover:text-white cursor-pointer"
              title="Toggle Sound"
            >
              {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* ACTIVE DRIVING HUD */}
      {phase === 'playing' && (
        <DrivingHud
          telemetry={telemetry}
          sampledTrack={sampledTrack}
          trackDef={activeTrack}
          environment={environment}
          cameraMode={cameraMode}
          muted={muted}
          hudCollapsed={hudCollapsed}
          room={room}
          localPlayerId={localPlayerId}
          projectedTags={projectedTags}
          onCycleCamera={cycleCamera}
          onToggleMute={toggleMute}
          onToggleHeadlights={toggleHeadlights}
          onToggleHudCollapsed={() => setHudCollapsed((v) => !v)}
          onChangeEnvironment={handleEnvironmentChange}
          onRepairCar={repairCar}
          onPauseMenu={() => {
            phaseRef.current = 'paused';
            setPhase('paused');
          }}
          onResetCar={resetCar}
          onRequestShift={handleRequestShift}
          onCrankIgnition={handleCrankIgnition}
          onPedalOverride={handlePedalOverride}
        />
      )}

      {/* PAUSE / FINISH MODAL */}
      {(phase === 'paused' || phase === 'finished') && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#07090C]/88 p-4">
          <div className="w-full max-w-md bg-[#11151C] border border-white/15 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              {phase === 'finished' && <Trophy className="w-6 h-6 text-amber-400" />}
              <div>
                <h2 className="font-display text-2xl font-bold text-white">
                  {phase === 'finished' ? 'Checkered Flag' : 'Session Paused'}
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {activeTrack.name} · <span className="capitalize">{environment.weather}</span> ·{' '}
                  <span className="capitalize">{environment.timeOfDay}</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3.5 bg-[#0B0E14] border border-white/10 rounded-lg">
              <div>
                <div className="text-[11px] text-zinc-400">Best Lap</div>
                <div className="font-mono-num text-lg font-bold text-emerald-400">
                  {formatLapTime(telemetry.bestLapMs)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-400">Last Lap</div>
                <div className="font-mono-num text-lg font-bold text-white">
                  {formatLapTime(telemetry.lastLapMs)}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => {
                  if (phase === 'finished') resetCar();
                  startDriving();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                {phase === 'finished' ? 'Drive Another Session' : 'Resume Driving'}
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => {
                    resetCar();
                    startDriving();
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/12 text-xs font-medium text-zinc-200 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restart Grid
                </button>
                <button
                  onClick={() => {
                    repairCar();
                    startDriving();
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/12 text-xs font-medium text-zinc-200 cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5 text-emerald-400" />
                  Pit Repair
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => setShowTrackEditor(true)}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/12 text-xs font-medium text-zinc-200 cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5 text-amber-400" />
                  Track Builder
                </button>
                <button
                  onClick={() => setShowMultiplayer(true)}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/12 text-xs font-medium text-zinc-200 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  Multiplayer
                </button>
              </div>

              <button
                onClick={() => {
                  phaseRef.current = 'title';
                  setPhase('title');
                }}
                className="w-full py-2 px-3 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-medium text-zinc-300 cursor-pointer"
              >
                Title Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM TRACK EDITOR MODAL */}
      {showTrackEditor && (
        <TrackEditorModal
          initialTrack={activeTrack}
          savedTracks={savedCustomTracks}
          onClose={() => setShowTrackEditor(false)}
          onSaveAndDrive={handleSaveCustomTrack}
          onSelectTrack={(t) => loadTrackIntoWorld(t, 0)}
          onDeleteTrack={(id) => setSavedCustomTracks(deleteCustomTrack(id))}
        />
      )}

      {/* MULTIPLAYER LOBBY MODAL */}
      {showMultiplayer && (
        <MultiplayerModal
          wsConnected={wsConnected}
          room={room}
          localPlayerId={localPlayerId}
          errorMsg={mpError}
          playerName={playerName}
          carColor={carColor}
          carSpec={carSpec}
          activeTrack={activeTrack}
          savedCustomTracks={savedCustomTracks}
          onChangeProfile={handleProfileChange}
          onCreateRoom={(roomName) => {
            sendWs({
              type: 'room:create',
              roomName,
              playerName,
              color: carColor,
              carSpec,
              track: activeTrack,
              environment,
            });
          }}
          onJoinRoom={(code) => {
            sendWs({
              type: 'room:join',
              code,
              playerName,
              color: carColor,
              carSpec,
            });
          }}
          onLeaveRoom={() => sendWs({ type: 'room:leave' })}
          onToggleReady={() => {
            const me = room?.players.find((p) => p.id === localPlayerId);
            sendWs({ type: 'room:updatePlayer', ready: !me?.ready });
          }}
          onSelectRoomTrack={(track) => sendWs({ type: 'room:updateTrack', track })}
          onSelectRoomEnvironment={handleEnvironmentChange}
          onStartRace={() => sendWs({ type: 'room:startRace' })}
          onClose={() => setShowMultiplayer(false)}
        />
      )}
    </div>
  );
}
