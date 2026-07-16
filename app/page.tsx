"use client";

import { useEffect, useState } from "react";
import { AIRDROP_INTERVAL_MINUTES, emptySnapshot, type ProtocolSnapshot } from "@/lib/protocol";

const stocks = [
  { ticker: "AAPLx", name: "Apple", color: "#f2f2ee", ink: "#090909" },
  { ticker: "NVDAx", name: "Nvidia", color: "#76e247", ink: "#071407" },
  { ticker: "TSLAx", name: "Tesla", color: "#ef3d4c", ink: "#fff" },
  { ticker: "HOODx", name: "Robinhood", color: "#c9ff38", ink: "#111" },
  { ticker: "GME x", name: "GameStop", color: "#ff593d", ink: "#fff" },
  { ticker: "CRCLx", name: "Circle", color: "#6c8cff", ink: "#fff" },
];

const recent = [
  ["9Kp…w21", "$30", "NVDAx", "$34.82", "+16.1%"],
  ["H7m…Q4z", "$10", "AAPLx", "$11.07", "+10.7%"],
  ["3Fx…aV8", "$50", "HOODx", "$63.40", "+26.8%"],
  ["Bq2…L9n", "$10", "TSLAx", "$9.72", "-2.8%"],
];
export default function Home() {
  const [tier, setTier] = useState(10);
  const [wallet, setWallet] = useState("");
  const [spectating, setSpectating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<(typeof stocks)[number] | null>(null);
  const [walletError, setWalletError] = useState("");
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot>(emptySnapshot());
  const [seconds, setSeconds] = useState(AIRDROP_INTERVAL_MINUTES*60);
  useEffect(() => { let offset=0; let end=Date.parse(snapshot.epochEndsAt); const load=async()=>{try{const r=await fetch("/api/protocol",{cache:"no-store"});const data=await r.json() as ProtocolSnapshot;offset=Date.parse(data.serverNow)-Date.now();end=Date.parse(data.epochEndsAt);setSnapshot(data)}catch{}}; load(); const refresh=window.setInterval(load,15000); const tick=window.setInterval(()=>setSeconds(Math.max(0,Math.ceil((end-(Date.now()+offset))/1000))),250); return()=>{window.clearInterval(tick);window.clearInterval(refresh)}; }, []);
  const countdown=`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;

  async function connect() {
    const provider = (window as Window & { solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }> } }).solana;
    if (provider) {
      try { setWallet((await provider.connect()).publicKey.toString()); setWalletError(""); return; } catch { setWalletError("Wallet connection was cancelled."); return; }
    }
    setWalletError("No Solana wallet detected. Install Phantom or Backpack, then reload.");
  }

  function openPack() {
    setWalletError("Mainnet checkout is not configured yet. No USDC was charged.");
  }

  return (
    <main>
      <div className="grain" />
      <nav className="nav wrap">
        <a className="brand brandImage" href="#top" aria-label="RipStocks home"><img src="/ripstocks-logo.jpg" alt=""/><span><em>rip</em>stocks</span><i>β</i></a>
        <div className="navlinks"><a href="#packs">Packs</a><a href="#live">Live rips</a><a href="#flywheel">Flywheel</a></div>
        <button className="wallet" onClick={connect}>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)}` : "CONNECT WALLET"}<span>↗</span></button>
      </nav>

      <div className="brandBanner wrap"><img src="/ripstocks-banner.jpg" alt="RipStocks — tokenized stock packs"/></div>
      <section className="hero wrap" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> LIVE ON SOLANA</div>
          <h1>RIP IT.<br/><em>OWN IT.</em></h1>
          <p>Rip a stock pack. Hold for stock pack airdrops every {AIRDROP_INTERVAL_MINUTES} minutes.</p>
          <p className="heroSupport">75% of protocol fees fund holder drops. 25% increases pack expected value.</p>
          <div className="heroActions"><a className="primary" href="#packs">RIP A PACK <b>↓</b></a><button className="textBtn" onClick={() => setSpectating(true)}>SPECTATE LIVE <span>●</span></button></div>
          <div className="proof"><div><b>75/25</b><span>PROTOCOL FEE SPLIT</span></div><div className="nextDrop"><b>{countdown}</b><span>NEXT HOLDER DROP</span></div><div><b>{AIRDROP_INTERVAL_MINUTES}M</b><span>SYNCHRONIZED</span></div></div>
        </div>
        <div className="machine" aria-label="Animated pack ripping machine">
          <div className="machineTop"><span>RIP-O-MATIC</span><i>ONLINE</i></div>
          <div className="window">
            <div className="glow" />
            <img className="heroPackImage" src="/ripstocks-logo.jpg" alt="RipStocks sealed stock pack"/>
            <div className="claw">⌄</div>
          </div>
          <div className="belt">{[1,2,3,4,5,6].map(n=><span key={n} />)}</div>
          <div className="machineBase"><span>USDC IN</span><b>→</b><span>xSTOCKS OUT</span></div>
        </div>
      </section>

      <div className="ticker"><div>{[...stocks,...stocks].map((s,i)=><span key={i}><b>{s.ticker}</b> {s.name} <i>◆</i></span>)}</div></div>

      <section className="packs wrap" id="packs">
        <div className="liveStats">{[["PACK INVENTORY VALUE",snapshot.packInventoryValue],["HOLDER AIRDROP TREASURY",snapshot.holderAirdropTreasury],["CURRENT PACK EV",snapshot.currentPackEv],["PACKS REMAINING",snapshot.packsRemaining],["TOTAL PACKS OPENED",snapshot.totalPacksOpened],["TOTAL HOLDER DROPS",snapshot.totalHolderDrops],["VALUE AIRDROPPED",snapshot.totalValueAirdropped]].map(([label,value],i)=><div key={String(label)}><span>{label}</span><b>{i<3||i===6?`$${Number(value).toFixed(2)}`:Number(value).toLocaleString()}</b></div>)}</div>
        <div className="sectionHead"><div><span className="kicker">CHOOSE YOUR RIP</span><h2>Launch pack.<br/>One stock pull.</h2></div><p>The $10 launch pack contains exactly one randomized xStock available on Solana. You pay in USDC. The pull lands in your wallet.</p></div>
        <div className="packGrid">
          {[10,30,50].map((price, i)=>{const available=price===10; const inventory=available?snapshot.packsRemaining:0; return <button key={price} disabled={!available} onClick={()=>available&&setTier(price)} className={`packCard p${price} ${tier===price?"selected":""} ${!available?"unavailable":""}`}>
            <span className="chance">{i===0?"THE QUICK RIP":i===1?"CROWD FAVORITE":"THE BIG RIP"}</span>
            <span className={`inventory ${inventory===0?"empty":""}`}>{inventory} PACKS LEFT</span>
            <div className="miniPack photoPack"><img src="/ripstocks-logo.jpg" alt=""/><i>{price}</i></div>
            <div className="packMeta"><div><b>${price}</b><span>USDC</span></div><p>{i===0?"1 Stock Pull":"Premium Pulls"}<br/>{available&&<>Expected Value <strong className="evValue">${snapshot.currentPackEv.toFixed(2)}</strong><br/></>}<em>{available?"Instant Delivery":"Projected EV · Coming Soon"}</em></p></div>
            {tier===price && <span className="chosen">SELECTED ✓</span>}
            {!available && <span className="soldOut">UNAVAILABLE</span>}
          </button>})}
        </div>
        <div className="ripBar">
          <div><span>YOUR PACK</span><b>${tier} RIP</b></div><div><span>PAY WITH</span><b>USDC <i>◎</i></b></div><button onClick={wallet?openPack:connect}>{wallet?`RIP THE $${tier} PACK`:`CONNECT TO RIP`} <span>→</span></button>
        </div>
        {walletError && <div className="walletNotice" role="alert">{walletError}</div>}
      </section>

      <section className="live" id="live"><div className="wrap">
        <div className="liveHead"><div><span className="liveDot"/> LIVE RIPS</div><p>Every tear. Every pull. Onchain.</p><button onClick={()=>setSpectating(!spectating)}>{spectating?"WATCHING LIVE":"SPECTATE"} ◉</button></div>
        <div className="table"><div className="tr labels"><span>RIPPER</span><span>PACK</span><span>PULLED</span><span>VALUE</span><span>EV</span></div>{recent.map((r,i)=><div className="tr" key={i}><span><i className={`avatar a${i}`}/>{r[0]}</span><span>{r[1]}</span><span><b>{r[2]}</b></span><span>{r[3]}</span><span className={r[4].startsWith("+")?"up":"down"}>{r[4]}</span></div>)}</div>
      </div></section>

      <section className="fly wrap" id="flywheel"><span className="kicker">HOW IT WORKS</span><h2>Two systems.<br/><em>One clear flywheel.</em></h2><div className="protocolSteps">{[["01","RIP A PACK","Open a $10 stock pack and instantly receive one tokenized stock."],["02","RESTOCK INVENTORY","Pack-sale USDC purchases new stocks only for future paid packs."],["03","SPLIT PROTOCOL FEES","75% funds Holder Airdrops. 25% increases Pack Expected Value."],["04",`EVERY ${AIRDROP_INTERVAL_MINUTES} MINUTES`,"One eligible holder receives a free stock pack from the Holder Airdrop Treasury."],["05","PROOF","The reward is delivered immediately and proof is published on-chain."]].map(s=><div className="hourStep" key={s[0]}><b>{s[0]}</b><span>{s[1]}</span><p>{s[2]}</p></div>)}</div>
      <div className="dropProof"><div className="proofTitle"><div><span className="liveDot"/> HOLDER DROP PROOF</div><b>NEXT DRAW {countdown}</b></div><div className="proofRows"><div className="proofRow proofLabels"><span>WINNER</span><span>PACK</span><span>STOCK RECEIVED</span><span>REWARD VALUE</span><span>TIME</span><span>TRANSACTION PROOF</span></div>{snapshot.proofs.map((a,i)=><div className="proofRow" key={a.signature||i}><span>{a.winner}</span><span>{a.pack}</span><span><b>{a.stock}</b></span><span>${a.value.toFixed(2)}</span><span>{new Date(a.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span><a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noreferrer">{a.signature.slice(0,4)}…{a.signature.slice(-3)} ↗</a></span></div>)}{snapshot.proofs.length===0&&<div className="emptyProof">No holder drops published yet.</div>}</div></div><p className="disclaimer">Pack-sale USDC belongs only to Pack Inventory and never funds holder drops. Protocol fees are recorded separately: 75% to the Holder Airdrop Treasury and 25% to the Pack EV Reserve. EV is a statistical expected value calculated from remaining inventory; it is not a promise of profit.</p></section>

      <footer><div className="wrap"><div className="brand brandImage"><img src="/ripstocks-logo.jpg" alt=""/><span><em>rip</em>stocks</span></div><p>RIP. PULL. REPEAT.</p><div><a href="#packs">PACKS</a><a href="#live">LIVE</a><a href="#flywheel">HOW IT WORKS</a></div><span>BUILT ON SOLANA ◈</span></div></footer>

      {(opening||result) && <div className="modal" role="dialog" aria-modal="true"><div className={`reveal ${opening?"opening":""}`}>
        <button className="close" onClick={()=>{setOpening(false);setResult(null)}}>×</button>
        {opening ? <><span className="kicker">RIPPING ONCHAIN</span><div className="ripAnim"><div className="pack"><strong>RIP<br/>STOCKS</strong></div></div><p>VERIFYING PULL…</p></> : result && <><span className="kicker">YOU PULLED</span><div className="stockResult" style={{background:result.color,color:result.ink}}><small>xSTOCK</small><b>{result.ticker}</b><span>{result.name}</span></div><h3>${(tier*1.14).toFixed(2)} OF {result.name.toUpperCase()}</h3><p>Delivered to {wallet.slice(0,4)}…{wallet.slice(-4)}</p><div className="instantProof"><span>PROOF</span><b>Posts instantly after mainnet confirmation ↗</b></div><button className="primary" onClick={()=>setResult(null)}>RIP ANOTHER →</button></>}
      </div></div>}
    </main>
  );
}
