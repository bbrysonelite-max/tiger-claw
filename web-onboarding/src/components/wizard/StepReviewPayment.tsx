"use client";

import { CreditCard, Rocket, Loader2, Bot, Database, Zap } from "lucide-react";
import type { WizardState } from "../OnboardingModal";

interface ReviewPaymentProps {
    state: WizardState;
    isDeploying: boolean;
    onLaunch: () => void;
}

export default function StepReviewPayment({ state, isDeploying, onLaunch }: ReviewPaymentProps) {
    const isTigerCredits = state.connectionType === "tiger_credits";
    const monthlyTotal = isTigerCredits ? "$97.00" : "$47.00"; // BYOK saves $50/mo

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2 text-white">Review & Deploy</h3>
                <p className="text-white/50 text-base leading-relaxed">
                    Almost there. Review your agent configuration before we spin up your dedicated Kubernetes pod.
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
                            <span className="text-white/50">Managed User</span>
                            <span className="text-white font-medium">{state.yourName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-white/50">AI Engine Engine</span>
                            <span className="text-white font-medium flex items-center gap-2">
                                {isTigerCredits ? <Zap className="h-3 w-3 text-primary" /> : <Database className="h-3 w-3 text-[#22c55e]" />}
                                {isTigerCredits ? "Tiger Claw AI" : `${state.aiProvider} (${state.aiModel})`}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Info */}
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                    <p className="text-xs text-primary/80 leading-relaxed text-center">
                        Your agent will be provisioned on a dedicated secure pod. Cancel anytime.
                    </p>
                </div>
            </div>

            <div className="mt-8 flex justify-end">
                <button
                    onClick={onLaunch}
                    disabled={isDeploying}
                    className="w-full relative inline-flex h-14 items-center justify-center overflow-hidden rounded-full font-black px-8 bg-primary text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_30px_rgba(249,115,22,0.5)]"
                >
                    <span className="relative z-10 flex items-center gap-2 text-lg">
                        {isDeploying ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" /> Provisioning K8s Pod...
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
