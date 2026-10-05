"use client";

import Image from "next/image";
import { useState, useSyncExternalStore } from "react";
import { canAutoplayFilm } from "./film-policy";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
// Not shipped in browsers yet, harmless to ask for.
const REDUCED_DATA = "(prefers-reduced-data: reduce)";

// Network Information API: only Chromium-based browsers have it. Where
// it's missing, saveData is simply false and the film plays.
type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
const connection = () =>
  (navigator as Navigator & { connection?: Connection }).connection;

function subscribe(onChange: () => void) {
  const queries = [matchMedia(REDUCED_MOTION), matchMedia(REDUCED_DATA)];
  const conn = connection();
  queries.forEach((q) => q.addEventListener("change", onChange));
  conn?.addEventListener("change", onChange);
  return () => {
    queries.forEach((q) => q.removeEventListener("change", onChange));
    conn?.removeEventListener("change", onChange);
  };
}

function getSnapshot() {
  const conn = connection();
  return canAutoplayFilm({
    reducedMotion: matchMedia(REDUCED_MOTION).matches,
    reducedData: matchMedia(REDUCED_DATA).matches,
    saveData: conn?.saveData === true,
    effectiveType: conn?.effectiveType,
  });
}

// Server and first client render: poster only. The <video> is only added
// once we know the visitor can take it, so reduced-motion and data-saver
// visitors never download the film at all.
const getServerSnapshot = () => false;

export function HeroFilm() {
  const mayPlay = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [playing, setPlaying] = useState(false);

  return (
    <div className="absolute inset-0 bg-[#2a3f4b]" aria-hidden="true">
      {/* The poster is frame 0 of the film: it paints first (and is the
          page's largest image), and stays put for anyone who doesn't get
          the video, or if the browser refuses to autoplay. */}
      <Image
        src="/video/hero-poster.jpg"
        alt=""
        fill
        preload
        sizes="100vw"
        className="object-cover"
      />
      {mayPlay && (
        <video
          ref={(el) => {
            if (!el) return;
            // React doesn't reliably emit the muted attribute, and
            // browsers only autoplay muted video — set it explicitly.
            el.muted = true;
            el.play().catch(() => {
              // Autoplay refused (e.g. low-power mode): poster stays.
            });
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
            playing ? "opacity-100" : "opacity-0"
          }`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
        >
          <source src="/video/hero.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  );
}
