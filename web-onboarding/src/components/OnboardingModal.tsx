"use client";

import { useState } from "react";
import { X, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Wizard Steps
import StepNichePicker from "./wizard/StepNichePicker";
import StepIdentity from "./wizard/StepIdentity";
import StepAIConnection from "./wizard/StepAIConnection";
import StepReviewPayment from "./wizard/StepReviewPayment";
import PostPaymentSuccess from "./wizard/PostPaymentSuccess";

export interface WizardState {
    nicheId: string;
    nicheName: string;
    botName: string;
    yourName: string;
    connectionType: "tiger_credits" | "byok";
    aiProvider: string;
    apiKey: string;
    aiModel: string;
    stripeSessionId?: string;
}

const initialState: WizardState = {
    nicheId: "",
    nicheName: "",
    botName: "",
    yourName: "",
    connectionType: "tiger_credits",
    aiProvider: "openai",
    apiKey: "",
    aiModel: "gpt-4o",
};

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
    const [step, setStep] = useState(1);
    const [state, setState] = useState<WizardState>(initialState);
    const [isDeploying, setIsDeploying] = useState(false);
    const [deploymentComplete, setDeploymentComplete] = useState(false);

    const totalSteps = 4;

    const handleNext = () => {
        if (step < totalSteps) setStep(step + 1);
    };

    const handleBack = () => {
        if (step > 1) setStep(step - 1);
    };

    const updateState = (updates: Partial<WizardState>) => {
        setState((prev) => ({ ...prev, ...updates }));
    };

    const handleLaunch = async () => {
        // Phase 2 MVP: Simulate Stripe Checkout / API logic
        setIsDeploying(true);
        setTimeout(() => {
            setIsDeploying(false);
            setDeploymentComplete(true);
        }, 2000);
    };

    if (deploymentComplete) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
                <div className="w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden glass-card shadow-2xl relative">
                    <PostPaymentSuccess state={state} onClose={onClose} />
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden glass-card shadow-2xl relative my-auto"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <div className="flex items-center gap-4">
                        {step > 1 && !isDeploying && (
                            <button
                                onClick={handleBack}
                                className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/70 hover:text-white"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        )}
                        <div>
                            <h2 className="font-bold text-xl">Agent Setup</h2>
                            <div className="text-white/50 text-sm mt-1">
                                Step {step} of {totalSteps}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isDeploying}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white disabled:opacity-50"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-white/5 h-1">
                    <div
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{ width: `${(step / totalSteps) * 100}%` }}
                    />
                </div>

                {/* Step Content */}
                <div className="p-8 min-h-[400px]">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                        >
                            {step === 1 && (
                                <StepNichePicker
                                    selectedId={state.nicheId}
                                    onSelect={(id, name) => {
                                        updateState({ nicheId: id, nicheName: name });
                                    }}
                                    onNext={handleNext}
                                />
                            )}
                            {step === 2 && (
                                <StepIdentity
                                    state={state}
                                    updateState={updateState}
                                    onNext={handleNext}
                                />
                            )}
                            {step === 3 && (
                                <StepAIConnection
                                    state={state}
                                    updateState={updateState}
                                    onNext={handleNext}
                                />
                            )}
                            {step === 4 && (
                                <StepReviewPayment
                                    state={state}
                                    isDeploying={isDeploying}
                                    onLaunch={handleLaunch}
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
}
