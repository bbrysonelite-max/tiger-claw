// THUNDERSTRUCK Production Dashboard Hero — Higgsfield.ai
import { motion } from "framer-motion";
import { IMAGES } from "@/lib/data";

export default function HeroSection() {
  return (
    <section className="relative min-h-[80vh] flex items-center justify-center overflow-hidden electric-grain">
      {/* Background skull */}
      <div className="absolute inset-0">
        <img
          src={IMAGES.sabertooth}
          alt=""
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] md:w-[700px] md:h-[700px] object-contain opacity-10"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, oklch(0.08 0.01 250 / 40%) 0%, oklch(0.08 0.01 250) 70%)",
          }}
        />
      </div>

      <div className="relative z-10 text-center px-4 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="inline-block mb-6 px-4 py-1.5"
          style={{
            border: "1px solid oklch(0.75 0.18 55 / 0.5)",
            background: "oklch(0.75 0.18 55 / 0.08)",
          }}
        >
          <span
            className="text-xs tracking-[0.4em] uppercase"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.75 0.18 55)", fontWeight: 600 }}
          >
            Higgsfield Production Guide
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, scale: 1.2 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="text-6xl md:text-8xl lg:text-[10rem] leading-none mb-2"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            color: "oklch(0.75 0.18 55)",
            letterSpacing: "0.05em",
            textShadow: "0 0 60px oklch(0.75 0.18 55 / 0.3)",
          }}
        >
          TIGER CLAW
        </motion.h1>

        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="orange-rule mx-auto mb-5"
          style={{ width: "180px" }}
        />

        <motion.h2
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.65 }}
          className="text-2xl md:text-4xl lg:text-5xl uppercase tracking-[0.12em] mb-8"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            color: "oklch(0.88 0.16 90)",
          }}
        >
          THUNDERSTRUCK
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
          className="text-base md:text-lg max-w-2xl mx-auto leading-relaxed mb-10"
          style={{ fontFamily: "var(--font-body)", color: "oklch(0.60 0.005 250)" }}
        >
          Your step-by-step guide to producing a 60-second Super Bowl ad using Higgsfield.ai.
          Copy each prompt. Paste it. Generate. No guesswork.
        </motion.p>

        {/* Quick-start steps */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 1.1 }}
          className="flex flex-wrap justify-center gap-3 mb-8"
        >
          {[
            "Read setup below",
            'Click "Image" in top nav',
            "Paste prompt → Generate → Download",
            'Click "Video" in top nav',
            "Upload image as Start Frame → Paste prompt → Generate → Download",
          ].map((step, i) => (
            <div
              key={step}
              className="flex items-center gap-2 px-3 py-2"
              style={{ background: "oklch(0.12 0.015 250)", border: "1px solid oklch(0.22 0.015 250)" }}
            >
              <span
                className="w-5 h-5 flex items-center justify-center text-[10px] font-bold"
                style={{
                  background: "oklch(0.75 0.18 55)",
                  color: "oklch(0.08 0.01 250)",
                  fontFamily: "var(--font-body)",
                }}
              >
                {i + 1}
              </span>
              <span
                className="text-xs tracking-wide"
                style={{ fontFamily: "var(--font-body)", color: "oklch(0.70 0.005 250)" }}
              >
                {step}
              </span>
            </div>
          ))}
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.5 }}
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className="flex flex-col items-center gap-2"
          >
            <span
              className="text-[10px] tracking-[0.4em] uppercase"
              style={{ fontFamily: "var(--font-body)", color: "oklch(0.35 0.005 250)" }}
            >
              Start Below
            </span>
            <svg width="16" height="24" viewBox="0 0 16 24" fill="none">
              <path d="M8 0v20M2 14l6 6 6-6" stroke="oklch(0.75 0.18 55)" strokeWidth="1.5" />
            </svg>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
