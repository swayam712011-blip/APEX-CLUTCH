import React, { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Plus, Trash2, Check, X, RotateCcw } from 'lucide-react';
import type { TrackDefinition, TrackNode, TrackTheme } from '../types/sim';
import { PRESET_TRACKS } from '../sim/trackSystem';

interface TrackEditorModalProps {
  initialTrack: TrackDefinition;
  savedTracks: TrackDefinition[];
  onClose: () => void;
  onSaveAndDrive: (track: TrackDefinition) => void;
  onSelectTrack: (track: TrackDefinition) => void;
  onDeleteTrack: (id: string) => void;
}

const CANVAS_SIZE = 500;
const WORLD_RANGE = 320; // +/- 320 meters around origin

function worldToCanvas(x: number, z: number) {
  const cx = CANVAS_SIZE * 0.5 + (x / WORLD_RANGE) * (CANVAS_SIZE * 0.44);
  const cy = CANVAS_SIZE * 0.5 + (z / WORLD_RANGE) * (CANVAS_SIZE * 0.44);
  return { cx, cy };
}

function canvasToWorld(cx: number, cy: number) {
  const x = ((cx - CANVAS_SIZE * 0.5) / (CANVAS_SIZE * 0.44)) * WORLD_RANGE;
  const z = ((cy - CANVAS_SIZE * 0.5) / (CANVAS_SIZE * 0.44)) * WORLD_RANGE;
  return {
    x: Math.round(THREE.MathUtils.clamp(x, -300, 300)),
    z: Math.round(THREE.MathUtils.clamp(z, -300, 300)),
  };
}

