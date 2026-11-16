import React, { useMemo, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Video,
  Pause,
  RotateCcw,
  Power,
  Lightbulb,
  Wrench,
  CloudRain,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  EnvironmentConfig,
  Gear,
  RoomState,
  TelemetrySnapshot,
  TimeOfDay,
  TrackDefinition,
  WeatherCondition,
} from '../types/sim';
import type { CameraMode, ProjectedTag } from '../sim/ThreeWorld';
import type { SampledTrack } from '../sim/trackSystem';

interface DrivingHudProps {
  telemetry: TelemetrySnapshot;
  sampledTrack: SampledTrack;
  trackDef: TrackDefinition;
  environment: EnvironmentConfig;
  cameraMode: CameraMode;
  muted: boolean;
  hudCollapsed: boolean;
  room: RoomState | null;
  localPlayerId: string | null;
  projectedTags: ProjectedTag[];
  onCycleCamera: () => void;
  onToggleMute: () => void;
  onToggleHeadlights: () => void;
  onToggleHudCollapsed: () => void;
  onChangeEnvironment: (env: EnvironmentConfig) => void;
  onRepairCar: () => void;
  onPauseMenu: () => void;
  onResetCar: () => void;
  onRequestShift: (gear: Gear) => void;
  onCrankIgnition: () => void;
  onPedalOverride: (pedal: 'clutch' | 'brake' | 'throttle', value: number | null) => void;
}

