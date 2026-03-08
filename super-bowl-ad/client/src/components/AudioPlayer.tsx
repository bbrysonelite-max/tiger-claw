// THUNDERSTRUCK — Sticky audio player with hard rock reference track
import { useState, useRef, useEffect } from "react";
import { AUDIO_URL } from "@/lib/data";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";

export default function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      setProgress(audio.currentTime);
    };
    const onMeta = () => {
      setDuration(audio.duration);
    };
    const onEnd = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(!isMuted);
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    audio.currentTime = pct * duration;
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 px-4 md:px-6 py-3"
      style={{
        background: "oklch(0.06 0.01 250 / 0.95)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid oklch(0.22 0.015 250)",
      }}
    >
      <audio ref={audioRef} src={AUDIO_URL} preload="metadata" />

      {/* Play/Pause */}
      <button
        onClick={togglePlay}
        className="w-9 h-9 flex items-center justify-center flex-shrink-0 transition-colors"
        style={{
          background: isPlaying ? "oklch(0.75 0.18 55)" : "oklch(0.22 0.015 250)",
          color: isPlaying ? "oklch(0.08 0.01 250)" : "oklch(0.75 0.18 55)",
        }}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      {/* Track info */}
      <div className="flex-shrink-0 hidden sm:block">
        <p
          className="text-[10px] tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-body)", color: "oklch(0.75 0.18 55)", fontWeight: 600 }}
        >
          Reference Track
        </p>
        <p
          className="text-[10px]"
          style={{ fontFamily: "var(--font-body)", color: "oklch(0.45 0.005 250)" }}
        >
          Hard Rock (AC/DC Style) — Royalty Free
        </p>
      </div>

      {/* Progress bar */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span
          className="text-[10px] tabular-nums flex-shrink-0"
          style={{ fontFamily: "var(--font-body)", color: "oklch(0.45 0.005 250)" }}
        >
          {formatTime(progress)}
        </span>
        <div
          className="flex-1 h-1 cursor-pointer relative"
          style={{ background: "oklch(0.22 0.015 250)" }}
          onClick={handleSeek}
        >
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: duration ? `${(progress / duration) * 100}%` : "0%",
              background: "linear-gradient(90deg, oklch(0.75 0.18 55), oklch(0.88 0.16 90))",
              transition: "width 200ms linear",
            }}
          />
        </div>
        <span
          className="text-[10px] tabular-nums flex-shrink-0"
          style={{ fontFamily: "var(--font-body)", color: "oklch(0.45 0.005 250)" }}
        >
          {formatTime(duration)}
        </span>
      </div>

      {/* Mute */}
      <button
        onClick={toggleMute}
        className="w-8 h-8 flex items-center justify-center flex-shrink-0"
        style={{ color: isMuted ? "oklch(0.35 0.005 250)" : "oklch(0.55 0.005 250)" }}
      >
        {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  );
}
