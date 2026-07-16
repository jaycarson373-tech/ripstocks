"use client";

import { useEffect, useRef, useState } from "react";
import { AIRDROP_INTERVAL_MINUTES, emptySnapshot, type ProtocolSnapshot } from "@/lib/protocol";
import { detectSolanaProvider, type SolanaProvider, type SolanaPublicKey } from "@/lib/solana-wallet";
import { Transaction } from "@solana/web3.js";
import { VERIFIED_XSTOCKS } from "@/lib/xstocks";

const stockPalette=["#65d1ff","#d8ff3e","#815cff","#ef3d4c","#ff5b42","#76e247","#1652f0","#fbbc04","#c9ff38","#ff9900"];
const RIPSTOCKS_MINT="31aEMecqoVxVB3Lt8U1XFcafmR167cYy77bRQMwMpump";
type StockDisplay={ticker:string;name:string;color:string;ink:string};
const stocks:StockDisplay[] = VERIFIED_XSTOCKS.map((stock,index)=>({ticker:stock.symbol,name:stock.name,color:stockPalette[index],ink:index===2||index===3||index===4||index===6?"#fff":"#090909"}));
export default function Home() {
  const [tier, setTier] = useState(10);
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
  const stockStyle=(symbol:string)=>stocks.find(stock=>stock.ticker===symbol)??{ticker:symbol,name:symbol,color:"#caff00",ink:"#080808"};
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
    await navigator.clipboard.writeText(RIPSTOCKS_MINT);
    setCopiedCa(true);
    window.setTimeout(() => setCopiedCa(false), 1400);
  }

  async function openPack() {
    const provider=providerRef.current; if(!provider||!wallet)return connect();
    if(!inventoryReady){setWalletError("Inventory is restocking. No payment was requested.");return}
    const base=(process.env.NEXT_PUBLIC_RAILWAY_API_URL||"").replace(/\/$/,"");
    if(!base){setWalletError("Checkout service is unavailable.");return}
    setWalletError(""); setOpening(true); setResult(null);
    try{
      const created=await fetch(`${base}/api/checkout/create`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet})});
      const checkout=await created.json() as {orderId?:string;transaction?:string;error?:string};
      if(!created.ok||!checkout.orderId||!checkout.transaction)throw new Error(checkout.error||"Could not reserve a pack");
      const bytes=Uint8Array.from(atob(checkout.transaction),c=>c.charCodeAt(0));
      const {signature}=await provider.signAndSendTransaction(Transaction.from(bytes));
      const confirmed=await fetch(`${base}/api/checkout/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:checkout.orderId,paymentSignature:signature,wallet})});
      const pull=await confirmed.json() as {symbol?:string;value?:number;error?:string};
      if(!confirmed.ok||!pull.symbol)throw new Error(pull.error||"Payment confirmed; delivery is retrying");
      setPulledValue(Number(pull.value)||0); setOpening(false); setResult(stocks.find(stock=>stock.ticker===pull.symbol)??{ticker:pull.symbol,name:pull.symbol,color:"#caff00",ink:"#080808"});
    }catch(error){setOpening(false);setWalletError(error instanceof Error?error.message:"Checkout failed. No unverified payment is treated as complete.")}
  }

  return (
    <main>
      <div className="grain" />
      <nav className="nav wrap">
        <a className="brand brandImage" href="#top" aria-label="RipStocks home"><img src="/ripstocks-logo.jpg" alt=""/><span><em>rip</em>stocks</span></a>
        <button className={`contractPill ${copiedCa?"copied":""}`} type="button" onClick={copyContract} title={RIPSTOCKS_MINT}><span>CA</span>{copiedCa?"COPIED":RIPSTOCKS_MINT}</button>
        <div className="navlinks"><a href="#packs">Packs</a><a href="#live">Live rips</a><a href="#flywheel">Flywheel</a><a href="https://x.com/RipStocks_" target="_blank" rel="noreferrer">X ↗</a></div>
        {wallet ? <div className="walletGroup"><button className="wallet walletAddress" type="button" aria-label={`Connected wallet ${wallet}`}>{wallet.slice(0,4)}…{wallet.slice(-4)}</button><button className="disconnectWallet" type="button" onClick={disconnect}>DISCONNECT</button></div> : <button className="wallet" onClick={connect} disabled={connecting}>{connecting ? "CONNECTING…" : "CONNECT WALLET"}<span>↗</span></button>}
      </nav>

      <div className="brandBanner wrap"><img src="/ripstocks-banner.jpg" alt="RipStocks — tokenized stock packs"/></div>
      <section className="hero wrap" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> LIVE ON SOLANA</div>
          <h1>RIP IT.<br/><em>OWN IT.</em></h1>
          <p>Rip a stock pack. Hold for stock pack airdrops every {AIRDROP_INTERVAL_MINUTES} minutes.</p>
          <p className="heroSupport">75% of protocol fees fund holder drops. 25% increases pack expected value.</p>
          <div className="heroActions"><a className="primary" href="#packs">RIP A PACK <b>↓</b></a><button className="textBtn" onClick={() => setSpectating(true)}>SPECTATE LIVE <span>●</span></button></div>
          <div className="proof"><div><b>75/25</b><span>PROTOCOL FEE SPLIT</span></div><div className="nextDrop"><b>{countdown}</b><span>NEXT HOLDER DROP</span></div><div><b>{snapshot.totalPacksOpened}</b><span>PACKS OPENED</span></div></div>
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
        <div className="sectionHead"><div><span className="kicker">CHOOSE YOUR RIP</span><h2>Launch pack.<br/>One stock pull.</h2></div><p>The $10 launch pack contains exactly one randomized xStock available on Solana. You pay in USDC. The pull lands in your wallet.</p></div>
        <div className="packGrid">
          {[10,30,50].map((price, i)=>{const available=price===10; const inventory=available?snapshot.packsRemaining:0; return <div key={price} onClick={()=>available&&setTier(price)} className={`packCard p${price} ${tier===price?"selected":""} ${!available?"unavailable":""}`}>
            <span className="chance">{i===0?"THE QUICK RIP":i===1?"CROWD FAVORITE":"THE BIG RIP"}</span>
            <span className={`inventory ${inventory===0?"empty":""}`}>{inventory} PACKS LEFT</span>
            <div className="miniPack photoPack"><img src="/ripstocks-logo.jpg" alt=""/><i>{price}</i></div>
            {available&&<button className="packBuy" type="button" disabled={!inventoryReady||opening} onClick={event=>{event.stopPropagation();void (wallet?openPack():connect())}}>{inventoryReady?(wallet?"BUY PACK · 10 USDC":"CONNECT TO BUY"):"RESTOCKING INVENTORY"}</button>}
            <div className="packMeta"><div><b>${price}</b><span>USDC</span></div><p>{i===0?"1 Stock Pull":"Premium Pulls"}<br/>{available&&<>Expected Value <strong className="evValue">${snapshot.currentPackEv.toFixed(2)}</strong><br/></>}<em>{available?"Instant Delivery":"Projected EV · Coming Soon"}</em></p></div>
            {tier===price && <span className="chosen">SELECTED ✓</span>}
            {!available && <span className="soldOut">UNAVAILABLE</span>}
          </div>})}
        </div>
        <div className="ripBar">
          <div><span>YOUR PACK</span><b>${tier} RIP</b></div><div><span>PAY WITH</span><b>USDC <i>◎</i></b></div><button disabled={!inventoryReady||opening} onClick={wallet?openPack:connect}>{inventoryReady?(wallet?`RIP THE $${tier} PACK`:`CONNECT TO RIP`):"RESTOCKING INVENTORY"} <span>→</span></button>
        </div>
        {walletError && <div className="walletNotice" role="alert">{walletError}</div>}
      </section>

      <section className="live" id="live"><div className="wrap">
        <div className="liveHead"><div><span className="liveDot"/> LIVE RIPS</div><p>Every tear. Every pull. Onchain.</p><button onClick={()=>setSpectating(!spectating)}>{spectating?"WATCHING LIVE":"SPECTATE"} ◉</button></div>
        <div className="table"><div className="tr labels"><span>RIPPER</span><span>PACK</span><span>PULLED</span><span>VALUE</span><span>PROOF</span></div>{snapshot.recentPacks.map((rip,i)=>{const style=stockStyle(rip.stock);return <div className="tr" key={rip.fulfillmentSignature||i}><span><i className={`avatar a${i%4}`}/>{short(rip.wallet)}</span><span>{rip.pack}</span><span><b className="stockBadge" style={{background:style.color,color:style.ink}}>{rip.stock}</b></span><span>${Number(rip.value).toFixed(2)}</span><span><a href={`https://solscan.io/tx/${rip.fulfillmentSignature}`} target="_blank" rel="noreferrer">TX ↗</a></span></div>})}{snapshot.recentPacks.length===0&&<div className="emptyProof">Waiting for the first confirmed rip.</div>}</div>
      </div></section>

      <section className="fly wrap" id="flywheel"><span className="kicker">HOW IT WORKS</span><h2>Two wallets.<br/><em>One clear flywheel.</em></h2><div className="protocolSteps">{[["01","RIP A PACK","Open a $10 stock pack and instantly receive one tokenized stock from the Main Treasury."],["02","RESTOCK INVENTORY","The Main Treasury receives pack-sale USDC and replenishes replacement $10 xStock inventory lots."],["03","SPLIT PROTOCOL FEES","Fees enter the Main Treasury. Every 20 minutes, 75% moves to Holder Airdrops while 25% stays reserved for Pack EV."],["04",`EVERY ${AIRDROP_INTERVAL_MINUTES} MINUTES`,"One funded stock pack is delivered to an eligible holder from reserved airdrop inventory."],["05","PROOF","Every confirmed holder drop publishes its winner, stock, value and transaction proof immediately."]].map(s=><div className="hourStep" key={s[0]}><b>{s[0]}</b><span>{s[1]}</span><p>{s[2]}</p></div>)}</div>
      <div className="dropProof"><div className="proofTitle"><div><span className="liveDot"/> PAID PACK PROOFS</div><b>INSTANT ONCHAIN DELIVERY</b></div><div className="proofRows"><div className="proofRow proofLabels"><span>RIPPER</span><span>PACK</span><span>STOCK RECEIVED</span><span>VALUE</span><span>TIME</span><span>PAYOUT PROOF</span></div>{snapshot.recentPacks.slice(0,12).map((rip,i)=><div className="proofRow" key={rip.fulfillmentSignature||i}><span>{short(rip.wallet)}</span><span>{rip.pack}</span><span><b>{rip.stock}</b></span><span>${Number(rip.value).toFixed(2)}</span><span>{new Date(rip.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span><a href={`https://solscan.io/tx/${rip.fulfillmentSignature}`} target="_blank" rel="noreferrer">{short(rip.fulfillmentSignature)} ↗</a></span></div>)}{snapshot.recentPacks.length===0&&<div className="emptyProof">No paid pack proofs published yet.</div>}</div></div>
      <div className="dropProof"><div className="proofTitle"><div><span className="liveDot"/> HOLDER DROP PROOFS</div><b>NEXT DRAW {countdown}</b></div><div className="proofRows"><div className="proofRow proofLabels"><span>WINNER</span><span>PACK</span><span>STOCK RECEIVED</span><span>REWARD VALUE</span><span>TIME</span><span>TRANSACTION PROOF</span></div>{snapshot.proofs.map((a,i)=><div className="proofRow" key={a.signature||i}><span>{short(a.winner)}</span><span>{a.pack}</span><span><b>{a.stock}</b></span><span>${Number(a.value).toFixed(2)}</span><span>{new Date(a.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span><a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noreferrer">{short(a.signature)} ↗</a></span></div>)}{snapshot.proofs.length===0&&<div className="emptyProof">No holder drops published yet.</div>}</div></div><p className="disclaimer">Pack-sale USDC belongs only to Pack Inventory and never funds holder drops. Protocol fees are recorded separately: 75% to the Holder Airdrop Treasury and 25% to the Pack EV Reserve. EV is a statistical expected value calculated from remaining inventory; it is not a promise of profit.</p></section>

      <section className="verifiedUniverse wrap" aria-labelledby="verified-title"><div className="verifiedHead"><div><span className="kicker">VERIFIED INVENTORY UNIVERSE</span><h2 id="verified-title">10 official xStocks.<br/>Nothing else.</h2></div><p>RipStocks inventory is restricted to these verified Solana mints. Every mint links directly to its on-chain record.</p></div><div className="verifiedGrid">{VERIFIED_XSTOCKS.map((stock,index)=><a key={stock.mint} href={`https://solscan.io/token/${stock.mint}`} target="_blank" rel="noreferrer"><span>{String(index+1).padStart(2,"0")}</span><div><b>{stock.symbol}</b><small>{stock.name}</small></div><code>{stock.mint.slice(0,8)}…{stock.mint.slice(-6)}</code><i>↗</i></a>)}</div></section>

      <footer><div className="wrap"><div className="brand brandImage"><img src="/ripstocks-logo.jpg" alt=""/><span><em>rip</em>stocks</span></div><p>RIP. PULL. REPEAT.</p><div className="footerLinks"><a href="https://x.com/RipStocks_" target="_blank" rel="noreferrer">X / TWITTER ↗</a><a href={`https://dexscreener.com/solana/${RIPSTOCKS_MINT}`} target="_blank" rel="noreferrer">DEXSCREENER ↗</a><a href={`https://pump.fun/coin/${RIPSTOCKS_MINT}`} target="_blank" rel="noreferrer">PUMP.FUN ↗</a><a className="footerBuy" href={`https://jup.ag/?sell=So11111111111111111111111111111111111111112&buy=${RIPSTOCKS_MINT}`} target="_blank" rel="noreferrer">BUY $RIPSTOCKS ↗</a></div><span>BUILT ON SOLANA ◈</span></div></footer>

      {(opening||result) && <div className="modal" role="dialog" aria-modal="true"><div className={`reveal ${opening?"opening":""}`}>
        <button className="close" onClick={()=>{setOpening(false);setResult(null)}}>×</button>
        {opening ? <><span className="kicker">RIPPING ONCHAIN</span><div className="ripAnim"><div className="pack"><strong>RIP<br/>STOCKS</strong></div></div><p>VERIFYING PULL…</p></> : result && <><span className="kicker">YOU PULLED</span><div className="stockResult" style={{background:result.color,color:result.ink}}><small>xSTOCK</small><b>{result.ticker}</b><span>{result.name}</span></div><h3>${pulledValue.toFixed(2)} OF {result.name.toUpperCase()}</h3><p>Delivered to {wallet.slice(0,4)}…{wallet.slice(-4)}</p><div className="instantProof"><span>PROOF</span><b>Posts instantly after mainnet confirmation ↗</b></div><button className="primary" onClick={()=>setResult(null)}>RIP ANOTHER →</button></>}
      </div></div>}
    </main>
  );
}
