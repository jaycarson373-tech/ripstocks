/* eslint-disable @next/next/no-img-element */
"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PackOpening } from "@/app/components/pack-opening";
import { type StockToken } from "@/app/lib/stock-tokens";
import { ACTIVE_PACK, HOLDER_TOKENS_PER_TICKET, PACK_PRICE_USD, PACK_RARITIES, PACK_STOCKS as STOCK_TOKENS, rarityForValue } from "@/app/lib/pack-config";
import { type RarityTier } from "@/app/lib/rarity";
import { discoverEvmWallets, ensureRobinhoodChain, ROBINHOOD_CHAIN_ID, walletAccount, walletChainId, walletErrorMessage, type EthereumProvider, type EvmWalletOption } from "@/app/lib/wallet-provider";

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
  requestId?: string;
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
  recipient: string;
  stock: StockToken;
  tokenAmount: string;
  valueUsd: number;
  transactionHash: string;
  rarity: RarityTier;
};

type PendingReveal = {
  requestId: bigint;
  buyer: string;
  entropyBlock: bigint;
};


const WALLET_DISCONNECTED_KEY = "stonkrips.wallet-disconnected";
const CANONICAL_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PACK_REQUESTED_TOPIC = "0x72ce6acbcd0dcdfc48c244249d669a4a6cfd9f429795cdcc5c430ad27273f383";
const PRIZE_DELIVERED_TOPIC = "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656";
const ACTIVE_REQUEST_SELECTOR = "0xb57e51c4";
const REQUEST_SELECTOR = "0x81d12c58";
const PACK_CONTRACT = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
const PONS_TOKEN_URL = (process.env.NEXT_PUBLIC_PONS_TOKEN_URL || "").trim();
const X_URL = (process.env.NEXT_PUBLIC_X_URL || "https://x.com/stonkrips_").trim();
const PUBLIC_RESERVE_DISPLAY_FLOOR_USD = ACTIVE_PACK.inventoryRequirements.publicAvailabilityFloorUsd;
const HOLDER_TICKET_LABEL = Number(HOLDER_TOKENS_PER_TICKET).toLocaleString("en-US");
const MAX_PLAYER_GAS_USD = 0.20;

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

