// THUNDERSTRUCK — Production Progress Tracker
// Persists completion state to localStorage so you don't lose progress on refresh
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { CLIPS } from "@/lib/data";
import { CheckCircle, Circle, RotateCcw } from "lucide-react";

interface ClipProgress {
  imageGenerated: boolean;
  videoGenerated: boolean;
}

const STORAGE_KEY = "tigerclaw-production-progress";

function loadProgress(): Record<string, ClipProgress> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  const initial: Record<string, ClipProgress> = {};
  CLIPS.forEach((clip) => {
    initial[clip.number] = { imageGenerated: false, videoGenerated: false };
  });
  return initial;
}

function saveProgress(progress: Record<string, ClipProgress>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {}
}

export default function ProgressTracker() {
  const { ref, isVisible } = useScrollReveal(0.1);
  const [progress, setProgress] = useState<Record<string, ClipProgress>>(loadProgress);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  function toggle(clipNumber: string, field: "imageGenerated" | "videoGenerated") {
    setProgress((prev) => ({
      ...prev,
      [clipNumber]: {
        ...prev[clipNumber],
        [field]: !prev[clipNumber]?.[field],
      },
    }));
  }

  function resetAll() {
    const fresh: Record<string, ClipProgress> = {};
    CLIPS.forEach((clip) => {
      fresh[clip.number] = { imageGenerated: false, videoGenerated: false };
    });
    setProgress(fresh);
  }

  // Count completed items (each clip has 2 tasks: image + video)
  // Clip 03 has 2 video parts but we track it as one clip
  const totalTasks = CLIPS.length * 2;
  const completedTasks = Object.values(progress).reduce((acc, p) => {
    return acc + (p.imageGenerated ? 1 : 0) + (p.videoGenerated ? 1 : 0);
  }, 0);
  const percentComplete = Math.round((completedTasks / totalTasks) * 100);
  const allDone = completedTasks === totalTasks;

  return (
    <section ref={ref} className="py-12 md:py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2
                className="text-2xl md:text-3xl uppercase tracking-wide mb-1"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 700,
                  color: "oklch(0.92 0.005 250)",
                  lineHeight: 1.1,
                }}
              >
                Production{" "}
                <span
                  style={{
                    color: allDone
                      ? "oklch(0.65 0.2 145)"
                      : "oklch(0.75 0.18 55)",
                  }}
                >
                  {allDone ? "complete." : "tracker."}
                </span>
              </h2>
              <p
                className="text-sm"
                style={{
                  fontFamily: "var(--font-body)",
                  color: "oklch(0.50 0.005 250)",
                }}
              >
                Check off each step as you go. Progress saves automatically.
              </p>
            </div>
            <button
              onClick={resetAll}
              className="flex items-center gap-1.5 px-3 py-1.5 transition-all duration-200"
              style={{
                background: "oklch(0.15 0.01 250)",
                border: "1px solid oklch(0.25 0.015 250)",
                color: "oklch(0.50 0.005 250)",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                fontSize: "11px",
                letterSpacing: "0.1em",
              }}
            >
              <RotateCcw size={12} />
              RESET
            </button>
          </div>

          {/* Progress bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-xs tracking-[0.2em] uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  color: allDone
                    ? "oklch(0.65 0.2 145)"
                    : "oklch(0.55 0.14 55)",
                  fontWeight: 600,
                }}
              >
                {completedTasks} of {totalTasks} tasks done
              </span>
              <span
                className="text-2xl"
                style={{
                  fontFamily: "var(--font-display)",
                  color: allDone
                    ? "oklch(0.65 0.2 145)"
                    : "oklch(0.75 0.18 55)",
                }}
              >
                {percentComplete}%
              </span>
            </div>
            <div
              className="w-full h-2 overflow-hidden"
              style={{ background: "oklch(0.15 0.01 250)" }}
            >
              <motion.div
                className="h-full"
                initial={{ width: 0 }}
                animate={{ width: `${percentComplete}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                style={{
                  background: allDone
                    ? "oklch(0.65 0.2 145)"
                    : "oklch(0.75 0.18 55)",
                }}
              />
            </div>
          </div>

          {/* Clip checklist grid */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-px" style={{ background: "oklch(0.22 0.015 250)" }}>
            {CLIPS.map((clip) => {
              const cp = progress[clip.number] || {
                imageGenerated: false,
                videoGenerated: false,
              };
              const clipDone = cp.imageGenerated && cp.videoGenerated;

              return (
                <div
                  key={clip.number}
                  className="p-4 transition-colors duration-300"
                  style={{
                    background: clipDone
                      ? "oklch(0.12 0.02 145)"
                      : "oklch(0.10 0.01 250)",
                  }}
                >
                  {/* Clip number + title */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="text-xl"
                      style={{
                        fontFamily: "var(--font-display)",
                        color: clipDone
                          ? "oklch(0.65 0.2 145)"
                          : "oklch(0.75 0.18 55)",
                      }}
                    >
                      {clip.number}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-wider"
                      style={{
                        fontFamily: "var(--font-heading)",
                        color: clipDone
                          ? "oklch(0.65 0.2 145)"
                          : "oklch(0.70 0.005 250)",
                        fontWeight: 600,
                      }}
                    >
                      {clip.title}
                    </span>
                  </div>

                  {/* Image checkbox */}
                  <button
                    onClick={() => toggle(clip.number, "imageGenerated")}
                    className="flex items-center gap-2 w-full mb-2 group"
                  >
                    {cp.imageGenerated ? (
                      <CheckCircle
                        size={16}
                        style={{ color: "oklch(0.65 0.2 145)" }}
                      />
                    ) : (
                      <Circle
                        size={16}
                        className="group-hover:opacity-80"
                        style={{ color: "oklch(0.35 0.005 250)" }}
                      />
                    )}
                    <span
                      className="text-xs"
                      style={{
                        fontFamily: "var(--font-body)",
                        color: cp.imageGenerated
                          ? "oklch(0.65 0.2 145)"
                          : "oklch(0.50 0.005 250)",
                        fontWeight: cp.imageGenerated ? 600 : 400,
                        textDecoration: cp.imageGenerated
                          ? "line-through"
                          : "none",
                      }}
                    >
                      Image
                    </span>
                  </button>

                  {/* Video checkbox */}
                  <button
                    onClick={() => toggle(clip.number, "videoGenerated")}
                    className="flex items-center gap-2 w-full group"
                  >
                    {cp.videoGenerated ? (
                      <CheckCircle
                        size={16}
                        style={{ color: "oklch(0.65 0.2 145)" }}
                      />
                    ) : (
                      <Circle
                        size={16}
                        className="group-hover:opacity-80"
                        style={{ color: "oklch(0.35 0.005 250)" }}
                      />
                    )}
                    <span
                      className="text-xs"
                      style={{
                        fontFamily: "var(--font-body)",
                        color: cp.videoGenerated
                          ? "oklch(0.65 0.2 145)"
                          : "oklch(0.50 0.005 250)",
                        fontWeight: cp.videoGenerated ? 600 : 400,
                        textDecoration: cp.videoGenerated
                          ? "line-through"
                          : "none",
                      }}
                    >
                      Video
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Completion message */}
          {allDone && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mt-4 p-4 text-center"
              style={{
                background: "oklch(0.12 0.02 145)",
                border: "1px solid oklch(0.35 0.15 145)",
              }}
            >
              <p
                className="text-sm uppercase tracking-[0.2em]"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 700,
                  color: "oklch(0.65 0.2 145)",
                }}
              >
                All clips generated. Scroll down to assemble the final cut.
              </p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
