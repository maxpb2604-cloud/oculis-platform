"use client";

import { MeshBackground } from "@/components/ui/background-shader";

/**
 * Standalone showcase for the themed mesh-gradient background.
 * White hero text rides above the gradient (z-10). Not wired into app routes —
 * the app itself uses <MeshBackground /> directly via AppShell.
 */
export default function BackgroundShaderDemo() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <MeshBackground />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <div className="mx-auto w-full max-w-2xl space-y-8 text-center">
          <h1 className="py-[23px] text-4xl font-semibold tracking-tight text-white drop-shadow-2xl md:text-6xl">
            Oculis Auribus
          </h1>
        </div>
      </main>
    </div>
  );
}
