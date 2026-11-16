import React, { useEffect, useState } from 'react';
import { Users, RefreshCw, Play, LogOut, Copy, Check, X } from 'lucide-react';
import type {
  CarSpecId,
  EnvironmentConfig,
  RoomState,
  RoomSummary,
  TimeOfDay,
  TrackDefinition,
  WeatherCondition,
} from '../types/sim';
import { CAR_SPECS } from '../sim/carPhysics';
import { PRESET_TRACKS } from '../sim/trackSystem';

interface MultiplayerModalProps {
  wsConnected: boolean;
  room: RoomState | null;
  localPlayerId: string | null;
  errorMsg: string | null;
  playerName: string;
  carColor: string;
  carSpec: CarSpecId;
  activeTrack: TrackDefinition;
  savedCustomTracks: TrackDefinition[];
  onChangeProfile: (name: string, color: string, spec: CarSpecId) => void;
  onCreateRoom: (roomName: string) => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  onToggleReady: () => void;
  onSelectRoomTrack: (track: TrackDefinition) => void;
  onSelectRoomEnvironment: (env: EnvironmentConfig) => void;
  onStartRace: () => void;
  onClose: () => void;
}

const LIVERY_COLORS = [
  '#e11d48',
  '#f59e0b',
  '#0284c7',
  '#10b981',
  '#8b5cf6',
  '#f8fafc',
];

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  wsConnected,
  room,
  localPlayerId,
  errorMsg,
  playerName,
  carColor,
  carSpec,
  activeTrack,
  savedCustomTracks,
  onChangeProfile,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onToggleReady,
  onSelectRoomTrack,
  onSelectRoomEnvironment,
  onStartRace,
  onClose,
}) => {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState(`${playerName || 'Driver'}'s Grid`);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const fetchRooms = async () => {
    setLoadingRooms(true);
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = (await res.json()) as { rooms: RoomSummary[] };
        setRooms(data.rooms);
      }
    } catch {
      // Ignore network hiccup
    } finally {
      setLoadingRooms(false);
    }
  };

  useEffect(() => {
    if (!room) {
      void fetchRooms();
    }
  }, [room]);

  const isHost = Boolean(room && localPlayerId && room.hostId === localPlayerId);
  const me = room?.players.find((p) => p.id === localPlayerId);

  const handleCopyCode = () => {
    if (!room) return;
    void navigator.clipboard?.writeText(room.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090C]/92 p-4">
      <div className="w-full max-w-3xl bg-[#11151C] border border-white/15 rounded-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">Multiplayer Grid</h2>
              <p className="text-xs text-zinc-400">
                {wsConnected ? 'WebSocket server connected' : 'Connecting to race server...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-6 mt-4 px-3.5 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Driver & Car Setup */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-[#0B0E14] border border-white/10 rounded-lg">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Driver Name</label>
              <input
                type="text"
                maxLength={18}
                value={playerName}
                onChange={(e) => onChangeProfile(e.target.value, carColor, carSpec)}
                className="w-full px-3 py-1.5 bg-[#11151C] border border-white/15 rounded text-sm text-white focus:outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Manual Car</label>
              <select
                value={carSpec}
                onChange={(e) => onChangeProfile(playerName, carColor, e.target.value as CarSpecId)}
                className="w-full px-3 py-1.5 bg-[#11151C] border border-white/15 rounded text-sm text-white focus:outline-none focus:border-amber-400"
              >
                {Object.values(CAR_SPECS).map((spec) => (
                  <option key={spec.id} value={spec.id}>
                    {spec.name} ({spec.engineLabel})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Livery Color</label>
              <div className="flex items-center gap-2 pt-1">
                {LIVERY_COLORS.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => onChangeProfile(playerName, hex, carSpec)}
                    style={{ backgroundColor: hex }}
                    className={`w-6 h-6 rounded-md cursor-pointer border-2 transition-transform ${
                      carColor === hex ? 'border-white scale-110' : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {!room ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Create or Join by Code */}
              <div className="space-y-4">
                <div className="p-4 bg-[#0B0E14] border border-white/10 rounded-lg space-y-3">
                  <h3 className="text-sm font-semibold text-white">Create Race Room</h3>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Room Title</label>
                    <input
                      type="text"
                      maxLength={28}
                      value={roomNameInput}
                      onChange={(e) => setRoomNameInput(e.target.value)}
                      className="w-full px-3 py-1.5 bg-[#11151C] border border-white/15 rounded text-sm text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="text-xs text-zinc-400">
                    Active Track: <strong className="text-zinc-200">{activeTrack.name}</strong>
                  </div>
                  <button
                    disabled={!wsConnected}
                    onClick={() => onCreateRoom(roomNameInput)}
                    className="w-full py-2 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-semibold text-sm cursor-pointer transition-colors"
                  >
                    Create Room
                  </button>
                </div>

                <div className="p-4 bg-[#0B0E14] border border-white/10 rounded-lg space-y-3">
                  <h3 className="text-sm font-semibold text-white">Join by Room Code</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="ABCD"
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      className="flex-1 px-3 py-1.5 bg-[#11151C] border border-white/15 rounded text-sm font-mono-num uppercase text-white focus:outline-none focus:border-amber-400"
                    />
                    <button
                      disabled={!wsConnected || joinCodeInput.trim().length < 4}
                      onClick={() => onJoinRoom(joinCodeInput)}
                      className="px-4 py-1.5 rounded-lg bg-white/12 hover:bg-white/20 disabled:opacity-40 text-sm font-medium text-white cursor-pointer"
                    >
                      Join
                    </button>
                  </div>
                </div>
              </div>

              {/* Open Rooms List */}
              <div className="p-4 bg-[#0B0E14] border border-white/10 rounded-lg flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white">Active Rooms</h3>
                  <button
                    onClick={() => void fetchRooms()}
                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingRooms ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {rooms.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 py-10 text-center">
                    No active rooms right now. Create one and share the 4-character code with friends or open a second tab.
                  </div>
                ) : (
                  <div className="space-y-2 overflow-y-auto max-h-60">
                    {rooms.map((r) => (
                      <div
                        key={r.code}
                        className="flex items-center justify-between p-2.5 bg-[#11151C] border border-white/10 rounded-lg"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white truncate">{r.name}</div>
                          <div className="text-[11px] text-zinc-400">
                            {r.trackName} · <span className="font-mono-num">{r.playerCount}/8</span> · {r.status}
                          </div>
                        </div>
                        <button
                          onClick={() => onJoinRoom(r.code)}
                          className="ml-3 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs cursor-pointer shrink-0"
                        >
                          Join {r.code}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Active Room Lobby */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#0B0E14] border border-white/10 rounded-lg">
                <div>
                  <div className="text-xs text-zinc-400">Room Code</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono-num text-2xl font-bold text-amber-400 tracking-widest">
                      {room.code}
                    </span>
                    <button
                      onClick={handleCopyCode}
                      className="p-1.5 rounded bg-white/8 hover:bg-white/15 text-zinc-300 cursor-pointer"
                      title="Copy Room Code"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-zinc-400">Circuit</div>
                  {isHost && room.status === 'lobby' ? (
                    <select
                      value={room.track.id}
                      onChange={(e) => {
                        const found = [...PRESET_TRACKS, ...savedCustomTracks].find(
                          (t) => t.id === e.target.value,
                        );
                        if (found) onSelectRoomTrack(found);
                      }}
                      className="mt-1 px-2.5 py-1 bg-[#11151C] border border-white/15 rounded text-xs text-white"
                    >
                      {[...PRESET_TRACKS, ...savedCustomTracks].map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.totalLaps} Laps)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm font-semibold text-white mt-0.5">
                      {room.track.name} · {room.track.totalLaps} Laps
                    </div>
                  )}
                </div>
              </div>

              {/* Room Weather & Time of Day */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#0B0E14] border border-white/10 rounded-lg text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Weather:</span>
                  {isHost ? (
                    <select
                      value={room.environment.weather}
                      onChange={(e) =>
                        onSelectRoomEnvironment({
                          ...room.environment,
                          weather: e.target.value as WeatherCondition,
                        })
                      }
                      className="px-2 py-1 bg-[#11151C] border border-white/15 rounded text-white capitalize"
                    >
                      <option value="clear">Clear</option>
                      <option value="fog">Fog</option>
                      <option value="rain">Rain</option>
                      <option value="storm">Storm</option>
                    </select>
                  ) : (
                    <span className="text-white font-medium capitalize">{room.environment.weather}</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Time:</span>
                  {isHost ? (
                    <select
                      value={room.environment.timeOfDay}
                      onChange={(e) =>
                        onSelectRoomEnvironment({
                          ...room.environment,
                          timeOfDay: e.target.value as TimeOfDay,
                        })
                      }
                      className="px-2 py-1 bg-[#11151C] border border-white/15 rounded text-white capitalize"
                    >
                      <option value="dawn">Dawn</option>
                      <option value="midday">Midday</option>
                      <option value="dusk">Dusk</option>
                      <option value="night">Night</option>
                    </select>
                  ) : (
                    <span className="text-white font-medium capitalize">{room.environment.timeOfDay}</span>
                  )}
                </div>
              </div>

              {/* Driver Grid */}
              <div className="bg-[#0B0E14] border border-white/10 rounded-lg divide-y divide-white/8">
                {room.players.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-xs shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-medium text-white">{p.name}</span>
                      {p.id === room.hostId && (
                        <span className="text-[11px] text-amber-400 font-medium">Host</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-400">
                      <span>{CAR_SPECS[p.carSpec]?.name}</span>
                      <span className={p.ready ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}>
                        {p.ready ? 'Ready' : 'In Pits'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  onClick={onLeaveRoom}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-medium text-zinc-200 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Leave Room
                </button>

                <div className="flex items-center gap-2.5">
                  <button
                    onClick={onToggleReady}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${
                      me?.ready
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-white/12 hover:bg-white/20 text-white'
                    }`}
                  >
                    {me?.ready ? 'Ready' : 'Mark Ready'}
                  </button>

                  {isHost && room.status === 'lobby' && (
                    <button
                      onClick={onStartRace}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm cursor-pointer transition-colors"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Start Race
                    </button>
                  )}

                  {room.status === 'racing' && (
                    <button
                      onClick={onClose}
                      className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm cursor-pointer"
                    >
                      Return to Cockpit
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
