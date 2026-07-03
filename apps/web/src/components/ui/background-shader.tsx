"use client";

import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

/**
 * Themed mesh-gradient background (Paper Design shaders).
 *
 * Day  → baby-blue field with soft white "bubbles".
 * Night → intense blue field with navy / near-black bubbles.
 *
 * Reacts live to the <html class="dark"> toggle and honors prefers-reduced-motion
 * (freezes the animation). Sits fixed behind the app at z-0; content rides above on
 * opaque cards, so readability is unaffected.
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
  const [reduce, setReduce] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    setReduce(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    // Pause the WebGL animation when the tab is hidden — a background dashboard
    // tab must not keep the GPU busy.
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      obs.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <MeshGradient
        style={{ height: "100%", width: "100%" }}
        distortion={0.8}
        swirl={0.1}
        offsetX={0}
        offsetY={0}
        scale={1}
        rotation={0}
        speed={reduce || hidden ? 0 : 0.25}
        colors={dark ? NIGHT_COLORS : DAY_COLORS}
      />
    </div>
  );
}

export default MeshBackground;
