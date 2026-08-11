import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";

export const USDC_MINT = process.env.USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const PACK_PRICE_USDC_ATOMS = BigInt("10000000");

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function publicKeyEnv(name: string) { return new PublicKey(requiredEnv(name)); }

export function keypairEnv(name: string) {
  const raw = requiredEnv(name);
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}

function firstConfiguredEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing ${names[0]}`);
}

/**
 * Stonk Drops intentionally uses one operational wallet for fee collection,
 * inventory custody, and holder-drop signing. The legacy names remain as
 * fallbacks so an existing deployment can migrate without moving funds.
 */
export function protocolWallet() {
  return new PublicKey(firstConfiguredEnv("PROTOCOL_WALLET", "MAIN_TREASURY_WALLET", "HOLDER_AIRDROP_WALLET"));
}

export function protocolSigner() {
  const raw = firstConfiguredEnv("PROTOCOL_SIGNER_SECRET", "MAIN_TREASURY_SIGNER_SECRET", "HOLDER_AIRDROP_SIGNER_SECRET");
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
  const signer = Keypair.fromSecretKey(bytes);
  const wallet = protocolWallet();
  if (!signer.publicKey.equals(wallet)) throw new Error("Protocol signer does not match PROTOCOL_WALLET");
  return signer;
}

export function rpcUrl() { return process.env.HELIUS_RPC_URL || requiredEnv("SOLANA_RPC_URL"); }

export function supabaseConfig() {
  return { url: requiredEnv("SUPABASE_URL"), key: requiredEnv("SUPABASE_SERVICE_ROLE_KEY") };
}

export async function supabase(path: string, init: RequestInit = {}) {
  const { url, key } = supabaseConfig();
  return fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey:key, Authorization:`Bearer ${key}`, "Content-Type":"application/json", Prefer:"return=representation", ...init.headers }, cache:"no-store" });
}
