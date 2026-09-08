import { getAddress, isAddress, keccak256, stringToHex } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663;
export const CANONICAL_SPY = "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C";
export const CANONICAL_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

export const STOCK_TOKENS = [
  ["SPY", "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"],
  ["NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"],
  ["TSLA", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"],
  ["GME", "0x1b0E319c6A659F002271B69dB8A7df2F911c153E"],
  ["PLTR", "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A"],
  ["COIN", "0x6330D8C3178a418788dF01a47479c0ce7CCF450b"],
  ["RKLB", "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2"],
  ["SPCX", "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa"],
  ["AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"],
  ["MRVL", "0x62fd0668e10D8B72339BE2DCF7643001688ff13B"],
].map(([symbol, address]) => ({ symbol, address: getAddress(address) }));

export function parseMode(value = "off") {
  const mode = value.trim().toLowerCase();
  if (!new Set(["off", "dry-run", "live"]).has(mode)) {
    throw new Error("AUTOMATION_MODE must be off, dry-run, or live");
  }
  return mode;
}

export function required(name, value) {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function addressEnv(name, value) {
  const raw = required(name, value);
  if (!isAddress(raw)) throw new Error(`${name} is not a valid EVM address`);
  return getAddress(raw);
}

export function positiveInteger(name, value, fallback) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function basisPoints(name, value, fallback) {
  const parsed = positiveInteger(name, value, fallback);
  if (parsed >= 10_000) throw new Error(`${name} must be below 10000`);
  return parsed;
}

export function epochKey(date, intervalMinutes = 60) {
  const intervalMs = intervalMinutes * 60_000;
  const start = Math.floor(date.getTime() / intervalMs) * intervalMs;
  return new Date(start).toISOString();
}

export function splitAmount(amount, firstShareBps = 5_000) {
  const first = (BigInt(amount) * BigInt(firstShareBps)) / 10_000n;
  return [first, BigInt(amount) - first];
}

export function ticketUnit(tokensPerTicket, decimals) {
  const normalized = String(tokensPerTicket).trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("TOKENS_PER_TICKET must be a positive decimal");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error("TOKENS_PER_TICKET exceeds token precision");
  const atoms = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  if (atoms <= 0n) throw new Error("TOKENS_PER_TICKET must be positive");
  return atoms;
}

export function weightedWinner(candidates, seed, unit) {
  const eligible = candidates
    .map((candidate) => ({ ...candidate, tickets: BigInt(candidate.balance) / BigInt(unit) }))
    .filter((candidate) => candidate.tickets > 0n)
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const totalTickets = eligible.reduce((total, candidate) => total + candidate.tickets, 0n);
  if (totalTickets === 0n) throw new Error("No eligible holder tickets at the snapshot block");
  let cursor = BigInt(seed) % totalTickets;
  for (const candidate of eligible) {
    if (cursor < candidate.tickets) return { winner: candidate.address, totalTickets, winningTicket: BigInt(seed) % totalTickets };
    cursor -= candidate.tickets;
  }
  throw new Error("Weighted selection failed");
}

export function deriveSeed(blockHash, epoch, label) {
  return BigInt(keccak256(stringToHex(`${blockHash.toLowerCase()}:${epoch}:${label}`)));
}

export function deterministicStockOrder(blockHash, epoch, label) {
  return STOCK_TOKENS
    .map((stock) => ({ stock, rank: deriveSeed(blockHash, epoch, `${label}:${stock.symbol}`) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map(({ stock }) => stock);
}

export async function discoverContractStartBlock(latestBlock, bytecodeAt) {
  let low = 0n;
  let high = BigInt(latestBlock);
  if (!await bytecodeAt(high)) throw new Error("Token contract has no bytecode at the latest block");
  while (low < high) {
    const middle = (low + high) / 2n;
    if (await bytecodeAt(middle)) high = middle;
    else low = middle + 1n;
  }
  return low;
}

export function applyTransfers(logs) {
  const balances = new Map();
  for (const log of logs) {
    const amount = BigInt(log.args.value);
    const from = getAddress(log.args.from);
    const to = getAddress(log.args.to);
    if (from !== "0x0000000000000000000000000000000000000000") {
      balances.set(from, (balances.get(from) || 0n) - amount);
    }
    if (to !== "0x0000000000000000000000000000000000000000") {
      balances.set(to, (balances.get(to) || 0n) + amount);
    }
  }
  return [...balances.entries()].filter(([, balance]) => balance > 0n).map(([address, balance]) => ({ address, balance }));
}

export function eligibleHolderSnapshot(logs, exclusions, unit) {
  const excluded = new Set([...exclusions].map((address) => getAddress(address).toLowerCase()));
  const holders = applyTransfers(logs)
    .filter(({ address }) => !excluded.has(address.toLowerCase()))
    .map(({ address, balance }) => ({ address, balance, tickets: balance / BigInt(unit) }))
    .filter(({ tickets }) => tickets > 0n)
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const canonical = holders.map(({ address, balance, tickets }) => `${address.toLowerCase()}:${balance}:${tickets}`).join("|");
  return {
    holders,
    totalTickets: holders.reduce((sum, holder) => sum + holder.tickets, 0n),
    snapshotHash: keccak256(stringToHex(canonical || "empty")),
  };
}

export function decimalToScaled(value, decimals) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error(`Invalid decimal: ${value}`);
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

export function usdMicrosForTokenAmount(tokenAtoms, price, multiplier, tokenDecimals = 18) {
  const priceMicros = decimalToScaled(price, 6);
  const multiplierAtoms = decimalToScaled(multiplier, 18);
  return (BigInt(tokenAtoms) * priceMicros * multiplierAtoms) / (10n ** BigInt(tokenDecimals + 18));
}
