"use client";

import { useEffect, useMemo, useState } from "react";

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
const airdrops = [["14:00","7sK…Pq9","NVDAx","$18.42","5fW…oR2"],["13:00","B2m…xL8","AAPLx","$11.06","3kA…Vn7"],["12:00","H8q…cY1","HOODx","$22.75","9jT…mP4"]];

export default function Home() {
  const [tier, setTier] = useState(30);
  const [wallet, setWallet] = useState("");
  const [spectating, setSpectating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<(typeof stocks)[number] | null>(null);
  const [walletError, setWalletError] = useState("");
  const [seconds, setSeconds] = useState(3600);
  const pick = useMemo(() => stocks[(tier / 10 + 1) % stocks.length], [tier]);
  useEffect(() => { const tick=()=>setSeconds(3600-(new Date().getMinutes()*60+new Date().getSeconds())); tick(); const timer=window.setInterval(tick,1000); return()=>window.clearInterval(timer); }, []);
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
        <a className="brand" href="#top" aria-label="RipStocks home"><span className="ripmark">R</span><span>RIPSTOCKS</span><i>β</i></a>
        <div className="navlinks"><a href="#packs">Packs</a><a href="#live">Live rips</a><a href="#flywheel">Flywheel</a></div>
        <button className="wallet" onClick={connect}>{wallet ? `${wallet.slice(0,4)}…${wallet.slice(-4)}` : "CONNECT WALLET"}<span>↗</span></button>
      </nav>

      <section className="hero wrap" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> LIVE ON SOLANA</div>
          <h1>RIP IT.<br/><em>OWN IT.</em></h1>
          <p>Crack a pack. Pull tokenized stocks. Straight to your wallet.</p>
          <div className="heroActions"><a className="primary" href="#packs">RIP A PACK <b>↓</b></a><button className="textBtn" onClick={() => setSpectating(true)}>SPECTATE LIVE <span>●</span></button></div>
          <div className="proof"><div><b>100%</b><span>FEES → STOCKS</span></div><div><b>{countdown}</b><span>NEXT AIRDROP</span></div><div><b>24/7</b><span>PROOF POSTED</span></div></div>
        </div>
        <div className="machine" aria-label="Animated pack ripping machine">
          <div className="machineTop"><span>RIP-O-MATIC</span><i>ONLINE</i></div>
          <div className="window">
            <div className="glow" />
            <div className="pack heroPack"><small>SOLANA STOCK PACK</small><strong>RIP<br/>STOCKS</strong><div className="tear">TEAR HERE ✂</div><b>$30</b></div>
            <div className="claw">⌄</div>
          </div>
          <div className="belt">{[1,2,3,4,5,6].map(n=><span key={n} />)}</div>
          <div className="machineBase"><span>USDC IN</span><b>→</b><span>xSTOCKS OUT</span></div>
        </div>
      </section>

      <div className="ticker"><div>{[...stocks,...stocks].map((s,i)=><span key={i}><b>{s.ticker}</b> {s.name} <i>◆</i></span>)}</div></div>

      <section className="packs wrap" id="packs">
        <div className="sectionHead"><div><span className="kicker">CHOOSE YOUR RIP</span><h2>Three packs.<br/>No boring picks.</h2></div><p>Every pack contains a randomized bundle of xStocks available on Solana. You pay in USDC. The pull lands in your wallet.</p></div>
        <div className="packGrid">
          {[10,30,50].map((price, i)=><button key={price} onClick={()=>setTier(price)} className={`packCard p${price} ${tier===price?"selected":""}`}>
            <span className="chance">{i===0?"THE QUICK RIP":i===1?"CROWD FAVORITE":"THE BIG RIP"}</span>
            <div className="miniPack"><small>SEALED ON SOLANA</small><strong>RIP<br/>STOCKS</strong><i>{price}</i></div>
            <div className="packMeta"><div><b>${price}</b><span>USDC</span></div><p>{i===0?"1–2":i===1?"2–4":"3–6"} stock pulls<br/><em>Instant delivery</em></p></div>
            {tier===price && <span className="chosen">SELECTED ✓</span>}
          </button>)}
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

      <section className="fly wrap" id="flywheel"><span className="kicker">THE HOURLY HOLDER DROP</span><h2>Every fee.<br/><em>Back to holders.</em></h2><div className="hourly">
        <div className="hourStep"><b>01</b><span>FEES LAND</span><p>100% of creator fees collect onchain.</p></div><i>→</i><div className="hourStep acid"><b>02</b><span>BUY xSTOCKS</span><p>The full balance buys eligible tokenized stocks.</p></div><i>→</i><div className="hourStep"><b>03</b><span>RANDOM DRAW</span><p>One eligible holder is selected every hour.</p></div><i>→</i><div className="hourStep"><b>04</b><span>INSTANT PROOF</span><p>The signature posts as soon as it lands.</p></div>
      </div><div className="dropProof"><div className="proofTitle"><div><span className="liveDot"/> HOURLY AIRDROP PROOF</div><b>NEXT DRAW {countdown}</b></div><div className="proofRows"><div className="proofRow proofLabels"><span>DRAW</span><span>WINNER</span><span>STOCK</span><span>VALUE</span><span>PROOF</span></div>{airdrops.map((a,i)=><div className="proofRow" key={i}><span>{a[0]}</span><span>{a[1]}</span><span><b>{a[2]}</b></span><span>{a[3]}</span><span><button title="Activates with the live distributor">{a[4]} ↗</button></span></div>)}</div></div><p className="disclaimer">Hourly draws use the configured holder snapshot and verifiable randomness seed. Eligibility and transaction signatures publish with every distribution. Tokenized assets carry market risk. Nothing here is financial advice.</p></section>

      <footer><div className="wrap"><div className="brand"><span className="ripmark">R</span><span>RIPSTOCKS</span></div><p>RIP. PULL. REPEAT.</p><div><a href="#packs">PACKS</a><a href="#live">LIVE</a><a href="#flywheel">HOW IT WORKS</a></div><span>BUILT ON SOLANA ◈</span></div></footer>

      {(opening||result) && <div className="modal" role="dialog" aria-modal="true"><div className={`reveal ${opening?"opening":""}`}>
        <button className="close" onClick={()=>{setOpening(false);setResult(null)}}>×</button>
        {opening ? <><span className="kicker">RIPPING ONCHAIN</span><div className="ripAnim"><div className="pack"><strong>RIP<br/>STOCKS</strong></div></div><p>VERIFYING PULL…</p></> : result && <><span className="kicker">YOU PULLED</span><div className="stockResult" style={{background:result.color,color:result.ink}}><small>xSTOCK</small><b>{result.ticker}</b><span>{result.name}</span></div><h3>${(tier*1.14).toFixed(2)} OF {result.name.toUpperCase()}</h3><p>Delivered to {wallet.slice(0,4)}…{wallet.slice(-4)}</p><div className="instantProof"><span>PROOF</span><b>Posts instantly after mainnet confirmation ↗</b></div><button className="primary" onClick={()=>setResult(null)}>RIP ANOTHER →</button></>}
      </div></div>}
    </main>
  );
}
