import test from "node:test";
import assert from "node:assert/strict";
import { discoverEvmWallets, uniqueEvmWalletOptions, ensureRobinhoodChain, isPhantomProvider, selectEvmProvider, walletAccount, walletChainId, walletErrorMessage } from "../app/lib/wallet-provider.ts";

test("Rabby announced and legacy wrappers appear once while MetaMask stays available", () => {
  const announced = { request: async () => null, isRabby: true, isMetaMask: true };
  const legacy = { request: async () => null, isRabby: true, isMetaMask: true };
  const metamask = { request: async () => null, isMetaMask: true };
  const choices = uniqueEvmWalletOptions([
    { provider: announced, info: { name: "Rabby Wallet", rdns: "io.rabby" } },
    { provider: metamask, info: { name: "MetaMask", rdns: "io.metamask" } },
    { provider: legacy },
  ]);
  assert.deepEqual(choices.map(x => x.name), ["Rabby Wallet", "MetaMask"]);
  assert.equal(choices[0].provider, announced);
});

test("duplicate announcements collapse by identity without hiding unknown distinct wallets", () => {
  const first = { request: async () => null };
  const second = { request: async () => null };
  assert.equal(uniqueEvmWalletOptions([
    { provider: first, info: { rdns: "io.rabby", name: "Rabby" } },
    { provider: second, info: { rdns: "io.rabby", name: "Rabby Wallet" } },
  ]).length, 1);
  assert.equal(uniqueEvmWalletOptions([{ provider: first }, { provider: second }, { provider: first }]).length, 2);
});

test("Phantom is never selected for the Robinhood Chain flow", () => {
  const phantom = { isPhantom: true, request: async () => null };
  const evm = { request: async () => null };
  assert.equal(selectEvmProvider([{ provider: phantom }, { provider: evm }]), evm);
  assert.equal(selectEvmProvider([{ provider: phantom }]), null);
  assert.equal(isPhantomProvider({ provider: evm, info: { name: "Phantom", rdns: "app.phantom" } }), true);
});

test("an announced Robinhood provider is preferred over other compatible EVM wallets", () => {
  const generic = { request: async () => null };
  const robinhood = { request: async () => null };
  assert.equal(selectEvmProvider([
    { provider: generic, info: { name: "Generic EVM" } },
    { provider: robinhood, info: { name: "Robinhood Wallet", rdns: "com.robinhood.wallet" } },
  ]), robinhood);
});

test("wallet discovery returns choices instead of automatically requesting an account", async () => {
  const requested = [];
  const rabby = { isRabby: true, request: async ({ method }) => { requested.push(method); return []; } };
  const robinhood = { isRobinhood: true, request: async ({ method }) => { requested.push(method); return []; } };
  const host = {
    ethereum: { request: async () => null, providers: [rabby, robinhood] },
    addEventListener() {}, dispatchEvent() { return true; },
  };
  const choices = await discoverEvmWallets(host, 0);
  assert.deepEqual(choices.map(({ name }) => name), ["Rabby Wallet", "Robinhood Wallet"]);
  assert.deepEqual(requested, []);
});

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