export const TrackEditorModal: React.FC<TrackEditorModalProps> = ({
  initialTrack,
  savedTracks,
  onClose,
  onSaveAndDrive,
  onSelectTrack,
  onDeleteTrack,
}) => {
  const [name, setName] = useState(
    initialTrack.isCustom ? initialTrack.name : `${initialTrack.name} Custom`,
  );
  const [width, setWidth] = useState(initialTrack.width);
  const [totalLaps, setTotalLaps] = useState(initialTrack.totalLaps);
  const [theme, setTheme] = useState<TrackTheme>(initialTrack.theme);
  const [nodes, setNodes] = useState<TrackNode[]>(() =>
    initialTrack.nodes.map((n) => ({ ...n })),
  );
  const [selectedIdx, setSelectedIdx] = useState(0);
  const draggingIdxRef = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const splinePath = useMemo(() => {
    if (nodes.length < 3) return '';
    const curve = new THREE.CatmullRomCurve3(
      nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z)),
      true,
      'centripetal',
      0.5,
    );
    const pts = curve.getPoints(160);
    return (
      pts
        .map((p, i) => {
          const { cx, cy } = worldToCanvas(p.x, p.z);
          return `${i === 0 ? 'M' : 'L'}${cx.toFixed(1)},${cy.toFixed(1)}`;
        })
        .join(' ') + ' Z'
    );
  }, [nodes]);

  const trackLengthM = useMemo(() => {
    if (nodes.length < 3) return 0;
    const curve = new THREE.CatmullRomCurve3(
      nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z)),
      true,
      'centripetal',
      0.5,
    );
    return Math.round(curve.getLength());
  }, [nodes]);

  const selectedNode = nodes[selectedIdx] ?? nodes[0];

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIdxRef.current === null || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE;
    const cy = ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE;
    const { x, z } = canvasToWorld(cx, cy);
    const idx = draggingIdxRef.current;
    setNodes((prev) => prev.map((n, i) => (i === idx ? { ...n, x, z } : n)));
  };

  const handleInsertAfter = (idx: number) => {
    if (nodes.length >= 24) return;
    const a = nodes[idx];
    const b = nodes[(idx + 1) % nodes.length];
    const mid: TrackNode = {
      x: Math.round((a.x + b.x) * 0.5),
      y: Math.round(((a.y + b.y) * 0.5) * 10) / 10,
      z: Math.round((a.z + b.z) * 0.5),
      bank: Math.round(((a.bank ?? 0) + (b.bank ?? 0)) * 0.5),
    };
    const next = [...nodes];
    next.splice(idx + 1, 0, mid);
    setNodes(next);
    setSelectedIdx(idx + 1);
  };

  const handleDeleteNode = (idx: number) => {
    if (nodes.length <= 6) return;
    const next = nodes.filter((_, i) => i !== idx);
    setNodes(next);
    setSelectedIdx(Math.max(0, Math.min(idx, next.length - 1)));
  };

  const handleResetOval = () => {
    setNodes([
      { x: 0, y: 0, z: 0, bank: 0 },
      { x: 0, y: 0, z: -130, bank: 0 },
      { x: 95, y: 3, z: -195, bank: 6 },
      { x: 195, y: 4, z: -115, bank: 6 },
      { x: 175, y: 1, z: 40, bank: 3 },
      { x: 110, y: 0, z: 145, bank: 5 },
      { x: 10, y: 0, z: 120, bank: 0 },
    ]);
    setSelectedIdx(0);
  };

  const handleSave = () => {
    const cleanName = name.trim() || 'Custom Circuit';
    const track: TrackDefinition = {
      id: initialTrack.isCustom ? initialTrack.id : `custom-${Date.now()}`,
      name: cleanName,
      width,
      theme,
      nodes,
      totalLaps,
      isCustom: true,
    };
    onSaveAndDrive(track);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090C]/92 p-4">
      <div className="w-full max-w-5xl bg-[#11151C] border border-white/15 rounded-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Custom Track Builder</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Drag corner nodes to sculpt the spline, adjust elevation &amp; banking, then drive or host in multiplayer.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] flex-1 overflow-y-auto">
          {/* Left: Interactive 2D CAD Spline Canvas */}
          <div className="p-5 flex flex-col items-center justify-center bg-[#0B0E14] border-b lg:border-b-0 lg:border-r border-white/10">
            <div className="w-full flex items-center justify-between text-xs text-zinc-400 mb-2">
              <span>Length: <strong className="font-mono-num text-zinc-200">{trackLengthM} m</strong> · Nodes: <strong className="font-mono-num text-zinc-200">{nodes.length}</strong></span>
              <button
                onClick={handleResetOval}
                className="flex items-center gap-1 text-zinc-400 hover:text-amber-300 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Layout
              </button>
            </div>

            <svg
              ref={svgRef}
              viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={() => {
                draggingIdxRef.current = null;
              }}
              onPointerLeave={() => {
                draggingIdxRef.current = null;
              }}
              className="w-full max-w-[460px] aspect-square bg-[#080A0F] border border-white/10 rounded-lg touch-none select-none"
            >
              {/* Grid lines */}
              {[1, 2, 3, 4, 5, 6, 7].map((i) => {
                const pos = (i * CANVAS_SIZE) / 8;
                return (
                  <g key={i}>
                    <line x1={pos} y1={0} x2={pos} y2={CANVAS_SIZE} stroke="#161C28" strokeWidth="1" />
                    <line x1={0} y1={pos} x2={CANVAS_SIZE} y2={pos} stroke="#161C28" strokeWidth="1" />
                  </g>
                );
              })}

              {/* Track Ribbon Preview */}
              <path
                d={splinePath}
                fill="none"
                stroke="#334155"
                strokeWidth={Math.max(10, width * 0.9)}
                strokeLinejoin="round"
              />
              <path
                d={splinePath}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeDasharray="6 6"
              />

              {/* Midpoint Insert Handles */}
              {nodes.map((n, idx) => {
                const next = nodes[(idx + 1) % nodes.length];
                const mid = worldToCanvas((n.x + next.x) * 0.5, (n.z + next.z) * 0.5);
                return (
                  <g
                    key={`mid-${idx}`}
                    onClick={() => handleInsertAfter(idx)}
                    className="cursor-pointer opacity-60 hover:opacity-100"
                  >
                    <circle cx={mid.cx} cy={mid.cy} r="6.5" fill="#1e293b" stroke="#64748b" strokeWidth="1.5" />
                    <text
                      x={mid.cx}
                      y={mid.cy + 3}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#e2e8f0"
                      fontWeight="bold"
                    >
                      +
                    </text>
                  </g>
                );
              })}

              {/* Draggable Control Nodes */}
              {nodes.map((n, idx) => {
                const { cx, cy } = worldToCanvas(n.x, n.z);
                const isSel = idx === selectedIdx;
                const isStart = idx === 0;
                return (
                  <g
                    key={idx}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      draggingIdxRef.current = idx;
                      setSelectedIdx(idx);
                    }}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSel ? 10 : 8}
                      fill={isStart ? '#10b981' : isSel ? '#f59e0b' : '#cbd5e1'}
                      stroke="#0b0d10"
                      strokeWidth="2.5"
                    />
                    <text
                      x={cx}
                      y={cy - 13}
                      textAnchor="middle"
                      fontSize="10"
                      fill={isStart ? '#34d399' : '#94a3b8'}
                    >
                      {isStart ? 'Start' : idx + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Right: Track Parameters & Saved Library */}
          <div className="p-5 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Track Name</label>
              <input
                type="text"
                value={name}
                maxLength={28}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0E14] border border-white/15 rounded-lg text-sm text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Width: <span className="font-mono-num text-white">{width}m</span>
                </label>
                <input
                  type="range"
                  min={11}
                  max={22}
                  step={0.5}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Laps: <span className="font-mono-num text-white">{totalLaps}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={totalLaps}
                  onChange={(e) => setTotalLaps(Number(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Environment Theme</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'gp-asphalt', label: 'GP Day' },
                    { id: 'alpine-dusk', label: 'Alpine Dusk' },
                    { id: 'desert-canyon', label: 'Canyon' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setTheme(opt.id)}
                    className={`px-2 py-1.5 rounded text-xs font-medium border cursor-pointer transition-colors ${
                      theme === opt.id
                        ? 'bg-amber-500 text-zinc-950 border-amber-400'
                        : 'bg-[#0B0E14] text-zinc-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Node Controls */}
            {selectedNode && (
              <div className="p-3 bg-[#0B0E14] border border-white/10 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    Node {selectedIdx + 1} {selectedIdx === 0 ? '(Start Line)' : ''}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleInsertAfter(selectedIdx)}
                      disabled={nodes.length >= 24}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-[11px] text-zinc-200 disabled:opacity-40 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                    <button
                      onClick={() => handleDeleteNode(selectedIdx)}
                      disabled={nodes.length <= 6}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-[11px] text-rose-300 disabled:opacity-40 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Del
                    </button>
                  </div>
                </div>

                <div>
                  <label className="flex justify-between text-[11px] text-zinc-400 mb-0.5">
                    <span>Elevation</span>
                    <span className="font-mono-num text-zinc-200">{selectedNode.y.toFixed(1)} m</span>
                  </label>
                  <input
                    type="range"
                    min={-4}
                    max={16}
                    step={0.5}
                    value={selectedNode.y}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setNodes((prev) =>
                        prev.map((n, i) => (i === selectedIdx ? { ...n, y: val } : n)),
                      );
                    }}
                    className="w-full accent-amber-400"
                  />
                </div>

                <div>
                  <label className="flex justify-between text-[11px] text-zinc-400 mb-0.5">
                    <span>Corner Banking</span>
                    <span className="font-mono-num text-zinc-200">{selectedNode.bank ?? 0}°</span>
                  </label>
                  <input
                    type="range"
                    min={-14}
                    max={14}
                    step={1}
                    value={selectedNode.bank ?? 0}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setNodes((prev) =>
                        prev.map((n, i) => (i === selectedIdx ? { ...n, bank: val } : n)),
                      );
                    }}
                    className="w-full accent-amber-400"
                  />
                </div>
              </div>
            )}

            {/* Quick Load Presets & Saved Tracks */}
            <div className="flex-1 overflow-y-auto max-h-36 space-y-1.5 border-t border-white/10 pt-3">
              <div className="text-[11px] font-medium text-zinc-400">Load Existing Circuit</div>
              {[...savedTracks, ...PRESET_TRACKS].map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-2.5 py-1.5 bg-[#0B0E14] border border-white/10 rounded text-xs"
                >
                  <button
                    onClick={() => {
                      setName(t.isCustom ? t.name : `${t.name} Custom`);
                      setWidth(t.width);
                      setTotalLaps(t.totalLaps);
                      setTheme(t.theme);
                      setNodes(t.nodes.map((n) => ({ ...n })));
                      setSelectedIdx(0);
                      onSelectTrack(t);
                    }}
                    className="text-left text-zinc-200 hover:text-amber-300 truncate flex-1 cursor-pointer"
                  >
                    {t.name}
                  </button>
                  {t.isCustom && (
                    <button
                      onClick={() => onDeleteTrack(t.id)}
                      className="text-zinc-500 hover:text-rose-400 ml-2 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              Save &amp; Drive Track
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