async function assertAffordableGas(provider: EthereumProvider, transaction: { from: string; to: string; data: string; value: string }, fallbackGas: bigint) {
  const [gasPriceHex, priceResponse] = await Promise.all([
    provider.request({ method: "eth_gasPrice" }) as Promise<string>,
    fetch("/api/robinhood/eth-price", { cache: "no-store" }),
  ]);
  if (!priceResponse.ok) throw new Error("GAS_CHECK_UNAVAILABLE");
  const { ethUsd } = await priceResponse.json() as { ethUsd?: number };
  if (!Number.isFinite(ethUsd) || !ethUsd) throw new Error("GAS_CHECK_UNAVAILABLE");
  let gas = fallbackGas;
  try {
    gas = BigInt(await provider.request({ method: "eth_estimateGas", params: [transaction] }) as string);
  } catch {
    // A conservative fallback is used when a dependent transaction (such as
    // approval) has not confirmed yet and the wallet cannot simulate the call.
  }
  const estimatedUsd = Number(gas * BigInt(gasPriceHex)) / 1e18 * ethUsd;
  if (!Number.isFinite(estimatedUsd)) throw new Error("GAS_CHECK_UNAVAILABLE");
  if (estimatedUsd > MAX_PLAYER_GAS_USD) throw new Error("GAS_ABOVE_CAP");
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
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [walletOptions, setWalletOptions] = useState<EvmWalletOption[]>([]);
  const [walletProvider, setWalletProvider] = useState<EthereumProvider | null>(null);
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [openingRun, setOpeningRun] = useState(0);
  const [recentPulls, setRecentPulls] = useState<RecentPull[]>([]);
  const [pullsState, setPullsState] = useState<"loading" | "ready" | "error">("loading");
  const [myRips, setMyRips] = useState<RecentPull[]>([]);
  const [myRipsState, setMyRipsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [clock, setClock] = useState<number | null>(null);
  const [recoverableRequest, setRecoverableRequest] = useState<PendingReveal | null>(null);
  const [pendingReveal, setPendingReveal] = useState<PendingReveal | null>(null);
  const [pendingRevealReady, setPendingRevealReady] = useState(false);
  const [autoDeliveryTimedOut, setAutoDeliveryTimedOut] = useState(false);
  const manuallyDisconnected = useRef(false);

  const networkReady = chainId === ROBINHOOD_CHAIN_ID;
  const inventoryBySymbol = useMemo(() => new Map(status.inventory.map((item) => [item.symbol, item])), [status.inventory]);
  const openingPreview = useMemo(() => {
    const funded = status.inventory.flatMap((item) => {
      const stock = STOCK_TOKENS.find((candidate) => candidate.symbol === item.symbol);
      return stock && item.fundedPulls > 0 ? [{ stock, rarity: item.fundedPulls === 1 ? rarityForValue(item.loadedValueUsd) : null }] : [];
    });
    return funded.length ? funded : STOCK_TOKENS.map(stock => ({ stock, rarity: null }));
  }, [status.inventory]);
  const publicReserveReady = status.inventoryValueUsd !== null && status.inventoryValueUsd >= PUBLIC_RESERVE_DISPLAY_FLOOR_USD;
  const arcadeReady = ACTIVE_PACK.enabled && statusState === "ready" && !status.dataError && status.configured && status.packsLive && status.inventoryCount > 0 && publicReserveReady;
  const automationLabel = status.automationLive
    ? AUTOMATION_LABELS[status.lastEpochStatus || ""] || "HOURLY ENGINE ONLINE"
    : "HOURLY CYCLE ACTIVATING";
  const machineState = statusState === "loading" ? "CHECKING" : statusState === "error" || status.dataError ? "UNAVAILABLE" : !status.configured ? "COMING SOON" : !ACTIVE_PACK.enabled || !status.operatorEnabled ? "COMING SOON" : status.inventoryCount < 1 || !publicReserveReady ? "RESTOCKING" : "READY";
  const packStatusLabel = machineState === "READY" ? "LIVE" : machineState;
  const holderDrawActive = status.automationLive && ["awaiting_seed", "holder_drop_swap", "holder_drop_send"].includes(status.lastEpochStatus || "");
  const nextHourlyCycle = clock === null ? null : Math.ceil((clock + 1) / 3_600_000) * 3_600_000;
  const holderCountdown = !status.automationLive
    ? "ACTIVATING"
    : holderDrawActive
      ? "SELECTING"
      : nextHourlyCycle === null
        ? "SYNCING"
        : formatCountdown(nextHourlyCycle - clock!);

  useEffect(() => {
    try { manuallyDisconnected.current = sessionStorage.getItem(WALLET_DISCONNECTED_KEY) === "true"; } catch { /* Storage can be blocked by the browser. */ }
    const provider = walletProvider;
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
  }, [walletProvider]);

  useEffect(() => {
    const provider = walletProvider;
    if (!provider || !account || !networkReady || !status.configured) {
      void Promise.resolve().then(() => setRecoverableRequest(null));
      return;
    }
    let active = true;
    void readActivePackRequest(provider)
      .then((request) => {
        if (!active) return;
        const ownedRequest = request?.buyer === account.toLowerCase() ? request : null;
        setRecoverableRequest(ownedRequest);
        if (ownedRequest && !packResult) {
          setPendingRevealReady(false);
          setAutoDeliveryTimedOut(false);
          setPendingReveal(ownedRequest);
        }
      })
      .catch(() => { if (active) setRecoverableRequest(null); });
    return () => { active = false; };
  }, [account, networkReady, packResult, status.configured, walletProvider]);

  useEffect(() => {
    if (!pendingReveal || !walletProvider) return;
    let active = true;
    const armReveal = async () => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const blockHex = await walletProvider.request({ method: "eth_blockNumber" }) as string;
        if (BigInt(blockHex) > pendingReveal.entropyBlock) break;
        await delay(1_000);
        if (attempt === 79) throw new Error("ENTROPY_TIMEOUT");
      }
      if (!active) return;
      setPendingRevealReady(true);
      for (let attempt = 0; attempt < 32; attempt += 1) {
        try {
          const fromBlock = pendingReveal.entropyBlock > BigInt(3) ? pendingReveal.entropyBlock - BigInt(3) : BigInt(0);
          const response = await fetch(`/api/robinhood/delivery?requestId=${pendingReveal.requestId}&buyer=${encodeURIComponent(pendingReveal.buyer)}&fromBlock=${fromBlock}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
          if (!active) return;
          if (response.ok) {
            const payload = await response.json() as { delivered?: RecentPull | null };
            if (!active) return;
            const delivered = payload.delivered?.requestId === pendingReveal.requestId.toString() ? payload.delivered : null;
            if (delivered) {
              const stock = STOCK_TOKENS.find((candidate) => candidate.symbol === delivered.symbol);
              if (!stock) throw new Error("UNSUPPORTED_PRIZE_TOKEN");
              setPackResult({ recipient: delivered.wallet, stock, tokenAmount: delivered.tokenAmount, valueUsd: delivered.valueUsd, transactionHash: delivered.transactionHash, rarity: rarityForValue(delivered.valueUsd) });
              setRecoverableRequest(null);
              setPendingReveal(null);
              setNotice("");
              return;
            }
          }
        } catch { /* Transient reads must not cancel a confirmed purchase. */ }
        await delay(1_000);
        if (!active) return;
      }
      if (active) setAutoDeliveryTimedOut(true);
    };
    void armReveal().catch(() => {
      if (active) {
        setPendingRevealReady(true);
        setAutoDeliveryTimedOut(true);
        setNotice("Confirmation is taking longer than expected. Your paid pack can be resumed; do not buy another pack to retry.");
      }
    });
    return () => { active = false; };
  }, [pendingReveal, walletProvider]);

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

  async function switchNetwork(provider: EthereumProvider) {
    try {
      setChainId(await ensureRobinhoodChain(provider));
    } catch (error) {
      setChainId(walletChainId(await provider.request({ method: "eth_chainId" }).catch(() => null)));
      throw error;
    }
  }

  async function connectWallet() {
    if (typeof window === "undefined") return;
    setBusy(true);
    setNotice("");
    const options = await discoverEvmWallets(window as Window & { ethereum?: EthereumProvider }).catch(() => []);
    setBusy(false);
    if (!options.length) {
      setNotice("StonkRips uses Robinhood Chain, not Phantom. Open the site in a compatible EVM wallet or enable an EVM wallet extension.");
      return;
    }
    setWalletOptions(options);
    setWalletPickerOpen(true);
  }

  async function connectWithWallet(option: EvmWalletOption) {
    const provider = option.provider;
    setBusy(true);
    setNotice("");
    try {
      setWalletProvider(provider);
      const nextAccount = walletAccount(await provider.request({ method: "eth_requestAccounts" }));
      if (!nextAccount) throw new Error("NO_WALLET_ACCOUNT");
      manuallyDisconnected.current = false;
      try { sessionStorage.removeItem(WALLET_DISCONNECTED_KEY); } catch { /* The in-memory session still works. */ }
      setAccount(nextAccount);
      await switchNetwork(provider);
      setWalletPickerOpen(false);
    } catch (error) {
      setNotice(walletErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectWallet() {
    const provider = walletProvider;
    manuallyDisconnected.current = true;
    try { sessionStorage.setItem(WALLET_DISCONNECTED_KEY, "true"); } catch { /* The current page still disconnects. */ }
    setAccount("");
    setChainId(null);
    setTermsAccepted(false);
    setPackModalOpen(false);
    setWalletPickerOpen(false);
    setNotice("Wallet disconnected from StonkRips. No transaction was sent.");
    setBusy(true);
    try {
      await provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // Not every injected wallet implements EIP-2255. Clearing the local
      // session still disconnects this page without sending a transaction.
    } finally {
      setWalletProvider(null);
      setBusy(false);
    }
  }

  async function settleAndReveal(provider: EthereumProvider, requestId: bigint, entropyBlock: bigint) {
    setNotice("Preparing direct Stock Token delivery…");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const blockHex = await provider.request({ method: "eth_blockNumber" }) as string;
      if (BigInt(blockHex) > entropyBlock) break;
      await delay(1_500);
      if (attempt === 79) throw new Error("ENTROPY_TIMEOUT");
    }

    setNotice("Confirm CLAIM & REVEAL. This transaction sends the Stock Token directly to your wallet.");
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
    setPackResult({ recipient: `0x${prizeLog.topics[2].slice(-40)}`, stock, tokenAmount, valueUsd, transactionHash: settleHash, rarity: rarityForValue(valueUsd) });
    setPendingReveal(null);
    setPendingRevealReady(false);
    setRecoverableRequest(null);
    setPackModalOpen(false);
    setNotice("");
  }

  function stagePaidPack(request: PendingReveal) {
    setRecoverableRequest(request);
    setPendingReveal(request);
    setPendingRevealReady(false);
    setAutoDeliveryTimedOut(false);
    setPackModalOpen(false);
    setNotice("");
    document.getElementById("pack")?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  function replayPull(pull: RecentPull) {
    if (busy || pendingReveal) return;
    const stock = STOCK_TOKENS.find((candidate) => candidate.symbol === pull.symbol);
    if (!stock) return;
    setOpeningRun(current => current + 1);
    setPackResult({ recipient: pull.wallet, stock, tokenAmount: pull.tokenAmount, valueUsd: pull.valueUsd, transactionHash: pull.transactionHash, rarity: rarityForValue(pull.valueUsd) });
    setPackModalOpen(false);
    setNotice("Replaying a confirmed result. No payment or transfer is requested.");
    document.getElementById("pack")?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  async function claimAndReveal() {
    const provider = walletProvider;
    if (!provider || !pendingReveal || !pendingRevealReady || busy) return;
    setBusy(true);
    try {
      await settleAndReveal(provider, pendingReveal.requestId, pendingReveal.entropyBlock);
    } catch (error) {
      const code = (error as { code?: number })?.code;
      setNotice(code === 4001 ? "Reveal cancelled. Your paid pack is safe—press CLAIM & REVEAL whenever you are ready." : "The reveal did not complete. Your paid pack is safe and can be retried.");
    } finally {
      setBusy(false);
    }
  }

  async function openPack() {
    if (!account) return connectWallet();
    const provider = walletProvider;
    if (!provider) {
      setNotice("Choose the wallet that holds your Robinhood Chain USDG.");
      return connectWallet();
    }
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
        stagePaidPack(activeRequest);
        setBusy(false);
        return;
      }
    } catch {
      setNotice("The active pack state could not be verified. No payment was requested.");
      setBusy(false);
      return;
    }
    if (!status.packsLive) {
      setNotice("Pack sales are not available yet. No payment was requested.");
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
      const commitment = randomCommitment();
      if (BigInt(allowanceHex) < priceAtoms) {
        await assertAffordableGas(provider, { from: account, to: CANONICAL_USDG, data: `0x095ea7b3${hexWord(PACK_CONTRACT)}${hexWord(priceAtoms)}`, value: "0x0" }, BigInt(70_000));
        setNotice(`Approve exactly ${PACK_PRICE_USD} USDG in your wallet.`);
        const approvalHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: account, to: CANONICAL_USDG, data: `0x095ea7b3${hexWord(PACK_CONTRACT)}${hexWord(priceAtoms)}`, value: "0x0" }],
        }) as string;
        await waitForReceipt(provider, approvalHash);
      }

      await assertAffordableGas(provider, { from: account, to: PACK_CONTRACT, data: `0x15437c79${hexWord(commitment)}`, value: "0x0" }, BigInt(230_000));
      setNotice(`Confirm the $${PACK_PRICE_USD} ${ACTIVE_PACK.label} rip in your wallet.`);
      const openHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: PACK_CONTRACT, data: `0x15437c79${hexWord(commitment)}`, value: "0x0" }],
      }) as string;
      const openReceipt = await waitForReceipt(provider, openHash);
      const requestLog = openReceipt.logs.find((log) => log.address.toLowerCase() === PACK_CONTRACT.toLowerCase() && log.topics[0]?.toLowerCase() === PACK_REQUESTED_TOPIC);
      if (!requestLog?.topics[1]) throw new Error("REQUEST_EVENT_MISSING");
      const requestId = BigInt(requestLog.topics[1]);
      const entropyBlock = BigInt(requestLog.data);
      stagePaidPack({ requestId, buyer: account.toLowerCase(), entropyBlock });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      const message = error instanceof Error ? error.message : "";
      setNotice(code === 4001
        ? "Transaction cancelled. No new transaction was sent."
        : message === "GAS_ABOVE_CAP"
          ? "Robinhood Chain is too congested right now. Estimated player gas is above $0.20—try again when fees drop."
          : message === "GAS_CHECK_UNAVAILABLE"
            ? "Network fee safety check is unavailable. No payment was requested; try again shortly."
            : "The pack could not complete. Check wallet activity before retrying.");
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
      ? "PACK COMING SOON"
      : !status.operatorEnabled
        ? "PACK SALES COMING SOON"
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
          <Image className="brand-logo" src="/stonkrips-logo.jpg" alt="StonkRips torn pack logo" width={48} height={48} priority />
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
        <div className="nav-actions">
          {X_URL && <a className="x-button" href={X_URL} target="_blank" rel="noreferrer" aria-label="StonkRips on X">X</a>}
          <button
            className={`wallet-button${account ? " is-connected" : ""}`}
            type="button"
            onClick={() => void (account ? disconnectWallet() : connectWallet())}
            disabled={busy}
            aria-label={account ? `Disconnect wallet ${account}` : "Connect wallet"}
          >
            {account ? <><span>{shortAddress(account)}</span><small>DISCONNECT</small></> : "CONNECT WALLET"}
          </button>
        </div>
      </nav>

      <section className="hero" id="arcade">
        <Image className="hero-arcade-art" src="/stonkrips-og.png" alt="" fill priority sizes="100vw" />
        <div className="hero-overlay" aria-hidden="true" />
        <div className="hero-inner shell">
          <div className="hero-copy">
            <div className="network-label"><span /> RIP THE MARKET.</div>
            <h1>RIP A PACK.<br/><em>PULL A STOCK.</em></h1>
            <p className="lead"><strong>Real Stock Tokens.</strong><br/>Delivered directly to your wallet.</p>
            <p className="sublead"><span>50% RESTOCKS THE TREASURY.</span><span>50% FUNDS HOURLY STOCK DROPS.</span></p>
            <div className="hero-actions">
              <button className="rip-button" type="button" onClick={() => void (!account ? connectWallet() : setPackModalOpen(true))} disabled={busy || (Boolean(account) && !arcadeReady && !recoverableRequest)}>
                {!account ? "CONNECT WALLET TO RIP" : primaryLabel}<span aria-hidden="true">●</span>
              </button>
              <a className="secondary-button" href="#pack">VIEW PACK</a>
            </div>
            {notice && <p className="notice" role="status">{notice}</p>}
            <div className="hero-facts" aria-label="StonkRips product metrics">
              <span><b>${PACK_PRICE_USD}</b><small>{ACTIVE_PACK.label}</small></span>
              <span><b>{status.inventoryValueUsd === null ? "—" : formatUsd(status.inventoryValueUsd)}</b><small>TREASURY</small></span>
              <span><b>{STOCK_TOKENS.length}</b><small>STOCKS</small></span>
              <span><b>1 HR</b><small>HOLDER DROPS</small></span>
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
              {machineState !== "READY" && <i>{packStatusLabel}</i>}
              <dl>
                <div><dt>PACK PRICE</dt><dd>{PACK_PRICE_USD} USDG</dd></div>
              </dl>
              <div className="rarity-legend" aria-label="Configured StonkRips rarity tiers">
                <small>WHAT ARE YOU PULLING?</small>
                <div>{PACK_RARITIES.map((tier) => <span key={tier.id} style={{ "--rarity-color": tier.color } as CSSProperties}>{tier.label}</span>)}</div>
              </div>
              {account && <div className="pack-wallet"><span>{shortAddress(account)}</span><button type="button" disabled={busy} onClick={() => void disconnectWallet()}>Disconnect</button></div>}
              <button type="button" onClick={() => void (!account ? connectWallet() : !networkReady ? openPack() : setPackModalOpen(true))} disabled={busy || (Boolean(account && networkReady) && !arcadeReady && !recoverableRequest)}>{busy ? "WAITING FOR WALLET / CHAIN…" : !account ? "CONNECT WALLET" : !networkReady ? "SWITCH NETWORK" : recoverableRequest ? "RESUME PACK" : arcadeReady ? "RIP PACK" : primaryLabel}</button>
              {notice && <p className="pack-progress" role="status">{notice}</p>}
            </div>
            {(pendingReveal || packResult) && (
              <PackOpening key={openingRun} preview={openingPreview} result={packResult} renderLogo={stock => <StockLogo stock={stock} />} retry={autoDeliveryTimedOut ? <><p>Taking longer than expected. Payment confirmed.</p><button type="button" onClick={() => void claimAndReveal()} disabled={busy}>{busy ? "RETRYING DELIVERY…" : "RETRY DELIVERY"}</button></> : undefined}>
                {packResult && <div className="confirmed-prize" style={{ "--rarity-color": packResult.rarity.color } as CSSProperties}>
                  <span>YOU PULLED</span>
                  <StockLogo stock={packResult.stock} />
                  <h2>{packResult.stock.name}</h2>
                  <em>{packResult.stock.symbol} · {packResult.rarity.label}</em>
                  <p>{packResult.tokenAmount} {packResult.stock.symbol}</p>
                  <small>{formatUsd(packResult.valueUsd)} value when loaded · not a current price</small>
                  <b>DELIVERED · {shortAddress(packResult.recipient)}</b>
                  <div className="result-actions"><a href={`https://robinhoodchain.blockscout.com/tx/${packResult.transactionHash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a><button type="button" onClick={() => { setPackResult(null); setTermsAccepted(false); }}>RIP ANOTHER →</button></div>
                </div>}
              </PackOpening>
            )}
          </div>
        </div>
        <div className="stock-universe-strip shell" aria-label="Supported Stock Tokens">
          {STOCK_TOKENS.map((stock) => <span key={stock.symbol}><StockLogo stock={stock} /><b>{stock.symbol}</b></span>)}
        </div>
      </section>

      <div className="market-tape" aria-hidden="true"><div>{[...STOCK_TOKENS, ...STOCK_TOKENS].map((stock, index) => <span key={`${stock.symbol}-tape-${index}`}><StockLogo stock={stock} decorative /><b>{stock.symbol}</b><i>•</i></span>)}</div></div>

      <section className="arcade-steps shell" aria-label="Pack overview">
        <article><span>01</span><i className="step-signal" aria-hidden="true"><b/><b/><b/></i><h2>INSERT</h2><p>Connect your wallet and approve the {PACK_PRICE_USD} USDG pack payment.</p></article>
        <article><span>02</span><i className="step-signal" aria-hidden="true"><b/><b/><b/></i><h2>GRAB</h2><p>A funded stock outcome is selected from available inventory.</p></article>
        <article><span>03</span><i className="step-signal" aria-hidden="true"><b/><b/><b/></i><h2>RIP</h2><p>Reveal the result and receive the Stock Token in your wallet.</p></article>
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
              <span>{shortAddress(pull.wallet)}</span><b>{pull.symbol}</b><span>{pull.tokenAmount}</span><span>{formatUsd(pull.valueUsd)}</span><time dateTime={pull.timestamp ? new Date(pull.timestamp).toISOString() : undefined}>{pull.timestamp ? new Date(pull.timestamp).toLocaleString() : "UNAVAILABLE"}</time><span className="pull-actions"><a href={`https://robinhoodchain.blockscout.com/tx/${pull.transactionHash}`} target="_blank" rel="noreferrer">VIEW ↗</a><button type="button" disabled={busy || Boolean(pendingReveal)} onClick={() => replayPull(pull)} aria-label={`Replay confirmed ${pull.symbol} rip ${pull.requestId || ""}`}>REPLAY</button></span>
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
          <span>HOURLY STOCK REWARDS</span>
          <h2>HOLDER DROPS.</h2>
          <p>One eligible weighted holder receives the Stock Token purchased by each hourly fee cycle. Every whole {HOLDER_TICKET_LABEL} $RIP held at the snapshot block equals one ticket.</p>
        </div>
        <div className={`holder-draw-machine${holderDrawActive ? " is-selecting" : ""}`} aria-label={`Holder draw engine status: ${holderCountdown}`}>
          <div className="holder-draw-topline"><span>NEXT HOURLY HOLDER DROP</span><b>{holderCountdown}</b></div>
          <div className="holder-ticket-window" aria-hidden="true">
            <i className="holder-ticket-marker" />
            <div className="holder-ticket-track">
              {Array.from({ length: 14 }, (_, index) => <span key={`holder-ticket-${index}`}><small>WEIGHTED</small><b>TICKET {String(index + 1).padStart(2, "0")}</b></span>)}
            </div>
          </div>
          <div className="holder-draw-footer"><span>HOURLY CYCLE</span><span>WEIGHTED TICKETS</span><span>ONCHAIN RECEIPTS</span></div>
        </div>
        <div className="holder-drop-panel">
          <div><small>STATUS</small><b>{status.automationLive ? automationLabel : "ACTIVATING"}</b></div>
          <div><small>TOTAL COMPLETED</small><b>{status.completedEpochs === null ? "—" : status.completedEpochs}</b></div>
          <div><small>LAST WINNER</small><b>{status.lastHolderDrop ? shortAddress(status.lastHolderDrop.winner) : "NO VERIFIED DROP"}</b></div>
          <div><small>ASSET</small><b>{status.lastHolderDrop?.symbol || "—"}</b></div>
          <div><small>EXACT TOKEN AMOUNT</small><b>{status.lastHolderDrop ? `${status.lastHolderDrop.tokenAmount} ${status.lastHolderDrop.symbol}` : "—"}</b></div>
          <div><small>RECEIPT</small>{status.lastHolderDrop ? <a href={`https://robinhoodchain.blockscout.com/tx/${status.lastHolderDrop.transactionHash}`} target="_blank" rel="noreferrer">VIEW ↗</a> : <b>—</b>}</div>
        </div>
      </section>

      <section className="how shell" id="how">
        <div className="section-heading"><span>THE ON-CHAIN PACK FLOW</span><h2>FOUR MOVES.<br/>ONE RECEIPT.</h2><p>The reel starts after payment. It lands only on the stock confirmed by the contract; the animation never chooses your prize.</p></div>
        <div className="technical-steps">
          <article><b>01</b><h3>CONNECT</h3><p>Use an EVM wallet on Robinhood Chain, network 4663. ETH pays network gas.</p></article>
          <article><b>02</b><h3>APPROVE</h3><p>Approve exactly {PACK_PRICE_USD} canonical USDG for the configured StonkRips pack contract.</p></article>
          <article><b>03</b><h3>SELECT</h3><p>A future Robinhood Chain blockhash selects one funded inventory slot. This transparent method is not oracle VRF.</p></article>
          <article><b>04</b><h3>RECEIVE</h3><p>Settlement sends the selected Stock Token to the buyer and exposes the transaction receipt.</p></article>
        </div>
      </section>

      <section className="restock-engine shell" id="restock">
        <div className="restock-copy">
          <span>THE RESTOCK ENGINE</span>
          <h2>50% RESTOCKS THE TREASURY.<br/><em>50% FUNDS HOURLY STOCK DROPS.</em></h2>
          <p>After the $RIP launch, creator fees route through one hourly cycle: half buys Stock Token inventory and half funds a weighted-holder Stock Token drop.</p>
          <p>Confirmed pack payments can also reload future inventory. Every purchase, load, and delivery keeps its own receipt.</p>
          <i className={status.automationLive ? "is-live" : ""}>{automationLabel}</i>
        </div>
        <div className="restock-machine" aria-label="50 percent holder drop and 50 percent pack inventory split">
          <div className="fee-inlet"><span>CREATOR FEES</span><b>↓</b></div>
          <div className="split-line" aria-hidden="true"><i /><i /></div>
          <article><b>50%</b><span>HOLDER STOCK DROPS</span><p>Purchases the Stock Token awarded to one eligible weighted holder each hour.</p></article>
          <article><b>50%</b><span>PACK INVENTORY</span><p>Purchases Stock Tokens and reloads funded pack inventory.</p></article>
        </div>
        <div className="flywheel-line" aria-label="Trading to fees to stocks to packs and drops, then repeat"><span>TRADING</span><i>→</i><span>FEES</span><i>→</i><span>STOCKS</span><i>→</i><span>PACKS + DROPS</span><i>↻</i></div>
        <div className="engine-stats">
          <span><b>{status.completedEpochs === null ? "—" : status.completedEpochs}</b><small>COMPLETED FEE CYCLES</small></span>
          <span><b>{status.inventoryDataAvailable ? status.inventoryCount : "—"}</b><small>FUNDED PACK LOTS</small></span>
          <span><b>{status.automationLive ? "LIVE" : "ACTIVATING"}</b><small>HOLDER DROP STATUS</small></span>
        </div>
        <p className="engine-note">Holder weight: {HOLDER_TICKET_LABEL} $RIP per whole ticket at the confirmed snapshot block. The pack and holder-drop ledgers remain separate and verifiable.</p>
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
            <summary>FEE ROUTING <span>{status.automationLive ? "LIVE" : "ACTIVATING"}</span></summary>
            <div className="proof-body"><p><b>SOURCE</b><span>Pons v2 creator fees after the $RIP launch.</span></p><p><b>VERIFY</b><span>The launch token, fee asset, and escrow must match the configured Pons market.</span></p><p><b>SPLIT</b><span>50% holder stock drops / 50% pack inventory.</span></p><p><b>LAST CYCLE</b><span>{status.lastEpochStatus ? AUTOMATION_LABELS[status.lastEpochStatus] || status.lastEpochStatus : "—"}</span></p></div>
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
          <article><b>02</b><h3>HOLDER WEIGHT</h3><p>When holder rewards are activated, each whole {HOLDER_TICKET_LABEL} $RIP at the confirmed snapshot block equals one ticket. Partial tickets are excluded, and system wallets are excluded from eligibility.</p></article>
          <article><b>03</b><h3>HOURLY RESTOCK</h3><p>When enabled, the Railway treasury worker reserves the previous hour’s confirmed settlement receipts, buys configured Stock Tokens using those USDG proceeds, and loads the exact amount received. Signed transactions are journaled before broadcast; retries reuse the same transaction. Pons is not required.</p></article>
          <article><b>04</b><h3>SUSTAINABILITY</h3><p>Inventory value, funded pulls, and completed holder drops are measured from real sources. Parameters are reviewed manually and any change should be disclosed before activation.</p></article>
        </div>
      </section>

      <section className="next-rooms shell" id="next-rooms">
        <div className="section-heading"><span>NEXT ROOMS</span><h2>MORE PACKS<br/>COMING SOON.</h2><p>New pack formats and stock lineups will arrive in future rooms.</p></div>
        <div className="room-grid">
          <article><em>LOCKED 01</em><h3>CURATED SERIES</h3><p>Distinct inventory-backed rooms for indexes, technology, and community-selected rotations.</p></article>
          <article><em>LOCKED 02</em><h3>TREASURY DESK</h3><p>A receipt-first view of fee claims, purchases, inventory loads, and holder drops.</p></article>
          <article><em>LOCKED 03</em><h3>PARTNER DROPS</h3><p>Clearly disclosed sponsored prizes added without drawing from existing funded inventory.</p></article>
        </div>
      </section>

      <section className="legal shell">
        <b>IMPORTANT</b>
        <p>Robinhood Chain Stock Tokens provide economic exposure to referenced assets; they are not shares and do not provide shareholder rights. Users are responsible for confirming they are legally eligible to use Robinhood Chain Stock Tokens in their jurisdiction. Prize values and probabilities appear only when funded inventory can be read from the configured contract. Holder drops and creator-fee routing begin only after their onchain configuration is verified. StonkRips is independent and is not endorsed by Robinhood, Pons, or 0x.</p>
      </section>

      <footer className="shell">
        <a href="#top" className="brand" aria-label="StonkRips home"><Image className="brand-logo" src="/stonkrips-logo.jpg" alt="StonkRips torn pack logo" width={48} height={48} /><b>STONK<span>RIPS</span></b></a>
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

      {walletPickerOpen && (
        <div className="pack-modal wallet-picker" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title">
          <div className="pack-modal-card wallet-picker-card">
            <button className="modal-close" type="button" onClick={() => setWalletPickerOpen(false)} aria-label="Close wallet picker">×</button>
            <span>ROBINHOOD CHAIN · 4663</span>
            <h2 id="wallet-picker-title">CHOOSE WALLET</h2>
            <p>Select the EVM wallet you want to use. StonkRips will not open one automatically.</p>
            <div className="wallet-choice-list">
              {walletOptions.map((option) => (
                <button key={option.id} type="button" disabled={busy} onClick={() => void connectWithWallet(option)}>
                  <b>{option.name}</b><small>CONNECT ON ROBINHOOD CHAIN</small>
                </button>
              ))}
            </div>
            {notice && <p className="notice" role="status">{notice}</p>}
            <small>Phantom is excluded because this pack runs on Robinhood Chain.</small>
          </div>
        </div>
      )}

    </main>
  );
}
