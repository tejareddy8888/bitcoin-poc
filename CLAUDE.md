# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bitcoin transaction proof-of-concept: a Node.js/Express REST API for Bitcoin testnet/signet operations (key generation, UTXO management, transaction building/signing/broadcasting, message signing, 2-of-2 multisig via P2WSH/P2SH-P2WSH).

## Commands

```bash
npm install                # Install dependencies
npm start                  # Start server (port 3000)
npm run dev                # Start with nodemon auto-reload
node scripts/demo.js       # Generate demo addresses / send transaction
node scripts/check-utxos.js <address>  # Check UTXOs for address
npm run test:signing       # Test message signing (requires TEST_PRIVATE_KEY_WIF env var)
```

No test suite exists — `npm test` is a no-op placeholder.

## Architecture

```
src/
  server.js              # Express app: middleware stack, route mounting, error handling
  config/network.js      # Network selection (BITCOIN_NETWORK env: "signet"|"testnet")
  lib/
    bitcoin.js           # Single ECC/ECPair initialization — all other lib files import from here
    keys.js              # generateKeyPair, keyPairFromWIF, deriveAddresses
    utxo.js              # fetchUTXOs (mempool.space API), selectCoins (largest-first)
    transaction.js       # P2WPKH: build/sign/broadcast/fee estimation, createSigner
    message.js           # Bitcoin message sign/verify (recoverable ECDSA)
    multisig.js          # 2-of-2 P2WSH/P2SH-P2WSH: witness scripts, PSBT build/sign, signing status
  middleware/validation.js  # handleValidationErrors, asyncHandler, successResponse, errorResponse
  routes/
    bitcoin.js           # /api/bitcoin/* — standard P2WPKH endpoints
    multisig.js          # /api/bitcoin/wsh/* — multisig endpoints
scripts/                 # CLI tools (demo, UTXO checker, signing test)
```

### Key Architectural Decisions

- **`src/lib/bitcoin.js` is the single point of ECC initialization.** All lib modules import `{ bitcoin, ecc, ECPair }` from here. Never call `bitcoin.initEccLib()` or `ECPairFactory()` elsewhere.
- **Route mounting order matters:** `/api/bitcoin/wsh` (multisig) is mounted separately from `/api/bitcoin` (standard). Both are Express routers.
- **All external Bitcoin network calls go through mempool.space API** (`src/config/network.js` builds the base URL). No direct node RPC.
- **PSBT is the transaction format** throughout — built unsigned, then signed (potentially by multiple parties for multisig), then finalized and broadcast.

### Conventions for New Endpoints

Routes follow this pattern (see `src/routes/bitcoin.js`):

```js
router.post('/endpoint', [
  body('field').notEmpty().withMessage('...'),  // express-validator
  handleValidationErrors,                        // middleware rejects if invalid
], asyncHandler(async (req, res) => {
  try {
    // ... business logic using src/lib/ functions
    res.json(successResponse(result, 'Message'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to ...'));
  }
}));
```

- Always use `express-validator` for request validation
- Wrap handlers in `asyncHandler` (catches promise rejections)
- Return `successResponse(data, message)` or `errorResponse(error, message)`
- Import key operations from `src/lib/keys.js` (`keyPairFromWIF`) — don't re-instantiate ECPair in routes

## Environment Variables

Configured via `.env` (see `.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | — | `development` enables error stack traces in responses |
| `BITCOIN_NETWORK` | `signet` | `"signet"` or `"testnet"` — controls mempool.space API URL and faucet |
| `TEST_PRIVATE_KEY_WIF` | — | Used by `scripts/test-message-signing.js` |

## Bitcoin Domain Notes

- **Dust limit**: 546 sats minimum output, enforced in transaction building
- **Fee estimation**: P2WPKH uses `10.5 + (inputs × 68) + (outputs × 31)` vBytes; P2WSH multisig uses `10.5 + (inputs × 104) + (outputs × 43)` vBytes
- **Coin selection**: Largest-first greedy algorithm
- **Network**: Both signet and testnet use `bitcoin.networks.testnet` params in bitcoinjs-lib — the difference is only the mempool.space API URL
- **Multisig signing status**: `getSigningStatus(psbt)` in `src/lib/multisig.js` parses the witness script to track which keys have signed — useful for multi-step signing flows
