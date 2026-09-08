// Read-only launch checks. Never creates a wallet client or broadcasts a transaction.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPublicClient, formatUnits, http, isAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CANONICAL_USDG, ROBINHOOD_CHAIN_ID } from "./pons-core.mjs";
import { supabaseHeaders } from "./supabase-headers.mjs";

export function inspectLaunchInputs(env) {
  const problems = [];
  let wallet = null;
  const key = env.AUTOMATION_PRIVATE_KEY?.trim();
  if (!key) problems.push("AUTOMATION_PRIVATE_KEY is missing");
  else {
    try { wallet = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`).address; }
    catch { problems.push("AUTOMATION_PRIVATE_KEY must be a valid 32-byte EVM key"); }
  }
  let ponsWallet = null;
  const ponsKey = env.PONS_PRIVATE_KEY?.trim();
  if (ponsKey) {
    try { ponsWallet = privateKeyToAccount(ponsKey.startsWith("0x") ? ponsKey : `0x${ponsKey}`).address; }
    catch { problems.push("PONS_PRIVATE_KEY must be a valid 32-byte EVM key"); }
  } else if (env.CREATOR_FEE_CLAIM_ENABLED === "true" || env.HOLDER_REWARDS_ENABLED === "true") {
    problems.push("PONS_PRIVATE_KEY is required when Pons automation is enabled");
  }
  const swapProvider = (env.SWAP_PROVIDER || "uniswap-v4").trim();
  if (!["uniswap-v4", "0x"].includes(swapProvider)) problems.push("SWAP_PROVIDER must be uniswap-v4 or 0x");
  if (swapProvider === "0x" && !env.ZEROX_API_KEY?.trim()) problems.push("ZEROX_API_KEY is required only when SWAP_PROVIDER=0x");
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) problems.push("SUPABASE_SERVICE_ROLE_KEY is missing");
  let databaseUrl = null;
  try {
    const url = new URL(env.SUPABASE_URL?.trim());
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error();
    databaseUrl = url.origin;
  } catch { problems.push("SUPABASE_URL must be the project HTTPS URL from Supabase Connect"); }
  const contract = env.STOCKRIPS_PACK_CONTRACT?.trim() || null;
  if (contract && !isAddress(contract)) problems.push("STOCKRIPS_PACK_CONTRACT is not a valid EVM address");
  return { wallet, ponsWallet, databaseUrl, contract, problems };
}

export async function checkLaunch(env = process.env) {
  const inputs = inspectLaunchInputs(env);
  const checks = inputs.problems.map(detail => ({ status: "blocked", detail }));
  const client = createPublicClient({ transport: http(env.ROBINHOOD_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com", { timeout: 12000, retryCount: 0 }) });
  const [chain, database] = await Promise.all([
    (async () => {
      try {
        if (await client.getChainId() !== ROBINHOOD_CHAIN_ID) return { status: "blocked", detail: "RPC must be Robinhood Chain 4663" };
        if (!inputs.wallet) return { status: "pass", detail: "Robinhood Chain RPC reachable; funding check needs the treasury key" };
        const [eth, usdg] = await Promise.all([
          client.getBalance({ address: inputs.wallet }),
          client.readContract({ address: CANONICAL_USDG, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [inputs.wallet] }),
        ]);
        return { status: eth > 0n && usdg > 0n ? "pass" : "blocked", detail: "Treasury balances (exact purchase budget and gas estimate still required before sending)", wallet: inputs.wallet, ETH: formatUnits(eth, 18), USDG: formatUnits(usdg, 6) };
      } catch { return { status: "blocked", detail: "RPC or treasury balance check failed; no transaction sent" }; }
    })(),
    (async () => {
      if (!inputs.databaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { status: "blocked", detail: "Database check needs valid Supabase credentials" };
      const tables = ["treasury_purchases", "pack_settlements", "automation_locks", "pack_reinvestment_epochs", "pack_sale_receipts", "pack_reinvestment_lots", "pack_reinvestment_transactions"];
      try {
        // HEAD verifies schema/access without reading audit rows or signed bytes.
        const results = await Promise.all(tables.map(async table => {
          const response = await fetch(`${inputs.databaseUrl}/rest/v1/${table}?select=*&limit=0`, {
            method: "HEAD", redirect: "error", signal: AbortSignal.timeout(12000),
            headers: supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY.trim()),
          });
          return { table, status: response.status };
        }));
        const failures = results.filter(result => result.status !== 200 && result.status !== 206);
        return failures.length ? { status: "blocked", detail: "Database access/schema incomplete; check credentials and run launch-setup.sql", failures } : { status: "pass", detail: "All seven automation tables reachable" };
      } catch { return { status: "blocked", detail: "Supabase unreachable; correct the project URL/key before launch" }; }
    })(),
  ]);
  checks.push(chain, database);
  checks.push({ status: "pending", detail: inputs.contract ? "Configured pack contract still requires on-chain bootstrap verification" : "Pack contract deployment pending; keep sales disabled" });
  checks.push({ status: "pending", detail: "Stock route, seeded inventory, settlement, and worker dry-run require verification" });
  return { readOnly: true, launchReady: false, configurationChecksPassed: !checks.some(check => check.status === "blocked"), checks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkLaunch();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.configurationChecksPassed ? 0 : 1;
}
