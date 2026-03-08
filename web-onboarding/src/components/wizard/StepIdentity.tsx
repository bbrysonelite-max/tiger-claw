"use client";

import { useEffect, useState } from "react";
import { User, Bot, Mail, ArrowRight, Loader2 } from "lucide-react";
import type { WizardState } from "../OnboardingModal";

interface IdentityProps {
    state: WizardState;
    updateState: (updates: Partial<WizardState>) => void;
    onNext: () => void;
}

const defaultBotNames: Record<string, string> = {
    network_marketing: "Prospect Scout",
    airbnb: "Guest Welcome Bot",
    real_estate: "Lead Qualifier",
    healthcare: "Patient Assistant",
    other: "Support Bot",
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function StepIdentity({ state, updateState, onNext }: IdentityProps) {
    const [isRegistering, setIsRegistering] = useState(false);
    const [registerError, setRegisterError] = useState("");

    // Pre-fill bot name if it's empty
    useEffect(() => {
        if (!state.botName && state.nicheId) {
            updateState({ botName: defaultBotNames[state.nicheId] || "AI Assistant" });
        }
    }, [state.nicheId, state.botName, updateState]);

    const isValid =
        state.botName.trim().length > 0 &&
        state.yourName.trim().length > 0 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email);

    const handleContinue = async () => {
        if (!isValid) return;
        setIsRegistering(true);
        setRegisterError("");

        try {
            const res = await fetch(`${API_BASE}/subscriptions/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: state.email,
                    name: state.yourName,
                    niche: state.nicheId,
                    botName: state.botName,
                }),
            });

            const data = await res.json();

            if (!res.ok || !data.botId) {
                setRegisterError(data.error ?? "Registration failed. Please try again.");
                return;
            }

            updateState({ botId: data.botId });
            onNext();
        } catch (err: any) {
            setRegisterError("Network error — could not reach the server. Try again.");
        } finally {
            setIsRegistering(false);
        }
    };

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="mb-8">
                <h3 className="text-2xl font-bold mb-2 text-white">Bot Identity</h3>
                <p className="text-white/50 text-base leading-relaxed">
                    Give your agent a name. This is how it will introduce itself to your prospects.
                </p>
            </div>

            <div className="space-y-6 flex-1">
                <div>
                    <label className="block text-sm font-semibold text-white/80 mb-2">
                        Your Name
                    </label>
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-white/40">
                            <User className="h-5 w-5" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-10 pr-3 py-3 rounded-xl border border-white/10 bg-white/5 focus:bg-white/10 focus:border-primary focus:ring-1 focus:ring-primary text-white placeholder-white/30 transition-all outline-none"
                            placeholder="e.g. John Doe"
                            value={state.yourName}
                            onChange={(e) => updateState({ yourName: e.target.value })}
                            autoFocus
                        />
                    </div>
                    <p className="mt-2 text-xs text-white/40">The bot will say you are its manager/owner.</p>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-white/80 mb-2">
                        Email Address
                    </label>
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-white/40">
                            <Mail className="h-5 w-5" />
                        </div>
                        <input
                            type="email"
                            className="block w-full pl-10 pr-3 py-3 rounded-xl border border-white/10 bg-white/5 focus:bg-white/10 focus:border-primary focus:ring-1 focus:ring-primary text-white placeholder-white/30 transition-all outline-none"
                            placeholder="you@example.com"
                            value={state.email}
                            onChange={(e) => updateState({ email: e.target.value })}
                            autoComplete="email"
                        />
                    </div>
                    <p className="mt-2 text-xs text-white/40">Used for your Stripe receipt and account access.</p>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-white/80 mb-2">
                        Agent Display Name
                    </label>
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-white/40">
                            <Bot className="h-5 w-5" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-10 pr-3 py-3 rounded-xl border border-white/10 bg-white/5 focus:bg-white/10 focus:border-primary focus:ring-1 focus:ring-primary text-white placeholder-white/30 transition-all outline-none"
                            placeholder="e.g. Prospect Scout"
                            value={state.botName}
                            onChange={(e) => updateState({ botName: e.target.value })}
                        />
                    </div>
                </div>

                {registerError && (
                    <p className="text-xs text-red-400 mt-1">{registerError}</p>
                )}
            </div>

            <div className="mt-8 flex justify-end">
                <button
                    onClick={handleContinue}
                    disabled={!isValid || isRegistering}
                    className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-full font-bold px-8 bg-primary text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                    <span className="relative z-10 flex items-center gap-2">
                        {isRegistering ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Setting up...</>
                        ) : (
                            <>Continue <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
                        )}
                    </span>
                </button>
            </div>
        </div>
    );
}
