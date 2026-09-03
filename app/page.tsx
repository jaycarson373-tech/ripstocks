/* eslint-disable @next/next/no-img-element */
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { STOCK_TOKENS, type StockToken } from "@/app/lib/stock-tokens";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type InventoryStock = {
  symbol: string;
  tokenAmount: string;
  loadedValueUsd: number;
  currentValueUsd: number | null;
  fundedPulls: number;
  probabilityPct: number;
};

type PackStatus = {
  configured: boolean;
  packsLive: boolean;
  operatorEnabled: boolean;
  inventoryCount: number;
  inventoryValueUsd: number | null;
  maxPrizeUsd: number | null;
  packEvUsd: number | null;
  packPriceUsd: number;
  totalPacksOpened: number | null;
  inventory: InventoryStock[];
  inventoryDataAvailable: boolean;
  dataError: boolean;
  automationLive: boolean;
  completedEpochs: number | null;
  lastEpochStatus: string | null;
  lastHolderDrop: {
    winner: string;
    symbol: string;
    tokenAmount: string;
    transactionHash: string;
    completedAt: string | null;
  } | null;
};

type RecentPull = {
  wallet: string;
  symbol: string;
  name: string;
  tokenAmount: string;
  valueUsd: number;
  transactionHash: string;
  timestamp: number | null;
};

type RpcReceipt = {
  blockNumber: string;
  status: string;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

type PackResult = {
  stock: StockToken;
  tokenAmount: string;
  valueUsd: number;
  transactionHash: string;
};

type RevealStage = "pack" | "spin" | "lock" | "reveal";

const REEL_WINNER_INDEX = 32;

const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_CHAIN_HEX = "0x1237";
const CANONICAL_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PACK_REQUESTED_TOPIC = "0x72ce6acbcd0dcdfc48c244249d669a4a6cfd9f429795cdcc5c430ad27273f383";
const PRIZE_DELIVERED_TOPIC = "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656";
const PACK_CONTRACT = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
const PONS_TOKEN_URL = (process.env.NEXT_PUBLIC_PONS_TOKEN_URL || "").trim();
const X_URL = (process.env.NEXT_PUBLIC_X_URL || "").trim();

const EMPTY_STATUS: PackStatus = {
  configured: Boolean(PACK_CONTRACT),
  packsLive: false,
  operatorEnabled: false,
  inventoryCount: 0,
  inventoryValueUsd: null,
  maxPrizeUsd: null,
  packEvUsd: null,
  packPriceUsd: 20,
  totalPacksOpened: null,
  inventory: [],
  inventoryDataAvailable: false,
  dataError: false,
  automationLive: false,
  completedEpochs: null,
  lastEpochStatus: null,
  lastHolderDrop: null,
};

const AUTOMATION_LABELS: Record<string, string> = {
  complete: "LAST CYCLE COMPLETE",
  no_fees: "NO FEES TO ROUTE",
  dry_run: "DRY RUN VERIFIED",
  created: "CYCLE CREATED",
  claiming: "CLAIMING FEES",
  awaiting_seed: "AWAITING FUTURE BLOCK",
  holder_drop_swap: "BUYING HOLDER DROP",
  holder_drop_send: "SENDING HOLDER DROP",
  inventory_swap: "BUYING PACK INVENTORY",
  inventory_load: "LOADING PACK INVENTORY",
  error: "OPERATOR REVIEW REQUIRED",
};

function getProvider() {
  if (typeof window === "undefined") return null;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function hexWord(value: string | bigint) {
  const raw = typeof value === "bigint" ? value.toString(16) : value.toLowerCase().replace(/^0x/, "");
  return raw.padStart(64, "0");
}

function formatTokenUnits(value: bigint, decimals = 18) {
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 8);
  return fraction ? `${whole}.${fraction}` : whole;
}

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "UNAVAILABLE";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function randomCommitment() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForReceipt(provider: EthereumProvider, transactionHash: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [transactionHash] }) as RpcReceipt | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("TRANSACTION_REVERTED");
      return receipt;
    }
    await delay(1_500);
  }
  throw new Error("RECEIPT_TIMEOUT");
}

function StockLogo({ stock, decorative = false }: { stock: StockToken; decorative?: boolean }) {
  return (
    <span className="stock-token-logo" style={{ "--stock-color": stock.color } as CSSProperties}>
      <img src={stock.logoUrl} alt={decorative ? "" : `${stock.name} logo`} />
      <i aria-hidden="true">{stock.symbol.slice(0, 1)}</i>
    </span>
  );
}

