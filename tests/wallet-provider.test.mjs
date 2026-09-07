import test from "node:test";
import assert from "node:assert/strict";
import { ensureRobinhoodChain, walletAccount, walletChainId, walletErrorMessage } from "../app/lib/wallet-provider.ts";

test("an already connected Robinhood wallet needs no network prompt", async () => {
  const methods = [];
  const chain = await ensureRobinhoodChain({ request: async ({ method }) => { methods.push(method); return "0x1237"; } });
  assert.equal(chain, 4663);
  assert.deepEqual(methods, ["eth_chainId"]);
});

test("an unknown chain is added and explicitly switched before it is accepted", async () => {
  let chain = "0x1";
  let added = false;
  const methods = [];
  const result = await ensureRobinhoodChain({ request: async ({ method }) => {
    methods.push(method);
    if (method === "eth_chainId") return chain;
    if (method === "wallet_switchEthereumChain") {
      if (!added) throw { code: 4902 };
      chain = "0x1237";
    }
    if (method === "wallet_addEthereumChain") added = true;
    return null;
  } });
  assert.equal(result, 4663);
  assert.equal(methods.filter(method => method === "wallet_switchEthereumChain").length, 2);
  assert.equal(methods.at(-1), "eth_chainId");
  assert.equal(methods.includes("eth_sendTransaction"), false);
});

test("a wallet that reports success without switching is rejected", async () => {
  await assert.rejects(ensureRobinhoodChain({ request: async ({ method }) => method === "eth_chainId" ? "0x1" : null }), /WALLET_WRONG_NETWORK/);
});

test("rejecting a switch does not trigger an add-network prompt", async () => {
  const methods = [];
  const rejection = { code: 4001 };
  await assert.rejects(ensureRobinhoodChain({ request: async ({ method }) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1";
    throw rejection;
  } }), error => error === rejection);
  assert.deepEqual(methods, ["eth_chainId", "wallet_switchEthereumChain"]);
});

test("a wallet that switches while adding the network needs no second switch", async () => {
  let chain = "0x1";
  let switches = 0;
  await ensureRobinhoodChain({ request: async ({ method }) => {
    if (method === "eth_chainId") return chain;
    if (method === "wallet_switchEthereumChain") { switches += 1; throw { code: 4902 }; }
    if (method === "wallet_addEthereumChain") chain = "0x1237";
    return null;
  } });
  assert.equal(switches, 1);
});

test("malformed account and chain responses never mark a wallet ready", () => {
  assert.equal(walletAccount(["not-a-wallet"]), "");
  assert.equal(walletAccount([]), "");
  assert.equal(walletAccount(null), "");
  assert.equal(walletAccount(["0x" + "a".repeat(40)]), "0x" + "a".repeat(40));
  assert.equal(walletChainId("0x1237junk"), null);
  assert.equal(walletChainId("4663"), null);
  assert.equal(walletChainId("0x1237"), 4663);
});

test("wallet errors explain pending requests without leaking provider internals", () => {
  assert.match(walletErrorMessage({ code: -32002 }), /already open/);
  assert.match(walletErrorMessage({ code: 4001 }), /cancelled/);
  assert.equal(walletErrorMessage(new Error("private provider details")), "Could not connect to Robinhood Chain. Open your wallet and try again.");
});
