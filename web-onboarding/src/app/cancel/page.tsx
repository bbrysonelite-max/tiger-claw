"use client";

import { ArrowLeft } from "lucide-react";

// Stripe cancel_url lands here when a customer exits Checkout without paying.
// Show a friendly message and return them to the home page.
export default function CancelPage() {
    return (
        <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
            <div className="w-full max-w-md text-center">
                <div className="h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6">
                    <span className="text-2xl">↩️</span>
                </div>
                <h1 className="text-2xl font-bold mb-3">Payment Cancelled</h1>
                <p className="text-white/50 leading-relaxed mb-8">
                    No worries — you weren't charged. Your agent setup progress is saved. Come back whenever you're ready.
                </p>
                <a
                    href="/"
                    className="inline-flex items-center gap-2 font-bold px-6 py-3 rounded-full bg-primary text-black hover:scale-105 active:scale-95 transition-all"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Home
                </a>
            </div>
        </div>
    );
}
