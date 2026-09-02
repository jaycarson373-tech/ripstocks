"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type PackStatus = {
  configured: boolean;
  packsLive: boolean;
  inventoryCount: number;
  maxPrizeUsd: number | null;
  packPriceUsd: number;
};

type StockToken = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  logoUrl: string;
  color: string;
};

type RpcReceipt = {
  blockNumber: string;
  status: string;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

type PackResult = { stock: StockToken; valueUsd: number; transactionHash: string };

const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_CHAIN_HEX = "0x1237";
const CANONICAL_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PACK_REQUESTED_TOPIC = "0x72ce6acbcd0dcdfc48c244249d669a4a6cfd9f429795cdcc5c430ad27273f383";
const PRIZE_DELIVERED_TOPIC = "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656";
const PACK_CONTRACT = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
const LONG_TOKEN_URL = (process.env.NEXT_PUBLIC_LONG_TOKEN_URL || "").trim();
const X_URL = (process.env.NEXT_PUBLIC_X_URL || "").trim();

const STOCK_TOKENS: StockToken[] = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x117cc2133c37b721f49de2a7a74833232b3b4c0c.png", color: "#ff725e" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xaf3d76f1834a1d425780943c99ea8a608f8a93f9.png", color: "#f4f4f1" },
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec.png", color: "#76b900" },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x322f0929c4625ed5bad873c95208d54e1c003b2d.png", color: "#e82127" },
  { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xe93237c50d904957cf27e7b1133b510c669c2e74.png", color: "#00a4ef" },
  { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3.png", color: "#4285f4" },
  { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x12f190a9f9d7d37a250758b26824b97ce941bf54.png", color: "#ff9900" },
  { symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xc0d6457c16cc70d6790dd43521c899c87ce02f35.png", color: "#168aff" },
  { symbol: "QQQ", name: "Invesco QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0xd5f3879160bc7c32ebb4dc785f8a4f505888de68.png", color: "#805ad5" },
  { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x6330d8c3178a418788df01a47479c0ce7ccf450b.png", color: "#1652f0" },
];

const EMPTY_STATUS: PackStatus = {
  configured: Boolean(PACK_CONTRACT),
  packsLive: false,
  inventoryCount: 0,
  maxPrizeUsd: null,
  packPriceUsd: 20,
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

function StockLogo({ stock }: { stock: StockToken }) {
  return <span className="stock-token-logo" style={{ "--stock-color": stock.color } as CSSProperties}><img src={stock.logoUrl} alt="" /><i>{stock.symbol.slice(0, 1)}</i></span>;
}

export default function Home() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<PackStatus>(EMPTY_STATUS);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [packResult, setPackResult] = useState<PackResult | null>(null);
  const [regionAllowed, setRegionAllowed] = useState<boolean | null>(null);
  const [country, setCountry] = useState<string | null>(null);

  const networkReady = chainId === ROBINHOOD_CHAIN_ID;
  const canRip = Boolean(account && networkReady && status.configured && status.packsLive && status.inventoryCount > 0 && termsAccepted && regionAllowed !== false && !busy);
  const reel = useMemo(() => [...STOCK_TOKENS, ...STOCK_TOKENS], []);

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
    void fetch("/api/robinhood/eligibility", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { allowed: boolean | null; country: string | null }) => { setRegionAllowed(data.allowed); setCountry(data.country); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/robinhood/status", { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as PackStatus;
        if (active) setStatus(next);
      } catch { /* Keep the safe launch-gated fallback visible. */ }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

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
    if (!networkReady) {
      const provider = getProvider();
      if (provider) await switchNetwork(provider);
      return;
    }
    if (!status.configured || !status.packsLive) {
      setNotice("Pack contract is not live yet. No payment was requested.");
      return;
    }
    if (status.inventoryCount < 1) {
      setNotice("Inventory is empty. No payment was requested.");
      return;
    }
    const provider = getProvider();
    if (!provider) return;
    setBusy(true);
    setNotice("Checking your 20 USDG allowance…");
    try {
      const priceAtoms = BigInt(Math.round(status.packPriceUsd * 1_000_000));
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
      setNotice("Pack locked. Waiting for Robinhood Chain entropy…");

      for (let attempt = 0; attempt < 80; attempt += 1) {
        const blockHex = await provider.request({ method: "eth_blockNumber" }) as string;
        if (BigInt(blockHex) > entropyBlock) break;
        await delay(1_500);
        if (attempt === 79) throw new Error("ENTROPY_TIMEOUT");
      }

      setNotice("Reveal ready. Confirm the final on-chain reveal.");
      const settleHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: PACK_CONTRACT, data: `0x8533498d${hexWord(requestId)}`, value: "0x0" }],
      }) as string;
      const settleReceipt = await waitForReceipt(provider, settleHash);
      const prizeLog = settleReceipt.logs.find((log) => log.address.toLowerCase() === PACK_CONTRACT.toLowerCase() && log.topics[0]?.toLowerCase() === PRIZE_DELIVERED_TOPIC);
      if (!prizeLog?.topics[3]) throw new Error("PRIZE_EVENT_MISSING");
      const tokenAddress = `0x${prizeLog.topics[3].slice(-40)}`.toLowerCase();
      const valueUsd = Number(BigInt(`0x${prizeLog.data.slice(66, 130)}`)) / 1_000_000;
      const stock = STOCK_TOKENS.find((candidate) => candidate.address.toLowerCase() === tokenAddress);
      if (!stock) throw new Error("UNSUPPORTED_PRIZE_TOKEN");
      setPackResult({ stock, valueUsd, transactionHash: settleHash });
      setStatus((current) => ({ ...current, inventoryCount: Math.max(0, current.inventoryCount - 1) }));
      setNotice("");
    } catch (error) {
      const code = (error as { code?: number })?.code;
      setNotice(code === 4001 ? "Transaction cancelled. No new transaction was sent." : "The pack could not complete. Check the wallet activity before retrying.");
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = busy ? "CONNECTING…" : !account ? "CONNECT WALLET" : !networkReady ? "SWITCH TO ROBINHOOD CHAIN" : !status.configured ? "CONTRACT DEPLOYING" : !status.packsLive ? "PACKS NOT LIVE" : status.inventoryCount < 1 ? "RESTOCKING" : "RIP FOR $20 USDG";

  return (
    <main id="top">
      <div className="ambient" aria-hidden="true" />
      <nav className="nav shell">
        <a href="#top" className="brand" aria-label="StonkRips home"><span className="brand-mark"><i>SR</i></span><b>STONK<span>RIPS</span></b></a>
        <div className="nav-links"><a href="#packs">The pack</a><a href="#stocks">Stock Tokens</a><a href="#how">How it works</a></div>
        <button className="wallet-button" type="button" onClick={() => void connectWallet()} disabled={busy}>{account ? shortAddress(account) : "CONNECT WALLET"}</button>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="network-label"><span /> BUILT FOR ROBINHOOD CHAIN</div>
          <h1>RIP A PACK.<br/><em>PULL A STOCK TOKEN.</em></h1>
          <p className="lead">Pay <strong>$20 USDG</strong>. Reveal one inventory-backed Robinhood Chain Stock Token. Most pulls are smaller; rare funded tiers can exceed <strong>$100</strong> once loaded.</p>
          <div className="hero-actions">
            <button className="rip-button" type="button" onClick={() => void openPack()} disabled={busy || Boolean(account && networkReady && !canRip)}>{buttonLabel}<span>↗</span></button>
            <a className="secondary-button" href={LONG_TOKEN_URL || "https://app.long.xyz/launch"} target="_blank" rel="noreferrer">{LONG_TOKEN_URL ? "TRADE STONKRIPS / SPY" : "VIEW LONG.XYZ"}</a>
          </div>
          <label className="eligibility"><input type="checkbox" checked={termsAccepted} disabled={regionAllowed === false} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>{regionAllowed === false ? `This interface is unavailable in detected region ${country || "restricted"}.` : "I am 18+ and legally eligible to use Robinhood Chain Stock Tokens in my jurisdiction."}</span></label>
          {notice && <p className="notice" role="status">{notice}</p>}
          <div className="hero-facts"><span><b>$20</b><small>FIXED PACK PRICE</small></span><span><b>{status.inventoryCount || "—"}</b><small>FUNDED PACKS</small></span><span><b>{status.maxPrizeUsd ? `$${status.maxPrizeUsd}` : "—"}</b><small>CURRENT TOP TIER</small></span></div>
        </div>

        <div className="pack-terminal" id="packs">
          <div className="terminal-head"><span>STONKRIPS // PACK_01</span><i>{status.packsLive ? "LIVE" : "PRELAUNCH"}</i></div>
          <div className="reel-window">
            <div className="reel-line" />
            <div className="reel-track">{reel.map((stock, index) => <div className="reel-stock" key={`${stock.symbol}-${index}`}><StockLogo stock={stock}/><b>{stock.symbol}</b><small>STOCK TOKEN</small></div>)}</div>
            <div className="mystery-pack"><span>ROBINHOOD CHAIN</span><b>STONK<br/>RIPS</b><small>$20 USDG · 1 RANDOM DROP</small></div>
          </div>
          <div className="terminal-foot"><span>SETTLEMENT <b>USDG</b></span><span>GAS <b>ETH</b></span><span>PAIR <b>SPY</b></span></div>
        </div>
      </section>

      <div className="market-tape"><div>{[...STOCK_TOKENS, ...STOCK_TOKENS].map((stock, index) => <span key={`${stock.symbol}-tape-${index}`}><StockLogo stock={stock}/><b>{stock.symbol}</b><i>◆</i></span>)}</div></div>

      <section className="value-grid shell" aria-label="StonkRips highlights">
        <article><span>01</span><h2>One clean price.</h2><p>Every pack costs exactly $20 in canonical USDG. ETH is used only for Robinhood Chain gas.</p></article>
        <article><span>02</span><h2>Funded inventory.</h2><p>The button only activates when the deployed contract reports at least one Stock Token lot ready to deliver.</p></article>
        <article><span>03</span><h2>On-chain receipt.</h2><p>Payment, selection request, and Stock Token transfer are independently visible on Robinhood Chain.</p></article>
      </section>

      <section className="stock-section shell" id="stocks">
        <div className="section-heading"><span>OFFICIAL ROBINHOOD CHAIN ASSETS</span><h2>Ten ways<br/>to rip.</h2><p>The launch rotation uses standard 18-decimal ERC-20 Stock Tokens discovered through Robinhood&apos;s asset registry.</p></div>
        <div className="stock-grid">{STOCK_TOKENS.map((stock, index) => <a key={stock.symbol} href={`https://robinhoodchain.blockscout.com/token/${stock.address}`} target="_blank" rel="noreferrer"><em>{String(index + 1).padStart(2, "0")}</em><StockLogo stock={stock}/><span><b>{stock.symbol}</b><small>{stock.name}</small></span><i>↗</i></a>)}</div>
      </section>

      <section className="how shell" id="how">
        <div className="section-heading"><span>PACK FLOW</span><h2>Four moves.<br/>One reveal.</h2></div>
        <div className="steps">
          <article><b>1</b><h3>Connect</h3><p>Use an EVM wallet and switch to Robinhood Chain, network 4663.</p></article>
          <article><b>2</b><h3>Approve</h3><p>Approve exactly 20 USDG for the StonkRips pack contract.</p></article>
          <article><b>3</b><h3>Rip</h3><p>A future Robinhood Chain blockhash selects one funded inventory lot on-chain.</p></article>
          <article><b>4</b><h3>Receive</h3><p>The selected Stock Token transfers directly to the connected wallet.</p></article>
        </div>
      </section>

      <section className="pairing shell">
        <div><span>LONG.XYZ MARKET</span><h2>Paired with<br/><em>SPY.</em></h2></div>
        <p>{LONG_TOKEN_URL ? "The official StonkRips market is configured against SPY on Long.xyz." : "The StonkRips / SPY Long.xyz market link will appear here once its official URL is configured."}</p>
        <a href={LONG_TOKEN_URL || "https://app.long.xyz/launch"} target="_blank" rel="noreferrer">OPEN LONG.XYZ ↗</a>
      </section>

      <section className="legal shell">
        <b>IMPORTANT</b>
        <p>Robinhood Chain Stock Tokens provide economic exposure to referenced assets; they are not shares and do not provide shareholder rights. This interface blocks detected access from the United States, Canada, the United Kingdom, and Switzerland. A $100+ pull is possible only when a funded tier of that value is actually loaded; it is never a guaranteed return. StonkRips is independent and is not endorsed by Robinhood or Long.xyz.</p>
      </section>

      <footer className="shell"><a href="#top" className="brand"><span className="brand-mark"><i>SR</i></span><b>STONK<span>RIPS</span></b></a><div><a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">EXPLORER</a>{X_URL && <a href={X_URL} target="_blank" rel="noreferrer">X</a>}<a href="https://docs.robinhood.com/chain/" target="_blank" rel="noreferrer">CHAIN DOCS</a></div><span>ROBINHOOD CHAIN · 4663</span></footer>

      {packResult && <div className="result-modal" role="dialog" aria-modal="true" aria-label="Pack result"><div className="result-card">
        <button type="button" onClick={() => setPackResult(null)} aria-label="Close result">×</button>
        <span>PACK REVEALED</span>
        <StockLogo stock={packResult.stock}/>
        <h2>{packResult.stock.symbol}</h2>
        <p>${packResult.valueUsd.toFixed(2)} OF {packResult.stock.name.toUpperCase()}</p>
        <a href={`https://robinhoodchain.blockscout.com/tx/${packResult.transactionHash}`} target="_blank" rel="noreferrer">VIEW ON-CHAIN RECEIPT ↗</a>
      </div></div>}
    </main>
  );
}
