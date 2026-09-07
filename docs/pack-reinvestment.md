# Hourly settled-payment restocking

Independent of Pons. The worker reserves **100% of confirmed, settled pack payments** once per closed UTC hour, then buys configured Stock Tokens in varied budgets. An open request is not a settled sale. Initial wallet deposits are not sale receipts.

Every swap budget is reserved; plans sum exactly to the receipt total. Actual token transfer logs establish stock received, and only those atoms are loaded. A shared lease and persisted signed-transaction journal protect retries. The stock value may differ from its USDG purchase budget due to markets/slippage; no return or profit is promised.

See [setup and activation](start-here.md). The planned Pons fee split is separate and disabled.
