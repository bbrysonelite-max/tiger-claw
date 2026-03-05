"use client";

import { motion } from "framer-motion";
import { Briefcase, Building2, Home, HeartPulse, MoreHorizontal, ArrowRight } from "lucide-react";

interface NichePickerProps {
    selectedId: string;
    onSelect: (id: string, name: string) => void;
    onNext: () => void;
}

const niches = [
    { id: "network_marketing", name: "Network Marketing", icon: <Briefcase /> },
    { id: "airbnb", name: "Airbnb / STR", icon: <Building2 /> },
    { id: "real_estate", name: "Real Estate", icon: <Home /> },
    { id: "healthcare", name: "Healthcare", icon: <HeartPulse /> },
    { id: "other", name: "Other", icon: <MoreHorizontal /> },
];

export default function StepNichePicker({ selectedId, onSelect, onNext }: NichePickerProps) {
    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="mb-8">
                <h3 className="text-2xl font-bold mb-2 text-white">Select Your Industry</h3>
                <p className="text-white/50 text-base leading-relaxed">
                    We will pre-load your agent with a customized persona, FAQs, and qualifying questions tailored specifically for your niche.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                {niches.map((niche) => (
                    <button
                        key={niche.id}
                        onClick={() => onSelect(niche.id, niche.name)}
                        className={`
              flex flex-col items-center justify-center p-6 rounded-2xl border transition-all
              ${selectedId === niche.id
                                ? "bg-primary/10 border-primary text-primary shadow-[0_0_30px_rgba(249,115,22,0.15)] ring-1 ring-primary/50"
                                : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20"}
            `}
                    >
                        <div className={`
              w-12 h-12 rounded-full flex items-center justify-center mb-4 transition-colors
              ${selectedId === niche.id ? "bg-primary/20" : "bg-white/5"}
            `}>
                            {niche.icon}
                        </div>
                        <span className="font-semibold text-lg">{niche.name}</span>
                    </button>
                ))}
            </div>

            <div className="mt-8 flex justify-end">
                <button
                    onClick={onNext}
                    disabled={!selectedId}
                    className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-full font-bold px-8 bg-primary text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                    <span className="relative z-10 flex items-center gap-2">
                        Continue <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                </button>
            </div>
        </div>
    );
}
