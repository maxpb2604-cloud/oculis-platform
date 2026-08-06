"use client";

import { useEffect, useState } from "react";

type MeshGradientComponent = typeof import("@paper-design/shaders-react")["MeshGradient"];

/**
 * Themed mesh-gradient background (Paper Design shaders).
 *
 * Day  → baby-blue field with soft white "bubbles".
 * Night → intense blue field with navy / near-black bubbles.
 *
 * Reacts live to the <html class="dark"> toggle. Reduced-motion and compact-screen users
 * receive a lightweight static CSS fallback, avoiding a permanent GPU/WebGL workload.
 * Sits fixed behind the app at z-0; content rides above on opaque cards.
 */
const DAY_COLORS = [
  "hsl(205, 90%, 86%)", // baby blue base
  "hsl(0, 0%, 100%)", //   white bubble
  "hsl(204, 82%, 92%)", // pale azure
  "hsl(210, 78%, 80%)", // soft sky bubble
];

const NIGHT_COLORS = [
  "hsl(214, 95%, 28%)", // intense blue base
  "hsl(222, 64%, 7%)", //  near-black navy bubble
  "hsl(216, 90%, 38%)", // bright blue
  "hsl(230, 55%, 13%)", // deep navy bubble
];

export function MeshBackground() {
  const [dark, setDark] = useState(false);
  const [renderShader, setRenderShader] = useState(false);
  const [Shader, setShader] = useState<MeshGradientComponent | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compactViewport = window.matchMedia("(max-width: 767px)");
    const syncTheme = () => setDark(el.classList.contains("dark"));
    const syncRendering = () => setRenderShader(!reducedMotion.matches && !compactViewport.matches);

    syncTheme();
    syncRendering();
    const obs = new MutationObserver(syncTheme);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    reducedMotion.addEventListener("change", syncRendering);
    compactViewport.addEventListener("change", syncRendering);
    return () => {
      obs.disconnect();
      reducedMotion.removeEventListener("change", syncRendering);
      compactViewport.removeEventListener("change", syncRendering);
    };
  }, []);

  useEffect(() => {
    if (!renderShader || Shader) return;
    let active = true;
    void import("@paper-design/shaders-react").then((module) => {
      if (active) setShader(() => module.MeshGradient);
    });
    return () => {
      active = false;
    };
  }, [renderShader, Shader]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      {renderShader && Shader ? (
        <Shader
          style={{ height: "100%", width: "100%" }}
          distortion={0.8}
          swirl={0.1}
          offsetX={0}
          offsetY={0}
          scale={1}
          rotation={0}
          speed={0.6}
          colors={dark ? NIGHT_COLORS : DAY_COLORS}
        />
      ) : (
        <div className="mesh-background-fallback h-full w-full" />
      )}
    </div>
  );
}

export default MeshBackground;
