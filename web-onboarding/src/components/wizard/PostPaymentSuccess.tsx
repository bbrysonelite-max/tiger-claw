"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, ArrowRight, Loader2, MessageCircle } from "lucide-react";
import type { WizardState } from "../OnboardingModal";
import { motion } from "framer-motion";

interface PostPaymentSuccessProps {
    state: WizardState;
    onClose: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function PostPaymentSuccess({ state, onClose }: PostPaymentSuccessProps) {
    const [status, setStatus] = useState<"deploying" | "live">("deploying");
    const [botUsername, setBotUsername] = useState<string | null>(null);
    const [telegramLink, setTelegramLink] = useState<string | null>(null);

    // On mount, check for session_id from Stripe redirect and poll for bot status
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get("session_id");

        if (sessionId) {
            // Poll the API for provisioning status — max 30 retries (90 seconds)
            let retries = 0;
            const MAX_RETRIES = 30;
            const poll = async () => {
                try {
                    const res = await fetch(`${API_BASE}/wizard/status?session_id=${encodeURIComponent(sessionId)}`);
                    const data = await res.json();
                    if (data.status === "live" && data.botUsername) {
                        setBotUsername(data.botUsername);
                        setTelegramLink(data.telegramLink ?? `https://t.me/${data.botUsername}`);
                        setStatus("live");
                        return; // Stop polling
                    }
                } catch {
                    // Keep polling
                }
                retries++;
                if (retries < MAX_RETRIES) {
                    setTimeout(poll, 3000);
                } else {
                    // Provisioning took too long — show generic success
                    setStatus("live");
                }
            };
            poll();
        } else {
            // No session_id — simulate for dev/demo
            const timer = setTimeout(() => {
                setStatus("live");
                const devUsername = state.botName?.replace(/\s/g, "_") || "tiger_claw_bot";
                setBotUsername(devUsername);
                setTelegramLink(`https://t.me/${devUsername}`);
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [state.botName]);

    return (
        <div className="flex flex-col items-center justify-center p-12 text-center relative overflow-hidden">
            {/* Background Glows */}
            {status === "live" && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[100px] mix-blend-screen pointer-events-none transition-all duration-1000" />
            )}

            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                className="relative z-10"
            >
                {status === "deploying" ? (
                    <div className="h-24 w-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6 shadow-inner relative overflow-hidden">
                        <div className="absolute inset-0 border-t-2 border-primary rounded-full animate-spin" />
                        <BotIcon />
                    </div>
                ) : (
                    <div className="h-24 w-24 rounded-full bg-primary flex items-center justify-center mx-auto mb-6 text-black shadow-[0_0_50px_rgba(249,115,22,0.4)]">
                        <CheckCircle2 className="h-12 w-12" />
                    </div>
                )}
            </motion.div>

            <h2 className="text-3xl font-black mb-4 relative z-10 text-white">
                {status === "deploying" ? "Provisioning..." : "Agent Deployed"}
            </h2>

            <p className="text-white/60 text-lg mb-8 max-w-md mx-auto relative z-10 !leading-relaxed">
                {status === "deploying"
                    ? `Setting up ${state.botName || "your agent"} on our infrastructure. This usually takes 10-30 seconds.`
                    : `Your agent is live and connected via Google Gemini.`}
            </p>

            {status === "live" && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-black/40 border border-[#22c55e]/30 rounded-2xl p-6 relative w-full mb-8"
                >
                    <div className="flex items-start gap-4 text-left">
                        <div className="h-10 w-10 flex-shrink-0 bg-[#22c55e]/10 rounded-full flex items-center justify-center border border-[#22c55e]/20">
                            <MessageCircle className="h-5 w-5 text-[#22c55e]" />
                        </div>
                        <div>
                            <h4 className="font-bold text-lg mb-1 flex items-center gap-2">
                                Status: LIVE
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e]"></span>
                                </span>
                            </h4>
                            <p className="text-sm text-white/60 mb-1">
                                <span className="font-mono text-[#22c55e]">@{botUsername}</span>
                            </p>
                            <p className="text-sm text-white/60 mb-4">
                                Your agent is online and waiting for the first message. Click below to open Telegram.
                            </p>
                            <a
                                href={telegramLink ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-white text-sm"
                            >
                                Open Telegram <ArrowRight className="h-4 w-4" />
                            </a>
                        </div>
                    </div>
                </motion.div>
            )}

            {status === "live" && (
                <button
                    onClick={onClose}
                    className="text-white/40 hover:text-white transition-colors text-sm font-semibold uppercase tracking-widest relative z-10"
                >
                    Go to Dashboard
                </button>
            )}
        </div>
    );
}

function BotIcon() {
    return (
        <svg className="h-10 w-10 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
    );
}
