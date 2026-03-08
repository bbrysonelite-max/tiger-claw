"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Bot, Lock, Code2, ArrowRight } from "lucide-react";
import OnboardingModal from "@/components/OnboardingModal";

export default function Home() {
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="relative min-h-[calc(100vh-64px)] overflow-hidden flex flex-col justify-center">
      {/* Premium Gradient Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] pointer-events-none mix-blend-screen" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#22c55e]/10 rounded-full blur-[128px] pointer-events-none mix-blend-screen" />

      <div className="container mx-auto px-6 py-20 relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 backdrop-blur text-sm text-white/80 mb-8"
        >
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          v4.0 Enterprise Ready
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-6xl md:text-8xl font-black tracking-tighter mb-6 leading-tight max-w-4xl mx-auto"
        >
          Deploy Your <br className="hidden md:block" />
          <span className="gradient-text">Agent in 60 Seconds</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-lg md:text-xl text-white/60 !leading-relaxed mb-12 max-w-2xl mx-auto"
        >
          Bring Your Own Key (BYOK) architecture. Secure, compliant, and highly available agents on edge computing. Stop wiring tools, start selling.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <button
            onClick={() => setWizardOpen(true)}
            className="group relative inline-flex h-14 items-center justify-center overflow-hidden rounded-full font-bold px-8 bg-primary text-black transition-all hover:scale-105 active:scale-95 w-full sm:w-auto"
          >
            <span className="relative z-10 flex items-center gap-2">
              Launch My Agent <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
          </button>

          <button className="h-14 px-8 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors font-semibold text-white/80 w-full sm:w-auto">
            Read Docs
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto text-left"
        >
          <FeatureCard
            icon={<Lock className="w-6 h-6 text-primary" />}
            title="BYOK Enabled"
            description="Use your own Google AI API key securely. AES-256-GCM encrypted at rest. Never shared."
          />
          <FeatureCard
            icon={<Zap className="w-6 h-6 text-primary" />}
            title="Instant Provisioning"
            description="Automated Kubernetes deployments mean zero wait time from payment to live bot."
          />
          <FeatureCard
            icon={<Bot className="w-6 h-6 text-primary" />}
            title="Pre-trained Flavors"
            description="Agents hit the ground running with industry specific nurture sequences."
          />
        </motion.div>
      </div>

      {wizardOpen && (
        <OnboardingModal onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/20 transition-colors relative group overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center border border-white/10 mb-4">
          {icon}
        </div>
        <h3 className="text-xl font-bold mb-2 text-white/90">{title}</h3>
        <p className="text-white/50 leading-relaxed text-sm">
          {description}
        </p>
      </div>
    </div>
  );
}
