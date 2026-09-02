import { getAddress, isAddress, keccak256, stringToHex } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663;
export const CANONICAL_SPY = "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C";
export const CANONICAL_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const PONS_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
export const PONS_V2_FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";

export const STOCK_TOKENS = [
  ["SPY", "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"],
  ["AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"],
  ["NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"],
  ["TSLA", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"],
  ["MSFT", "0xe93237C50D904957Cf27E7B1133b510C669c2e74"],
  ["GOOGL", "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3"],
  ["AMZN", "0x12f190a9F9d7D37a250758b26824B97CE941bF54"],
  ["META", "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35"],
  ["QQQ", "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"],
  ["COIN", "0x6330D8C3178a418788dF01a47479c0ce7CCF450b"],
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
