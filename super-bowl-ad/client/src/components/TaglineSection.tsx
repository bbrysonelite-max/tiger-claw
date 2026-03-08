// THUNDERSTRUCK — Closing tagline with lead counter
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { useCountUp } from "@/hooks/useCountUp";
import { TAGLINES, IMAGES } from "@/lib/data";

export default function TaglineSection() {
  const { ref, isVisible } = useScrollReveal(0.2);
  const leadCount = useCountUp(14502, 2000, isVisible);

  return (
    <section
      ref={ref}
      className="relative min-h-[70vh] flex items-center justify-center overflow-hidden electric-grain"
    >
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src={IMAGES.tigerEyes}
          alt=""
          className="w-full h-full object-cover opacity-12"
          style={{ filter: "blur(4px) saturate(1.5)" }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, oklch(0.08 0.01 250 / 60%) 0%, oklch(0.08 0.01 250) 70%)",
          }}
        />
      </div>

      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto pb-16">
        {/* Lead counter */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isVisible ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8"
        >
          <p
            className="text-xs tracking-[0.4em] uppercase mb-3"
            style={{ fontFamily: "var(--font-body)", color: "oklch(0.40 0.005 250)" }}
          >
            Tiger Claw: Session Complete
          </p>
          <p
            className="text-5xl md:text-7xl lg:text-8xl tabular-nums"
            style={{
              fontFamily: "var(--font-display)",
              color: "oklch(0.75 0.18 55)",
              textShadow: "0 0 40px oklch(0.75 0.18 55 / 0.4)",
              letterSpacing: "0.02em",
            }}
          >
            {leadCount.toLocaleString()}
          </p>
          <p
            className="text-base md:text-lg uppercase tracking-[0.2em] mt-1"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              color: "oklch(0.88 0.16 90)",
            }}
          >
            New Leads
          </p>
        </motion.div>

        <motion.div
          initial={{ scaleX: 0 }}
          animate={isVisible ? { scaleX: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="orange-rule mx-auto mb-8"
          style={{ width: "100px" }}
        />

        {/* TIGER CLAW */}
        <motion.h2
          initial={{ opacity: 0 }}
          animate={isVisible ? { opacity: 1 } : {}}
          transition={{ duration: 0.7, delay: 0.9 }}
          className="text-4xl md:text-6xl lg:text-7xl mb-3"
          style={{
            fontFamily: "var(--font-display)",
            color: "oklch(0.75 0.18 55)",
            letterSpacing: "0.05em",
            textShadow: "0 0 30px oklch(0.75 0.18 55 / 0.3)",
          }}
        >
          TIGER CLAW
        </motion.h2>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isVisible ? { opacity: 1 } : {}}
          transition={{ duration: 0.7, delay: 1.2 }}
          className="text-lg md:text-xl uppercase tracking-[0.15em]"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 500,
            color: "oklch(0.88 0.16 90)",
          }}
        >
          "{TAGLINES.primary}"
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={isVisible ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 1.6 }}
          className="mt-8 text-sm tracking-[0.3em] uppercase"
          style={{ fontFamily: "var(--font-body)", color: "oklch(0.30 0.005 250)" }}
        >
          {TAGLINES.hashtag}
        </motion.p>
      </div>
    </section>
  );
}
