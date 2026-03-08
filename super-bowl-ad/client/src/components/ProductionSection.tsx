// THUNDERSTRUCK — Download All Prompts + Pro Tips
// REWRITTEN for Higgsfield.ai (Seedream 4.5 images, Kling 3.0 video)
import { useState } from "react";
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { CLIPS } from "@/lib/data";
import { Download, Check } from "lucide-react";

function generateAllPromptsText(): string {
  let text = "TIGER CLAW: THUNDERSTRUCK\n";
  text += "Higgsfield.ai Production Prompts\n";
  text += "=".repeat(50) + "\n\n";
  text += "HOW THIS WORKS:\n";
  text += "For each clip, you do TWO steps on Higgsfield.ai:\n";
  text += "  Step A: Click 'Image' in the top nav, paste the IMAGE PROMPT into the bottom bar, generate, download the image.\n";
  text += "  Step B: Click 'Video' in the top nav, upload that image as 'Start frame', paste the VIDEO PROMPT, generate, download the video.\n\n";
  text += "MODELS TO USE:\n";
  text += "  Images: Seedream 4.5 (select in settings row below prompt bar)\n";
  text += "  Videos: Kling 3.0 (click 'Change' on the model badge in the left panel)\n";
  text += "  Aspect ratio: 16:9 for everything\n\n";
  text += "=".repeat(50) + "\n\n";

  for (const clip of CLIPS) {
    text += `CLIP ${clip.number}: ${clip.title.toUpperCase()} (${clip.duration})\n`;
    text += "-".repeat(30) + "\n\n";
    text += "IMAGE PROMPT (paste into Image mode prompt bar):\n";
    text += clip.imagePrompt + "\n\n";
    text += "VIDEO PROMPT (paste into Video mode prompt area after uploading image as Start Frame):\n";
    text += clip.videoPrompt + "\n\n";
    text += "AUDIO DIRECTION (for your reference during editing):\n";
    text += clip.audioDirection + "\n\n";
    text += "STEP-BY-STEP:\n";
    clip.steps.forEach((step: string, i: number) => {
      text += `  ${i + 1}. ${step}\n`;
    });
    text += "\n" + "=".repeat(50) + "\n\n";
  }

  text += "ASSEMBLY INSTRUCTIONS\n";
  text += "-".repeat(30) + "\n";
  text += "1. Open your 'TigerClaw Ad' folder — you should have Clip01-Clip05\n";
  text += "2. Open a video editor (CapCut, DaVinci Resolve, Premiere, iMovie)\n";
  text += "3. Drop clips on timeline in order: 01 → 02 → 03a → 03b → 04 → 05\n";
  text += "4. Add the royalty-free hard rock soundtrack\n";
  text += "5. Sync drum hits to hard cuts in Clip 03\n";
  text += '6. Add text overlays: "LEADS." on beats (Clip 03), "TIGER CLAW" + "Just tell it to go." (Clip 05)\n';
  text += "7. Apply teal-and-orange color grade (optional)\n";
  text += "8. Export at 1920x1080, 16:9, H.264, high quality\n";
  text += "9. Save as TigerClaw_Thunderstruck_Final.mp4\n";

  return text;
}

export default function ProductionSection() {
  const { ref, isVisible } = useScrollReveal(0.1);
  const [downloaded, setDownloaded] = useState(false);

  function handleDownload() {
    const text = generateAllPromptsText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tiger-claw-thunderstruck-prompts.txt";
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  }

  return (
    <section ref={ref} className="py-20 md:py-28 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h2
            className="text-3xl md:text-5xl uppercase tracking-wide mb-3"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
              color: "oklch(0.92 0.005 250)",
              lineHeight: 1.1,
            }}
          >
            Download{" "}
            <span style={{ color: "oklch(0.75 0.18 55)" }}>everything.</span>
          </h2>
          <p
            className="text-sm leading-relaxed max-w-2xl mb-8"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.50 0.005 250)" }}
          >
            All five image prompts, video prompts, audio directions, and assembly steps in one text file.
            Print it out and keep it next to you while you work.
          </p>

          <button
            onClick={handleDownload}
            className="flex items-center gap-3 px-8 py-4 transition-all duration-200"
            style={{
              background: downloaded ? "oklch(0.45 0.15 145)" : "oklch(0.75 0.18 55)",
              color: "oklch(0.08 0.01 250)",
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
              fontSize: "16px",
              letterSpacing: "0.15em",
              textTransform: "uppercase" as const,
            }}
          >
            {downloaded ? <Check size={20} /> : <Download size={20} />}
            {downloaded ? "DOWNLOADED!" : "DOWNLOAD ALL PROMPTS"}
          </button>
        </motion.div>

        {/* Pro tips — for Higgsfield */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid md:grid-cols-2 gap-px"
          style={{ background: "oklch(0.22 0.015 250)" }}
        >
          {[
            {
              title: "Two Steps Per Clip",
              tip: "Every clip is Image first, then Video. Generate the still image in Image mode, save it, then upload it as the 'Start frame' in Video mode. This gives you much better results than text-to-video alone.",
            },
            {
              title: "Clip 03 Is Two Parts",
              tip: "Clip 03 (The Flood) is 18 seconds — longer than the 5-second max. Generate it in two parts (Clip03a and Clip03b) and stitch them in your video editor.",
            },
            {
              title: "Aspect Ratio: Always 16:9",
              tip: "In Image mode, change the ratio from 3:4 to 16:9 (click the ratio button in the settings row). In Video mode, it's already 16:9 by default. You only need to set this once.",
            },
            {
              title: "The Tiger Eyes Are Critical",
              tip: "Clip 04 needs glowing yellow-gold eyes. If Higgsfield doesn't nail them on the first try, regenerate. Sometimes it takes 2-3 attempts. Don't settle — this is the money shot.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="p-5"
              style={{ background: "oklch(0.10 0.01 250)" }}
            >
              <h4
                className="text-xs tracking-[0.25em] uppercase mb-2"
                style={{ fontFamily: "var(--font-body)", color: "oklch(0.88 0.16 90)", fontWeight: 600 }}
              >
                {item.title}
              </h4>
              <p
                className="text-sm leading-relaxed"
                style={{ fontFamily: "var(--font-body)", color: "oklch(0.55 0.005 250)" }}
              >
                {item.tip}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
