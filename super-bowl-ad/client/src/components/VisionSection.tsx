// THUNDERSTRUCK — "Before You Start" Setup Guide
// REWRITTEN for Higgsfield.ai (Seedream 4.5 images, Kling 3.0 video)
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { IMAGES } from "@/lib/data";
import {
  AlertTriangle,
  CheckCircle,
  Monitor,
  MousePointer,
  Image as ImageIcon,
  Video,
  Download,
} from "lucide-react";

export default function VisionSection() {
  const { ref, isVisible } = useScrollReveal(0.05);

  return (
    <section ref={ref} className="py-16 md:py-24 px-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* ===== HEADER ===== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <div className="flex items-center gap-3 mb-3">
            <span
              className="w-10 h-10 flex items-center justify-center text-base font-bold"
              style={{
                background: "oklch(0.75 0.18 55)",
                color: "oklch(0.08 0.01 250)",
                fontFamily: "var(--font-display)",
              }}
            >
              0
            </span>
            <p
              className="text-xs tracking-[0.35em] uppercase"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.55 0.14 55)",
                fontWeight: 500,
              }}
            >
              Read This First — 5 Minutes
            </p>
          </div>
          <h2
            className="text-3xl md:text-5xl uppercase tracking-wide mb-3"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
              color: "oklch(0.92 0.005 250)",
              lineHeight: 1.1,
            }}
          >
            Before you{" "}
            <span style={{ color: "oklch(0.75 0.18 55)" }}>start.</span>
          </h2>
          <p
            className="text-sm leading-relaxed max-w-2xl"
            style={{
              fontFamily: "var(--font-body)",
              color: "oklch(0.50 0.005 250)",
            }}
          >
            Everything happens on{" "}
            <strong style={{ color: "oklch(0.75 0.18 55)" }}>
              higgsfield.ai
            </strong>
            . You'll use two tools: <strong style={{ color: "oklch(0.88 0.16 90)" }}>Image mode</strong> (to create still frames) and{" "}
            <strong style={{ color: "oklch(0.88 0.16 90)" }}>Video mode</strong>{" "}
            (to animate those frames into clips). Here's exactly what you'll see
            on screen.
          </p>
        </motion.div>

        {/* ===== SIGN IN ===== */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="p-5"
          style={{
            background: "oklch(0.10 0.01 250)",
            border: "1px solid oklch(0.22 0.015 250)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Monitor size={14} style={{ color: "oklch(0.88 0.16 90)" }} />
            <h4
              className="text-xs tracking-[0.2em] uppercase"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.88 0.16 90)",
                fontWeight: 600,
              }}
            >
              Step 1 — Sign In & Create a Folder
            </h4>
          </div>
          <ol className="space-y-2">
            {[
              'Go to higgsfield.ai and sign in (or create a free account — click "Sign up" at the top right)',
              'Create a folder on your computer called "TigerClaw Ad" — this is where you\'ll save everything',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5"
                  style={{
                    background: "oklch(0.75 0.18 55 / 0.15)",
                    color: "oklch(0.75 0.18 55)",
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
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </motion.div>

        {/* ===== IMAGE MODE EXPLAINED ===== */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="p-5"
          style={{
            background: "oklch(0.10 0.01 250)",
            border: "1px solid oklch(0.22 0.015 250)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon size={14} style={{ color: "oklch(0.88 0.16 90)" }} />
            <h4
              className="text-xs tracking-[0.2em] uppercase"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.88 0.16 90)",
                fontWeight: 600,
              }}
            >
              What Image Mode Looks Like
            </h4>
          </div>
          <p
            className="text-sm leading-relaxed mb-3"
            style={{
              fontFamily: "var(--font-body)",
              color: "oklch(0.55 0.005 250)",
            }}
          >
            Click{" "}
            <strong style={{ color: "oklch(0.75 0.18 55)" }}>
              "Image"
            </strong>{" "}
            in the top navigation bar. Here's what you'll see:
          </p>
          <div className="space-y-2">
            {[
              {
                label: "Center area",
                text: 'Shows the model branding (e.g., "SEEDREAM 4.5"). After you generate, your images appear here.',
              },
              {
                label: "Bottom bar",
                text: 'A prompt bar that says "Describe the scene you imagine" — this is where you paste the image prompt.',
              },
              {
                label: "Settings row",
                text: "Below the prompt bar: Model name (click to change) — Resolution (2K/4K) — Aspect Ratio (click to change to 16:9) — Image count.",
              },
              {
                label: "Generate button",
                text: "Green/yellow button on the right side of the prompt bar. Click it after pasting your prompt.",
              },
              {
                label: "Left sidebar",
                text: '"History" and "Community" tabs — your past generations show up here.',
              },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span
                  className="text-xs font-bold flex-shrink-0 mt-0.5 px-1.5 py-0.5"
                  style={{
                    background: "oklch(0.75 0.18 55 / 0.15)",
                    color: "oklch(0.75 0.18 55)",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {item.label}
                </span>
                <span
                  className="text-sm leading-relaxed"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ===== VIDEO MODE EXPLAINED ===== */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.22 }}
          className="p-5"
          style={{
            background: "oklch(0.10 0.01 250)",
            border: "1px solid oklch(0.22 0.015 250)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Video size={14} style={{ color: "oklch(0.88 0.16 90)" }} />
            <h4
              className="text-xs tracking-[0.2em] uppercase"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.88 0.16 90)",
                fontWeight: 600,
              }}
            >
              What Video Mode Looks Like
            </h4>
          </div>
          <p
            className="text-sm leading-relaxed mb-3"
            style={{
              fontFamily: "var(--font-body)",
              color: "oklch(0.55 0.005 250)",
            }}
          >
            Click{" "}
            <strong style={{ color: "oklch(0.75 0.18 55)" }}>
              "Video"
            </strong>{" "}
            in the top navigation bar. Here's what you'll see:
          </p>
          <div className="space-y-2">
            {[
              {
                label: "Left panel",
                text: 'Three tabs at the top: "Create Video" | "Edit Video" | "Motion Control". Stay on "Create Video".',
              },
              {
                label: "Model badge",
                text: 'Shows the current model name (e.g., "Kling 3.0") with a "Change" button. Click "Change" to switch models.',
              },
              {
                label: "Start frame",
                text: "An upload area with a camera icon. Click it to upload your saved image. This is the first frame of your video.",
              },
              {
                label: "End frame",
                text: "Another upload area — leave this EMPTY. We only use the Start frame.",
              },
              {
                label: "Prompt area",
                text: 'A text box that says "Describe your video..." — paste your video prompt here.',
              },
              {
                label: "Settings row",
                text: 'At the bottom of the left panel: Model — Duration ("5s") — Ratio ("16:9") — Resolution ("720p" or "1080p").',
              },
              {
                label: "Generate button",
                text: "Green/yellow button at the very bottom of the left panel. Shows credit cost.",
              },
              {
                label: "Right area",
                text: "Shows your generated video when it's ready. Also has History tab.",
              },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span
                  className="text-xs font-bold flex-shrink-0 mt-0.5 px-1.5 py-0.5"
                  style={{
                    background: "oklch(0.75 0.18 55 / 0.15)",
                    color: "oklch(0.75 0.18 55)",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {item.label}
                </span>
                <span
                  className="text-sm leading-relaxed"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ===== HOW TO SAVE / DOWNLOAD ===== */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.28 }}
          className="p-5"
          style={{
            background: "oklch(0.75 0.18 55 / 0.06)",
            border: "2px solid oklch(0.75 0.18 55 / 0.4)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Download size={14} style={{ color: "oklch(0.75 0.18 55)" }} />
            <h4
              className="text-xs tracking-[0.2em] uppercase"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.75 0.18 55)",
                fontWeight: 600,
              }}
            >
              How to Save Your Images & Videos
            </h4>
          </div>
          <div className="space-y-2">
            <p
              className="text-sm leading-relaxed"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.65 0.005 250)",
              }}
            >
              <strong style={{ color: "oklch(0.75 0.18 55)" }}>
                For images:
              </strong>{" "}
              After generating, hover over the image in the center area. A download icon (↓ arrow) will appear. Click it. The file goes to your Downloads folder.
            </p>
            <p
              className="text-sm leading-relaxed"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.65 0.005 250)",
              }}
            >
              <strong style={{ color: "oklch(0.75 0.18 55)" }}>
                For videos:
              </strong>{" "}
              After generating, the video appears on the right side. Hover over it and click the download icon. The file goes to your Downloads folder.
            </p>
          </div>
          <div
            className="mt-3 p-3"
            style={{
              background: "oklch(0.08 0.01 250)",
              border: "1px solid oklch(0.75 0.18 55 / 0.2)",
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={14}
                className="mt-0.5 flex-shrink-0"
                style={{ color: "oklch(0.88 0.16 90)" }}
              />
              <p
                className="text-xs leading-relaxed"
                style={{
                  fontFamily: "var(--font-body)",
                  color: "oklch(0.88 0.16 90)",
                }}
              >
                <strong>DO NOT right-click → "Save image as"</strong> — this
                can give you a broken .html file. Always use the{" "}
                <strong>download icon that appears when you hover</strong> over
                the generated image or video.
              </p>
            </div>
          </div>
        </motion.div>

        {/* ===== THE PATTERN ===== */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.32 }}
          className="p-5"
          style={{
            background: "oklch(0.10 0.01 250)",
            border: "1px solid oklch(0.22 0.015 250)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <MousePointer
              size={14}
              style={{ color: "oklch(0.88 0.16 90)" }}
            />
            <h4
              className="text-xs tracking-[0.2em] uppercase"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.88 0.16 90)",
                fontWeight: 600,
              }}
            >
              The Pattern (Same for Every Clip)
            </h4>
          </div>
          <div className="space-y-2">
            {[
              {
                letter: "A",
                text: 'Click "Image" in the top nav → go to image mode',
              },
              {
                letter: "B",
                text: "Come back to this page → click COPY IMAGE PROMPT",
              },
              {
                letter: "C",
                text: "Go to Higgsfield → paste into the prompt bar → click Generate",
              },
              {
                letter: "D",
                text: "Hover over the image → download icon → save to TigerClaw Ad folder",
              },
              {
                letter: "E",
                text: 'Click "Video" in the top nav → go to video mode',
              },
              {
                letter: "F",
                text: 'Upload your saved image as "Start frame" (click the camera icon)',
              },
              {
                letter: "G",
                text: "Come back here → click COPY VIDEO PROMPT → paste into the prompt area → click Generate",
              },
              {
                letter: "H",
                text: "Hover over the video → download icon → save to TigerClaw Ad folder",
              },
            ].map((item) => (
              <div key={item.letter} className="flex items-start gap-3">
                <span
                  className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-[11px] font-bold"
                  style={{
                    background: "oklch(0.75 0.18 55)",
                    color: "oklch(0.08 0.01 250)",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {item.letter}
                </span>
                <span
                  className="text-sm leading-relaxed"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  {item.text}
                </span>
              </div>
            ))}
          </div>
          <div
            className="mt-4 p-3"
            style={{
              background: "oklch(0.75 0.18 55 / 0.08)",
              border: "1px solid oklch(0.75 0.18 55 / 0.3)",
            }}
          >
            <p
              className="text-sm"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.75 0.18 55)",
                fontWeight: 600,
              }}
            >
              That's it. A → H for every clip. Five clips total. Then you
              assemble them in a video editor.
            </p>
          </div>
        </motion.div>

        {/* ===== FIRST-TIME SETTINGS ===== */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.38 }}
          className="p-5 mb-4"
          style={{
            background: "oklch(0.10 0.01 250)",
            border: "1px solid oklch(0.22 0.015 250)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <MousePointer
              size={14}
              style={{ color: "oklch(0.88 0.16 90)" }}
            />
            <h4
              className="text-xs tracking-[0.2em] uppercase"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.88 0.16 90)",
                fontWeight: 600,
              }}
            >
              One-Time Settings (Do This Once)
            </h4>
          </div>
          <div className="space-y-3">
            <div>
              <p
                className="text-sm leading-relaxed"
                style={{
                  fontFamily: "var(--font-body)",
                  color: "oklch(0.55 0.005 250)",
                }}
              >
                <strong style={{ color: "oklch(0.88 0.16 90)" }}>
                  In Image mode:
                </strong>
              </p>
              <ul className="mt-1 space-y-1 ml-4">
                <li
                  className="text-sm"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  • Click the model name in the settings row → select{" "}
                  <strong style={{ color: "oklch(0.75 0.18 55)" }}>
                    Seedream 4.5
                  </strong>
                </li>
                <li
                  className="text-sm"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  • Click the aspect ratio (probably says "3:4") → select{" "}
                  <strong style={{ color: "oklch(0.75 0.18 55)" }}>16:9</strong>
                </li>
              </ul>
            </div>
            <div>
              <p
                className="text-sm leading-relaxed"
                style={{
                  fontFamily: "var(--font-body)",
                  color: "oklch(0.55 0.005 250)",
                }}
              >
                <strong style={{ color: "oklch(0.88 0.16 90)" }}>
                  In Video mode:
                </strong>
              </p>
              <ul className="mt-1 space-y-1 ml-4">
                <li
                  className="text-sm"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  • Click "Change" on the model badge → select{" "}
                  <strong style={{ color: "oklch(0.75 0.18 55)" }}>
                    Kling 3.0
                  </strong>
                </li>
                <li
                  className="text-sm"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  • Ratio should already be{" "}
                  <strong style={{ color: "oklch(0.75 0.18 55)" }}>16:9</strong>{" "}
                  by default — no change needed
                </li>
                <li
                  className="text-sm"
                  style={{
                    fontFamily: "var(--font-body)",
                    color: "oklch(0.65 0.005 250)",
                  }}
                >
                  • Duration should be{" "}
                  <strong style={{ color: "oklch(0.75 0.18 55)" }}>5s</strong>{" "}
                  — no change needed
                </li>
              </ul>
            </div>
            <p
              className="text-xs mt-2"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.50 0.005 250)",
              }}
            >
              These settings stay set once you change them. You only do this
              once.
            </p>
          </div>
        </motion.div>

        {/* ===== READY callout ===== */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isVisible ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="p-5 flex items-start gap-3"
          style={{
            background: "oklch(0.75 0.18 55 / 0.1)",
            border: "2px solid oklch(0.75 0.18 55 / 0.3)",
          }}
        >
          <CheckCircle
            size={20}
            className="mt-0.5 flex-shrink-0"
            style={{ color: "oklch(0.75 0.18 55)" }}
          />
          <div>
            <p
              className="text-base font-bold mb-1"
              style={{
                fontFamily: "var(--font-heading)",
                color: "oklch(0.88 0.16 90)",
              }}
            >
              YOU'RE READY.
            </p>
            <p
              className="text-sm leading-relaxed"
              style={{
                fontFamily: "var(--font-body)",
                color: "oklch(0.65 0.005 250)",
              }}
            >
              Scroll down. Each clip has two orange buttons:{" "}
              <strong style={{ color: "oklch(0.75 0.18 55)" }}>
                COPY IMAGE PROMPT
              </strong>{" "}
              and{" "}
              <strong style={{ color: "oklch(0.75 0.18 55)" }}>
                COPY VIDEO PROMPT
              </strong>
              . Do the image first (Steps A–D), save it, then do the video using
              that image as the Start Frame (Steps E–H). Five clips. Then
              assemble.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
