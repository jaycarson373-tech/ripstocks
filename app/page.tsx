"use client";

import { useEffect, useRef, useState } from "react";
import { AIRDROP_INTERVAL_MINUTES, emptySnapshot, type ProtocolSnapshot } from "@/lib/protocol";
import { detectSolanaProvider, type SolanaProvider, type SolanaPublicKey } from "@/lib/solana-wallet";
import { Transaction } from "@solana/web3.js";
import { VERIFIED_XSTOCKS } from "@/lib/xstocks";

const stockPalette=["#65d1ff","#d8ff3e","#815cff","#ef3d4c","#ff5b42","#76e247","#1652f0","#fbbc04","#c9ff38","#ff9900"];
const MEMEPACKS_MINT=(process.env.NEXT_PUBLIC_MEMEPACKS_MINT||"").trim();
type StockDisplay={ticker:string;name:string;color:string;ink:string;image:string};
const stocks:StockDisplay[] = VERIFIED_XSTOCKS.map((stock,index)=>({ticker:stock.symbol,name:stock.name,color:stockPalette[index],ink:index===2||index===3||index===4||index===6?"#fff":"#090909",image:stock.image}));
function apiBase(){
  const raw=(process.env.NEXT_PUBLIC_RAILWAY_API_URL||"").trim().replace(/^["']|["']$/g,"").replace(/\/$/,"");
  if(!raw)return "";
  return /^https?:\/\//i.test(raw)?raw:`https://${raw}`;
}
export default function Home() {
  const [wallet, setWallet] = useState("");
  const [spectating, setSpectating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<StockDisplay | null>(null);
  const [pulledValue, setPulledValue] = useState(0);
  const [walletError, setWalletError] = useState("");
  const [copiedCa, setCopiedCa] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const providerRef = useRef<SolanaProvider | null>(null);
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot>(emptySnapshot());
  const [seconds, setSeconds] = useState(AIRDROP_INTERVAL_MINUTES*60);
  useEffect(() => { let offset=0; let end=Date.parse(snapshot.epochEndsAt); const load=async()=>{try{const r=await fetch("/api/protocol",{cache:"no-store"});const data=await r.json() as ProtocolSnapshot;offset=Date.parse(data.serverNow)-Date.now();end=Date.parse(data.epochEndsAt);setSnapshot(data)}catch{}}; load(); const refresh=window.setInterval(load,15000); const tick=window.setInterval(()=>setSeconds(Math.max(0,Math.ceil((end-(Date.now()+offset))/1000))),250); return()=>{window.clearInterval(tick);window.clearInterval(refresh)}; }, []);
  useEffect(() => {
    let provider: SolanaProvider | null = null;
    let attached = false;
    const setAccount = (key?: SolanaPublicKey | null) => { setWallet(key?.toString() ?? ""); setWalletError(""); };
    const clearAccount = () => { setWallet(""); setConnecting(false); };
    const attach = async () => {
      provider = detectSolanaProvider();
      if (!provider) return;
      if (attached) return;
      attached = true;
      providerRef.current = provider;
      provider.on?.("connect", setAccount);
      provider.on?.("accountChanged", setAccount);
      provider.on?.("disconnect", clearAccount);
      try { setAccount((await provider.connect({ onlyIfTrusted: true })).publicKey); } catch { /* No trusted session yet. */ }
    };
    void attach();
    const retry = window.setTimeout(attach, 800);
    window.addEventListener("solana#initialized", attach);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("solana#initialized", attach);
      provider?.off?.("connect", setAccount);
      provider?.off?.("accountChanged", setAccount);
      provider?.off?.("disconnect", clearAccount);
    };
  }, []);
  const countdown=`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  const inventoryReady=snapshot.packsRemaining>0;
  const stockStyle=(symbol:string)=>stocks.find(stock=>stock.ticker===symbol)??{ticker:symbol,name:symbol,color:"#caff00",ink:"#080808",image:"/memepacks-logo.jpg"};
  const short=(address:string)=>address?`${address.slice(0,4)}…${address.slice(-4)}`:"—";

  async function connect() {
    const provider = providerRef.current ?? detectSolanaProvider();
    if (provider) {
      providerRef.current = provider;
      setConnecting(true);
      try { setWallet((await provider.connect()).publicKey.toString()); setWalletError(""); return; } catch { setWalletError("Wallet connection was cancelled or blocked. Unlock Phantom or Backpack and try again."); return; } finally { setConnecting(false); }
    }
    setWalletError("No Solana wallet detected. Install Phantom or Backpack, then reload.");
  }

  async function disconnect() {
    try { await providerRef.current?.disconnect(); } finally { setWallet(""); setWalletError(""); setConnecting(false); }
  }

  async function copyContract() {
    if(!MEMEPACKS_MINT)return;
    await navigator.clipboard.writeText(MEMEPACKS_MINT);
    setCopiedCa(true);
    window.setTimeout(() => setCopiedCa(false), 1400);
  }

  async function openPack() {
    const provider=providerRef.current; if(!provider||!wallet)return connect();
    if(!inventoryReady){setWalletError("Inventory is restocking. No payment was requested.");return}
    const base=apiBase();
    setWalletError(""); setOpening(true); setResult(null);
    try{
      const created=await fetch(`${base}/api/checkout/create`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet})});
      const checkout=await created.json() as {orderId?:string;transaction?:string;error?:string};
      if(!created.ok||!checkout.orderId||!checkout.transaction)throw new Error(created.status===409?"Inventory is restocking. Try again in a moment.":"Pack checkout is warming up. Try again in a moment.");
      const bytes=Uint8Array.from(atob(checkout.transaction),c=>c.charCodeAt(0));
      const {signature}=await provider.signAndSendTransaction(Transaction.from(bytes));
      const confirmed=await fetch(`${base}/api/checkout/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:checkout.orderId,paymentSignature:signature,wallet})});
      const pull=await confirmed.json() as {symbol?:string;value?:number;error?:string};
      if(!confirmed.ok||!pull.symbol)throw new Error("Payment received. Delivery is retrying.");
      setPulledValue(Number(pull.value)||0); setOpening(false); setResult(stocks.find(stock=>stock.ticker===pull.symbol)??{ticker:pull.symbol,name:pull.symbol,color:"#caff00",ink:"#080808",image:"/memepacks-logo.jpg"});
    }catch(error){setOpening(false);setWalletError(error instanceof Error&&error.message.includes("User rejected")?"Transaction cancelled. No payment was taken.":"Pack checkout did not start. Refresh and try again.")}
  }

  return (
    <main>
      <div className="grain" />
      <nav className="nav wrap">
        <a className="brand brandImage" href="#top" aria-label="MemePacks home"><img src="/memepacks-logo.jpg" alt=""/><span>MEME<em>PACKS</em></span></a>
        {MEMEPACKS_MINT&&<button className={`contractPill ${copiedCa?"copied":""}`} type="button" onClick={copyContract} title={MEMEPACKS_MINT}><span>CA</span>{copiedCa?"COPIED":MEMEPACKS_MINT}</button>}
        <div className="navlinks"><a href="#packs">Packs</a><a href="#live">Live pulls</a><a href="#flywheel">How it works</a><a href="https://x.com/RipStocks_" target="_blank" rel="noreferrer">X ↗</a></div>
        {wallet ? <div className="walletGroup"><button className="wallet walletAddress" type="button" aria-label={`Connected wallet ${wallet}`}>{wallet.slice(0,4)}…{wallet.slice(-4)}</button><button className="disconnectWallet" type="button" onClick={disconnect}>DISCONNECT</button></div> : <button className="wallet" onClick={connect} disabled={connecting}>{connecting ? "CONNECTING…" : "CONNECT WALLET"}<span>↗</span></button>}
      </nav>

      <section className="hero wrap" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> SERIES 001 · LIVE ON SOLANA</div>
          <h1>RIP<br/><em>A PACK.</em></h1>
          <p>One sealed MemePack. One random pull from a curated series of trending and undervalued Solana memes.</p>
          <div className="heroActions"><button className="primary heroPrimary" disabled={!inventoryReady||opening} onClick={wallet?openPack:connect}>{inventoryReady?(wallet?"RIP A PACK · 10 USDC":"CONNECT TO RIP") : "RESTOCKING SERIES"}<b>↗</b></button><button className="textBtn" onClick={() => document.querySelector("#live")?.scrollIntoView()}>WATCH LIVE <span>●</span></button></div>
          <div className="proof"><div><b>{snapshot.packsRemaining}</b><span>PACKS READY</span></div><div className="nextDrop"><b>{countdown}</b><span>NEXT HOLDER DRAW</span></div><div><b>{snapshot.totalPacksOpened}</b><span>PACKS RIPPED</span></div></div>
        </div>
        <div className="packStage" aria-label="Sealed Series 001 MemePack">
          <span className="orbit orbitOne">✦</span><span className="orbit orbitTwo">✦</span><span className="orbit orbitThree">◆</span>
          <div className="floatingPack"><img src="/memepacks-logo.jpg" alt="Sealed MemePack"/><i/><b>SERIES 001</b></div>
          <div className="packStageFloor"/>
          <div className="packStageMeta"><span>SEALED ONCHAIN</span><b>1 RANDOM PULL</b><em>10 USDC</em></div>
        </div>
      </section>

      <div className="ticker"><div>{snapshot.recentPacks.length?[...snapshot.recentPacks,...snapshot.recentPacks].map((rip,i)=>{const s=stockStyle(rip.stock);return <span key={`${rip.fulfillmentSignature}-${i}`}><b style={{color:s.color}}>{rip.stock}</b> ${Number(rip.value).toFixed(2)} · {short(rip.wallet)} <i>◆</i></span>}):[...stocks,...stocks].map((s,i)=><span key={i}><b>{s.ticker}</b> {s.name} <i>◆</i></span>)}</div></div>

      <section className="packs wrap" id="packs">
        <div className="liveStats">{[
          ["PACKS IN INVENTORY",snapshot.packsRemaining,false],
          ["CURRENT PACK EV",snapshot.currentPackEv,true],
          ["AIRDROP TREASURY",snapshot.holderAirdropTreasury,true],
          ["AIRDROP PACKS READY",snapshot.holderPacksAvailable,false],
          ["PACKS AIRDROPPED",snapshot.totalHolderDrops,false],
          ["AVERAGE DROP VALUE",snapshot.averageHolderDropValue,true],
          ["VALUE AIRDROPPED",snapshot.totalValueAirdropped,true],
        ].map(([label,value,currency])=><div key={String(label)}><span>{label}</span><b>{currency?`$${Number(value).toFixed(2)}`:Number(value).toLocaleString()}</b></div>)}</div>
        <div className="inventoryLog" aria-label="Inventory purchase log">
          {snapshot.inventoryLogs.length?snapshot.inventoryLogs.slice(0,4).map(log=><a key={`${log.source}-${log.signature}`} href={`https://solscan.io/tx/${log.signature}`} target="_blank" rel="noreferrer"><span>{log.source}</span><b>{log.message}</b><i>+{log.count}</i><em>{new Date(log.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</em></a>):<div><span>Inventory Log</span><b>Waiting for the next wallet purchase</b><i>+0</i><em>LIVE</em></div>}
        </div>
        <div className="sectionHead vaultHead"><div><span className="kicker">CURRENT SERIES</span><h2>Series 001.<br/>Ten possible pulls.</h2></div><p>Every pull comes directly from the live Series 001 vault and lands in your connected wallet.</p></div>
        {walletError && <div className="walletNotice" role="alert">{walletError}</div>}
      </section>

      <section className="live" id="live"><div className="wrap">
        <div className="liveHead"><div><span className="liveDot"/> LIVE FROM THE RIP ROOM</div><p>Every reveal, confirmed onchain.</p><button onClick={()=>setSpectating(!spectating)}>{spectating?"LIVE NOW":"WATCH LIVE"} ◉</button></div>
        <div className="activityFeed">{snapshot.recentPacks.map((rip,i)=>{const style=stockStyle(rip.stock);return <a className="activityCard" href={`https://solscan.io/tx/${rip.fulfillmentSignature}`} target="_blank" rel="noreferrer" key={rip.fulfillmentSignature||i}><img src={style.image} alt=""/><div><small>{short(rip.wallet)} RIPPED A PACK</small><strong>Pulled ${rip.stock}</strong><span>Pull value ${Number(rip.value).toFixed(2)}</span></div><i>LIVE</i><b>↗</b></a>})}{snapshot.recentPacks.length===0&&<div className="activityEmpty"><img src="/memepacks-logo.jpg" alt=""/><div><b>THE RIP ROOM IS READY</b><span>The first confirmed pull will appear here live.</span></div></div>}</div>
      </div></section>

      <section className="fly wrap" id="flywheel"><span className="kicker">HOW IT RIPS</span><h2>Open. Pull.<br/><em>Repeat.</em></h2><div className="protocolSteps">{[["01","CONNECT","Connect Phantom or Backpack."],["02","RIP","Open one Series 001 pack for 10 USDC."],["03","REVEAL","Watch your actual meme artwork break through the foil."],["04","RECEIVE","Your pull lands directly in your wallet."],["05","HOLDER DRAW",`Funded $1–$30 holder draws run every ${AIRDROP_INTERVAL_MINUTES} minutes.`]].map(s=><div className="hourStep" key={s[0]}><b>{s[0]}</b><span>{s[1]}</span><p>{s[2]}</p></div>)}</div>
      <div className="dropProof"><div className="proofTitle"><div><span className="liveDot"/> PAID PACK PROOFS</div><b>INSTANT ONCHAIN DELIVERY</b></div><div className="proofRows"><div className="proofRow proofLabels"><span>RIPPER</span><span>PACK</span><span>MEME RECEIVED</span><span>VALUE</span><span>TIME</span><span>PAYOUT PROOF</span></div>{snapshot.recentPacks.slice(0,12).map((rip,i)=><div className="proofRow" key={rip.fulfillmentSignature||i}><span>{short(rip.wallet)}</span><span>{rip.pack}</span><span><b>{rip.stock}</b></span><span>${Number(rip.value).toFixed(2)}</span><span>{new Date(rip.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span><a href={`https://solscan.io/tx/${rip.fulfillmentSignature}`} target="_blank" rel="noreferrer">{short(rip.fulfillmentSignature)} ↗</a></span></div>)}{snapshot.recentPacks.length===0&&<div className="emptyProof">No paid pack proofs published yet.</div>}</div></div>
      <div className="dropProof"><div className="proofTitle"><div><span className="liveDot"/> HOLDER DROP PROOFS</div><b>NEXT DRAW {countdown}</b></div><div className="proofRows"><div className="proofRow proofLabels"><span>WINNER</span><span>PACK</span><span>MEME RECEIVED</span><span>REWARD VALUE</span><span>TIME</span><span>TRANSACTION PROOF</span></div>{snapshot.proofs.map((a,i)=><div className="proofRow" key={a.signature||i}><span>{short(a.winner)}</span><span>{a.pack}</span><span><b>{a.stock}</b></span><span>${Number(a.value).toFixed(2)}</span><span>{new Date(a.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span><a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noreferrer">{short(a.signature)} ↗</a></span></div>)}{snapshot.proofs.length===0&&<div className="emptyProof">No holder drops published yet.</div>}</div></div><p className="disclaimer">Pack-sale USDC belongs only to Pack Inventory and never funds holder drops. Protocol fees are recorded separately: 80% to the Holder Airdrop Treasury and 20% keeps MemePacks inventory stocked. EV is a statistical expected value calculated from remaining inventory; it is not a promise of profit.</p></section>

      {/* VERIFIED INVENTORY UNIVERSE is retained as the protocol invariant; only its visible label is reskinned. */}
      <section className="verifiedUniverse wrap" aria-labelledby="verified-title"><div className="verifiedHead"><div><span className="kicker">SERIES 001 CHECKLIST</span><h2 id="verified-title">Meet the pulls.</h2></div><p>Ten verified Solana memes. Tap any artwork to inspect its onchain mint.</p></div><div className="verifiedGrid memeGrid">{VERIFIED_XSTOCKS.map((stock,index)=><a key={stock.mint} href={`https://solscan.io/token/${stock.mint}`} target="_blank" rel="noreferrer"><img src={stock.image} alt=""/><span>{String(index+1).padStart(2,"0")}</span><div><b>${stock.symbol}</b><small>{stock.name}</small></div><code>{stock.mint.slice(0,8)}…{stock.mint.slice(-6)}</code><i>↗</i></a>)}</div></section>

      <footer><div className="wrap"><div className="brand brandImage"><img src="/memepacks-logo.jpg" alt=""/><span>MEME<em>PACKS</em></span></div><p>OPEN. PULL. REPEAT.</p><div className="footerLinks"><a href="https://x.com/RipStocks_" target="_blank" rel="noreferrer">X</a>{MEMEPACKS_MINT&&<><a href={`https://dexscreener.com/solana/${MEMEPACKS_MINT}`} target="_blank" rel="noreferrer">DEXSCREENER</a><a href={`https://pump.fun/coin/${MEMEPACKS_MINT}`} target="_blank" rel="noreferrer">TOKEN PAGE</a><a className="footerBuy" href={`https://jup.ag/?sell=So11111111111111111111111111111111111111112&buy=${MEMEPACKS_MINT}`} target="_blank" rel="noreferrer">BUY TOKEN</a></>}</div><span>BUILT ON SOLANA ◈</span></div></footer>

      {(opening||result) && <div className={`modal ${result?"pullComplete":""}`} role="dialog" aria-modal="true"><div className={`reveal ${opening?"opening":""}`}>
        <button className="close" aria-label="Close pack opening" onClick={()=>{setOpening(false);setResult(null)}}>×</button>
        {opening ? <div className="openingSequence"><span className="openingLabel">SEALED · SERIES 001</span><div className="ripAnim"><div className="foilPack"><img src="/memepacks-logo.jpg" alt="Opening MemePack"/><i className="tearLine"/><i className="foilFlash"/></div><div className="burst">✦</div></div><p>RIPPING YOUR PACK…</p><small>Keep this window open while your pull confirms onchain.</small></div> : result && <div className="pullReveal"><span className="kicker">SERIES 001 · PULL CONFIRMED</span><div className="rewardArt"><div className="rewardHalo"/><img src={result.image} alt={result.name}/></div><div className="rewardIdentity"><small>YOU PULLED</small><h2>${result.ticker}</h2><p>{result.name}</p></div><div className="rewardStats"><div><span>AMOUNT</span><b>ONCHAIN ALLOCATION</b></div><div><span>TOTAL PULL VALUE</span><b>${pulledValue.toFixed(2)}</b></div></div><p className="deliveryLine">Delivered to {wallet.slice(0,4)}…{wallet.slice(-4)}</p><button className="primary continueButton" onClick={()=>setResult(null)}>CONTINUE <b>→</b></button></div>}
      </div></div>}
    </main>
  );
}
