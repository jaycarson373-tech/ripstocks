// Compatibility entrypoint. Retires the former v1 factory/locker integration.
import { main } from "./treasury-worker.mjs";
main().catch(() => { console.error("Treasury configuration invalid; run launch:check."); process.exitCode = 1; });
