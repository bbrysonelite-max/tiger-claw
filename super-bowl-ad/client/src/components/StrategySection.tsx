// THUNDERSTRUCK — Assembly Guide (after generating all clips)
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const ASSEMBLY_STEPS = [
  {
    step: "01",
    title: "Check Your 'TigerClaw Ad' Folder",
    desc: "You should have 6 files: clip01.jpg through clip05.jpg (your first-frame images) and Clip01.mp4 through Clip05.mp4 (Clip03 has two parts: Clip03a.mp4 and Clip03b.mp4). If anything is missing, go back and generate it.",
  },
  {
    step: "02",
    title: "Download a Free Video Editor",
    desc: "If you don't have one: CapCut (capcut.com — free, easiest), DaVinci Resolve (free, more powerful), or iMovie (free on Mac). Any of these work. Download, install, open it.",
  },
  {
    step: "03",
    title: "Create a New Project",
    desc: "In your video editor, create a new project. Set the resolution to 1920x1080 (1080p) and the frame rate to 24fps. In CapCut: click 'New Project'. In DaVinci Resolve: File → New Project.",
  },
  {
    step: "04",
    title: "Import Your Clips",
    desc: "Drag all your .mp4 files from the TigerClaw Ad folder into the editor's media bin. Or use File → Import. You need: Clip01.mp4, Clip02.mp4, Clip03a.mp4, Clip03b.mp4, Clip04.mp4, Clip05.mp4.",
  },
  {
    step: "05",
    title: "Drop Clips on the Timeline in Order",
    desc: "Drag them onto the timeline left to right: Clip01 → Clip02 → Clip03a → Clip03b → Clip04 → Clip05. They should play back to back with no gaps between them.",
  },
  {
    step: "06",
    title: "Add the Hard Rock Soundtrack",
    desc: "Download the royalty-free track from the audio player at the bottom of this page (right-click the play bar → 'Save audio as', or use the download link). Drag it onto the audio track in your editor. Line it up so the drums kick in right when Clip02 starts.",
  },
  {
    step: "07",
    title: "Add Text Overlays",
    desc: "In Clip 03: Add the word 'LEADS.' slamming on screen on each beat — use white text, Bebas Neue or Impact font, large and bold. In Clip 05: Add 'TIGER CLAW' in large white text and 'Just tell it to go.' below it in smaller text.",
  },
  {
    step: "08",
    title: "Color Grade (Optional but Recommended)",
    desc: "Apply a teal-and-orange color grade (LUT) across all clips for a unified cinematic look. In CapCut: Filters → Film. In DaVinci Resolve: Color tab → add a LUT. This makes everything look like a real movie.",
  },
  {
    step: "09",
    title: "Export Your Final Ad",
    desc: "Export at 1920x1080 (1080p), 16:9 aspect ratio, H.264 codec, high quality. In CapCut: Export button (top right). In DaVinci Resolve: Deliver tab → YouTube preset works great. Save as 'TigerClaw_Thunderstruck_Final.mp4'. You're done.",
  },
];

export default function StrategySection() {
  const { ref, isVisible } = useScrollReveal(0.08);

  return (
    <section ref={ref} className="py-20 md:py-28 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-3">
            <span
              className="w-10 h-10 flex items-center justify-center text-base font-bold"
              style={{
                background: "oklch(0.88 0.16 90)",
                color: "oklch(0.08 0.01 250)",
                fontFamily: "var(--font-display)",
              }}
            >
              ✓
            </span>
            <p
              className="text-xs tracking-[0.35em] uppercase"
              style={{ fontFamily: "var(--font-body)", color: "oklch(0.55 0.14 55)", fontWeight: 500 }}
            >
              After You've Generated All 5 Clips
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
            Assemble the{" "}
            <span style={{ color: "oklch(0.75 0.18 55)" }}>final cut.</span>
          </h2>
          <p
            className="text-sm leading-relaxed max-w-2xl"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.50 0.005 250)" }}
          >
            You've got all the raw clips. Now put them together. This takes about 15–30 minutes in any video editor.
          </p>
        </motion.div>

        <div className="space-y-3">
          {ASSEMBLY_STEPS.map((item, i) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, x: -12 }}
              animate={isVisible ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.35, delay: 0.06 * i }}
              className="flex items-start gap-4 p-5"
              style={{ background: "oklch(0.10 0.01 250)", border: "1px solid oklch(0.18 0.01 250)" }}
            >
              <span
                className="text-2xl flex-shrink-0"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "oklch(0.75 0.18 55)",
                  lineHeight: 1,
                }}
              >
                {item.step}
              </span>
              <div>
                <h3
                  className="text-sm uppercase tracking-wider mb-1"
                  style={{ fontFamily: "var(--font-heading)", color: "oklch(0.88 0.16 90)", fontWeight: 600 }}
                >
                  {item.title}
                </h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ fontFamily: "var(--font-body)", color: "oklch(0.55 0.005 250)" }}
                >
                  {item.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
