// ============================================================
// Tiger Claw "THUNDERSTRUCK" — Higgsfield Production Dashboard
// Design: Hard Rock Cinema — AC/DC × Fincher × Concert Lighting
// Fonts: Bebas Neue (display), Oswald (headings), Space Grotesk (body)
// Palette: Void black, electric orange, tiger yellow, chrome
// ============================================================

import ProgressBar from "@/components/ProgressBar";
import HeroSection from "@/components/HeroSection";
import VisionSection from "@/components/VisionSection";
import StoryOverview from "@/components/StoryOverview";
import ProgressTracker from "@/components/ProgressTracker";
import ClipSection from "@/components/ClipSection";
import StrategySection from "@/components/StrategySection";
import ProductionSection from "@/components/ProductionSection";
import TaglineSection from "@/components/TaglineSection";
import Footer from "@/components/Footer";
import AudioPlayer from "@/components/AudioPlayer";
import { CLIPS } from "@/lib/data";

export default function Home() {
  return (
    <div className="min-h-screen pb-14" style={{ background: "oklch(0.08 0.01 250)" }}>
      <ProgressBar />
      <HeroSection />
      <VisionSection />
      <StoryOverview />

      {/* Production progress tracker */}
      <ProgressTracker />

      {/* Clip-by-clip production prompts */}
      <div>
        <div className="max-w-4xl mx-auto px-4 md:px-8 mb-6">
          <h2
            className="text-2xl md:text-3xl uppercase tracking-wide mb-3"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
              color: "oklch(0.90 0.005 250)",
              lineHeight: 1.1,
            }}
          >
            Clip-by-clip{" "}
            <span style={{ color: "oklch(0.75 0.18 55)" }}>prompts.</span>
          </h2>
          <p
            className="text-sm leading-relaxed max-w-2xl"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.50 0.005 250)" }}
          >
            Each clip has two orange buttons: <strong style={{ color: "oklch(0.75 0.18 55)" }}>COPY IMAGE PROMPT</strong> (Step A) and <strong style={{ color: "oklch(0.75 0.18 55)" }}>COPY VIDEO PROMPT</strong> (Step B). Do the image first, save it, use it as the First Frame for the video. Generate. Download. Next clip.
          </p>
        </div>

        {CLIPS.map((clip) => (
          <ClipSection key={clip.number} clip={clip} />
        ))}
      </div>

      <StrategySection />
      <ProductionSection />
      <TaglineSection />
      <Footer />

      {/* Sticky audio player */}
      <AudioPlayer />
    </div>
  );
}
