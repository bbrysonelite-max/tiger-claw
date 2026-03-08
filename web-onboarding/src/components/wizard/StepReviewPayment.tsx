"use client";

import { useState } from "react";
import { CreditCard, Loader2, Bot, Database, AlertCircle } from "lucide-react";
import type { WizardState } from "../OnboardingModal";

interface ReviewPaymentProps {
    state: WizardState;
    isDeploying: boolean;
    onLaunch: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function StepReviewPayment({ state, isDeploying, onLaunch }: ReviewPaymentProps) {
    const [error, setError] = useState("");

    const handleCheckout = async () => {
        setError("");

        try {
            const res = await fetch(`${API_BASE}/subscriptions/checkout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: state.email,
                    name: state.yourName,
                    niche: state.nicheId,
                    botName: state.botName,
                    connectionType: "byok",
                    aiProvider: "google",
                    aiModel: "gemini-2.5-flash",
                    botId: state.botId,   // Set by StepIdentity via /subscriptions/register
                }),
            });

            const data = await res.json();

            if (data.url) {
                // Only lock the UI once we're guaranteed to redirect — prevents
                // permanently disabled buttons if checkout fails
                onLaunch();
                window.location.href = data.url;
            } else {
                setError(data.error ?? "Failed to create checkout session. Please try again.");
            }
        } catch (err: any) {
            setError("Network error — could not reach the payment server. Try again.");
        }
    };

    // BYOK pricing only — Tiger Credits does not exist (Locked Decision #12)
    const monthlyTotal = "$47.00";

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2 text-white">Review & Pay</h3>
                <p className="text-white/50 text-base leading-relaxed">
                    Review your agent configuration. You'll be redirected to Stripe for secure payment.
                </p>
            </div>

            <div className="space-y-4 flex-1">
                {/* Summary Card */}
                <div className="bg-black/50 border border-white/10 rounded-2xl p-6 relative overflow-hidden">
                    {/* subtle glow */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-[64px] mix-blend-screen pointer-events-none" />

                    <div className="flex justify-between items-start mb-6 pb-6 border-b border-white/5">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                                <Bot className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <h4 className="text-lg font-bold text-white">{state.botName}</h4>
                                <p className="text-white/50 text-sm">{state.nicheName} Persona</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xl font-black text-white">{monthlyTotal}</div>
                            <div className="text-white/50 text-xs uppercase tracking-widest">per month</div>
                        </div>
                    </div>

                    <div className="space-y-4 text-sm">
                        <div className="flex justify-between">
                            <span className="text-white/50">Account Owner</span>
                            <span className="text-white font-medium">{state.yourName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-white/50">AI Engine</span>
                            <span className="text-white font-medium flex items-center gap-2">
                                <Database className="h-3 w-3 text-[#22c55e]" />
                                Google Gemini (gemini-2.5-flash)
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-white/50">API Key</span>
                            <span className="text-white font-medium text-[#22c55e]">
                                ✓ Validated & Encrypted
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-white/50">Channel</span>
                            <span className="text-white font-medium">Telegram (auto-provisioned)</span>
                        </div>
                    </div>
                </div>

                {/* Info */}
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                    <p className="text-xs text-primary/80 leading-relaxed text-center">
                        You'll be redirected to Stripe for secure payment. Your agent will be provisioned automatically after payment completes. Cancel anytime.
                    </p>
                </div>

                {/* Error */}
                {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3">
                        <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-red-400 leading-relaxed">{error}</p>
                    </div>
                )}
            </div>

            <div className="mt-8 flex justify-end">
                <button
                    onClick={handleCheckout}
                    disabled={isDeploying}
                    className="w-full relative inline-flex h-14 items-center justify-center overflow-hidden rounded-full font-black px-8 bg-primary text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_30px_rgba(249,115,22,0.5)]"
                >
                    <span className="relative z-10 flex items-center gap-2 text-lg">
                        {isDeploying ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" /> Redirecting to Stripe...
                            </>
                        ) : (
                            <>
                                <CreditCard className="w-5 h-5" /> Pay & Launch Agent
                            </>
                        )}
                    </span>
                </button>
            </div>
        </div>
    );
}
