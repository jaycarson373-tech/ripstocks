"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import type { StockToken } from "@/app/lib/stock-tokens";
import type { RarityTier } from "@/app/lib/rarity";
import { CASE_REVEAL_TIMING, CASE_WINNER_INDEX, PACK_OPENING_INTRO_MS, fixedReelPosition } from "@/app/lib/case-reel";

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
  const [introDone, setIntroDone] = useState(false);
  const [phase, setPhase] = useState<"spinning" | "landed" | "revealed">("spinning");
  const track = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);
  const skipped = useRef(false);
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
    let frame = 0;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let started: number | null = null;
    if (!introDone) return;
    const paint = (now: number) => {
      const element = track.current;
      const card = element?.firstElementChild as HTMLElement | null;
      if (!element || !card) return;
      if (started === null) started = now;
      const elapsed = reduced.current || skipped.current ? CASE_REVEAL_TIMING.spinMs : now - started;
      const width = card.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(element).gap) || 0;
      element.style.transform = `translate3d(${-fixedReelPosition(elapsed) * (width + gap) - width / 2}px,0,0)`;
      if (elapsed >= CASE_REVEAL_TIMING.spinMs) {
        setPhase("landed");
        revealTimer = setTimeout(() => setPhase("revealed"), reduced.current || skipped.current ? 0 : CASE_REVEAL_TIMING.lockMs);
        return;
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => { cancelAnimationFrame(frame); clearTimeout(revealTimer); };
  }, [introDone]);

  return <div className={`hero-pack-result continuous-opening reveal-${!introDone ? "pack" : phase === "revealed" && result ? "reveal" : phase !== "spinning" ? "lock" : "spin"}`} style={{ "--winning-rarity": result?.rarity.color || "var(--lime)" } as CSSProperties} aria-live="polite">
    {result && phase !== "revealed" && <button type="button" className="skip-reveal" onClick={() => { skipped.current = true; setIntroDone(true); }}>SKIP ANIMATION</button>}
    {!introDone && <div className="pack-opening-intro"><span>OPENING PACK…</span><Image className="opening-pack-art" src="/stonkrips-pack-transparent.png" alt="StonkRips pack opening" width={1024} height={1536} /></div>}
    <div className="hero-case-reel">
      <div className="case-reveal-header"><span>OPENING PACK…</span><b>{result ? "RESULT CONFIRMED" : "PAYMENT CONFIRMED"}</b></div>
      <div className="case-reel-window">
        <div className="case-reel-marker" aria-hidden="true"><i/><span/></div>
        <div className="case-reel-track" ref={track}>
          {tiles.map((tile, index) => {
            const sealed = !result && index === CASE_WINNER_INDEX;
            const winning = Boolean(result && index === CASE_WINNER_INDEX);
            const item = winning && result ? result : tile;
            return <div key={index} data-winning={winning ? "true" : undefined} className={`case-reel-card${winning ? " is-winning" : sealed ? " is-sealed" : ""}`} style={{ "--rarity-color": sealed ? "var(--lime)" : item.rarity?.color || "var(--muted)" } as CSSProperties}>
              {sealed ? <><Image src="/stonkrips-pack-transparent.png" alt="Sealed result" width={64} height={96} /><b>SEALED</b><small>RESULT PENDING</small></> : <>{renderLogo(item.stock)}<b>{item.stock.symbol}</b><small>{item.rarity?.label || "STOCK TOKEN"}</small></>}
            </div>;
          })}
        </div>
      </div>
      {waiting && <p className="opening-retry" role="status">Delivery is delayed. Still checking your paid pack—no extra payment needed.</p>}
    </div>
    {phase === "revealed" && result && children}
  </div>;
}
