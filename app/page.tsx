/* eslint-disable @next/next/no-img-element */
"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildCaseReel, type CaseReelItem } from "@/app/lib/case-reel";
import { type StockToken } from "@/app/lib/stock-tokens";
import { ACTIVE_PACK, PACK_PRICE_USD, PACK_RARITIES, PACK_RARITY_ODDS_PUBLISHED, PACK_STOCKS as STOCK_TOKENS, rarityForValue } from "@/app/lib/pack-config";
import { type RarityTier } from "@/app/lib/rarity";
import { ensureRobinhoodChain, ROBINHOOD_CHAIN_ID, walletAccount, walletChainId, walletErrorMessage, type EthereumProvider } from "@/app/lib/wallet-provider";

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
  rarity: RarityTier;
};

type RevealStage = "pack" | "spin" | "lock" | "reveal";

const WALLET_DISCONNECTED_KEY = "stonkrips.wallet-disconnected";
const CANONICAL_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PACK_REQUESTED_TOPIC = "0x72ce6acbcd0dcdfc48c244249d669a4a6cfd9f429795cdcc5c430ad27273f383";
const PRIZE_DELIVERED_TOPIC = "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656";
const ACTIVE_REQUEST_SELECTOR = "0xb57e51c4";
const REQUEST_SELECTOR = "0x81d12c58";
const REEL_WINNER_INDEX = 45;
const PACK_CONTRACT = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
const PONS_TOKEN_URL = (process.env.NEXT_PUBLIC_PONS_TOKEN_URL || "").trim();
const X_URL = (process.env.NEXT_PUBLIC_X_URL || "").trim();
const PUBLIC_RESERVE_DISPLAY_FLOOR_USD = ACTIVE_PACK.inventoryRequirements.publicAvailabilityFloorUsd;

