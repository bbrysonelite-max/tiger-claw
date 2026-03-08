"use client";

import { Suspense } from "react";
import PostPaymentSuccess from "@/components/wizard/PostPaymentSuccess";

function SuccessContent() {
    return (
        <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-zinc-900/50 border border-white/10 rounded-3xl overflow-hidden">
                <PostPaymentSuccess
                    state={{
                        nicheId: "",
                        nicheName: "",
                        botName: "",
                        yourName: "",
                        connectionType: "byok",
                        aiProvider: "google",
                        apiKey: "",
                        aiModel: "gemini-2.5-flash",
                    }}
                    onClose={() => {
                        window.location.href = "/";
                    }}
                />
            </div>
        </div>
    );
}

export default function SuccessPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary" />
            </div>
        }>
            <SuccessContent />
        </Suspense>
    );
}
