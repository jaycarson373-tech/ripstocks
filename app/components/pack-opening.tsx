"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import type { StockToken } from "@/app/lib/stock-tokens";
import type { RarityTier } from "@/app/lib/rarity";
import { CASE_REVEAL_TIMING, CASE_WINNER_INDEX, PACK_OPENING_INTRO_MS, fixedReelPosition } from "@/app/lib/case-reel";
import { playCaseTick, primeCaseAudio } from "@/app/lib/case-audio";

type Tile = { stock: StockToken; rarity: RarityTier | null };
type Outcome = { stock: StockToken; rarity: RarityTier };

export function PackOpening({ preview, result, delivered, renderLogo, children }: {
  preview: Tile[];
  result: Outcome | null;
  renderLogo: (stock: StockToken) => ReactNode;
  children: ReactNode;
  delivered: boolean;
}) {
  // Hold the purchase-time preview steady through inventory refreshes.
  const [tiles] = useState(() => Array.from({ length: 96 }, (_, i) => preview[i % preview.length]));
  const [spinStarted, setSpinStarted] = useState(false);
  const [phase, setPhase] = useState<"spinning" | "landed" | "revealed">("spinning");
  const [muted, setMuted] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);
  const skipped = useRef(false);
  const mutedRef = useRef(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = preference.matches;
    const change = () => { reduced.current = preference.matches; };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setSpinStarted(true), reduced.current ? 0 : PACK_OPENING_INTRO_MS);
    return () => clearTimeout(timer);
  }, [result?.stock.symbol]);

  useEffect(() => {
    let frame = 0;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let started: number | null = null;
    if (!spinStarted || !result) return;
    let previousTile = 3;
    const paint = (now: number) => {
      const element = track.current;
      const card = element?.firstElementChild as HTMLElement | null;
      if (!element || !card) return;
      if (started === null) started = now;
      const elapsed = reduced.current || skipped.current ? CASE_REVEAL_TIMING.spinMs : now - started;
      const reelPosition = fixedReelPosition(elapsed);
      const width = card.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(element).gap) || 0;
      element.style.transform = `translate3d(${-reelPosition * (width + gap) - width / 2}px,0,0)`;
      const currentTile = Math.floor(reelPosition);
      if (currentTile > previousTile) {
        playCaseTick(elapsed / CASE_REVEAL_TIMING.spinMs, mutedRef.current);
        previousTile = currentTile;
      }
      if (elapsed >= CASE_REVEAL_TIMING.spinMs) {
        playCaseTick(1, mutedRef.current, true);
        setPhase("landed");
        revealTimer = setTimeout(() => setPhase("revealed"), reduced.current || skipped.current ? 0 : CASE_REVEAL_TIMING.lockMs);
        return;
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => { cancelAnimationFrame(frame); clearTimeout(revealTimer); };
  }, [spinStarted, result?.stock.symbol]);

  const revealDelivered = phase === "revealed" && delivered;
  return <div className={`hero-pack-result continuous-opening reveal-${!spinStarted ? "pack" : revealDelivered ? "reveal" : phase !== "spinning" ? "lock" : "spin"}`} style={{ "--winning-rarity": result?.rarity.color || "var(--lime)" } as CSSProperties} aria-live="polite">
    {result && phase !== "revealed" && <button type="button" className="skip-reveal" onClick={() => { skipped.current = true; setSpinStarted(true); }}>SKIP ANIMATION</button>}
    <button type="button" className="case-sound-toggle" aria-pressed={!muted} onClick={() => { const next = !muted; setMuted(next); mutedRef.current = next; if (!next) primeCaseAudio(); }}>{muted ? "SOUND OFF" : "SOUND ON"}</button>
    {!spinStarted && <div className={`pack-opening-intro${result ? " result-ready" : ""}`}><span>OPENING PACK…</span><Image className="opening-pack-art" src="/stonkrips-pack-transparent.png" alt="StonkRips pack opening" width={1024} height={1536} /></div>}
    <div className="hero-case-reel">
      <div className="case-reveal-header"><span>OPENING PACK…</span><b>{result ? "RESULT CONFIRMED" : "PAYMENT CONFIRMED"}</b></div>
      <div className="case-reel-window">
        <div className="case-reel-marker" aria-hidden="true"><i/><span/></div>
        <div className="case-reel-track" ref={track}>
          {tiles.map((tile, index) => {
            const winning = Boolean(result && index === CASE_WINNER_INDEX);
            const item = winning && result ? result : tile;
            return <div key={index} data-winning={winning ? "true" : undefined} className={`case-reel-card${winning ? " is-winning" : ""}`} style={{ "--rarity-color": item.rarity?.color || "var(--muted)" } as CSSProperties}>
              {renderLogo(item.stock)}<b>{item.stock.symbol}</b><small>{item.rarity?.label || "STOCK TOKEN"}</small>
            </div>;
          })}
        </div>
      </div>
      {phase === "revealed" && !delivered && <p className="opening-retry" role="status">DELIVERING TO WALLET…</p>}
    </div>
    {revealDelivered && children}
  </div>;
}
