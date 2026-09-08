"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import type { StockToken } from "@/app/lib/stock-tokens";
import type { RarityTier } from "@/app/lib/rarity";
import { PACK_OPENING_INTRO_MS, planReelLanding, reelPositionAt } from "@/app/lib/case-reel";

type Tile = { stock: StockToken; rarity: RarityTier | null };
type Outcome = { stock: StockToken; rarity: RarityTier; transactionHash: string };

export function PackOpening({ preview, result, renderLogo, children, delayed = false }: {
  preview: Tile[];
  result: Outcome | null;
  renderLogo: (stock: StockToken) => ReactNode;
  children: ReactNode;
  delayed?: boolean;
}) {
  // Hold the purchase-time preview steady through inventory refreshes.
  const [tiles] = useState(() => Array.from({ length: 64 }, (_, i) => preview[i % preview.length]));
  const [cycle] = useState(() => preview.length);
  const [introDone, setIntroDone] = useState(false);
  const [phase, setPhase] = useState<"spinning" | "landing" | "landed" | "revealed">("spinning");
  const [landing, setLanding] = useState<{ index: number; durationMs: number; start: number } | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const position = useRef(10);
  const replay = useRef(Boolean(result));
  const reduced = useRef(false);
  const skipped = useRef(false);
  const spinStartedAt = useRef<number | null>(null);
  const waiting = delayed && !result;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = preference.matches;
    const change = () => { reduced.current = preference.matches; };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setIntroDone(true), reduced.current ? 0 : PACK_OPENING_INTRO_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!result || !introDone) return;
    const frame = requestAnimationFrame(() => {
      const elapsed = spinStartedAt.current === null ? 0 : performance.now() - spinStartedAt.current;
      const plan = planReelLanding(position.current, replay.current, elapsed);
      setLanding({ ...plan, start: position.current });
      setPhase("landing");
    });
    return () => cancelAnimationFrame(frame);
  }, [result, introDone]);

  useEffect(() => {
    let frame = 0;
    let started: number | null = null;
    let previous: number | null = null;
    let landed = false;
    if (!introDone) return;
    const paint = (now: number) => {
      const element = track.current;
      const card = element?.firstElementChild as HTMLElement | null;
      if (!element || !card) return;
      if (started === null) started = now;
      if (spinStartedAt.current === null) spinStartedAt.current = now;
      const dt = previous === null ? 0 : Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const elapsed = now - started;
      if (landing) {
        const progress = reduced.current || skipped.current ? 1 : elapsed / landing.durationMs;
        position.current = reelPositionAt(landing.start, landing.index, progress);
        if (progress >= 1 && !landed) { landed = true; setPhase("landed"); }
        if (progress >= 1 && (reduced.current || skipped.current || elapsed >= landing.durationMs + 200)) {
          setPhase("revealed");
          return;
        }
      } else if (!reduced.current) {
        // One continuous pass while the chain works: fast initially, then cruising.
        const speed = 4 + 14 * Math.exp(-elapsed / 2200);
        position.current = 10 + ((position.current - 10 + speed * dt) % cycle);
      }
      const width = card.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(element).gap) || 0;
      element.style.transform = `translate3d(${-position.current * (width + gap) - width / 2}px,0,0)`;
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [landing, cycle, introDone]);

  return <div className={`hero-pack-result continuous-opening reveal-${!introDone ? "pack" : phase === "revealed" ? "reveal" : phase === "landed" ? "lock" : "spin"}`} style={{ "--winning-rarity": result?.rarity.color || "var(--lime)" } as CSSProperties} aria-live="polite">
    {result && phase !== "revealed" && <button type="button" className="skip-reveal" onClick={() => { skipped.current = true; setIntroDone(true); }}>SKIP ANIMATION</button>}
    {!introDone && <div className="pack-opening-intro"><span>OPENING PACK…</span><Image className="opening-pack-art" src="/stonkrips-pack-transparent.png" alt="StonkRips pack opening" width={1024} height={1536} /></div>}
    <div className="hero-case-reel">
      <div className="case-reveal-header"><span>OPENING PACK…</span><b>{result ? "RESULT CONFIRMED" : "PAYMENT CONFIRMED"}</b></div>
      <div className="case-reel-window">
        <div className="case-reel-marker" aria-hidden="true"><i/><span/></div>
        <div className="case-reel-track" ref={track}>
          {tiles.map((tile, index) => {
            const winning = Boolean(result && landing?.index === index);
            const item = winning && result ? result : tile;
            return <div key={index} data-winning={winning ? "true" : undefined} className={`case-reel-card${winning ? " is-winning" : ""}`} style={{ "--rarity-color": item.rarity?.color || "var(--muted)" } as CSSProperties}>
              {renderLogo(item.stock)}<b>{item.stock.symbol}</b><small>{item.rarity?.label || "STOCK TOKEN"}</small>
            </div>;
          })}
        </div>
      </div>
      {waiting && <p className="opening-retry" role="status">Delivery is delayed. Still checking your paid pack—no extra payment needed.</p>}
    </div>
    {phase === "revealed" && children}
  </div>;
}
