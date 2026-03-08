// THUNDERSTRUCK Story Overview — Compact clip timeline for production dashboard
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { CLIPS } from "@/lib/data";

export default function StoryOverview() {
  const { ref, isVisible } = useScrollReveal(0.1);

  return (
    <section ref={ref} className="py-16 md:py-20 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h2
            className="text-2xl md:text-3xl uppercase tracking-wide mb-3"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
              color: "oklch(0.90 0.005 250)",
              lineHeight: 1.1,
            }}
          >
            The 60-Second{" "}
            <span style={{ color: "oklch(0.75 0.18 55)" }}>Breakdown</span>
          </h2>
          <p
            className="text-sm leading-relaxed max-w-2xl"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.50 0.005 250)" }}
          >
            Five clips, each generated separately in Seed Dream. Scroll down to produce each one.
          </p>
        </motion.div>

        {/* Horizontal timeline on desktop, vertical on mobile */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="grid grid-cols-1 md:grid-cols-5 gap-px"
          style={{ background: "oklch(0.22 0.015 250)" }}
        >
          {CLIPS.map((clip) => (
            <div
              key={clip.number}
              className="p-4"
              style={{ background: "oklch(0.10 0.01 250)" }}
            >
              <span
                className="text-2xl block mb-1"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "oklch(0.75 0.18 55)",
                }}
              >
                {clip.number}
              </span>
              <h3
                className="text-sm uppercase tracking-wider mb-1"
                style={{
                  fontFamily: "var(--font-heading)",
                  color: "oklch(0.85 0.005 250)",
                  fontWeight: 600,
                }}
              >
                {clip.title}
              </h3>
              <p
                className="text-[10px]"
                style={{ fontFamily: "var(--font-body)", color: "oklch(0.45 0.005 250)" }}
              >
                {clip.duration}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
