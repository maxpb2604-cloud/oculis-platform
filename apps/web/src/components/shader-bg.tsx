"use client";

/**
 * Subtle ambient background — flowing FHC-blue bands rendered in raw WebGL (no
 * three.js dependency). Sits fixed behind the app at low opacity so content stays on
 * opaque cards and fully readable. Honors prefers-reduced-motion (renders one static
 * frame). Silently no-ops if WebGL is unavailable.
 */
import { useEffect, useRef } from "react";

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
void main(){
  vec2 p = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float t = u_time;
  float a = 0.0;
  a += 0.010 / abs(p.y          + sin((p.x * 1.1 + t)        * 1.0) * 0.45);
  a += 0.008 / abs(p.y + 0.55   + sin((p.x * 0.8 - t * 0.7)  * 1.2) * 0.40);
  a += 0.007 / abs(p.y - 0.60   + sin((p.x * 0.6 + t * 0.5)  * 0.9) * 0.50);
  a = clamp(a, 0.0, 0.42);
  vec3 col = mix(vec3(0.055, 0.30, 0.55), vec3(0.16, 0.60, 0.85), clamp(p.x * 0.5 + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
}`;

export function ShaderBg() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true }) as WebGLRenderingContext | null;
    } catch {
      return;
    }
    if (!gl) return;
    const ctx = gl;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const compile = (type: number, src: string) => {
      const s = ctx.createShader(type)!;
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
      return s;
    };
    const prog = ctx.createProgram()!;
    ctx.attachShader(prog, compile(ctx.VERTEX_SHADER, VERT));
    ctx.attachShader(prog, compile(ctx.FRAGMENT_SHADER, FRAG));
    ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) return;
    ctx.useProgram(prog);

    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    const loc = ctx.getAttribLocation(prog, "p");
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);

    const uRes = ctx.getUniformLocation(prog, "u_res");
    const uTime = ctx.getUniformLocation(prog, "u_time");
    ctx.enable(ctx.BLEND);
    ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      ctx.uniform2f(uRes, canvas.width, canvas.height);
      ctx.uniform1f(uTime, (now - start) * 0.0004);
      ctx.clearColor(0, 0, 0, 0);
      ctx.clear(ctx.COLOR_BUFFER_BIT);
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full"
      style={{ zIndex: 0, opacity: 0.5 }}
    />
  );
}
