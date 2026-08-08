"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AIRDROP_INTERVAL_MINUTES, HOLDER_TICKET_TOKENS, emptySnapshot, type ProtocolSnapshot } from "@/lib/protocol";
import { detectSolanaProvider, type SolanaProvider, type SolanaPublicKey } from "@/lib/solana-wallet";
import { Transaction } from "@solana/web3.js";
import { VERIFIED_XSTOCKS } from "@/lib/xstocks";

type StockDisplay={ticker:string;name:string;color:string;ink:string;logo:string;logoUrl?:string};
type ChatMessage={id:string;created_at:string;wallet:string;message:string};
const DEFAULT_STOCKDROPS_MINT="GUmtbfXHEKyB1SwpyevMHwXa9nx2LT9gKD1a738Vpump";
const STOCKDROPS_MINT=(process.env.NEXT_PUBLIC_STOCKDROPS_MINT||DEFAULT_STOCKDROPS_MINT).trim();
const X_URL=(process.env.NEXT_PUBLIC_X_URL||"https://x.com/StockDrops").trim();
const JUPITER_BUY_URL=`https://jup.ag/?sell=So11111111111111111111111111111111111111112&buy=${STOCKDROPS_MINT}`;
const DEXSCREENER_URL=`https://dexscreener.com/solana/${STOCKDROPS_MINT}`;
const stocks:StockDisplay[] = VERIFIED_XSTOCKS.map(stock=>({ticker:stock.symbol,name:stock.name,color:stock.color,ink:stock.ink,logo:stock.logo,logoUrl:stock.logoUrl}));
function stockVars(stock:StockDisplay){return {"--stock":stock.color,"--stockInk":stock.ink} as CSSProperties}
function StockLogo({stock,className=""}:{stock:StockDisplay;className?:string}){return <span className={`stockLogo ${className}`} style={stockVars(stock)}>{stock.logoUrl&&<img src={stock.logoUrl} alt={`${stock.name} logo`} loading="lazy" onError={event=>{event.currentTarget.style.display="none"}}/>}<b>{stock.logo}</b></span>}
function apiBase(){
  const raw=(process.env.NEXT_PUBLIC_RAILWAY_API_URL||"").trim().replace(/^["']|["']$/g,"").replace(/\/$/,"");
  if(!raw)return "";
  return /^https?:\/\//i.test(raw)?raw:`https://${raw}`;
}
export default function Home() {
  const [tier, setTier] = useState(10);
  const [wallet, setWallet] = useState("");
  const [spectating, setSpectating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<StockDisplay | null>(null);
  const [pulledValue, setPulledValue] = useState(0);
  const [walletError, setWalletError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [copiedCa, setCopiedCa] = useState(false);
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
  const stockStyle=(symbol:string)=>stocks.find(stock=>stock.ticker===symbol)??{ticker:symbol,name:symbol,color:"#a7ff16",ink:"#080808",logo:symbol.slice(0,1)};
  const short=(address:string)=>address?`${address.slice(0,4)}…${address.slice(-4)}`:"—";
  const approvedSymbols=new Set(stocks.map(stock=>stock.ticker));
  const stockProofs=snapshot.proofs.filter(proof=>approvedSymbols.has(proof.stock));
  const staleProofsHidden=snapshot.proofs.length!==stockProofs.length;
  const latestDrop=stockProofs[0];
  const proofPackLabel=(value:number|string)=>`$${Number(value).toFixed(2)} STOCK DROP`;
  const displayedDropCount=staleProofsHidden?stockProofs.length:Number(snapshot.totalHolderDrops);
  const displayedValueAirdropped=staleProofsHidden?stockProofs.reduce((sum,proof)=>sum+Number(proof.value),0):Number(snapshot.totalValueAirdropped);
  const displayedAverageDrop=displayedDropCount>0?displayedValueAirdropped/displayedDropCount:Number(snapshot.averageHolderDropValue);

  useEffect(()=>{const load=async()=>{try{const r=await fetch("/api/chat",{cache:"no-store"});const data=await r.json() as {messages?:ChatMessage[]};setChatMessages(data.messages||[])}catch{}};load();const timer=window.setInterval(load,5000);return()=>window.clearInterval(timer)},[]);

  async function sendChat(){
    const message=chatInput.trim();
    if(!message)return;
    setChatInput("");
    try{
      const response=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:wallet||"spectator",message})});
      const data=await response.json() as {message?:ChatMessage};
      if(data.message)setChatMessages(messages=>[...messages.slice(-39),data.message as ChatMessage]);
    }catch{}
  }

  async function copyCa() {
    try {
      await navigator.clipboard.writeText(STOCKDROPS_MINT);
      setCopiedCa(true);
      window.setTimeout(()=>setCopiedCa(false),1400);
    } catch {
      setCopiedCa(false);
    }
  }

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
      setPulledValue(Number(pull.value)||0); setOpening(false); setResult(stocks.find(stock=>stock.ticker===pull.symbol)??{ticker:pull.symbol,name:pull.symbol,color:"#a7ff16",ink:"#080808",logo:pull.symbol.slice(0,1)});
    }catch(error){setOpening(false);setWalletError(error instanceof Error&&error.message.includes("User rejected")?"Transaction cancelled. No payment was taken.":"Pack checkout did not start. Refresh and try again.")}
  }

  return (
    <main>
      <div className="grain" />
      <nav className="nav wrap">
        <a className="brand brandImage" href="#top" aria-label="Stock Drops home"><img src="/stockdrops-logo.svg" alt=""/><span><em>stock</em>drops</span></a>
        <div className="navlinks"><a href="#how">How it works</a><a href="#draw">Draw</a><a href="#live">Live room</a><a href="#flywheel">Proof</a><a href={X_URL} target="_blank" rel="noreferrer">X</a></div>
        <button className="caPill headerCa" type="button" onClick={()=>void copyCa()} aria-label="Copy Stock Drops contract address"><span>CA</span>{STOCKDROPS_MINT}<b>{copiedCa?"COPIED":"COPY"}</b></button>
        {wallet ? <div className="walletGroup"><button className="wallet walletAddress" type="button" aria-label={`Connected wallet ${wallet}`}>{wallet.slice(0,4)}…{wallet.slice(-4)}</button><button className="disconnectWallet" type="button" onClick={disconnect}>DISCONNECT</button></div> : <button className="wallet" onClick={connect} disabled={connecting}>{connecting ? "CONNECTING…" : "CONNECT WALLET"}<span>↗</span></button>}
      </nav>

      <div className="brandBanner wrap"><img src="/stockdrops-banner.svg" alt="Stock Drops — tokenized stock airdrops"/></div>
      <section className="hero wrap" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> STOCK DROP PICKER LIVE ON SOLANA</div>
          <h1>Hold Drops.<br/><em>Win stocks.</em></h1>
          <p>Every {AIRDROP_INTERVAL_MINUTES} minutes, creator fees buy a random xStock and airdrop it to one weighted holder.</p>
          <p className="heroSupport">80% funds stock drops · 20% builds a jackpot · 1 in 20 draws clears the pot.</p>
          <div className="heroActions"><a className="primary" href={JUPITER_BUY_URL} target="_blank" rel="noreferrer">BUY ON JUPITER <b>↗</b></a><button className="textBtn" onClick={() => setSpectating(true)}>OPEN LIVE ROOM <span>●</span></button></div>
          <div className="proof"><div><b>{HOLDER_TICKET_TOKENS/1000}K</b><span>DROPS / TICKET</span></div><div className="nextDrop"><b>{countdown}</b><span>NEXT DRAW</span></div><div><b>1/20</b><span>JACKPOT ODDS</span></div></div>
        </div>
        <div className="machine caseMachine" aria-label="Animated Stock Drops selection machine">
          <div className="machineTop"><span>STOCK DROP PICKER</span><i>LIVE</i></div>
          <div className="window">
            <div className="glow" />
            <div className="casePointer" />
            <div className="caseReel">{[...stocks,...stocks].map((stock,index)=><span className="caseCard" key={`${stock.ticker}-${index}`} style={stockVars(stock)}><StockLogo stock={stock} className="caseLogo"/><b>{stock.ticker}</b><small>${[1,2,3,5,8,10,12,15,20,25,30,40,50][index%13]}</small></span>)}</div>
            <div className="caseResult"><small>LATEST DROP</small><b>{latestDrop?.stock || "DROPS"}</b><em>{latestDrop?`$${Number(latestDrop.value).toFixed(2)}`:"ARMED"}</em></div>
          </div>
          <div className="belt">{[1,2,3,4,5,6].map(n=><span key={n} />)}</div>
          <div className="machineBase"><span>80% STOCK BUY</span><b>→</b><span>20% JACKPOT</span></div>
        </div>
      </section>

      <div className="ticker"><div>{stockProofs.length?[...stockProofs,...stockProofs].map((rip,i)=>{const s=stockStyle(rip.stock);return <span key={`${rip.signature}-${i}`}><StockLogo stock={s} className="tickerLogo"/><b style={{color:s.color}}>{rip.stock}</b> ${Number(rip.value).toFixed(2)} · {short(rip.winner)} <i>◆</i></span>}):[...stocks,...stocks].map((s,i)=><span key={i}><StockLogo stock={s} className="tickerLogo"/><b>{s.ticker}</b> {s.name} <i>◆</i></span>)}</div></div>

      <section className="dropDesk wrap" aria-label="Stock Drops live routing board">
        <div className="deskCard wide">
          <span className="kicker">LIVE ROUTING</span>
          <h2>Creator fees become holder rewards.</h2>
          <p>Each 15-minute epoch routes fresh fees into two visible buckets: stock inventory for the next winner and a growing jackpot reserve.</p>
        </div>
        <div className="deskCard"><b>80%</b><span>Stock-drop fund</span><p>Used to buy the next random xStock for holder airdrops.</p></div>
        <div className="deskCard"><b>20%</b><span>Jackpot fund</span><p>Accumulates until a jackpot draw hits.</p></div>
        <div className="deskCard"><b>1/20</b><span>Jackpot hit rate</span><p>Average clear is roughly every five hours.</p></div>
      </section>

      <section className="topLiveChat wrap" aria-label="Live spectator chat">
        <div className="chatHead"><b>LIVE CHAT</b><span>{chatMessages.length||"0"} MSGS</span></div>
        <div className="chatStream">{chatMessages.length?chatMessages.map(message=><div key={message.id}><span>{short(message.wallet)}</span><p>{message.message}</p></div>):<div><span>SYSTEM</span><p>Chat opens with the first draw.</p></div>}</div>
        <div className="chatComposer"><input value={chatInput} onChange={event=>setChatInput(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void sendChat()}} placeholder={wallet?"Say something live…":"Connect wallet or chat as spectator"} maxLength={180}/><button type="button" onClick={()=>void sendChat()}>SEND</button></div>
      </section>

      <section className="winUniverse wrap" aria-label="Approved xStocks in Stock Drops">
        <div><span className="kicker">10 STOCKS IN ROTATION</span><p>Each holder draw spins through the approved xStock universe before a funded stock drop is airdropped.</p></div>
        <div className="winLogoGrid">{stocks.map(stock=><div key={stock.ticker} style={stockVars(stock)}><StockLogo stock={stock}/><b>{stock.ticker}</b><span>{stock.name}</span></div>)}</div>
      </section>

      <section className="howWorks wrap" id="how" aria-labelledby="how-title">
        <div className="howIntro">
          <span className="kicker">HOW IT WORKS</span>
          <h2 id="how-title">Hold DROPS.<br/>Wait for the airdrop.</h2>
          <p>Stock Drops collects fees, buys live xStocks, snapshots eligible holders, selects one wallet, and publishes proof after each confirmed airdrop.</p>
        </div>
        <div className="howGrid">
          {[
            ["01","HOLD DROPS",`${HOLDER_TICKET_TOKENS.toLocaleString()} DROPS equals one weighted ticket for the next draw.`],
            ["02","FEES ROUTE 80/20","80% buys stock drops. 20% builds the jackpot reserve."],
            ["03","15-MINUTE PICKER","Each epoch buys or selects a random approved xStock for the next draw."],
            ["04","ONE LUCKY HOLDER","The live picker resolves to one weighted holder. Jackpot clears on roughly 1 in 20 draws."],
            ["05","AIRDROP + PROOF","The stock drop is sent to the winner and the transaction proof appears on the site."]
          ].map(step=><article key={step[0]}><b>{step[0]}</b><span>{step[1]}</span><p>{step[2]}</p></article>)}
        </div>
      </section>

      <section className="packs wrap" id="draw">
        <div className="liveStats">{[
          ["TREASURY DROPS READY",snapshot.holderPacksAvailable,false],
          ["CURRENT DRAW EV",snapshot.averageHolderDropValue,true],
          ["TREASURY BALANCE",snapshot.holderAirdropTreasury,true],
          ["JACKPOT FUND",snapshot.packEvReserve,true],
          ["DRAWS COMPLETED",displayedDropCount,false],
          ["AVERAGE DROP VALUE",displayedAverageDrop,true],
          ["VALUE AIRDROPPED",displayedValueAirdropped,true],
        ].map(([label,value,currency])=><div key={String(label)}><span>{label}</span><b>{currency?`$${Number(value).toFixed(2)}`:Number(value).toLocaleString()}</b></div>)}</div>
        <div className="inventoryLog" aria-label="Inventory purchase log">
          {snapshot.inventoryLogs.length?snapshot.inventoryLogs.slice(0,4).map(log=><a key={`${log.source}-${log.signature}`} href={`https://solscan.io/tx/${log.signature}`} target="_blank" rel="noreferrer"><span>{log.source}</span><b>{log.message}</b><i>+{log.count}</i><em>{new Date(log.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</em></a>):<div><span>Inventory Log</span><b>Waiting for the next wallet purchase</b><i>+0</i><em>LIVE</em></div>}
        </div>
        <div className="sectionHead"><div><span className="kicker">LIVE HOLDER DROP</span><h2>One stock.<br/>Every 15 minutes.</h2></div><p>Fees stock the treasury with xStock drops from $1 to $50. The draw picks one weighted holder, runs the selector, sends the winning stock drop, and posts proof. Jackpot draws clear on roughly 1 in 20 epochs.</p></div>
        <div className="gachaTeaser" aria-label="Gacha packs coming soon">
          <div className="teaserPack"><img src="/stockdrops-logo.svg" alt=""/><span>SOON</span></div>
          <div>
            <span className="kicker">GACHA PACKS COMING SOON</span>
            <h3>Holder drops are live first.</h3>
            <p>The live product is the Stock Drop Picker: treasury-funded xStocks, weighted holder draws, jackpot routing, and public proof every 15 minutes.</p>
          </div>
          <b>COMING SOON</b>
        </div>
        <div className="ripBar drawBar">
          <div><span>NEXT STOCK DROP</span><b>{countdown}</b></div><div><span>ENTRY</span><b>{HOLDER_TICKET_TOKENS.toLocaleString()} DROPS = 1 TICKET</b></div><a href="#live">WATCH LIVE ROOM <span>→</span></a>
        </div>
        {walletError && <div className="walletNotice" role="alert">{walletError}</div>}
      </section>

      <section className="live" id="live"><div className="wrap">
        <div className="liveHead"><div><span className="liveDot"/> LIVE DROP ROOM</div><p>Everyone can watch the draw, proof, and chat.</p><button onClick={()=>setSpectating(!spectating)}>{spectating?"WATCHING LIVE":"SPECTATE"} ◉</button></div>
        <div className="liveRoom">
          <div className="table"><div className="tr labels"><span>WINNER</span><span>DROP</span><span>STOCK</span><span>VALUE</span><span>PROOF</span></div>{stockProofs.map((rip,i)=>{const style=stockStyle(rip.stock);return <div className="tr" key={rip.signature||i}><span><i className={`avatar a${i%4}`}/>{short(rip.winner)}</span><span>{proofPackLabel(rip.value)}</span><span><b className="stockBadge" style={stockVars(style)}><StockLogo stock={style} className="badgeLogo"/>{rip.stock}</b></span><span>${Number(rip.value).toFixed(2)}</span><span><a href={`https://solscan.io/tx/${rip.signature}`} target="_blank" rel="noreferrer">TX ↗</a></span></div>})}{stockProofs.length===0&&<div className="emptyProof">Waiting for the first confirmed holder stock drop.</div>}</div>
        </div>
      </div></section>

      <section className="fly wrap" id="flywheel"><span className="kicker">PROOF ENGINE</span><h2>Fair seed.<br/><em>On-chain receipt.</em></h2><div className="protocolSteps">{[["01","HOLDER SNAPSHOT",`${HOLDER_TICKET_TOKENS.toLocaleString()} DROPS equals one draw ticket. More tickets means more weight, not a guaranteed win.`],["02","80/20 ROUTING","80% of creator fees funds stock drops. 20% accrues to the jackpot reserve."],["03","PUBLIC SEED","Each draw combines the 15-minute epoch, a public Solana blockhash, and the holder snapshot hash."],["04",`EVERY ${AIRDROP_INTERVAL_MINUTES} MINUTES`,"One weighted holder is selected and Stock Drops resolves to one funded xStock drop."],["05","PUBLISHED PROOF","The winner, stock, amount, transaction, and fairness seed are published after payout."]].map(s=><div className="hourStep" key={s[0]}><b>{s[0]}</b><span>{s[1]}</span><p>{s[2]}</p></div>)}</div>
      <div className="dropProof"><div className="proofTitle"><div><span className="liveDot"/> STOCK DROPS PROOFS</div><b>NEXT DROP {countdown}</b></div><div className="proofRows"><div className="proofRow proofLabels"><span>WINNER</span><span>DROP</span><span>STOCK</span><span>VALUE</span><span>SEED</span><span>TX PROOF</span></div>{stockProofs.map((a,i)=><div className="proofRow" key={a.signature||i}><span>{short(a.winner)}</span><span>{proofPackLabel(a.value)}</span><span><b>{a.stock}</b></span><span>${Number(a.value).toFixed(2)}</span><span>{a.randomSeed?short(a.randomSeed):new Date(a.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span><a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noreferrer">{short(a.signature)} ↗</a></span></div>)}{stockProofs.length===0&&<div className="emptyProof">No Stock Drops holder drops published yet.</div>}</div></div><p className="disclaimer">Stock Drops draws are statistical holder rewards funded by treasury inventory. 250k DROPS equals one ticket. 80% of creator fees funds stock drops and 20% accrues to the jackpot reserve. EV is a statistical expected value calculated from available inventory; it is not a promise of profit.</p></section>

      <section className="verifiedUniverse wrap" aria-labelledby="verified-title"><div className="verifiedHead"><div><span className="kicker">WHICH STOCKS CAN DROP?</span><h2 id="verified-title">10 verified xStocks.<br/>Loaded for airdrops.</h2></div><p>Stock Drops inventory is restricted to this approved Solana xStock universe. Every draw resolves to one treasury-funded stock drop.</p></div><div className="verifiedGrid">{stocks.map((stock,index)=><a key={stock.ticker} href={`https://solscan.io/token/${VERIFIED_XSTOCKS[index].mint}`} target="_blank" rel="noreferrer"><span>{String(index+1).padStart(2,"0")}</span><StockLogo stock={stock} className="verifiedLogo"/><div><b>{stock.ticker}</b><small>{stock.name}</small></div><code>{VERIFIED_XSTOCKS[index].mint.slice(0,8)}…{VERIFIED_XSTOCKS[index].mint.slice(-6)}</code><i>↗</i></a>)}</div></section>

      <footer><div className="wrap"><div className="brand brandImage"><img src="/stockdrops-logo.svg" alt=""/><span><em>stock</em>drops</span></div><button className="caPill footerCa" type="button" onClick={()=>void copyCa()}><span>CA</span>{STOCKDROPS_MINT}<b>{copiedCa?"COPIED":"COPY"}</b></button><div className="footerLinks"><a href={X_URL} target="_blank" rel="noreferrer">X</a><a href={DEXSCREENER_URL} target="_blank" rel="noreferrer">DEXSCREENER</a><a href={JUPITER_BUY_URL} target="_blank" rel="noreferrer">BUY $DROPS</a></div><span>BUILT ON SOLANA ◈</span></div></footer>

      {(opening||result) && <div className="modal" role="dialog" aria-modal="true"><div className={`reveal ${opening?"opening":""}`}>
        <button className="close" onClick={()=>{setOpening(false);setResult(null)}}>×</button>
        {opening ? <><span className="kicker">DROPPING ONCHAIN</span><div className="ripAnim"><div className="pack"><strong>STOCK<br/>DROP</strong></div></div><p>VERIFYING DROP…</p></> : result && <><span className="kicker">YOU RECEIVED</span><div className="stockResult" style={{background:result.color,color:result.ink}}><small>xSTOCK</small><b>{result.ticker}</b><span>{result.name}</span></div><h3>${pulledValue.toFixed(2)} OF {result.name.toUpperCase()}</h3><p>Delivered to {wallet.slice(0,4)}…{wallet.slice(-4)}</p><div className="instantProof"><span>PROOF</span><b>Posts instantly after mainnet confirmation ↗</b></div><button className="primary" onClick={()=>setResult(null)}>CLOSE →</button></>}
      </div></div>}
    </main>
  );
}
