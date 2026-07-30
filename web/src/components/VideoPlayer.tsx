import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Loader2,
  AlertCircle,
  SkipBack,
  SkipForward,
} from "lucide-react";

interface VideoPlayerProps {
  src: string;
  sessionId: string;
  onEnded: () => void;
  startPosition?: number; // seconds
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({
  src,
  sessionId,
  onEnded,
  startPosition,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hideControlsTimer = useRef<number | undefined>(undefined);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showControls, setShowControls] = useState(true);
  const [seeking, setSeeking] = useState(false);

  // Seek to start position on load
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !startPosition) return;
    const onLoadedMeta = () => {
      v.currentTime = startPosition;
    };
    v.addEventListener("loadedmetadata", onLoadedMeta, { once: true });
    return () => v.removeEventListener("loadedmetadata", onLoadedMeta);
  }, [startPosition]);

  // Session position reporting (every 10s while playing)
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      fetch(`/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("utahmeta_token")}`,
        },
        body: JSON.stringify({
          state: "playing",
          positionSeconds: v.currentTime,
        }),
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [playing, sessionId]);

  // Report pause on unmount
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v) return;
      fetch(`/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("utahmeta_token")}`,
        },
        body: JSON.stringify({
          state: "paused",
          positionSeconds: v.currentTime,
        }),
      }).catch(() => {});
    };
  }, [sessionId]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch((e) => setError(`Playback failed: ${e.message}`));
    } else {
      v.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
    setCurrentTime(v.currentTime);
  }, [duration]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const vol = parseFloat(e.target.value);
    v.volume = vol;
    v.muted = vol === 0;
    setVolume(vol);
    setMuted(vol === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const skip = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds));
    setCurrentTime(v.currentTime);
  }, []);

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, 3000);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          skip(-10);
          break;
        case "ArrowRight":
          skip(10);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
      }
      showControlsTemporarily();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, skip, toggleMute, toggleFullscreen, showControlsTemporarily]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-lg overflow-hidden group"
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => playing && setShowControls(false)}
      style={{ cursor: showControls ? "default" : "none" }}
    >
      <video
        ref={videoRef}
        className="w-full"
        src={src}
        onClick={togglePlay}
        onPlay={() => { setPlaying(true); setLoading(false); setError(""); }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => !seeking && setCurrentTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length > 0) {
            setBuffered(v.buffered.end(v.buffered.length - 1));
          }
        }}
        onEnded={() => { setPlaying(false); onEnded(); }}
        onError={(e) => {
          setError("Failed to load video stream. The server may be transcoding or the file is unavailable.");
          setLoading(false);
        }}
      />

      {/* Loading spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-12 h-12 text-white/80 animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
          <AlertCircle className="w-12 h-12 text-red-500 mb-3" />
          <p className="text-white text-sm text-center max-w-md px-4">{error}</p>
          <button
            onClick={() => {
              setError("");
              setLoading(true);
              videoRef.current?.load();
              videoRef.current?.play().catch(() => {});
            }}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Center play button when paused */}
      {!playing && !loading && !error && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="bg-black/50 rounded-full p-5 hover:bg-black/70 transition">
            <Play className="w-12 h-12 text-white" fill="white" />
          </div>
        </button>
      )}

      {/* Custom controls bar */}
      {showControls && !error && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-8 transition-opacity">
          {/* Progress bar */}
          <div
            ref={progressRef}
            onClick={handleSeek}
            onMouseDown={() => setSeeking(true)}
            onMouseUp={() => setSeeking(false)}
            className="relative h-1.5 bg-white/20 rounded-full cursor-pointer mb-3 group/progress"
          >
            {/* Buffered */}
            <div
              className="absolute h-full bg-white/30 rounded-full"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Progress */}
            <div
              className="absolute h-full bg-blue-500 rounded-full"
              style={{ width: `${progressPct}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 bg-blue-500 rounded-full opacity-0 group-hover/progress:opacity-100 transition" />
            </div>
          </div>

          {/* Buttons row */}
          <div className="flex items-center gap-3 text-white">
            <button onClick={togglePlay} className="hover:text-blue-400 transition" title="Play/Pause (Space)">
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>

            <button onClick={() => skip(-10)} className="hover:text-blue-400 transition" title="Back 10s (←)">
              <SkipBack className="w-5 h-5" />
            </button>
            <button onClick={() => skip(10)} className="hover:text-blue-400 transition" title="Forward 10s (→)">
              <SkipForward className="w-5 h-5" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2 group/vol">
              <button onClick={toggleMute} className="hover:text-blue-400 transition" title="Mute (M)">
                {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-0 group-hover/vol:w-20 transition-all duration-200 accent-blue-500 cursor-pointer"
              />
            </div>

            {/* Time */}
            <span className="text-sm tabular-nums text-gray-300">
              {formatTime(currentTime)} <span className="text-gray-500">/ {formatTime(duration)}</span>
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Fullscreen */}
            <button onClick={toggleFullscreen} className="hover:text-blue-400 transition" title="Fullscreen (F)">
              {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