export function formatLapTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--.--';
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const hundredths = Math.floor((totalSec * 100) % 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

const GATE_COORDS: Record<Gear, { col: number; row: number }> = {
  '1': { col: 0, row: 0 },
  '3': { col: 1, row: 0 },
  '5': { col: 2, row: 0 },
  R: { col: 3, row: 0 },
  N: { col: 1.5, row: 1 },
  '2': { col: 0, row: 2 },
  '4': { col: 1, row: 2 },
  '6': { col: 2, row: 2 },
};

function dmgColor(val: number): string {
  if (val < 0.2) return '#34d399';
  if (val < 0.55) return '#f59e0b';
  return '#ef4444';
}

export const DrivingHud: React.FC<DrivingHudProps> = ({
  telemetry,
  sampledTrack,
  trackDef,
  environment,
  cameraMode,
  muted,
  hudCollapsed,
  room,
  localPlayerId,
  projectedTags,
  onCycleCamera,
  onToggleMute,
  onToggleHeadlights,
  onToggleHudCollapsed,
  onChangeEnvironment,
  onRepairCar,
  onPauseMenu,
  onResetCar,
  onRequestShift,
  onCrankIgnition,
  onPedalOverride,
}) => {
  const [envOpen, setEnvOpen] = useState(false);

  const minimap = useMemo(() => {
    const pts = sampledTrack.samples.filter((_, idx) => idx % 3 === 0).map((s) => s.point);
    if (pts.length === 0) return { path: '', toSvg: (_x: number, _z: number) => ({ x: 50, y: 50 }) };

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 20);
    const pad = 12;
    const size = 104 - pad * 2;
    const scale = size / span;
    const offX = pad + (size - (maxX - minX) * scale) * 0.5;
    const offZ = pad + (size - (maxZ - minZ) * scale) * 0.5;

    const toSvg = (wx: number, wz: number) => ({
      x: offX + (wx - minX) * scale,
      y: offZ + (wz - minZ) * scale,
    });

    const d =
      pts
        .map((p, i) => {
          const pt = toSvg(p.x, p.z);
          return `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
        })
        .join(' ') + ' Z';

    return { path: d, toSvg };
  }, [sampledTrack]);

  const playerDot = minimap.toSvg(telemetry.x, telemetry.z);
  const rpmRatio = Math.min(1, telemetry.rpm / telemetry.redlineRpm);
  const arcTotal = 215;
  const arcProgress = rpmRatio * arcTotal;

  const activePedalRef = useRef<'clutch' | 'brake' | 'throttle' | null>(null);

  const handlePedalPointer = (
    pedal: 'clutch' | 'brake' | 'throttle',
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onPedalOverride(pedal, relY);
  };

  const knobPos = GATE_COORDS[telemetry.gear];
  const clutchReady = telemetry.clutch >= (telemetry.damage.transmission > 0.45 ? 0.78 : 0.62);

  const maxDmg = Math.max(
    telemetry.damage.body,
    telemetry.damage.engine,
    telemetry.damage.transmission,
    ...telemetry.damage.tires,
    ...telemetry.damage.suspension,
  );
  const overallHealthPct = Math.max(
    0,
    Math.round(
      100 -
        (telemetry.damage.body * 25 +
          telemetry.damage.engine * 35 +
          telemetry.damage.transmission * 15 +
          ((telemetry.damage.tires[0] +
            telemetry.damage.tires[1] +
            telemetry.damage.tires[2] +
            telemetry.damage.tires[3]) /
            4) *
            25),
    ),
  );

  const isHostOrSolo = !room || room.hostId === localPlayerId;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
      {/* Remote Player Floating Nameplates */}
      {room &&
        projectedTags.map((tag) => {
          if (!tag.visible) return null;
          const rp = room.players.find((p) => p.id === tag.id);
          if (!rp) return null;
          return (
            <div
              key={tag.id}
              style={{
                transform: `translate3d(${tag.x}px, ${tag.y}px, 0) translate(-50%, -100%)`,
              }}
              className="absolute top-0 left-0 px-2 py-0.5 bg-[#0B0D10]/90 border border-white/15 rounded text-[11px] font-medium text-zinc-100 whitespace-nowrap"
            >
              <span
                className="inline-block w-2 h-2 rounded-xs mr-1.5 align-middle"
                style={{ backgroundColor: rp.color }}
              />
              {rp.name}
            </div>
          );
        })}

      {/* Top-Left Timing, Surface & Grip Readout */}
      {!hudCollapsed && (
        <div className="pointer-events-auto absolute top-4 left-4 flex flex-col gap-2">
          <div className="bg-[#0E1117]/92 border border-white/12 rounded-lg px-4 py-2.5 shadow-lg">
            <div className="flex items-center gap-2.5 text-xs text-zinc-400">
              <span className="font-medium text-zinc-200">{trackDef.name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num text-amber-400">
                Lap {Math.min(telemetry.lap, telemetry.totalLaps)}/{telemetry.totalLaps}
              </span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{environment.weather}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num text-zinc-200">{telemetry.gripPercent}% Grip</span>
            </div>

            <div className="mt-1.5 flex items-baseline gap-5">
              <div>
                <div className="text-[10px] text-zinc-500">Current Lap</div>
                <div className="font-mono-num text-xl font-bold text-white tracking-tight">
                  {formatLapTime(telemetry.currentLapMs)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500">Best Lap</div>
                <div className="font-mono-num text-sm font-semibold text-emerald-400">
                  {formatLapTime(telemetry.bestLapMs)}
                </div>
              </div>
              {telemetry.lastLapMs !== null && (
                <div>
                  <div className="text-[10px] text-zinc-500">Last</div>
                  <div className="font-mono-num text-sm text-zinc-300">
                    {formatLapTime(telemetry.lastLapMs)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {room && (
            <div className="bg-[#0E1117]/92 border border-white/12 rounded-lg px-3.5 py-2 text-xs max-w-[260px]">
              <div className="flex items-center justify-between text-zinc-400 mb-1.5">
                <span>Grid · {room.code}</span>
                <span className="font-mono-num text-zinc-300">{room.players.length} Drivers</span>
              </div>
              <div className="space-y-1">
                {[...room.players]
                  .sort((a, b) => b.lap + b.progress - (a.lap + a.progress))
                  .slice(0, 5)
                  .map((p, idx) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between ${
                        p.id === localPlayerId ? 'text-white font-semibold' : 'text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono-num text-zinc-500 w-3">{idx + 1}</span>
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="truncate">{p.name}</span>
                      </div>
                      <span className="font-mono-num text-zinc-400 ml-2">L{p.lap}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top-Right Compact Controls, Weather Switcher & Minimap */}
      <div className="pointer-events-auto absolute top-4 right-4 flex items-start gap-2.5">
        <div className="relative flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 bg-[#0E1117]/92 border border-white/12 rounded-lg p-1.5">
            <button
              onClick={onCycleCamera}
              title="Switch Camera (V)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Video className="w-3.5 h-3.5 text-amber-400" />
              <span className="capitalize">{cameraMode}</span>
            </button>
            <button
              onClick={onToggleHeadlights}
              title="Toggle Headlights (L)"
              className={`p-1.5 rounded hover:bg-white/10 transition-colors cursor-pointer ${
                telemetry.headlightsOn ? 'text-amber-300' : 'text-zinc-400'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setEnvOpen((v) => !v)}
              title="Weather & Time of Day"
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium hover:bg-white/10 transition-colors cursor-pointer ${
                envOpen ? 'text-amber-300 bg-white/10' : 'text-zinc-200'
              }`}
            >
              <CloudRain className="w-3.5 h-3.5 text-sky-400" />
              <span className="capitalize hidden sm:inline">{environment.timeOfDay}</span>
            </button>
            <button
              onClick={onResetCar}
              title="Reset to Grid (Backspace)"
              className="p-1.5 rounded text-zinc-300 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onToggleMute}
              title="Toggle Audio (M)"
              className="p-1.5 rounded text-zinc-300 hover:bg-white/10 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onToggleHudCollapsed}
              title="Collapse / Expand HUD (H)"
              className="p-1.5 rounded text-zinc-300 hover:bg-white/10 transition-colors cursor-pointer"
            >
              {hudCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onPauseMenu}
              title="Pause / Menu (Esc)"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/8 hover:bg-white/15 text-xs font-medium text-white transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Menu</span>
            </button>
          </div>

          {/* Environment Quick Switcher Popover */}
          {envOpen && (
            <div className="bg-[#0E1117]/96 border border-white/15 rounded-lg p-3 w-64 space-y-3 shadow-xl">
              <div>
                <div className="text-[11px] font-medium text-zinc-400 mb-1.5">Weather Condition</div>
                <div className="grid grid-cols-4 gap-1">
                  {(['clear', 'fog', 'rain', 'storm'] as WeatherCondition[]).map((w) => (
                    <button
                      key={w}
                      disabled={!isHostOrSolo}
                      onClick={() => onChangeEnvironment({ ...environment, weather: w })}
                      className={`py-1 rounded text-[11px] font-medium capitalize cursor-pointer disabled:opacity-50 ${
                        environment.weather === w
                          ? 'bg-amber-500 text-zinc-950 font-semibold'
                          : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium text-zinc-400 mb-1.5">Time of Day</div>
                <div className="grid grid-cols-4 gap-1">
                  {(['dawn', 'midday', 'dusk', 'night'] as TimeOfDay[]).map((t) => (
                    <button
                      key={t}
                      disabled={!isHostOrSolo}
                      onClick={() =>
                        onChangeEnvironment({ ...environment, timeOfDay: t, dynamicCycle: false })
                      }
                      className={`py-1 rounded text-[11px] font-medium capitalize cursor-pointer disabled:opacity-50 ${
                        !environment.dynamicCycle && environment.timeOfDay === t
                          ? 'bg-amber-500 text-zinc-950 font-semibold'
                          : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer pt-1 border-t border-white/10">
                <span>Dynamic Day-Night Cycle</span>
                <input
                  type="checkbox"
                  disabled={!isHostOrSolo}
                  checked={environment.dynamicCycle}
                  onChange={(e) =>
                    onChangeEnvironment({ ...environment, dynamicCycle: e.target.checked })
                  }
                  className="accent-amber-400"
                />
              </label>
            </div>
          )}
        </div>

        {/* SVG Track Minimap */}
        {!hudCollapsed && (
          <div className="bg-[#0E1117]/92 border border-white/12 rounded-lg p-1.5 hidden sm:block">
            <svg width="104" height="104" viewBox="0 0 104 104">
              <path
                d={minimap.path}
                fill="none"
                stroke="#334155"
                strokeWidth="5"
                strokeLinejoin="round"
              />
              <path
                d={minimap.path}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle
                cx={playerDot.x}
                cy={playerDot.y}
                r="4.2"
                fill="#f59e0b"
                stroke="#0b0d10"
                strokeWidth="1.5"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Center-Top Countdown or Clutch/Stall/Damage Alert */}
      {room && room.status === 'countdown' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-[#0E1117]/95 border border-amber-500/50 rounded-xl px-8 py-4 text-center">
          <div className="text-xs text-zinc-400">Hold Clutch [Space] &amp; Select Gear 1</div>
          <div className="font-display text-5xl font-bold text-amber-400 font-mono-num mt-1">
            {room.countdownSec}
          </div>
        </div>
      )}

      {(telemetry.grindMessage || telemetry.stalled || !telemetry.ignitionOn) && (
        <div className="pointer-events-auto absolute top-5 left-1/2 -translate-x-1/2 bg-[#171112]/95 border border-rose-500/60 rounded-lg px-4 py-2 flex items-center gap-3 shadow-xl">
          <span className="text-xs font-semibold text-rose-300">
            {telemetry.stalled
              ? 'Engine Stalled — Shift to N or Hold Clutch [Space], then Crank [I]'
              : !telemetry.ignitionOn
                ? 'Ignition Off — Press [I] to Start Engine'
                : telemetry.grindMessage}
          </span>
          {(telemetry.stalled || !telemetry.ignitionOn) && (
            <button
              onClick={onCrankIgnition}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
            >
              <Power className="w-3 h-3" />
              Crank [I]
            </button>
          )}
        </div>
      )}

      {telemetry.gear === 'N' &&
        telemetry.throttle > 0.3 &&
        telemetry.speedKmh < 3 &&
        telemetry.ignitionOn &&
        !telemetry.stalled && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-[#0E1117]/92 border border-amber-400/50 rounded-lg px-4 py-1.5 text-xs font-medium text-amber-300">
            Transmission in Neutral (N) — Hold Clutch [Space] + Press [1] to Engage 1st Gear
          </div>
        )}

      {/* Bottom-Left: Damage Telemetry Schematic + Subtle Key Legend */}
      {!hudCollapsed && (
        <div className="pointer-events-auto absolute bottom-4 left-4 flex flex-col gap-2">
          <div className="bg-[#0E1117]/92 border border-white/12 rounded-xl px-3 py-2.5 flex items-center gap-3 w-fit">
            {/* Compact Top-Down Car Damage SVG */}
            <svg width="46" height="68" viewBox="0 0 46 68" className="shrink-0">
              {/* Car Body Outline */}
              <rect
                x="11"
                y="8"
                width="24"
                height="52"
                rx="6"
                fill="#161b24"
                stroke={dmgColor(telemetry.damage.body)}
                strokeWidth="2"
              />
              {/* Engine Block */}
              <rect
                x="16"
                y="13"
                width="14"
                height="11"
                rx="2"
                fill={dmgColor(telemetry.damage.engine)}
                opacity="0.85"
              />
              {/* Gearbox */}
              <rect
                x="18"
                y="27"
                width="10"
                height="13"
                rx="2"
                fill={dmgColor(telemetry.damage.transmission)}
                opacity="0.85"
              />
              {/* 4 Tires */}
              <rect x="4" y="13" width="5" height="11" rx="1.5" fill={dmgColor(Math.max(telemetry.damage.tires[0], telemetry.damage.suspension[0]))} />
              <rect x="37" y="13" width="5" height="11" rx="1.5" fill={dmgColor(Math.max(telemetry.damage.tires[1], telemetry.damage.suspension[1]))} />
              <rect x="4" y="44" width="5" height="11" rx="1.5" fill={dmgColor(Math.max(telemetry.damage.tires[2], telemetry.damage.suspension[2]))} />
              <rect x="37" y="44" width="5" height="11" rx="1.5" fill={dmgColor(Math.max(telemetry.damage.tires[3], telemetry.damage.suspension[3]))} />
            </svg>

            <div className="text-[11px] space-y-1">
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-400">Chassis</span>
                <span className="font-mono-num font-semibold text-white">{overallHealthPct}%</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-400">Engine</span>
                <span className="font-mono-num" style={{ color: dmgColor(telemetry.damage.engine) }}>
                  {Math.round((1 - telemetry.damage.engine) * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-400">Tires / Susp</span>
                <span
                  className="font-mono-num"
                  style={{
                    color: dmgColor(
                      Math.max(...telemetry.damage.tires, ...telemetry.damage.suspension),
                    ),
                  }}
                >
                  {Math.round(
                    (1 -
                      (telemetry.damage.tires[0] +
                        telemetry.damage.tires[1] +
                        telemetry.damage.tires[2] +
                        telemetry.damage.tires[3]) /
                        4) *
                      100,
                  )}
                  %
                </span>
              </div>
              {maxDmg > 0.05 && (
                <button
                  onClick={onRepairCar}
                  className="mt-1 w-full flex items-center justify-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-[10px] font-semibold text-amber-300 cursor-pointer"
                >
                  <Wrench className="w-3 h-3" />
                  Pit Repair [F]
                </button>
              )}
            </div>
          </div>

          <div className="hidden md:flex bg-[#0E1117]/88 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-zinc-400 items-center gap-2.5">
            <span><strong className="text-zinc-200">W/S</strong> Gas/Brake</span>
            <span aria-hidden="true">·</span>
            <span><strong className="text-zinc-200">A/D</strong> Steer</span>
            <span aria-hidden="true">·</span>
            <span><strong className="text-amber-300">Space</strong> Clutch</span>
            <span aria-hidden="true">·</span>
            <span><strong className="text-zinc-200">1-6/R/N</strong> Shift</span>
            <span aria-hidden="true">·</span>
            <span><strong className="text-zinc-200">L</strong> Lights</span>
            <span aria-hidden="true">·</span>
            <span><strong className="text-zinc-200">H</strong> Zen</span>
          </div>
        </div>
      )}

      {/* Bottom-Right Manual Cockpit Cluster: Pedals + H-Gate Shifter + Tachometer */}
      {!hudCollapsed && (
        <div className="pointer-events-auto absolute bottom-4 right-4 flex items-end gap-2.5">
          {/* Interactive 3-Pedal Box */}
          <div className="bg-[#0E1117]/94 border border-white/12 rounded-xl p-2.5 flex items-end gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                onPointerDown={(e) => {
                  activePedalRef.current = 'clutch';
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handlePedalPointer('clutch', e);
                }}
                onPointerMove={(e) => {
                  if (activePedalRef.current === 'clutch') handlePedalPointer('clutch', e);
                }}
                onPointerUp={() => {
                  activePedalRef.current = null;
                  onPedalOverride('clutch', null);
                }}
                onPointerCancel={() => {
                  activePedalRef.current = null;
                  onPedalOverride('clutch', null);
                }}
                title="Clutch Pedal (Hold Space or Drag)"
                className="relative w-7 h-24 bg-zinc-900 border border-white/15 rounded overflow-hidden cursor-ns-resize touch-none"
              >
                <div
                  className="absolute left-0 right-0 bg-amber-500/20 border-y border-amber-400/40"
                  style={{ bottom: '26%', height: '46%' }}
                />
                <div
                  className={`absolute bottom-0 left-0 right-0 transition-none ${
                    clutchReady ? 'bg-amber-400' : 'bg-amber-600/80'
                  }`}
                  style={{ height: `${Math.round(telemetry.clutch * 100)}%` }}
                />
              </div>
              <span className="font-mono-num text-[10px] font-semibold text-amber-300">
                CLU
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div
                onPointerDown={(e) => {
                  activePedalRef.current = 'brake';
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handlePedalPointer('brake', e);
                }}
                onPointerMove={(e) => {
                  if (activePedalRef.current === 'brake') handlePedalPointer('brake', e);
                }}
                onPointerUp={() => {
                  activePedalRef.current = null;
                  onPedalOverride('brake', null);
                }}
                onPointerCancel={() => {
                  activePedalRef.current = null;
                  onPedalOverride('brake', null);
                }}
                title="Brake Pedal (S / Down)"
                className="relative w-7 h-24 bg-zinc-900 border border-white/15 rounded overflow-hidden cursor-ns-resize touch-none"
              >
                <div
                  className="absolute bottom-0 left-0 right-0 bg-rose-500"
                  style={{ height: `${Math.round(telemetry.brake * 100)}%` }}
                />
              </div>
              <span className="font-mono-num text-[10px] font-semibold text-rose-400">
                BRK
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div
                onPointerDown={(e) => {
                  activePedalRef.current = 'throttle';
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handlePedalPointer('throttle', e);
                }}
                onPointerMove={(e) => {
                  if (activePedalRef.current === 'throttle') handlePedalPointer('throttle', e);
                }}
                onPointerUp={() => {
                  activePedalRef.current = null;
                  onPedalOverride('throttle', null);
                }}
                onPointerCancel={() => {
                  activePedalRef.current = null;
                  onPedalOverride('throttle', null);
                }}
                title="Throttle Pedal (W / Up)"
                className="relative w-7 h-24 bg-zinc-900 border border-white/15 rounded overflow-hidden cursor-ns-resize touch-none"
              >
                <div
                  className="absolute bottom-0 left-0 right-0 bg-emerald-500"
                  style={{ height: `${Math.round(telemetry.throttle * 100)}%` }}
                />
              </div>
              <span className="font-mono-num text-[10px] font-semibold text-emerald-400">
                GAS
              </span>
            </div>
          </div>

          {/* Interactive H-Pattern Manual Shifter Gate */}
          <div className="bg-[#0E1117]/94 border border-white/12 rounded-xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-zinc-400">H-Gate Manual</span>
              <span
                className={`text-[10px] font-mono-num font-semibold ${
                  clutchReady ? 'text-emerald-400' : 'text-zinc-500'
                }`}
              >
                {clutchReady ? 'CLUTCH IN' : 'ENGAGED'}
              </span>
            </div>

            <div className="relative w-[132px] h-[94px] bg-zinc-950 border border-white/10 rounded-lg p-1.5">
              <svg
                viewBox="0 0 120 82"
                className="absolute inset-1.5 w-[120px] h-[82px] pointer-events-none"
              >
                <line x1="15" y1="41" x2="105" y2="41" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
                <line x1="15" y1="14" x2="15" y2="68" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
                <line x1="45" y1="14" x2="45" y2="68" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
                <line x1="75" y1="14" x2="75" y2="68" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
                <line x1="105" y1="14" x2="105" y2="41" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
                <circle
                  cx={15 + knobPos.col * 30}
                  cy={14 + knobPos.row * 27}
                  r="8.5"
                  fill={telemetry.gear === 'R' ? '#e11d48' : '#f59e0b'}
                  stroke="#0b0d10"
                  strokeWidth="2"
                />
              </svg>

              <div className="relative z-10 grid grid-cols-4 grid-rows-3 h-full text-[10px] font-mono-num font-bold">
                {(['1', '3', '5', 'R'] as Gear[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => onRequestShift(g)}
                    className={`flex items-start justify-center pt-0.5 cursor-pointer rounded hover:bg-white/5 ${
                      telemetry.gear === g ? 'text-white' : 'text-zinc-400'
                    }`}
                  >
                    {g}
                  </button>
                ))}
                <button
                  onClick={() => onRequestShift('N')}
                  className={`col-span-4 flex items-center justify-center cursor-pointer rounded hover:bg-white/5 ${
                    telemetry.gear === 'N' ? 'text-amber-300' : 'text-zinc-500'
                  }`}
                >
                  N
                </button>
                {(['2', '4', '6'] as Gear[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => onRequestShift(g)}
                    className={`flex items-end justify-center pb-0.5 cursor-pointer rounded hover:bg-white/5 ${
                      telemetry.gear === g ? 'text-white' : 'text-zinc-400'
                    }`}
                  >
                    {g}
                  </button>
                ))}
                <button
                  onClick={onCrankIgnition}
                  title="Ignition / Crank Starter (I)"
                  className={`flex items-end justify-center pb-0.5 cursor-pointer rounded hover:bg-white/5 ${
                    telemetry.stalled || !telemetry.ignitionOn ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  <Power className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Tachometer & Speedometer Cluster */}
          <div className="bg-[#0E1117]/94 border border-white/12 rounded-xl px-3.5 py-2.5 flex items-center gap-3">
            <div className="relative w-[124px] h-[112px]">
              <svg viewBox="0 0 120 110" className="w-full h-full">
                <circle
                  cx="60"
                  cy="60"
                  r="46"
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth="9"
                  strokeDasharray={`${arcTotal} 360`}
                  strokeLinecap="round"
                  transform="rotate(145 60 60)"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="46"
                  fill="none"
                  stroke="#7f1d1d"
                  strokeWidth="9"
                  strokeDasharray="34 360"
                  strokeDashoffset="-181"
                  transform="rotate(145 60 60)"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="46"
                  fill="none"
                  stroke={rpmRatio > 0.86 ? '#ef4444' : '#f59e0b'}
                  strokeWidth="9"
                  strokeDasharray={`${arcProgress} 360`}
                  strokeLinecap="round"
                  transform="rotate(145 60 60)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
                <div className="font-mono-num text-2xl font-bold text-white leading-none">
                  {telemetry.speedKmh}
                </div>
                <div className="text-[9px] text-zinc-400 mt-0.5">KM/H</div>
                <div className="font-mono-num text-[11px] text-amber-400 mt-1">
                  {telemetry.rpm} RPM
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center min-w-[44px] border-l border-white/10 pl-3">
              <span className="text-[10px] text-zinc-500">GEAR</span>
              <span
                className={`font-display font-mono-num text-4xl font-bold leading-none mt-1 ${
                  telemetry.gear === 'N'
                    ? 'text-zinc-300'
                    : telemetry.gear === 'R'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                }`}
              >
                {telemetry.gear}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
