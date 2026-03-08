// THUNDERSTRUCK Clip Production Card — CORRECTED for Dreamina
// Two copy buttons: IMAGE PROMPT and VIDEO PROMPT
import { useState } from "react";
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import type { Clip } from "@/lib/data";
import { Copy, Check, ChevronDown, ChevronUp, Image as ImageIcon, Video } from "lucide-react";

export default function ClipSection({ clip }: { clip: Clip }) {
  const { ref, isVisible } = useScrollReveal(0.05);
  const [copiedImage, setCopiedImage] = useState(false);
  const [copiedVideo, setCopiedVideo] = useState(false);
  const [copiedAudio, setCopiedAudio] = useState(false);
  const [showSteps, setShowSteps] = useState(true);

  function handleCopyImage() {
    navigator.clipboard.writeText(clip.imagePrompt);
    setCopiedImage(true);
    setTimeout(() => setCopiedImage(false), 2500);
  }

  function handleCopyVideo() {
    navigator.clipboard.writeText(clip.videoPrompt);
    setCopiedVideo(true);
    setTimeout(() => setCopiedVideo(false), 2500);
  }

  function handleCopyAudio() {
    navigator.clipboard.writeText(clip.audioDirection);
    setCopiedAudio(true);
    setTimeout(() => setCopiedAudio(false), 2500);
  }

  return (
    <section ref={ref} className="relative py-10 md:py-14">
      {/* Clip number watermark */}
      <div
        className="absolute top-2 right-4 md:right-12 text-[5rem] md:text-[8rem] leading-none select-none pointer-events-none"
        style={{
          fontFamily: "var(--font-display)",
          color: "oklch(0.12 0.015 250)",
        }}
      >
        {clip.number}
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-8">
        {/* Clip header */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4 }}
          className="mb-4"
        >
          <div className="flex items-center gap-3 mb-2">
            <span
              className="w-9 h-9 flex items-center justify-center text-base font-bold"
              style={{
                background: "oklch(0.75 0.18 55)",
                color: "oklch(0.08 0.01 250)",
                fontFamily: "var(--font-display)",
              }}
            >
              {clip.number}
            </span>
            <span
              className="text-xs tracking-[0.3em] uppercase"
              style={{ fontFamily: "var(--font-body)", color: "oklch(0.55 0.14 55)", fontWeight: 600 }}
            >
              {clip.duration}
            </span>
          </div>
          <h3
            className="text-2xl md:text-4xl uppercase tracking-wider mb-1"
            style={{ fontFamily: "var(--font-heading)", fontWeight: 700, color: "oklch(0.92 0.005 250)" }}
          >
            {clip.title}
          </h3>
          <p
            className="text-sm italic"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.55 0.14 55)" }}
          >
            {clip.beat}
          </p>
        </motion.div>

        {/* Concept art */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={isVisible ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative letterbox overflow-hidden mb-4"
          style={{ aspectRatio: "2.35/1" }}
        >
          <img
            src={clip.image}
            alt={`Clip ${clip.number} concept art`}
            className="w-full h-full object-cover"
            style={{ filter: "contrast(1.1) saturate(1.2)" }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(180deg, transparent 50%, oklch(0.75 0.18 55 / 0.08) 100%)",
            }}
          />
          <div
            className="absolute bottom-4 left-4 z-10 px-3 py-1.5"
            style={{ background: "oklch(0.08 0.01 250 / 0.85)", border: "1px solid oklch(0.75 0.18 55 / 0.4)" }}
          >
            <span
              className="text-[11px] tracking-[0.15em] uppercase"
              style={{ fontFamily: "var(--font-body)", color: "oklch(0.75 0.18 55)", fontWeight: 600 }}
            >
              Concept Art Reference
            </span>
          </div>
        </motion.div>

        {/* TWO PROMPT BUTTONS — Image and Video */}
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {/* IMAGE PROMPT */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={isVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="relative electric-border p-5"
            style={{ background: "oklch(0.10 0.01 250)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <ImageIcon size={14} style={{ color: "oklch(0.88 0.16 90)" }} />
              <h4
                className="text-xs tracking-[0.2em] uppercase"
                style={{ fontFamily: "var(--font-body)", color: "oklch(0.88 0.16 90)", fontWeight: 600 }}
              >
                Step A — Image Prompt
              </h4>
            </div>
            <p
              className="text-xs leading-relaxed mb-3"
              style={{ fontFamily: "var(--font-body)", color: "oklch(0.50 0.005 250)" }}
            >
              {clip.imagePrompt.slice(0, 120)}...
            </p>
            <button
              onClick={handleCopyImage}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 transition-all duration-200"
              style={{
                background: copiedImage ? "oklch(0.45 0.15 145)" : "oklch(0.75 0.18 55)",
                color: "oklch(0.08 0.01 250)",
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: "13px",
                letterSpacing: "0.15em",
              }}
            >
              {copiedImage ? <Check size={16} /> : <Copy size={16} />}
              {copiedImage ? "COPIED!" : "COPY IMAGE PROMPT"}
            </button>
          </motion.div>

          {/* VIDEO PROMPT */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={isVisible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="relative electric-border p-5"
            style={{ background: "oklch(0.10 0.01 250)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Video size={14} style={{ color: "oklch(0.88 0.16 90)" }} />
              <h4
                className="text-xs tracking-[0.2em] uppercase"
                style={{ fontFamily: "var(--font-body)", color: "oklch(0.88 0.16 90)", fontWeight: 600 }}
              >
                Step B — Video Prompt
              </h4>
            </div>
            <p
              className="text-xs leading-relaxed mb-3"
              style={{ fontFamily: "var(--font-body)", color: "oklch(0.50 0.005 250)" }}
            >
              {clip.videoPrompt.slice(0, 120)}...
            </p>
            <button
              onClick={handleCopyVideo}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 transition-all duration-200"
              style={{
                background: copiedVideo ? "oklch(0.45 0.15 145)" : "oklch(0.75 0.18 55)",
                color: "oklch(0.08 0.01 250)",
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: "13px",
                letterSpacing: "0.15em",
              }}
            >
              {copiedVideo ? <Check size={16} /> : <Copy size={16} />}
              {copiedVideo ? "COPIED!" : "COPY VIDEO PROMPT"}
            </button>
          </motion.div>
        </div>

        {/* Audio direction */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, delay: 0.25 }}
          className="relative p-5 mb-4"
          style={{ background: "oklch(0.10 0.01 250)", border: "1px solid oklch(0.22 0.015 250)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <h4
              className="text-xs tracking-[0.3em] uppercase"
              style={{ fontFamily: "var(--font-body)", color: "oklch(0.55 0.14 55)", fontWeight: 600 }}
            >
              Audio Direction (for your reference)
            </h4>
            <button
              onClick={handleCopyAudio}
              className="flex items-center gap-1.5 px-3 py-1.5 transition-all duration-200"
              style={{
                background: copiedAudio ? "oklch(0.45 0.15 145)" : "oklch(0.22 0.015 250)",
                color: copiedAudio ? "oklch(0.95 0 0)" : "oklch(0.65 0.005 250)",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                fontSize: "11px",
                letterSpacing: "0.1em",
              }}
            >
              {copiedAudio ? <Check size={12} /> : <Copy size={12} />}
              {copiedAudio ? "COPIED" : "COPY"}
            </button>
          </div>
          <p
            className="text-sm leading-relaxed italic"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.50 0.005 250)" }}
          >
            {clip.audioDirection}
          </p>
        </motion.div>

        {/* Step-by-step — EXPANDED BY DEFAULT */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isVisible ? { opacity: 1 } : {}}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <button
            onClick={() => setShowSteps(!showSteps)}
            className="flex items-center gap-2 mb-3 transition-colors"
            style={{ color: "oklch(0.75 0.18 55)" }}
          >
            {showSteps ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            <span
              className="text-xs tracking-[0.2em] uppercase"
              style={{ fontFamily: "var(--font-body)", fontWeight: 600 }}
            >
              {showSteps ? "Hide" : "Show"} Step-by-Step Instructions
            </span>
          </button>

          {showSteps && (
            <div
              className="p-5"
              style={{ background: "oklch(0.08 0.01 250)", border: "1px solid oklch(0.75 0.18 55 / 0.15)" }}
            >
              <ol className="space-y-3">
                {clip.steps.map((step, i) => {
                  const isImportant = step.startsWith("IMPORTANT") || step.startsWith("THIS CLIP") || step.startsWith("YOU'RE DONE") || step.startsWith("NOW SWITCH") || step.startsWith("For the second");
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span
                        className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5"
                        style={{
                          background: isImportant ? "oklch(0.75 0.18 55)" : "oklch(0.75 0.18 55 / 0.15)",
                          color: isImportant ? "oklch(0.08 0.01 250)" : "oklch(0.75 0.18 55)",
                          fontFamily: "var(--font-body)",
                          border: "1px solid oklch(0.75 0.18 55 / 0.3)",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span
                        className="text-sm leading-relaxed"
                        style={{
                          fontFamily: "var(--font-body)",
                          color: isImportant ? "oklch(0.88 0.16 90)" : "oklch(0.65 0.005 250)",
                          fontWeight: isImportant ? 600 : 400,
                        }}
                      >
                        {step}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </motion.div>
      </div>

      {/* Bottom divider */}
      <div className="orange-rule mt-10 mx-auto" style={{ maxWidth: "500px" }} />
    </section>
  );
}
