# StonkRips contract

`StonkRips.sol` sells one inventory-backed pack for exactly 20 USDG. Packs are off by default.

## Security model

- Only ten allowlisted Robinhood Chain Stock Tokens can be loaded.
- Each loaded lot is a specific token amount and operator-declared USD value.
- Only one pack request may be active, preventing settlement-order manipulation.
- Inventory cannot change while a request is active.
- A future blockhash selects the lot; anyone may call settlement after the entropy block.
- USDG stays in the contract until a Stock Token transfer succeeds, then routes to the treasury.
- The contract never contains an operator private key.

The future-blockhash scheme is transparent but is not the same as oracle VRF. Obtain an independent smart-contract audit and legal review before mainnet use.

## Approved mainnet Stock Tokens

Pass these addresses to the constructor after reconfirming them against Robinhood's live asset registry:

```text
SPY   0x117cc2133c37B721F49dE2A7a74833232B3B4C0C
AAPL  0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9
NVDA  0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
TSLA  0x322F0929c4625eD5bAd873c95208D54E1c003b2d
MSFT  0xe93237C50D904957Cf27E7B1133b510C669c2e74
GOOGL 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3
AMZN  0x12f190a9F9d7D37a250758b26824B97CE941bF54
META  0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35
QQQ   0xD5f3879160bc7c32ebb4dC785F8a4F505888de68
COIN  0x6330D8C3178a418788dF01a47479c0ce7CCF450b
```

## Verification

```bash
forge test -vv
forge build --sizes
```

Do not deploy with a raw private key in a repository, frontend environment, or shared shell history. Use a hardware wallet, Foundry keystore, or a dedicated audited deployment process.