export default function Home() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<PackStatus>(EMPTY_STATUS);
  const [statusState, setStatusState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [packModalOpen, setPackModalOpen] = useState(false);
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [revealStage, setRevealStage] = useState<RevealStage>("pack");
  const [recentPulls, setRecentPulls] = useState<RecentPull[]>([]);
  const [pullsState, setPullsState] = useState<"loading" | "ready" | "error">("loading");

  const networkReady = chainId === ROBINHOOD_CHAIN_ID;
  const inventoryBySymbol = useMemo(() => new Map(status.inventory.map((item) => [item.symbol, item])), [status.inventory]);
  const revealSequence = useMemo(() => {
    if (!packResult) return [];
    return Array.from({ length: 35 }, (_, index) => index === REEL_WINNER_INDEX
      ? packResult.stock
      : STOCK_TOKENS[(index * 7 + 3) % STOCK_TOKENS.length]);
  }, [packResult]);
  const arcadeReady = status.configured && status.packsLive && status.inventoryCount > 0;
  const automationLabel = status.automationLive
    ? AUTOMATION_LABELS[status.lastEpochStatus || ""] || "HOURLY ENGINE ONLINE"
    : "AUTOMATION SAFE MODE";
  const machineState = statusState === "error" || status.dataError ? "ERROR" : !status.configured ? "PRELAUNCH" : !status.operatorEnabled ? "PAUSED" : status.inventoryCount < 1 ? "EMPTY" : "READY";
  const packStatusLabel = machineState === "READY" ? "LIVE" : machineState === "EMPTY" ? "SOLD OUT" : machineState;

  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;
    const syncAccounts = (accounts: unknown) => setAccount(Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "");
    const syncChain = (value: unknown) => setChainId(typeof value === "string" ? Number.parseInt(value, 16) : null);
    void provider.request({ method: "eth_accounts" }).then(syncAccounts).catch(() => undefined);
    void provider.request({ method: "eth_chainId" }).then(syncChain).catch(() => undefined);
    provider.on?.("accountsChanged", syncAccounts);
    provider.on?.("chainChanged", syncChain);
    return () => {
      provider.removeListener?.("accountsChanged", syncAccounts);
      provider.removeListener?.("chainChanged", syncChain);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/robinhood/status", { cache: "no-store" });
        if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
        const next = await response.json() as PackStatus;
        if (active) { setStatus(next); setStatusState("ready"); }
      } catch { if (active) setStatusState("error"); }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setPullsState("loading");
      try {
        const response = await fetch("/api/robinhood/pulls", { cache: "no-store" });
        const payload = await response.json() as { pulls?: RecentPull[] };
        if (!active) return;
        if (!response.ok) {
          setPullsState("error");
          return;
        }
        setRecentPulls(payload.pulls || []);
        setPullsState("ready");
      } catch {
        if (active) setPullsState("error");
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!packResult || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const spinTimer = window.setTimeout(() => setRevealStage("spin"), 650);
    const lockTimer = window.setTimeout(() => setRevealStage("lock"), 2_650);
    const revealTimer = window.setTimeout(() => setRevealStage("reveal"), 3_150);
    return () => {
      window.clearTimeout(spinTimer);
      window.clearTimeout(lockTimer);
      window.clearTimeout(revealTimer);
    };
  }, [packResult]);

  async function switchNetwork(provider: EthereumProvider) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_CHAIN_HEX }] });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: ROBINHOOD_CHAIN_HEX,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
          blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        }],
      });
    }
    setChainId(ROBINHOOD_CHAIN_ID);
  }

  async function connectWallet() {
    const provider = getProvider();
    if (!provider) {
      setNotice("Install an EVM wallet such as Robinhood Wallet, MetaMask, or Rabby to continue.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      setAccount(accounts[0] || "");
      await switchNetwork(provider);
    } catch {
      setNotice("Wallet connection was cancelled. No transaction was sent.");
    } finally {
      setBusy(false);
    }
  }

  async function openPack() {
    if (!account) return connectWallet();
    const provider = getProvider();
    if (!provider) return;
    if (!networkReady) {
      setBusy(true);
      try { await switchNetwork(provider); } finally { setBusy(false); }
      return;
    }
    if (!termsAccepted) return;
    if (!status.configured || !status.packsLive) {
      setNotice("Pack contract is not live yet. No payment was requested.");
      return;
    }
    if (status.inventoryCount < 1) {
      setNotice("Inventory is empty. No payment was requested.");
      return;
    }
    setBusy(true);
    setNotice("Checking your 20 USDG allowance…");
    try {
      const priceAtoms = BigInt(Math.round(status.packPriceUsd * 1_000_000));
      const balanceData = `0x70a08231${hexWord(account)}`;
      const balanceHex = await provider.request({ method: "eth_call", params: [{ to: CANONICAL_USDG, data: balanceData }, "latest"] }) as string;
      if (BigInt(balanceHex) < priceAtoms) {
        setNotice("This wallet needs at least 20 USDG before it can rip a funded pack.");
        return;
      }
      const allowanceData = `0xdd62ed3e${hexWord(account)}${hexWord(PACK_CONTRACT)}`;
      const allowanceHex = await provider.request({ method: "eth_call", params: [{ from: account, to: CANONICAL_USDG, data: allowanceData }, "latest"] }) as string;
      if (BigInt(allowanceHex) < priceAtoms) {
        setNotice("Approve exactly 20 USDG in your wallet.");
        const approvalHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: account, to: CANONICAL_USDG, data: `0x095ea7b3${hexWord(PACK_CONTRACT)}${hexWord(priceAtoms)}`, value: "0x0" }],
        }) as string;
        await waitForReceipt(provider, approvalHash);
      }

      setNotice("Confirm the $20 pack rip in your wallet.");
      const commitment = randomCommitment();
      const openHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: PACK_CONTRACT, data: `0x15437c79${hexWord(commitment)}`, value: "0x0" }],
      }) as string;
      const openReceipt = await waitForReceipt(provider, openHash);
      const requestLog = openReceipt.logs.find((log) => log.address.toLowerCase() === PACK_CONTRACT.toLowerCase() && log.topics[0]?.toLowerCase() === PACK_REQUESTED_TOPIC);
      if (!requestLog?.topics[1]) throw new Error("REQUEST_EVENT_MISSING");
      const requestId = BigInt(requestLog.topics[1]);
      const entropyBlock = BigInt(requestLog.data);
      setNotice("Pack locked. Waiting for the future Robinhood Chain block…");

      for (let attempt = 0; attempt < 80; attempt += 1) {
        const blockHex = await provider.request({ method: "eth_blockNumber" }) as string;
        if (BigInt(blockHex) > entropyBlock) break;
        await delay(1_500);
        if (attempt === 79) throw new Error("ENTROPY_TIMEOUT");
      }

      setNotice("Reveal ready. Confirm the final on-chain settlement.");
      const settleHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: PACK_CONTRACT, data: `0x8533498d${hexWord(requestId)}`, value: "0x0" }],
      }) as string;
      const settleReceipt = await waitForReceipt(provider, settleHash);
      const prizeLog = settleReceipt.logs.find((log) => log.address.toLowerCase() === PACK_CONTRACT.toLowerCase() && log.topics[0]?.toLowerCase() === PRIZE_DELIVERED_TOPIC);
      if (!prizeLog?.topics[3]) throw new Error("PRIZE_EVENT_MISSING");
      const tokenAddress = `0x${prizeLog.topics[3].slice(-40)}`.toLowerCase();
      const data = prizeLog.data.replace(/^0x/, "");
      const tokenAmount = formatTokenUnits(BigInt(`0x${data.slice(0, 64)}`));
      const valueUsd = Number(BigInt(`0x${data.slice(64, 128)}`)) / 1_000_000;
      const stock = STOCK_TOKENS.find((candidate) => candidate.address.toLowerCase() === tokenAddress);
      if (!stock) throw new Error("UNSUPPORTED_PRIZE_TOKEN");
      setRevealStage(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reveal" : "pack");
      setPackResult({ stock, tokenAmount, valueUsd, transactionHash: settleHash });
      setPackModalOpen(false);
      setStatus((current) => ({ ...current, inventoryCount: Math.max(0, current.inventoryCount - 1) }));
      setNotice("");
    } catch (error) {
      const code = (error as { code?: number })?.code;
      setNotice(code === 4001 ? "Transaction cancelled. No new transaction was sent." : "The pack could not complete. Check wallet activity before retrying.");
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel = busy
    ? "PROCESSING…"
    : statusState === "error" || status.dataError
      ? "PACK STATUS UNAVAILABLE"
      : !status.configured
      ? "PACK CONTRACT PENDING"
      : !status.operatorEnabled
        ? "PACKS PAUSED"
        : status.inventoryCount < 1
          ? "ARCADE RESTOCKING"
          : "RIP A PACK — $20";

  const modalAction = !account
    ? "CONNECT WALLET"
    : !networkReady
      ? "SWITCH TO ROBINHOOD CHAIN"
      : "CONFIRM $20 USDG PACK";

  return (
    <main id="top">
      <div className="ambient" aria-hidden="true" />
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="#top" className="brand" aria-label="StonkRips home">
          <span className="brand-logo" aria-hidden="true">$RIP</span>
          <b>STONK<span>RIPS</span></b>
        </a>
        <div className="nav-links">
          <a href="#arcade">The Arcade</a>
          <a href="#prize-pool">Prize Pool</a>
          <a href="#how">How It Works</a>
          <a href="#restock">Restock Engine</a>
          <a href="#proof">Proof</a>
          <a href="#docs">Docs</a>
        </div>
        <button className="wallet-button" type="button" onClick={() => void connectWallet()} disabled={busy}>
          {account ? shortAddress(account) : "CONNECT WALLET"}
        </button>
      </nav>

      <section className="hero" id="arcade">
        <Image className="hero-arcade-art" src="/stonkrips-og.png" alt="" fill priority sizes="100vw" />
        <div className="hero-overlay" aria-hidden="true" />
        <div className="hero-inner shell">
          <div className="hero-copy">
            <div className="network-label"><span /> THE STOCK MARKET HAS LOOT BOXES NOW.</div>
            <h1>RIP A PACK.<br/><em>PULL A STOCK.</em></h1>
            <p className="lead"><strong>$20 per pack.</strong> One onchain-selected Stock Token. Delivered directly to your wallet.</p>
            <p className="sublead">Every trade feeds the game. Pons v2 creator fees restock packs and fund hourly holder drops.</p>
            <div className="hero-actions">
              <button className="rip-button" type="button" onClick={() => setPackModalOpen(true)} disabled={!arcadeReady || busy}>
                {primaryLabel}<span aria-hidden="true">●</span>
              </button>
              <a className="secondary-button" href="#pack">VIEW PACK</a>
            </div>
            {notice && <p className="notice" role="status">{notice}</p>}
            <div className="hero-facts" aria-label="StonkRips fixed product facts">
              <span><b>$20</b><small>PACK PRICE</small></span>
              <span><b>10</b><small>STOCK TOKENS</small></span>
              <span><b>1 HR</b><small>HOLDER DROP CYCLE</small></span>
            </div>
          </div>

          <div className={"pack-showcase state-" + machineState.toLowerCase().replace(" ", "-")} id="pack" aria-label={"StonkRips pack. Status: " + machineState}>
            <div className="pack-glow" aria-hidden="true" />
            <div className="pack-product">
              <Image className="premium-pack" src="/stonkrips-pack.png" alt="Premium black StonkRips pack featuring the ten supported Stock Tokens" width={1024} height={1536} priority />
              <span className="foil-sheen" aria-hidden="true" />
            </div>
            <div className="pack-readout">
              <span>STONKRIPS // PACK_01</span>
              <i>{packStatusLabel}</i>
              <dl>
                <div><dt>PRICE</dt><dd>{formatUsd(status.packPriceUsd)}</dd></div>
                <div><dt>FUNDED PACKS</dt><dd>{!status.configured ? "PENDING" : !status.inventoryDataAvailable ? "UNAVAILABLE" : status.inventoryCount}</dd></div>
                <div><dt>STOCK UNIVERSE</dt><dd>10</dd></div>
                <div><dt>PACK EV</dt><dd>{status.packEvUsd === null ? "UNAVAILABLE" : formatUsd(status.packEvUsd)}</dd></div>
              </dl>
              <button type="button" onClick={() => setPackModalOpen(true)} disabled={!arcadeReady || busy}>{primaryLabel}</button>
              <small>Purchases stay disabled unless an onchain funded slot is available.</small>
            </div>
          </div>
        </div>
        <div className="stock-universe-strip shell" aria-label="Supported Stock Tokens">
          {STOCK_TOKENS.map((stock) => <span key={stock.symbol}><StockLogo stock={stock} /><b>{stock.symbol}</b></span>)}
        </div>
      </section>

      <div className="market-tape" aria-hidden="true"><div>{[...STOCK_TOKENS, ...STOCK_TOKENS].map((stock, index) => <span key={`${stock.symbol}-tape-${index}`}><StockLogo stock={stock} decorative /><b>{stock.symbol}</b><i>•</i></span>)}</div></div>

      <section className="live-stats shell" aria-label="Verified StonkRips statistics">
        <span><b>{status.totalPacksOpened === null ? "NOT REPORTED" : status.totalPacksOpened}</b><small>TOTAL PACKS OPENED</small></span>
        <span><b>{status.inventoryDataAvailable ? status.inventoryCount : "NOT REPORTED"}</b><small>FUNDED PACKS</small></span>
        <span><b>{status.packEvUsd === null ? "NOT REPORTED" : formatUsd(status.packEvUsd)}</b><small>CURRENT PACK EV</small></span>
        <span><b>{status.completedEpochs === null ? "NOT REPORTED" : status.completedEpochs}</b><small>HOLDER DROPS COMPLETED</small></span>
      </section>

      <section className="arcade-steps shell" aria-label="Pack overview">
        <article><span>01</span><h2>INSERT</h2><p>Connect your wallet and approve exactly 20 USDG.</p></article>
        <article><span>02</span><h2>GRAB</h2><p>A funded inventory slot is selected by the on-chain pack flow.</p></article>
        <article><span>03</span><h2>RIP</h2><p>Reveal the confirmed result and receive the Stock Token in your wallet.</p></article>
      </section>

      <section className="prize-section shell" id="prize-pool">
        <div className="section-heading">
          <span>THE TEN POSSIBLE PULLS</span>
          <h2>WHAT&apos;S INSIDE<br/>THE MACHINES.</h2>
          <p>Browse the supported Stock Token universe. Only assets already loaded into the pack contract can be selected.</p>
        </div>
        <div className="prize-grid">
          {STOCK_TOKENS.map((stock, index) => {
            const inventory = inventoryBySymbol.get(stock.symbol);
            const unavailable = status.configured && !status.inventoryDataAvailable;
            return (
              <article className={inventory ? "is-loaded" : ""} key={stock.symbol}>
                <div className="prize-card-head"><em>{String(index + 1).padStart(2, "0")}</em><StockLogo stock={stock} /><a href={`https://robinhoodchain.blockscout.com/token/${stock.address}`} target="_blank" rel="noreferrer" aria-label={`View ${stock.name} token on Blockscout`}>↗</a></div>
                <h3>{stock.symbol}</h3>
                <p>{stock.name}</p>
                <div className="prize-status"><span>{inventory ? "LOADED" : unavailable ? "UNAVAILABLE" : "NOT LOADED"}</span>{inventory && <b>{inventory.fundedPulls} FUNDED {inventory.fundedPulls === 1 ? "PULL" : "PULLS"}</b>}</div>
              </article>
            );
          })}
        </div>
        <p className="token-disclosure">Stock Tokens provide economic exposure to referenced assets. They are not traditional shares and do not provide shareholder rights.</p>
      </section>

      <section className="recent-pulls shell" id="recent-pulls">
        <div className="section-heading compact">
          <span>VERIFIED ON-CHAIN RESULTS</span>
          <h2>RECENT PULLS.</h2>
        </div>
        <div className="crt-leaderboard">
          <div className="leaderboard-head"><span>PLAYER</span><span>PRIZE</span><span>QUANTITY</span><span>VALUE AT LOAD</span><span>TIME</span><span>RECEIPT</span></div>
          {pullsState === "loading" && <p className="leaderboard-empty">READING ROBINHOOD CHAIN…</p>}
          {pullsState === "error" && <p className="leaderboard-empty">RECENT PULLS ARE TEMPORARILY UNAVAILABLE.</p>}
          {pullsState === "ready" && recentPulls.length === 0 && <p className="leaderboard-empty">THE FIRST RIP IS WAITING.</p>}
          {pullsState === "ready" && recentPulls.map((pull) => (
            <div className="leaderboard-row" key={pull.transactionHash}>
              <span>{shortAddress(pull.wallet)}</span><b>{pull.symbol}</b><span>{pull.tokenAmount}</span><span>{formatUsd(pull.valueUsd)}</span><time dateTime={pull.timestamp ? new Date(pull.timestamp).toISOString() : undefined}>{pull.timestamp ? new Date(pull.timestamp).toLocaleString() : "UNAVAILABLE"}</time><a href={`https://robinhoodchain.blockscout.com/tx/${pull.transactionHash}`} target="_blank" rel="noreferrer">VIEW ↗</a>
            </div>
          ))}
        </div>
      </section>

      <section className="holder-drops shell" id="holder-drops">
        <div className="section-heading compact">
          <span>REAL HOLDER REWARDS</span>
          <h2>HOLDER DROPS.</h2>
          <p>One eligible weighted holder receives the Stock Token purchased by the live hourly fee cycle. Nothing appears here until the database records a completed transfer.</p>
        </div>
        <div className="holder-drop-panel">
          <div><small>STATUS</small><b>{status.automationLive ? automationLabel : "ACTIVATING"}</b></div>
          <div><small>TOTAL COMPLETED</small><b>{status.completedEpochs === null ? "NOT REPORTED" : status.completedEpochs}</b></div>
          <div><small>LAST WINNER</small><b>{status.lastHolderDrop ? shortAddress(status.lastHolderDrop.winner) : "NO VERIFIED DROP"}</b></div>
          <div><small>ASSET</small><b>{status.lastHolderDrop?.symbol || "NOT REPORTED"}</b></div>
          <div><small>EXACT TOKEN AMOUNT</small><b>{status.lastHolderDrop ? `${status.lastHolderDrop.tokenAmount} ${status.lastHolderDrop.symbol}` : "NOT REPORTED"}</b></div>
          <div><small>RECEIPT</small>{status.lastHolderDrop ? <a href={`https://robinhoodchain.blockscout.com/tx/${status.lastHolderDrop.transactionHash}`} target="_blank" rel="noreferrer">VIEW ↗</a> : <b>NOT AVAILABLE</b>}</div>
        </div>
      </section>

      <section className="how shell" id="how">
        <div className="section-heading"><span>THE ON-CHAIN PACK FLOW</span><h2>FOUR MOVES.<br/>ONE RECEIPT.</h2><p>The animation never chooses your prize. It starts only after the contract confirms the result.</p></div>
        <div className="technical-steps">
          <article><b>01</b><h3>CONNECT</h3><p>Use an EVM wallet on Robinhood Chain, network 4663. ETH pays network gas.</p></article>
          <article><b>02</b><h3>APPROVE</h3><p>Approve exactly 20 canonical USDG for the configured StonkRips pack contract.</p></article>
          <article><b>03</b><h3>SELECT</h3><p>A future Robinhood Chain blockhash selects one funded inventory slot. This transparent method is not oracle VRF.</p></article>
          <article><b>04</b><h3>RECEIVE</h3><p>Settlement sends the selected Stock Token to the buyer and exposes the transaction receipt.</p></article>
        </div>
      </section>

      <section className="restock-engine shell" id="restock">
        <div className="restock-copy">
          <span>PONS V2 CREATOR FEES</span>
          <h2>EVERY FEE<br/><em>RELOADS THE ARCADE.</em></h2>
          <p>Each successful hourly cycle claims Pons v2 creator fees. Any project-token side is converted into canonical SPY, then the resulting budget is routed 50/50. If no fees are available, no drop or inventory is created.</p>
          <i className={status.automationLive ? "is-live" : ""}>{automationLabel}</i>
        </div>
        <div className="restock-machine" aria-label="50 percent holder drop and 50 percent pack inventory split">
          <div className="fee-inlet"><span>PONS FEES</span><b>↓</b></div>
          <div className="split-line" aria-hidden="true"><i /><i /></div>
          <article><b>50%</b><span>HOLDER DROP CHAMBER</span><p>One weighted externally owned holder receives a Stock Token bought from half of the claimed fee budget.</p></article>
          <article><b>50%</b><span>PACK INVENTORY</span><p>The remaining half buys one approved Stock Token lot and loads it into the pack contract.</p></article>
        </div>
        <div className="flywheel-line" aria-label="Trading to fees to stocks to packs and drops, then repeat"><span>TRADING</span><i>→</i><span>FEES</span><i>→</i><span>STOCKS</span><i>→</i><span>PACKS + DROPS</span><i>↻</i></div>
        <div className="engine-stats">
          <span><b>{status.completedEpochs === null ? "NOT REPORTED" : status.completedEpochs}</b><small>COMPLETED FEE CYCLES</small></span>
          <span><b>{status.inventoryDataAvailable ? status.inventoryCount : "NOT REPORTED"}</b><small>FUNDED PACK LOTS</small></span>
          <span><b>250,000</b><small>LAUNCH TOKENS PER TICKET</small></span>
        </div>
        <p className="engine-note">Holder weight is the wallet&apos;s launch-token balance divided by 250,000, rounded down to whole tickets at the committed snapshot block. Contracts, pools, the automation wallet, and configured exclusions do not participate.</p>
        <a href={PONS_TOKEN_URL || "https://robinhood.ponslaunchpad.com/"} target="_blank" rel="noreferrer">{PONS_TOKEN_URL ? "OPEN STONKRIPS ON PONS ↗" : "OPEN PONS V2 ↗"}</a>
      </section>

      <section className="proof-section shell" id="proof">
        <div className="section-heading">
          <span>VERIFIABLE BY DEFAULT</span>
          <h2>PROOF,<br/>NOT PROMISES.</h2>
          <p>The homepage stays simple. The receipts and configured mechanics live here.</p>
        </div>
        <div className="proof-grid">
          <details open>
            <summary>PACK INVENTORY <span>{status.inventoryDataAvailable ? `${status.inventoryCount} FUNDED` : "UNAVAILABLE"}</span></summary>
            <div className="proof-body">
              {status.inventoryDataAvailable && status.inventory.length > 0 ? status.inventory.map((item) => (
                <p key={item.symbol}><b>{item.symbol}</b><span>{item.tokenAmount} tokens · {item.fundedPulls} funded {item.fundedPulls === 1 ? "pull" : "pulls"} · {formatUsd(item.currentValueUsd ?? item.loadedValueUsd)} · {item.probabilityPct.toFixed(2)}%</span></p>
              )) : <p><b>STATUS</b><span>{status.configured ? "No funded inventory is currently reported." : "Pack contract is not configured."}</span></p>}
              {PACK_CONTRACT && <a href={`https://robinhoodchain.blockscout.com/address/${PACK_CONTRACT}`} target="_blank" rel="noreferrer">VIEW PACK CONTRACT ↗</a>}
            </div>
          </details>
          <details>
            <summary>PACK SELECTION <span>FUTURE BLOCK</span></summary>
            <div className="proof-body"><p><b>COMMIT</b><span>The buyer first commits and locks the funded inventory state.</span></p><p><b>SELECT</b><span>A future Robinhood Chain blockhash enters the contract&apos;s selection function.</span></p><p><b>DELIVER</b><span>The selected funded slot is removed and its Stock Token is transferred to the buyer.</span></p></div>
          </details>
          <details>
            <summary>FEE ROUTING <span>{status.automationLive ? "LIVE" : "SAFE MODE"}</span></summary>
            <div className="proof-body"><p><b>SOURCE</b><span>Pons v2 creator fees from the configured launch token.</span></p><p><b>NORMALIZE</b><span>Any project-token side is swapped into the canonical SPY fee asset.</span></p><p><b>SPLIT</b><span>50% funds one holder drop and 50% funds one pack inventory lot.</span></p><p><b>LAST CYCLE</b><span>{status.lastEpochStatus ? AUTOMATION_LABELS[status.lastEpochStatus] || status.lastEpochStatus : "NOT REPORTED"}</span></p></div>
          </details>
          <details>
            <summary>RECEIPTS <span>ONCHAIN + DATABASE</span></summary>
            <div className="proof-body"><p><b>PACKS</b><span>Purchase and delivery receipts are read from Robinhood Chain PrizeDelivered events.</span></p><p><b>DROPS</b><span>Epoch, winner, asset, and delivery transaction are read from completed Supabase automation rows.</span></p><p><b>SAFETY</b><span>No user-facing activity row is rendered without a recorded transaction.</span></p></div>
          </details>
        </div>
      </section>

      <section className="docs-section shell" id="docs">
        <div className="section-heading compact"><span>THE OPERATOR MANUAL</span><h2>DOCS.</h2></div>
        <div className="docs-grid">
          <article><b>01</b><h3>PACKS</h3><p>Each rip costs exactly 20 canonical USDG. ETH pays Robinhood Chain gas. A purchase cannot begin unless the contract reports at least one funded Stock Token slot.</p></article>
          <article><b>02</b><h3>HOLDER WEIGHT</h3><p>Eligible externally owned wallets receive one whole ticket per 250,000 launch tokens at the committed snapshot block. Configured exclusions and contracts do not participate.</p></article>
          <article><b>03</b><h3>CREATOR FEES</h3><p>The hourly worker claims the configured Pons v2 creator-fee stream, normalizes it into SPY, and records the epoch before buying or sending Stock Tokens.</p></article>
          <article><b>04</b><h3>SUSTAINABILITY</h3><p>Inventory value, current pack EV, funded pulls, and completed holder drops are measured from real sources. Parameters are reviewed manually and any change should be disclosed before activation.</p></article>
        </div>
      </section>

      <section className="next-rooms shell" id="next-rooms">
        <div className="section-heading"><span>NEXT ROOMS · NOT LIVE</span><h2>MORE MACHINES<br/>BEHIND THE DOOR.</h2><p>Future releases stay visibly separate until each mechanic is funded, tested, and activated.</p></div>
        <div className="room-grid">
          <article><em>LOCKED 01</em><h3>CURATED SERIES</h3><p>Distinct inventory-backed rooms for indexes, technology, and community-selected rotations.</p></article>
          <article><em>LOCKED 02</em><h3>TREASURY DESK</h3><p>A receipt-first view of fee claims, purchases, inventory loads, and holder drops.</p></article>
          <article><em>LOCKED 03</em><h3>PARTNER DROPS</h3><p>Clearly disclosed sponsored prizes added without drawing from existing funded inventory.</p></article>
        </div>
      </section>

      <section className="legal shell">
        <b>IMPORTANT</b>
        <p>Robinhood Chain Stock Tokens provide economic exposure to referenced assets; they are not shares and do not provide shareholder rights. Users are responsible for confirming they are legally eligible to use Robinhood Chain Stock Tokens in their jurisdiction. Prize values and probabilities appear only when funded inventory can be read from the configured contract. Holder drops occur only when automation reports live and claimable fees exist. StonkRips is independent and is not endorsed by Robinhood, Pons, or 0x.</p>
      </section>

      <footer className="shell">
        <a href="#top" className="brand" aria-label="StonkRips home"><span className="brand-logo" aria-hidden="true">$RIP</span><b>STONK<span>RIPS</span></b></a>
        <div><a href="#proof">PROOF</a><a href="#docs">DOCS</a><a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">EXPLORER</a>{X_URL && <a href={X_URL} target="_blank" rel="noreferrer">X</a>}</div>
        <span>ROBINHOOD CHAIN · 4663</span>
      </footer>

      {packModalOpen && (
        <div className="pack-modal" role="dialog" aria-modal="true" aria-labelledby="pack-modal-title">
          <div className="pack-modal-card">
            <button className="modal-close" type="button" onClick={() => setPackModalOpen(false)} aria-label="Close pack window">×</button>
            <span>STONKRIPS // PACK_01</span>
            <h2 id="pack-modal-title">READY TO RIP?</h2>
            <Image className="modal-pack" src="/stonkrips-pack.png" alt="Sealed StonkRips pack" width={256} height={384} />
            <div className="purchase-summary"><b>$20 USDG</b><small>ONE FUNDED STOCK TOKEN · ETH GAS REQUIRED</small></div>
            <label className="eligibility"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>I am 18+ and legally eligible to use Robinhood Chain Stock Tokens in my jurisdiction.</span></label>
            {notice && <p className="notice" role="status">{notice}</p>}
            <button className="modal-action" type="button" onClick={() => void openPack()} disabled={busy || (Boolean(account && networkReady) && !termsAccepted)}>{busy ? "PROCESSING…" : modalAction}</button>
            <small>No payment is requested unless a funded contract slot is available.</small>
          </div>
        </div>
      )}

      {packResult && (
        <div className={`result-modal reveal-${revealStage}`} role="dialog" aria-modal="true" aria-label="Confirmed pack result">
          <div className="case-reveal">
            {revealStage !== "reveal" && <button className="skip-reveal" type="button" onClick={() => setRevealStage("reveal")}>SKIP ANIMATION</button>}
            <div className="case-reveal-header"><span>STONKRIPS // VERIFIED REVEAL</span><b>{revealStage === "pack" ? "RIPPING PACK…" : revealStage === "spin" ? "SELECTING CONFIRMED RESULT…" : revealStage === "lock" ? "RESULT LOCKED" : "PULL CONFIRMED"}</b></div>
            <div className="pack-tear-stage" aria-hidden="true"><Image src="/stonkrips-pack.png" alt="" width={270} height={405} /><i /></div>
            <div className="case-reel-window" aria-hidden="true">
              <div className="case-reel-marker"><i /><span /></div>
              <div className="case-reel-track">
                {revealSequence.map((stock, index) => (
                  <div className={`case-reel-card${index === REEL_WINNER_INDEX ? " is-winning" : ""}`} key={`${stock.symbol}-reveal-${index}`}>
                    <StockLogo stock={stock} decorative />
                    <b>{stock.symbol}</b>
                    <small>STOCK TOKEN</small>
                  </div>
                ))}
              </div>
            </div>
            <p className="case-proof-note">THE REEL DISPLAYS THE RESULT ALREADY CONFIRMED BY THE ROBINHOOD CHAIN TRANSACTION.</p>
            <div className="confirmed-prize">
              <button type="button" onClick={() => setPackResult(null)} aria-label="Close result">×</button>
              <span>YOU PULLED · DELIVERED ONCHAIN</span>
              <StockLogo stock={packResult.stock}/>
              <h2>{packResult.stock.name}</h2>
              <em>{packResult.stock.symbol}</em>
              <p>{packResult.tokenAmount} {packResult.stock.symbol}</p>
              <b>{formatUsd(packResult.valueUsd)} VALUE AT LOAD</b>
              <div className="result-actions"><a href={`https://robinhoodchain.blockscout.com/tx/${packResult.transactionHash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a><button type="button" onClick={() => { setPackResult(null); setTermsAccepted(false); setPackModalOpen(true); }}>RIP ANOTHER</button></div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