const EMPTY_STATUS: PackStatus = {
  configured: Boolean(PACK_CONTRACT),
  packsLive: false,
  operatorEnabled: false,
  inventoryCount: 0,
  inventoryValueUsd: null,
  maxPrizeUsd: null,
  packPriceUsd: PACK_PRICE_USD,
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
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function formatUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "UNAVAILABLE";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
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

async function readActivePackRequest(provider: EthereumProvider) {
  const requestIdHex = await provider.request({ method: "eth_call", params: [{ to: PACK_CONTRACT, data: ACTIVE_REQUEST_SELECTOR }, "latest"] }) as string;
  const requestId = BigInt(requestIdHex);
  if (requestId === BigInt(0)) return null;
  const encoded = await provider.request({ method: "eth_call", params: [{ to: PACK_CONTRACT, data: `${REQUEST_SELECTOR}${hexWord(requestId)}` }, "latest"] }) as string;
  const value = encoded.replace(/^0x/, "");
  if (value.length < 320) throw new Error("ACTIVE_REQUEST_UNAVAILABLE");
  return {
    requestId,
    buyer: `0x${value.slice(24, 64)}`.toLowerCase(),
    entropyBlock: BigInt(`0x${value.slice(192, 256)}`),
  };
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
  const [myRips, setMyRips] = useState<RecentPull[]>([]);
  const [myRipsState, setMyRipsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [clock, setClock] = useState<number | null>(null);
  const [reelStop, setReelStop] = useState("-5800px");
  const [recoverableRequest, setRecoverableRequest] = useState<{ requestId: bigint; buyer: string; entropyBlock: bigint } | null>(null);
  const manuallyDisconnected = useRef(false);
  const revealTrackRef = useRef<HTMLDivElement>(null);

  const networkReady = chainId === ROBINHOOD_CHAIN_ID;
  const inventoryBySymbol = useMemo(() => new Map(status.inventory.map((item) => [item.symbol, item])), [status.inventory]);
  const reelItems = useMemo<CaseReelItem<StockToken, RarityTier>[]>(() => {
    if (!packResult) return [];
    return buildCaseReel(STOCK_TOKENS, packResult.stock, packResult.rarity, (stock) => {
      const inventory = inventoryBySymbol.get(stock.symbol);
      const averageLoadedValue = inventory && inventory.fundedPulls > 0 ? inventory.loadedValueUsd / inventory.fundedPulls : 0;
      return rarityForValue(averageLoadedValue);
    }, REEL_WINNER_INDEX);
  }, [inventoryBySymbol, packResult]);
  const publicReserveReady = status.inventoryValueUsd !== null && status.inventoryValueUsd >= PUBLIC_RESERVE_DISPLAY_FLOOR_USD;
  const approximateAvailability = !status.inventoryDataAvailable
    ? "UNAVAILABLE"
    : !publicReserveReady || status.inventoryCount < 1
      ? "RESTOCKING"
      : `≈ ${status.inventoryCount} LEFT`;
  const arcadeReady = ACTIVE_PACK.enabled && statusState === "ready" && !status.dataError && status.configured && status.packsLive && status.inventoryCount > 0 && publicReserveReady;
  const automationLabel = status.automationLive
    ? AUTOMATION_LABELS[status.lastEpochStatus || ""] || "HOURLY ENGINE ONLINE"
    : "AUTOMATION SAFE MODE";
  const machineState = statusState === "loading" ? "CHECKING" : statusState === "error" || status.dataError ? "ERROR" : !status.configured ? "PRELAUNCH" : !ACTIVE_PACK.enabled || !status.operatorEnabled ? "PAUSED" : status.inventoryCount < 1 || !publicReserveReady ? "RESTOCKING" : "READY";
  const packStatusLabel = machineState === "READY" ? "LIVE" : machineState;
  const holderDrawActive = status.automationLive && ["awaiting_seed", "holder_drop_swap", "holder_drop_send"].includes(status.lastEpochStatus || "");
  const nextHourlyCycle = clock === null ? null : Math.ceil((clock + 1) / 3_600_000) * 3_600_000;
  const holderCountdown = !status.automationLive
    ? "PONS NOT CONNECTED"
    : holderDrawActive
      ? "SELECTING"
      : nextHourlyCycle === null
        ? "SYNCING"
        : formatCountdown(nextHourlyCycle - clock!);

  useEffect(() => {
    try { manuallyDisconnected.current = sessionStorage.getItem(WALLET_DISCONNECTED_KEY) === "true"; } catch { /* Storage can be blocked by the browser. */ }
    const provider = getProvider();
    if (!provider) return;
    let active = true;
    const syncAccounts = (accounts: unknown) => {
      if (active && !manuallyDisconnected.current) {
        setAccount(walletAccount(accounts));
        setTermsAccepted(false);
      }
    };
    const syncChain = (value: unknown) => { if (active) setChainId(walletChainId(value)); };
    const syncDisconnect = () => {
      if (!active) return;
      setAccount("");
      setChainId(null);
      setTermsAccepted(false);
    };
    void provider.request({ method: "eth_accounts" }).then(syncAccounts).catch(() => undefined);
    void provider.request({ method: "eth_chainId" }).then(syncChain).catch(() => undefined);
    provider.on?.("accountsChanged", syncAccounts);
    provider.on?.("chainChanged", syncChain);
    provider.on?.("disconnect", syncDisconnect);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", syncAccounts);
      provider.removeListener?.("chainChanged", syncChain);
      provider.removeListener?.("disconnect", syncDisconnect);
    };
  }, []);

  useEffect(() => {
    const provider = getProvider();
    if (!provider || !account || !networkReady || !status.configured) {
      void Promise.resolve().then(() => setRecoverableRequest(null));
      return;
    }
    let active = true;
    void readActivePackRequest(provider)
      .then((request) => {
        if (active) setRecoverableRequest(request?.buyer === account.toLowerCase() ? request : null);
      })
      .catch(() => { if (active) setRecoverableRequest(null); });
    return () => { active = false; };
  }, [account, networkReady, status.configured]);

  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
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
    if (!account) {
      void Promise.resolve().then(() => {
        setMyRips([]);
        setMyRipsState("idle");
      });
      return;
    }
    let active = true;
    void Promise.resolve().then(() => { if (active) setMyRipsState("loading"); });
    void fetch(`/api/robinhood/pulls?wallet=${encodeURIComponent(account)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { pulls?: RecentPull[] };
        if (!active) return;
        if (!response.ok) {
          setMyRipsState("error");
          return;
        }
        setMyRips(payload.pulls || []);
        setMyRipsState("ready");
      })
      .catch(() => { if (active) setMyRipsState("error"); });
    return () => { active = false; };
  }, [account]);

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
    const measure = () => {
      const winner = revealTrackRef.current?.querySelector<HTMLElement>("[data-winning='true']");
      if (winner) setReelStop(`${-(winner.offsetLeft + winner.offsetWidth / 2)}px`);
    };
    const frame = window.requestAnimationFrame(measure);
    const spinTimer = window.setTimeout(() => setRevealStage(stage => stage === "reveal" ? stage : "spin"), 450);
    const lockTimer = window.setTimeout(() => setRevealStage(stage => stage === "reveal" ? stage : "lock"), 4_650);
    const revealTimer = window.setTimeout(() => setRevealStage("reveal"), 5_250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(spinTimer);
      window.clearTimeout(lockTimer);
      window.clearTimeout(revealTimer);
    };
  }, [packResult]);

  async function switchNetwork(provider: EthereumProvider) {
    try {
      setChainId(await ensureRobinhoodChain(provider));
    } catch (error) {
      setChainId(walletChainId(await provider.request({ method: "eth_chainId" }).catch(() => null)));
      throw error;
    }
  }

  async function connectWallet() {
    const provider = getProvider();
    if (!provider) {
      setNotice("On mobile, open StonkRips in your EVM wallet’s browser. On desktop, enable your wallet extension to connect.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const nextAccount = walletAccount(await provider.request({ method: "eth_requestAccounts" }));
      if (!nextAccount) throw new Error("NO_WALLET_ACCOUNT");
      manuallyDisconnected.current = false;
      try { sessionStorage.removeItem(WALLET_DISCONNECTED_KEY); } catch { /* The in-memory session still works. */ }
      setAccount(nextAccount);
      await switchNetwork(provider);
    } catch (error) {
      setNotice(walletErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectWallet() {
    const provider = getProvider();
    manuallyDisconnected.current = true;
    try { sessionStorage.setItem(WALLET_DISCONNECTED_KEY, "true"); } catch { /* The current page still disconnects. */ }
    setAccount("");
    setChainId(null);
    setTermsAccepted(false);
    setPackModalOpen(false);
    setNotice("Wallet disconnected from StonkRips. No transaction was sent.");
    setBusy(true);
    try {
      await provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // Not every injected wallet implements EIP-2255. Clearing the local
      // session still disconnects this page without sending a transaction.
    } finally {
      setBusy(false);
    }
  }

  async function settleAndReveal(provider: EthereumProvider, requestId: bigint, entropyBlock: bigint) {
    setNotice("Pack locked. Waiting for the future Robinhood Chain block…");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const blockHex = await provider.request({ method: "eth_blockNumber" }) as string;
      if (BigInt(blockHex) > entropyBlock) break;
      await delay(1_500);
      if (attempt === 79) throw new Error("ENTROPY_TIMEOUT");
    }

    setNotice("Outcome ready. Confirm the final onchain settlement.");
    let settleHash: string;
    let settleReceipt: RpcReceipt;
    try {
      settleHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: PACK_CONTRACT, data: `0x8533498d${hexWord(requestId)}`, value: "0x0" }],
      }) as string;
      settleReceipt = await waitForReceipt(provider, settleHash);
    } catch (error) {
      const requestBlock = entropyBlock > BigInt(2) ? entropyBlock - BigInt(2) : BigInt(0);
      const logs = await provider.request({ method: "eth_getLogs", params: [{ address: PACK_CONTRACT, fromBlock: `0x${requestBlock.toString(16)}`, toBlock: "latest", topics: [PRIZE_DELIVERED_TOPIC, `0x${hexWord(requestId)}`] }] }) as Array<{ transactionHash: string }>;
      if (logs.length !== 1) throw error;
      settleHash = logs[0].transactionHash;
      settleReceipt = await waitForReceipt(provider, settleHash);
    }
    const prizeLog = settleReceipt.logs.find((log) => log.address.toLowerCase() === PACK_CONTRACT.toLowerCase() && log.topics[0]?.toLowerCase() === PRIZE_DELIVERED_TOPIC);
    if (!prizeLog?.topics[3]) throw new Error("PRIZE_EVENT_MISSING");
    const tokenAddress = `0x${prizeLog.topics[3].slice(-40)}`.toLowerCase();
    const data = prizeLog.data.replace(/^0x/, "");
    const tokenAmount = formatTokenUnits(BigInt(`0x${data.slice(0, 64)}`));
    const valueUsd = Number(BigInt(`0x${data.slice(64, 128)}`)) / 1_000_000;
    const stock = STOCK_TOKENS.find((candidate) => candidate.address.toLowerCase() === tokenAddress);
    if (!stock) throw new Error("UNSUPPORTED_PRIZE_TOKEN");
    setRevealStage(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reveal" : "pack");
    setPackResult({ stock, tokenAmount, valueUsd, transactionHash: settleHash, rarity: rarityForValue(valueUsd) });
    setRecoverableRequest(null);
    setPackModalOpen(false);
    setStatus((current) => ({ ...current, inventoryCount: Math.max(0, current.inventoryCount - 1) }));
    setNotice("");
  }

  async function openPack() {
    if (!account) return connectWallet();
    const provider = getProvider();
    if (!provider) return;
    if (!networkReady) {
      setBusy(true);
      try { await switchNetwork(provider); } catch (error) { setNotice(walletErrorMessage(error)); } finally { setBusy(false); }
      return;
    }
    if (!termsAccepted) return;
    if (!status.configured) {
      setNotice("Pack contract is not configured. No payment was requested.");
      return;
    }
    setBusy(true);
    setNotice("Checking for an unfinished pack…");
    try {
      const activeRequest = await readActivePackRequest(provider);
      if (activeRequest) {
        if (activeRequest.buyer !== account.toLowerCase()) {
          setNotice("Another pack is settling. No payment was requested; try again after it finishes.");
          setBusy(false);
          return;
        }
        await settleAndReveal(provider, activeRequest.requestId, activeRequest.entropyBlock);
        setBusy(false);
        return;
      }
    } catch {
      setNotice("The active pack state could not be verified. No payment was requested.");
      setBusy(false);
      return;
    }
    if (!status.packsLive) {
      setNotice("Pack contract is not live yet. No payment was requested.");
      setBusy(false);
      return;
    }
    if (status.inventoryCount < 1 || !publicReserveReady) {
      setNotice("The pack reserve is below the public availability floor. No payment was requested.");
      setBusy(false);
      return;
    }
    setNotice(`Checking your ${PACK_PRICE_USD} USDG allowance…`);
    try {
      const priceAtoms = BigInt(ACTIVE_PACK.priceUsdgAtoms);
      const actualPrice = await provider.request({ method: "eth_call", params: [{ to: PACK_CONTRACT, data: "0x335c8b63" }, "latest"] }) as string;
      if (BigInt(actualPrice) !== priceAtoms) throw new Error("Pack configuration changed. Refresh before purchasing.");
      const balanceData = `0x70a08231${hexWord(account)}`;
      const balanceHex = await provider.request({ method: "eth_call", params: [{ to: CANONICAL_USDG, data: balanceData }, "latest"] }) as string;
      if (BigInt(balanceHex) < priceAtoms) {
        setNotice(`This wallet needs at least ${PACK_PRICE_USD} USDG before it can rip this funded pack.`);
        return;
      }
      const allowanceData = `0xdd62ed3e${hexWord(account)}${hexWord(PACK_CONTRACT)}`;
      const allowanceHex = await provider.request({ method: "eth_call", params: [{ from: account, to: CANONICAL_USDG, data: allowanceData }, "latest"] }) as string;
      if (BigInt(allowanceHex) < priceAtoms) {
        setNotice(`Approve exactly ${PACK_PRICE_USD} USDG in your wallet.`);
        const approvalHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: account, to: CANONICAL_USDG, data: `0x095ea7b3${hexWord(PACK_CONTRACT)}${hexWord(priceAtoms)}`, value: "0x0" }],
        }) as string;
        await waitForReceipt(provider, approvalHash);
      }

      setNotice(`Confirm the $${PACK_PRICE_USD} ${ACTIVE_PACK.label} rip in your wallet.`);
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
      await settleAndReveal(provider, requestId, entropyBlock);
    } catch (error) {
      const code = (error as { code?: number })?.code;
      setNotice(code === 4001 ? "Transaction cancelled. No new transaction was sent." : "The pack could not complete. Check wallet activity before retrying.");
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel = busy
    ? "PROCESSING…"
    : recoverableRequest
      ? "RESUME PACK"
    : statusState === "error" || status.dataError
      ? "PACK STATUS UNAVAILABLE"
      : !status.configured
      ? "PACK CONTRACT PENDING"
      : !status.operatorEnabled
        ? "PACKS PAUSED"
        : status.inventoryCount < 1 || !publicReserveReady
          ? "ARCADE RESTOCKING"
          : `RIP ${ACTIVE_PACK.label} — $${PACK_PRICE_USD}`;

  const modalAction = !account
    ? "CONNECT WALLET"
    : !networkReady
      ? "SWITCH TO ROBINHOOD CHAIN"
      : `CONFIRM ${PACK_PRICE_USD} USDG PACK`;

  return (
    <main id="top">
      <div className="ambient" aria-hidden="true" />
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="#top" className="brand" aria-label="StonkRips home">
          <Image className="brand-logo" src="/stonkrips-transparent-192.png" alt="StonkRips Stock Token pack logo" width={48} height={48} priority />
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
        <button
          className={`wallet-button${account ? " is-connected" : ""}`}
          type="button"
          onClick={() => void (account ? disconnectWallet() : connectWallet())}
          disabled={busy}
          aria-label={account ? `Disconnect wallet ${account}` : "Connect wallet"}
        >
          {account ? <><span>{shortAddress(account)}</span><small>DISCONNECT</small></> : "CONNECT WALLET"}
        </button>
      </nav>

      <section className="hero" id="arcade">
        <Image className="hero-arcade-art" src="/stonkrips-og.png" alt="" fill priority sizes="100vw" />
        <div className="hero-overlay" aria-hidden="true" />
        <div className="hero-inner shell">
          <div className="hero-copy">
            <div className="network-label"><span /> THE STOCK MARKET HAS LOOT BOXES NOW.</div>
            <h1>RIP A PACK.<br/><em>PULL A STOCK.</em></h1>
            <p className="lead"><strong>{ACTIVE_PACK.label} — ${PACK_PRICE_USD}.</strong> One onchain-selected Stock Token. Delivered directly to your wallet.</p>
            <p className="sublead">Funded Stock Token inventory. Settled pack proceeds can restock hourly. Pons creator fees and holder drops come later.</p>
            <div className="hero-actions">
              <button className="rip-button" type="button" onClick={() => void (!account ? connectWallet() : setPackModalOpen(true))} disabled={busy || (Boolean(account) && !arcadeReady && !recoverableRequest)}>
                {!account ? "CONNECT WALLET TO RIP" : primaryLabel}<span aria-hidden="true">●</span>
              </button>
              <a className="secondary-button" href="#pack">VIEW PACK</a>
            </div>
            {notice && <p className="notice" role="status">{notice}</p>}
            <div className="hero-facts" aria-label="StonkRips fixed product facts">
              <span><b>${PACK_PRICE_USD}</b><small>{ACTIVE_PACK.label} PRICE</small></span>
              <span><b>{STOCK_TOKENS.length}</b><small>VERIFIED STOCK TOKENS</small></span>
              <span><b>1 HR</b><small>RESTOCK CYCLE · WHEN ENABLED</small></span>
            </div>
          </div>

          <div className={"pack-showcase playable-pack state-" + machineState.toLowerCase().replace(" ", "-")} id="pack" aria-label={"StonkRips pack. Status: " + machineState} aria-busy={busy}>
            <div className="pack-glow" aria-hidden="true" />
            <button className="pack-product interactive-pack" type="button" onClick={() => void (!account ? connectWallet() : setPackModalOpen(true))} disabled={busy || (Boolean(account) && !arcadeReady && !recoverableRequest)} aria-label={!account ? "Connect wallet to StonkRips" : recoverableRequest ? "Resume the previously purchased StonkRips pack" : `Open ${ACTIVE_PACK.label} for ${PACK_PRICE_USD} USDG`}>
              <Image className="premium-pack" src="/stonkrips-pack-transparent.png" alt="StonkRips black foil pack with authentic stock logos" width={1024} height={1536} priority />
              <span className="foil-sheen" aria-hidden="true" />
            </button>
            <div className="pack-readout">
              <span>STONKRIPS // {ACTIVE_PACK.id}</span>
              <i>{packStatusLabel}</i>
              <dl>
                <div><dt>PACK PRICE</dt><dd>{PACK_PRICE_USD} USDG</dd></div>
                <div><dt>PACKS AVAILABLE</dt><dd>{!status.configured ? "PENDING" : approximateAvailability}</dd></div>
                <div><dt>STOCK UNIVERSE</dt><dd>{STOCK_TOKENS.length}</dd></div>
                <div><dt>RESERVE BACKING</dt><dd>{status.inventoryValueUsd === null ? "UNAVAILABLE" : formatUsd(status.inventoryValueUsd)}</dd></div>
              </dl>
              <div className="rarity-legend" aria-label="Configured StonkRips rarity tiers">
                <small>WHAT ARE YOU PULLING?</small>
                <div>{PACK_RARITIES.map((tier) => <span key={tier.id} style={{ "--rarity-color": tier.color } as CSSProperties}>{tier.label}</span>)}</div>
                {!PACK_RARITY_ODDS_PUBLISHED && <em>RARITY ODDS ARE NOT PUBLISHED UNTIL THE PACK IS FULLY FUNDED.</em>}
              </div>
              {account && <div className="pack-wallet"><span>{shortAddress(account)}</span><button type="button" disabled={busy} onClick={() => void disconnectWallet()}>Disconnect</button></div>}
              <button type="button" onClick={() => void (!account ? connectWallet() : !networkReady ? openPack() : setPackModalOpen(true))} disabled={busy || (Boolean(account && networkReady) && !arcadeReady && !recoverableRequest)}>{busy ? "WAITING FOR WALLET / CHAIN…" : !account ? "CONNECT WALLET" : !networkReady ? "SWITCH NETWORK" : recoverableRequest ? "RESUME PACK" : arcadeReady ? `RIP PACK — ${PACK_PRICE_USD} USDG` : primaryLabel}</button>
              <small>Availability is an estimate from the latest onchain snapshot and can sell out at any time. ETH covers network gas.</small>
              {notice && <p className="pack-progress" role="status">{notice}</p>}
            </div>
            {packResult && (
              <div className={`hero-pack-result reveal-${revealStage}`} style={{ "--reel-stop": reelStop, "--winning-rarity": packResult.rarity.color } as CSSProperties} aria-live="polite">
                {revealStage !== "reveal" && <button className="skip-reveal" type="button" onClick={() => setRevealStage("reveal")}>SKIP ANIMATION</button>}
                <div className="pack-opening-intro">
                  <span>RESULT CONFIRMED ONCHAIN</span>
                  <Image src="/stonkrips-transparent-512.png" alt="Your confirmed Stock Token pack is opening" width={300} height={300} />
                </div>
                <div className="hero-case-reel">
                  <div className="case-reveal-header"><span>WHAT ARE YOU PULLING?</span><b>RESULT LOCKED</b></div>
                  <div className="case-reel-window">
                    <div className="case-reel-marker" aria-hidden="true"><i /><span /></div>
                    <div className="case-reel-track" ref={revealTrackRef}>
                      {reelItems.map((item, index) => (
                        <div className={`case-reel-card${item.winning ? " is-winning" : ""}`} data-winning={item.winning ? "true" : undefined} style={{ "--rarity-color": item.rarity.color } as CSSProperties} key={`${item.stock.symbol}-${index}`}>
                          <StockLogo stock={item.stock} />
                          <b>{item.stock.symbol}</b>
                          <small>{item.rarity.label}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="case-proof-note">The reel displays the outcome already confirmed by the pack contract. It never chooses or rerolls the prize.</p>
                </div>
                <div className="confirmed-prize" style={{ "--rarity-color": packResult.rarity.color } as CSSProperties}>
                  <span>YOU PULLED</span>
                  <StockLogo stock={packResult.stock} />
                  <h2>{packResult.stock.name}</h2>
                  <em>{packResult.stock.symbol} · {packResult.rarity.label}</em>
                  <p>{packResult.tokenAmount} {packResult.stock.symbol}</p>
                  <small>{formatUsd(packResult.valueUsd)} value when loaded · not a current price</small>
                  <b>DELIVERED · {shortAddress(account)}</b>
                  <div className="result-actions"><a href={`https://robinhoodchain.blockscout.com/tx/${packResult.transactionHash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a><button type="button" onClick={() => { setPackResult(null); setTermsAccepted(false); }}>RIP ANOTHER →</button></div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="stock-universe-strip shell" aria-label="Supported Stock Tokens">
          {STOCK_TOKENS.map((stock) => <span key={stock.symbol}><StockLogo stock={stock} /><b>{stock.symbol}</b></span>)}
        </div>
      </section>

      <div className="market-tape" aria-hidden="true"><div>{[...STOCK_TOKENS, ...STOCK_TOKENS].map((stock, index) => <span key={`${stock.symbol}-tape-${index}`}><StockLogo stock={stock} decorative /><b>{stock.symbol}</b><i>•</i></span>)}</div></div>

      <section className="live-stats shell" aria-label="Verified StonkRips statistics">
        <span><b>{status.totalPacksOpened === null ? "NOT REPORTED" : status.totalPacksOpened}</b><small>TOTAL PACKS OPENED</small></span>
        <span><b>{status.inventoryDataAvailable ? approximateAvailability : "NOT REPORTED"}</b><small>PACK AVAILABILITY</small></span>
        <span><b>{status.inventoryValueUsd === null ? "NOT REPORTED" : formatUsd(status.inventoryValueUsd)}</b><small>ONCHAIN RESERVE</small></span>
        <span><b>{status.completedEpochs === null ? "NOT REPORTED" : status.completedEpochs}</b><small>HOLDER DROPS COMPLETED</small></span>
      </section>

      <section className="arcade-steps shell" aria-label="Pack overview">
        <article><span>01</span><h2>INSERT</h2><p>Connect your wallet and approve exactly {PACK_PRICE_USD} USDG.</p></article>
        <article><span>02</span><h2>GRAB</h2><p>A funded inventory slot is selected by the on-chain pack flow.</p></article>
        <article><span>03</span><h2>RIP</h2><p>Reveal the confirmed result and receive the Stock Token in your wallet.</p></article>
      </section>

      <section className="prize-section shell" id="prize-pool">
        <div className="section-heading">
          <span>THE VERIFIED POSSIBLE PULLS</span>
          <h2>WHAT&apos;S INSIDE<br/>THE MACHINES.</h2>
          <p>Supported is not the same as funded. A stock can only be pulled when its card says loaded; odds use the latest onchain inventory snapshot.</p>
        </div>
        <div className="prize-grid">
          {STOCK_TOKENS.map((stock, index) => {
            const inventory = inventoryBySymbol.get(stock.symbol);
            const unavailable = status.configured && !status.inventoryDataAvailable;
            return (
              <article className={inventory ? "is-loaded" : ""} key={stock.symbol}>
                <div className="prize-card-head"><em>{String(index + 1).padStart(2, "0")}</em><StockLogo stock={stock} /><a href={`https://robinhoodchain.blockscout.com/token/${stock.address}`} target="_blank" rel="noreferrer" aria-label={`View ${stock.name} token on Blockscout`}>DETAILS</a></div>
                <h3>{stock.symbol}</h3>
                <p>{stock.name}</p>
                <div className="prize-status"><span>{inventory ? "LOADED" : unavailable ? "UNAVAILABLE" : "NOT LOADED"}</span>{inventory && <b>{inventory.probabilityPct.toFixed(2)}% CURRENT ODDS</b>}</div>
              </article>
            );
          })}
        </div>
        <p className="token-disclosure">Odds and availability can change whenever funded inventory changes. Stock Tokens provide economic exposure to referenced assets; they are not traditional shares and do not provide shareholder rights.</p>
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
        <div className="my-rips">
          <div><span>MY RIPS</span><small>VERIFIED FROM THE CONNECTED WALLET</small></div>
          {!account && <p>CONNECT YOUR WALLET TO FILTER VERIFIED PULLS.</p>}
          {account && myRipsState === "loading" && <p>READING YOUR VERIFIED RIPS…</p>}
          {account && myRipsState === "error" && <p>YOUR VERIFIED RIPS ARE TEMPORARILY UNAVAILABLE.</p>}
          {account && myRipsState === "ready" && myRips.length === 0 && <p>NO VERIFIED RIPS FOUND FOR {shortAddress(account)}.</p>}
          {account && myRips.map((pull) => {
            const rarity = rarityForValue(pull.valueUsd);
            const completedAt = pull.timestamp ? new Date(pull.timestamp).toLocaleString() : "TIME UNAVAILABLE";
            return <a href={`https://robinhoodchain.blockscout.com/tx/${pull.transactionHash}`} target="_blank" rel="noreferrer" key={`mine-${pull.transactionHash}`}><StockLogo stock={STOCK_TOKENS.find((stock) => stock.symbol === pull.symbol) || STOCK_TOKENS[0]} /><b>{pull.symbol}</b><span>{rarity.label}</span><small>{ACTIVE_PACK.label} · {pull.tokenAmount} · {formatUsd(pull.valueUsd)} AT LOAD · {completedAt}</small></a>;
          })}
        </div>
      </section>

      <section className="holder-drops shell" id="holder-drops">
        <div className="section-heading compact">
          <span>FUTURE HOLDER REWARDS · DISABLED</span>
          <h2>HOLDER DROPS.</h2>
          <p>Holder rewards are disabled in pre-CA mode. Eligibility and ticket rules will be confirmed with the Pons v2 integration before activation.</p>
        </div>
        <div className={`holder-draw-machine${holderDrawActive ? " is-selecting" : ""}`} aria-label={`Holder draw engine status: ${holderCountdown}`}>
          <div className="holder-draw-topline"><span>NEXT HOURLY HOLDER DROP</span><b>{holderCountdown}</b></div>
          <div className="holder-ticket-window" aria-hidden="true">
            <i className="holder-ticket-marker" />
            <div className="holder-ticket-track">
              {Array.from({ length: 14 }, (_, index) => <span key={`holder-ticket-${index}`}><small>WEIGHTED</small><b>TICKET {String(index + 1).padStart(2, "0")}</b></span>)}
            </div>
          </div>
          <div className="holder-draw-footer"><span>AWAITING PONS V2</span><span>ELIGIBILITY NOT ACTIVE</span><span>NO REWARDS SCHEDULED</span></div>
        </div>
        <div className="holder-drop-panel">
          <div><small>STATUS</small><b>{status.automationLive ? automationLabel : "PONS NOT CONNECTED"}</b></div>
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
          <article><b>02</b><h3>APPROVE</h3><p>Approve exactly {PACK_PRICE_USD} canonical USDG for the configured StonkRips pack contract.</p></article>
          <article><b>03</b><h3>SELECT</h3><p>A future Robinhood Chain blockhash selects one funded inventory slot. This transparent method is not oracle VRF.</p></article>
          <article><b>04</b><h3>RECEIVE</h3><p>Settlement sends the selected Stock Token to the buyer and exposes the transaction receipt.</p></article>
        </div>
      </section>

      <section className="restock-engine shell" id="restock">
        <div className="restock-copy">
          <span>FUTURE PONS V2 CREATOR FEES</span>
          <h2>EVERY FEE<br/><em>RELOADS THE ARCADE.</em></h2>
          <p>Pre-CA mode runs on treasury funding and settled pack payments only. Creator-fee claiming and holder rewards are disabled; neither requires a creator private key.</p>
          <p>When enabled, hourly restocking reserves confirmed pack payments once and buys varied, fully funded Stock Token lots. Pending payments are not spendable proceeds. The planned 50/50 creator-fee split is a future, separate integration.</p>
          <i className={status.automationLive ? "is-live" : ""}>{automationLabel}</i>
        </div>
        <div className="restock-machine" aria-label="50 percent holder drop and 50 percent pack inventory split">
          <div className="fee-inlet"><span>FUTURE PONS FEES · DISABLED</span><b>↓</b></div>
          <div className="split-line" aria-hidden="true"><i /><i /></div>
          <article><b>50%</b><span>HOLDER DROP CHAMBER</span><p>Planned allocation to holder rewards. Disabled until Pons v2 is integrated and verified.</p></article>
          <article><b>50%</b><span>PACK INVENTORY</span><p>Planned allocation to future inventory funding. No creator fees are being claimed in pre-CA mode.</p></article>
        </div>
        <div className="flywheel-line" aria-label="Trading to fees to stocks to packs and drops, then repeat"><span>TRADING</span><i>→</i><span>FEES</span><i>→</i><span>STOCKS</span><i>→</i><span>PACKS + DROPS</span><i>↻</i></div>
        <div className="engine-stats">
          <span><b>{status.completedEpochs === null ? "NOT REPORTED" : status.completedEpochs}</b><small>COMPLETED FEE CYCLES</small></span>
          <span><b>{status.inventoryDataAvailable ? status.inventoryCount : "NOT REPORTED"}</b><small>FUNDED PACK LOTS</small></span>
          <span><b>DISABLED</b><small>PRE-CA HOLDER REWARDS</small></span>
        </div>
        <p className="engine-note">Holder eligibility and ticket rules will be published after the actual Pons v2 launch is integrated and verified. Pack purchases do not depend on a Pons token.</p>
        {PONS_TOKEN_URL && <a href={PONS_TOKEN_URL} target="_blank" rel="noreferrer">OPEN STONKRIPS ON PONS ↗</a>}
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
            <div className="proof-body"><p><b>SOURCE</b><span>Future Pons v2 creator fees; no token launch is configured yet.</span></p><p><b>NORMALIZE</b><span>Fee asset and escrow addresses will be verified against the eventual Pons v2 launch. No fee swaps are active.</span></p><p><b>SPLIT</b><span>Planned 50% holder rewards / 50% inventory. Disabled in pre-CA mode.</span></p><p><b>LAST CYCLE</b><span>{status.lastEpochStatus ? AUTOMATION_LABELS[status.lastEpochStatus] || status.lastEpochStatus : "NOT REPORTED"}</span></p></div>
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
          <article><b>01</b><h3>PACK PAYMENT</h3><p>Connect an EVM wallet and approve exactly {PACK_PRICE_USD} canonical USDG. A successful open moves that USDG into the pack contract; settlement forwards it to the treasury and delivers one funded Stock Token. ETH is used only for Robinhood Chain gas.</p></article>
          <article><b>02</b><h3>HOLDER WEIGHT</h3><p>Holder eligibility is not active before the Pons token exists. The final snapshot and ticket rules will be documented after integration verification.</p></article>
          <article><b>03</b><h3>HOURLY RESTOCK</h3><p>When enabled, the Railway treasury worker reserves the previous hour’s confirmed settlement receipts, buys configured Stock Tokens using those USDG proceeds, and loads the exact amount received. Signed transactions are journaled before broadcast; retries reuse the same transaction. Pons is not required.</p></article>
          <article><b>04</b><h3>SUSTAINABILITY</h3><p>Inventory value, funded pulls, and completed holder drops are measured from real sources. Parameters are reviewed manually and any change should be disclosed before activation.</p></article>
        </div>
      </section>

      <section className="next-rooms shell" id="next-rooms">
        <div className="section-heading"><span>NEXT ROOMS · NOT LIVE</span><h2>MORE PACKS<br/>COMING SOON.</h2><p>Future releases stay visibly separate until each mechanic is funded, tested, and activated.</p></div>
        <div className="room-grid">
          <article><em>LOCKED 01</em><h3>CURATED SERIES</h3><p>Distinct inventory-backed rooms for indexes, technology, and community-selected rotations.</p></article>
          <article><em>LOCKED 02</em><h3>TREASURY DESK</h3><p>A receipt-first view of fee claims, purchases, inventory loads, and holder drops.</p></article>
          <article><em>LOCKED 03</em><h3>PARTNER DROPS</h3><p>Clearly disclosed sponsored prizes added without drawing from existing funded inventory.</p></article>
        </div>
      </section>

      <section className="legal shell">
        <b>IMPORTANT</b>
        <p>Robinhood Chain Stock Tokens provide economic exposure to referenced assets; they are not shares and do not provide shareholder rights. Users are responsible for confirming they are legally eligible to use Robinhood Chain Stock Tokens in their jurisdiction. Prize values and probabilities appear only when funded inventory can be read from the configured contract. Holder drops and creator-fee claims are disabled in pre-CA mode. StonkRips is independent and is not endorsed by Robinhood, Pons, or 0x.</p>
      </section>

      <footer className="shell">
        <a href="#top" className="brand" aria-label="StonkRips home"><Image className="brand-logo" src="/stonkrips-transparent-192.png" alt="StonkRips Stock Token pack logo" width={48} height={48} /><b>STONK<span>RIPS</span></b></a>
        <div><a href="#proof">PROOF</a><a href="#docs">DOCS</a><a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">EXPLORER</a>{X_URL && <a href={X_URL} target="_blank" rel="noreferrer">X</a>}</div>
        <span>ROBINHOOD CHAIN · 4663</span>
      </footer>

      {packModalOpen && (
        <div className="pack-modal" role="dialog" aria-modal="true" aria-labelledby="pack-modal-title">
          <div className="pack-modal-card">
            <button className="modal-close" type="button" onClick={() => setPackModalOpen(false)} aria-label="Close pack window">×</button>
            <span>STONKRIPS // {ACTIVE_PACK.id}</span>
            <h2 id="pack-modal-title">READY TO RIP?</h2>
            <Image className="modal-pack" src="/stonkrips-transparent-512.png" alt="StonkRips Stock Token pack" width={256} height={256} />
            <div className="purchase-summary"><b>{PACK_PRICE_USD} USDG</b><small>ONE FUNDED STOCK TOKEN · ETH GAS REQUIRED</small></div>
            <div className="payment-rails" aria-label="Pack payment details">
              <span><small>PACK PAYMENT</small><b>{PACK_PRICE_USD} USDG</b></span>
              <span><small>NETWORK GAS</small><b>ETH</b></span>
            </div>
            <label className="eligibility"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>I am 18+ and legally eligible to use Robinhood Chain Stock Tokens in my jurisdiction.</span></label>
            {notice && <p className="notice" role="status">{notice}</p>}
            <button className="modal-action" type="button" onClick={() => void openPack()} disabled={busy || (Boolean(account && networkReady) && (!termsAccepted || (!arcadeReady && !recoverableRequest)))}>{busy ? "PROCESSING…" : recoverableRequest ? "RESUME CONFIRMED PACK" : account && networkReady && !arcadeReady ? primaryLabel : modalAction}</button>
            <small>Approval authorizes exactly {PACK_PRICE_USD} USDG. The contract cannot open a pack unless sales are enabled and a funded inventory slot exists.</small>
          </div>
        </div>
      )}

    </main>
  );
}
