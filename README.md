# Bitcoin Transaction API Service

A RESTful API service for Bitcoin transactions built with Express.js and bitcoinjs-lib. Supports key generation, address derivation, UTXO management, transaction building/signing/broadcasting, message signing, and 2-of-2 multisig (P2WSH / P2SH-P2WSH) on Bitcoin testnet/signet.

## Installation

```bash
git clone <repository-url>
cd bitcoin-poc
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | — | Set to `development` for error stack traces |
| `BITCOIN_NETWORK` | `signet` | `"signet"` or `"testnet"` |
| `SIGNING_MAX_WAIT_TIME_SECONDS` | `60` | Max wait time before async signature requests time out |

## Starting the Server

```bash
npm start          # Production
npm run dev        # Development (auto-reload with nodemon)
```

## CLI Tools

```bash
node scripts/demo.js                                       # Generate demo addresses
node scripts/demo.js <privateKeyWIF> <recipient> <amount>   # Send transaction via CLI
node scripts/check-utxos.js <address>                       # Check UTXOs for an address
npm run test:signing                                        # Test message signing (needs TEST_PRIVATE_KEY_WIF)
```

---

## API Reference

Base URL: `http://localhost:3000`

All responses follow this format:

```json
// Success
{ "success": true, "message": "...", "data": { ... } }

// Error
{ "success": false, "message": "...", "error": "..." }
```

---

### Health & Status

#### Health Check

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-04-20T09:00:00.000Z",
  "environment": "development",
  "nodeVersion": "v24.13.0",
  "uptime": 42.5
}
```

#### API Status

```bash
curl http://localhost:3000/api/status
```

Returns server info and a list of all available endpoints.

---

### Key Management

#### Generate Key Pair

Generates a new Bitcoin key pair and derives all address types.

```bash
curl -X POST http://localhost:3000/api/bitcoin/keypair
```

**Response:**
```json
{
  "success": true,
  "message": "Key pair generated successfully",
  "data": {
    "privateKeyWIF": "cNhyQNc3r9eEKPJJ31p71LgvU9FT8UMJaBUSXSHk1jwhi49kp255",
    "publicKey": "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
    "addresses": {
      "p2pkh": "mqwhUDGN69pwwjpzkq4nnnh4gN25tQvoM4",
      "p2sh": "2NC9Zk4KKrS8wVVKYkQbBCVMedGHu82uHoz",
      "p2wpkh": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
      "p2tr": "tb1prfw0kmkw3hrymtgzfn3l20h0v8kcqqlq2trju5ltxhca64p66t3srxjd8q"
    }
  }
}
```

#### Derive Addresses from Private Key

```bash
curl http://localhost:3000/api/bitcoin/addresses/cNhyQNc3r9eEKPJJ31p71LgvU9FT8UMJaBUSXSHk1jwhi49kp255
```

**Response:**
```json
{
  "success": true,
  "message": "Addresses derived successfully",
  "data": {
    "publicKey": "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
    "addresses": {
      "p2pkh": "mqwhUDGN69pwwjpzkq4nnnh4gN25tQvoM4",
      "p2sh": "2NC9Zk4KKrS8wVVKYkQbBCVMedGHu82uHoz",
      "p2wpkh": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
      "p2tr": "tb1prfw0kmkw3hrymtgzfn3l20h0v8kcqqlq2trju5ltxhca64p66t3srxjd8q"
    }
  }
}
```

---

### UTXO Management

#### Fetch UTXOs

```bash
curl http://localhost:3000/api/bitcoin/utxos/tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a
```

**Response:**
```json
{
  "success": true,
  "message": "UTXOs fetched successfully",
  "data": {
    "address": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
    "utxos": [
      {
        "txid": "abc123...",
        "vout": 0,
        "value": 50000,
        "status": { "confirmed": true, "block_height": 210000 }
      }
    ],
    "totalBalance": 50000,
    "utxoCount": 1
  }
}
```

#### Select Coins

Selects optimal UTXOs using largest-first strategy to cover a target amount.

```bash
curl -X POST http://localhost:3000/api/bitcoin/select-coins \
  -H "Content-Type: application/json" \
  -d '{
    "utxos": [
      { "txid": "abc123...", "vout": 0, "value": 30000 },
      { "txid": "def456...", "vout": 1, "value": 50000 }
    ],
    "targetAmount": 40000
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Coins selected successfully",
  "data": {
    "selectedUtxos": [
      { "txid": "def456...", "vout": 1, "value": 50000 }
    ],
    "totalSelected": 50000,
    "targetAmount": 40000,
    "change": 10000
  }
}
```

---

### Transaction Management

#### Estimate Fee

```bash
curl -X POST http://localhost:3000/api/bitcoin/estimate-fee \
  -H "Content-Type: application/json" \
  -d '{
    "numInputs": 2,
    "numOutputs": 2,
    "feeRate": 1
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Fee estimated successfully",
  "data": {
    "numInputs": 2,
    "numOutputs": 2,
    "feeRate": 1,
    "estimatedFee": 209
  }
}
```

> Fee formula (P2WPKH): `ceil(10.5 + inputs*68 + outputs*31) * feeRate`

#### Build Transaction (Unsigned PSBT)

Builds a PSBT without signing it. Provide either `privateKeyWIF` or `sourceAddress` to identify the input address.

```bash
curl -X POST http://localhost:3000/api/bitcoin/build-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAddress": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
    "utxos": {
      "selected": [{ "txid": "abc123...", "vout": 0, "value": 50000 }],
      "total": 50000
    },
    "recipientAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 30000,
    "changeAddress": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction built successfully",
  "data": {
    "psbt": "cHNidP8B...",
    "inputCount": 1,
    "outputCount": 2,
    "sourceAddress": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a"
  }
}
```

#### Sign Transaction

Signs a PSBT with a private key, finalizes it, and returns the raw transaction hex.

```bash
curl -X POST http://localhost:3000/api/bitcoin/sign-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "privateKeyWIF": "cNhyQNc3r9eEKPJJ31p71LgvU9FT8UMJaBUSXSHk1jwhi49kp255",
    "psbtBase64": "cHNidP8B..."
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction signed successfully",
  "data": {
    "txId": "a1b2c3d4...",
    "txHex": "02000000...",
    "size": 222
  }
}
```

#### Broadcast Transaction

```bash
curl -X POST http://localhost:3000/api/bitcoin/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "txHex": "02000000..."
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction broadcast successfully",
  "data": {
    "txId": "a1b2c3d4...",
    "explorerUrl": "https://mempool.space/signet/tx/a1b2c3d4..."
  }
}
```

#### Monitor Transaction

```bash
curl http://localhost:3000/api/bitcoin/monitor/a1b2c3d4e5f6...
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction status retrieved",
  "data": {
    "txId": "a1b2c3d4e5f6...",
    "confirmed": true,
    "blockHeight": 210000,
    "explorerUrl": "https://mempool.space/signet/tx/a1b2c3d4e5f6..."
  }
}
```

#### Send (Complete Flow)

One-call shortcut: fetches UTXOs, selects coins, builds PSBT, signs, and broadcasts.

```bash
curl -X POST http://localhost:3000/api/bitcoin/send \
  -H "Content-Type: application/json" \
  -d '{
    "privateKeyWIF": "cNhyQNc3r9eEKPJJ31p71LgvU9FT8UMJaBUSXSHk1jwhi49kp255",
    "recipientAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 30000
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction sent successfully",
  "data": {
    "txId": "a1b2c3d4...",
    "fromAddress": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
    "toAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 30000,
    "fee": 141,
    "explorerUrl": "https://mempool.space/signet/tx/a1b2c3d4..."
  }
}
```

> Amount must be >= 546 sats (dust limit).

---

### Message Signing

#### Sign Message

Proves ownership of an address without spending funds or exposing the private key.

```bash
curl -X POST http://localhost:3000/api/bitcoin/sign-message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I own this address",
    "privateKeyWIF": "cNhyQNc3r9eEKPJJ31p71LgvU9FT8UMJaBUSXSHk1jwhi49kp255"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Message signed successfully",
  "data": {
    "signature": "H6cKjx8WNqP+...",
    "address": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
    "message": "I own this address"
  }
}
```

#### Verify Message

Verifies a signature against P2PKH, P2SH, or P2WPKH addresses.

```bash
curl -X POST http://localhost:3000/api/bitcoin/verify-message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I own this address",
    "address": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
    "signature": "H6cKjx8WNqP+..."
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Signature is valid",
  "data": {
    "message": "I own this address",
    "address": "tb1qwf05s8njjjg2rf7shu5makf4rc63ldssdgyx9a",
    "signature": "H6cKjx8WNqP+...",
    "valid": true
  }
}
```

---

### Multisig (2-of-2 P2WSH / P2SH-P2WSH)

All multisig endpoints are under `/api/bitcoin/wsh/`.

#### Generate Multisig Keypair

Creates two keys and derives both P2WSH and P2SH-P2WSH addresses from their 2-of-2 witness script.

```bash
curl -X POST http://localhost:3000/api/bitcoin/wsh/keypair
```

**Response:**
```json
{
  "success": true,
  "message": "2-of-2 multisig WSH keypair generated",
  "data": {
    "key1WIF": "cTuTLV84QtYUHxeds5DUr8QT4xVUvUaArR5NtFXscFvTBezptW8g",
    "key2WIF": "cVzUdVqME6UKbka1pBN8syHuBY91P2GRDToMW5tohE581NCcfa2N",
    "key1PublicKey": "0354529e13738d075d1fa4a23f0887df82cb1478c87d8aadc76cfe6ab0676b3459",
    "key2PublicKey": "03997ca7b2dcb1037f9bdb91d9e4b8d2894ffa3dad98d2370968ce34a71338963a",
    "witnessScript": "52210354529e...5268ae",
    "addresses": {
      "p2wsh": "tb1q...",
      "p2sh_p2wsh": "2N..."
    }
  }
}
```

#### Build Multisig PSBT

Builds an unsigned PSBT for a P2WSH or P2SH-P2WSH address. If `utxos` is omitted, fetches them automatically from the derived address.

```bash
curl -X POST http://localhost:3000/api/bitcoin/wsh/build-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "type": "p2wsh",
    "witnessScript": "52210354529e...5268ae",
    "recipientAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 10000
  }'
```

Optional fields: `changeAddress` (defaults to source), `utxos` (array, skips auto-fetch).

**Response:**
```json
{
  "success": true,
  "message": "P2WSH PSBT built successfully",
  "data": {
    "type": "p2wsh",
    "sourceAddress": "tb1q...",
    "recipientAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 10000,
    "psbtBase64": "cHNidP8B...",
    "psbtHex": "70736274...",
    "inputCount": 1,
    "outputCount": 2,
    "signingStatus": {
      "requiredSignatures": 2,
      "totalKeys": 2,
      "signedCount": 0,
      "signedBy": [],
      "pendingKeys": ["0354529e...", "03997ca7..."],
      "complete": false
    }
  }
}
```

#### Sign Multisig PSBT (Partial)

Signs a PSBT with one key. Call multiple times with different keys to collect all required signatures.

```bash
# Sign with key1
curl -X POST http://localhost:3000/api/bitcoin/wsh/sign-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "psbtBase64": "cHNidP8B...",
    "privateKeyWIF": "cTuTLV84QtYUHxeds5DUr8QT4xVUvUaArR5NtFXscFvTBezptW8g"
  }'
```

**Response (1 of 2 signed):**
```json
{
  "success": true,
  "message": "PSBT signed (1/2 signatures)",
  "data": {
    "psbtBase64": "cHNidP8B...",
    "psbtHex": "70736274...",
    "inputCount": 1,
    "signingStatus": {
      "requiredSignatures": 2,
      "totalKeys": 2,
      "signedCount": 1,
      "signedBy": ["0354529e..."],
      "pendingKeys": ["03997ca7..."],
      "complete": false
    }
  }
}
```

```bash
# Sign with key2 (use psbtBase64 from the previous response)
curl -X POST http://localhost:3000/api/bitcoin/wsh/sign-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "psbtBase64": "<psbtBase64 from key1 signing>",
    "privateKeyWIF": "cVzUdVqME6UKbka1pBN8syHuBY91P2GRDToMW5tohE581NCcfa2N"
  }'
```

**Response (2 of 2 signed):**
```json
{
  "success": true,
  "message": "PSBT fully signed - ready to finalize",
  "data": {
    "psbtBase64": "cHNidP8B...",
    "psbtHex": "70736274...",
    "inputCount": 1,
    "signingStatus": {
      "requiredSignatures": 2,
      "totalKeys": 2,
      "signedCount": 2,
      "signedBy": ["0354529e...", "03997ca7..."],
      "pendingKeys": [],
      "complete": true
    }
  }
}
```

#### Finalize Multisig PSBT

Finalizes a fully-signed PSBT and extracts the raw transaction hex for broadcasting.

```bash
curl -X POST http://localhost:3000/api/bitcoin/wsh/finalize-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "psbtBase64": "<fully signed psbtBase64>"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "PSBT finalized successfully",
  "data": {
    "txId": "a1b2c3d4...",
    "txHex": "02000000...",
    "size": 340,
    "virtualSize": 181,
    "weight": 724
  }
}
```

> After finalizing, use `POST /api/bitcoin/broadcast` with the `txHex` to send it to the network.

#### Multisig Send (Complete Flow)

One-call shortcut for multisig: fetches UTXOs, builds PSBT, signs with both keys, finalizes, and broadcasts.

```bash
curl -X POST http://localhost:3000/api/bitcoin/wsh/send \
  -H "Content-Type: application/json" \
  -d '{
    "type": "p2wsh",
    "key1WIF": "cTuTLV84QtYUHxeds5DUr8QT4xVUvUaArR5NtFXscFvTBezptW8g",
    "key2WIF": "cVzUdVqME6UKbka1pBN8syHuBY91P2GRDToMW5tohE581NCcfa2N",
    "recipientAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 10000
  }'
```

`type` can be `"p2wsh"` or `"p2sh-p2wsh"`.

**Response:**
```json
{
  "success": true,
  "message": "P2WSH transaction sent successfully",
  "data": {
    "type": "p2wsh",
    "txId": "a1b2c3d4...",
    "fromAddress": "tb1q...",
    "toAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 10000,
    "size": 340,
    "explorerUrl": "https://mempool.space/signet/tx/a1b2c3d4..."
  }
}
```

---

### Wallet Management

Wallet endpoints provide UUID-based wallet identity, mirroring the production Griffin wallet service (`WalletServiceClient`). Wallets are stored in-memory for this POC. All endpoints are under `/api/bitcoin/wallets/`.

#### Create Wallet

Generates a new keypair, assigns a UUID wallet ID, and derives all address types.

```bash
curl -X POST http://localhost:3000/api/bitcoin/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "label": "treasury-hot",
    "businessType": "VAULT"
  }'
```

Both fields are optional. `businessType` can be `VAULT`, `TRADING`, `PLEDGED`, `STAKING`, `OMNIBUS`, or `FEE_SPONSOR`.

**Response (201):**
```json
{
  "success": true,
  "message": "Wallet created successfully",
  "data": {
    "id": "a7c3e1f0-4b2d-4e8a-9f1c-6d5b3a2e0f8c",
    "createdAt": "2026-04-27T10:00:00.000Z",
    "updatedAt": "2026-04-27T10:00:00.000Z",
    "businessStatus": "ACTIVE",
    "name": "treasury-hot",
    "businessType": "VAULT",
    "technicalType": "SEGREGATED",
    "_embedded": {
      "addresses": [
        { "id": "...", "address": "tb1q...", "tagMemo": "p2wpkh" },
        { "id": "...", "address": "mqwh...", "tagMemo": "p2pkh" },
        { "id": "...", "address": "2NC9...", "tagMemo": "p2sh" },
        { "id": "...", "address": "tb1p...", "tagMemo": "p2tr" }
      ],
      "blockchain": { "name": "BITCOIN", "network": "TESTNET" }
    }
  }
}
```

#### List Wallets

```bash
curl http://localhost:3000/api/bitcoin/wallets
```

**Response:** `GetWallets200Response` shape with `items[]`, `total`, `offset`, `limit`.

#### Get Wallet by ID

Returns wallet details enriched with live balance from mempool.

```bash
curl http://localhost:3000/api/bitcoin/wallets/<walletId>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "a7c3e1f0-...",
    "businessStatus": "ACTIVE",
    "name": "treasury-hot",
    "businessType": "VAULT",
    "_embedded": { "addresses": [...], "blockchain": {...} },
    "balance": 50000,
    "utxoCount": 2
  }
}
```

#### Get Wallet Addresses

```bash
curl http://localhost:3000/api/bitcoin/wallets/<walletId>/addresses
```

**Response:**
```json
{
  "success": true,
  "data": {
    "walletId": "a7c3e1f0-...",
    "addresses": [
      { "id": "...", "address": "tb1q...", "tagMemo": "p2wpkh" },
      { "id": "...", "address": "mqwh...", "tagMemo": "p2pkh" }
    ],
    "primaryAddress": "tb1q..."
  }
}
```

#### Get Public Key

Mirrors `WalletServiceClient.getPublicKey()` returning `GetPublicKey200Response`.

```bash
curl http://localhost:3000/api/bitcoin/wallets/<walletId>/public-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "a7c3e1f0-...",
    "businessType": "VAULT",
    "publicKey": "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc"
  }
}
```

---

### Signing Service

Dedicated signing endpoints mirror the production signing service (`SigningServiceClient`). They support both asynchronous (fire-then-poll) and synchronous signing. All endpoints are under `/api/bitcoin/signing/`.

The asynchronous flow uses threshold-based timeout logic matching the production `CustodyService`:
- **`IN_PROCESSING` within threshold** → HTTP 425 (Too Early), caller should retry
- **`IN_PROCESSING` past threshold** → HTTP 408, timed out
- **`FAILED` within threshold** → HTTP 422, signing failure
- **`DONE`** → HTTP 200, signature returned as hex

Configure the threshold via `SIGNING_MAX_WAIT_TIME_SECONDS` env var (default: 60s).

#### Create Async Signature Request

Submits an unsigned PSBT (hex) for background signing. Returns immediately with a `signatureId` to poll.

Mirrors: `SigningServiceClient.asynchronousSignTransaction()` → `POST /v1/signature-requests`

```bash
curl -X POST http://localhost:3000/api/bitcoin/signing/v1/signature-requests \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "a7c3e1f0-4b2d-4e8a-9f1c-6d5b3a2e0f8c",
    "unsignedPayload": "70736274ff...",
    "signatureEncoding": "DER"
  }'
```

`signatureEncoding` is optional. Bitcoin uses `DER`; EVM/Solana use `RAW`.

**Response (202):**
```json
{
  "success": true,
  "message": "Signature request created — poll GET /v1/signature-requests/<id> for status",
  "data": {
    "id": "b8d4f2a1-5c3e-4f9b-a0d2-7e6c4b3d1f9a",
    "status": "IN_PROCESSING"
  }
}
```

#### Poll Signature Request

Polls for the signature result. Applies threshold timeout logic.

Mirrors: `SigningServiceClient.fetchAsynchronousSignedTransaction()` → `GET /v1/signature-requests/:signatureId`

```bash
curl http://localhost:3000/api/bitcoin/signing/v1/signature-requests/<signatureId>
```

Optional query parameter: `?requestedTime=2026-04-27T10:00:00.000Z` (for threshold calculation).

**Response when still processing (425):**
```json
{
  "success": true,
  "message": "Signature is still being processed — retry shortly",
  "data": {
    "id": "b8d4f2a1-...",
    "createdAt": "2026-04-27T10:00:00.000Z",
    "updatedAt": "2026-04-27T10:00:00.000Z",
    "payload": { "walletId": "a7c3e1f0-...", "unsignedPayload": "...", "signatureEncoding": "DER" },
    "status": "IN_PROCESSING"
  }
}
```

**Response when done (200):**
```json
{
  "success": true,
  "message": "Signature retrieved successfully",
  "data": {
    "id": "b8d4f2a1-...",
    "createdAt": "2026-04-27T10:00:00.000Z",
    "updatedAt": "2026-04-27T10:00:02.000Z",
    "payload": { "walletId": "a7c3e1f0-...", "unsignedPayload": "..." },
    "status": "DONE",
    "signature": "02000000..."
  }
}
```

#### Synchronous Sign

Signs immediately and returns the signature in one call. No polling required.

Mirrors: `SigningServiceClient.synchronousSignTransaction()` → `POST /v1/sign`

```bash
curl -X POST http://localhost:3000/api/bitcoin/signing/v1/sign \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "a7c3e1f0-4b2d-4e8a-9f1c-6d5b3a2e0f8c",
    "unsignedPayload": "70736274ff...",
    "authorizationApprovals": ["challenge-token-1"]
  }'
```

`authorizationApprovals` is optional (accepted for API parity, not enforced in POC).

**Response (200):**
```json
{
  "success": true,
  "message": "Transaction signed successfully",
  "data": {
    "signature": "02000000..."
  }
}
```

---

### Wallet Signing & Broadcasting (Convenience)

These endpoints on `/api/bitcoin/wallets/:walletId/` combine wallet resolution with signing — the wallet's private key is resolved internally so you only need the `walletId`.

#### Initiate Async Sign via Wallet

```bash
curl -X POST http://localhost:3000/api/bitcoin/wallets/<walletId>/sign-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "unsignedPayload": "70736274ff...",
    "signatureEncoding": "DER"
  }'
```

**Response (202):**
```json
{
  "success": true,
  "data": {
    "signatureId": "b8d4f2a1-...",
    "status": "IN_PROCESSING",
    "requestedTime": "2026-04-27T10:00:00.000Z"
  }
}
```

#### Poll Async Sign via Wallet

```bash
curl http://localhost:3000/api/bitcoin/wallets/<walletId>/sign-transaction/<signatureId>
```

**Response when done (200):**
```json
{
  "success": true,
  "data": {
    "signatureId": "b8d4f2a1-...",
    "status": "DONE",
    "signedTransaction": {
      "signature": "02000000...",
      "address": "tb1q..."
    }
  }
}
```

Returns `425` while `IN_PROCESSING`, `422` on `FAILED`.

#### Send (Managed Flow)

One-call shortcut: fetches UTXOs, builds PSBT, converts to hex, submits for async signing. Returns a `signatureId` to poll.

```bash
curl -X POST http://localhost:3000/api/bitcoin/wallets/<walletId>/send \
  -H "Content-Type: application/json" \
  -d '{
    "recipientAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
    "amount": 10000
  }'
```

**Response (202):**
```json
{
  "success": true,
  "message": "Transaction built and submitted for signing",
  "data": {
    "signatureId": "b8d4f2a1-...",
    "status": "IN_PROCESSING",
    "requestedTime": "2026-04-27T10:00:00.000Z",
    "walletId": "a7c3e1f0-...",
    "transaction": {
      "sourceAddress": "tb1q...",
      "recipientAddress": "tb1qxkgagapsdllm9mnz7gfya5gcttgwhv8sxnlf0k",
      "amount": 10000,
      "fee": 141,
      "inputCount": 1,
      "outputCount": 2
    },
    "next": "Poll GET .../sign-transaction/<signatureId> then POST .../broadcast/<signatureId>"
  }
}
```

#### Broadcast Signed Transaction

After the signature request reaches `DONE`, broadcast it.

```bash
curl -X POST http://localhost:3000/api/bitcoin/wallets/<walletId>/broadcast/<signatureId>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Transaction broadcast successfully",
  "data": {
    "txId": "a1b2c3d4...",
    "walletId": "a7c3e1f0-...",
    "signatureId": "b8d4f2a1-...",
    "explorerUrl": "https://mempool.space/signet/tx/a1b2c3d4..."
  }
}
```

Returns `409` if signing is still `IN_PROCESSING`, `422` if `FAILED`.

---

## End-to-End Workflows

### Standard Transaction (P2WPKH)

```bash
# 1. Generate a key pair
curl -X POST http://localhost:3000/api/bitcoin/keypair
# Save the privateKeyWIF and p2wpkh address from the response

# 2. Fund the address using a faucet:
#    Signet:  https://signetfaucet.com/
#    Testnet: https://testnet-faucet.mempool.co/

# 3. Check that funds arrived
curl http://localhost:3000/api/bitcoin/utxos/<your-p2wpkh-address>

# 4. Send bitcoin (all-in-one)
curl -X POST http://localhost:3000/api/bitcoin/send \
  -H "Content-Type: application/json" \
  -d '{
    "privateKeyWIF": "<your-privateKeyWIF>",
    "recipientAddress": "<recipient-address>",
    "amount": 10000
  }'

# 5. Monitor the transaction
curl http://localhost:3000/api/bitcoin/monitor/<txId-from-step-4>
```

### Multisig Transaction (Step-by-Step)

```bash
# 1. Generate a 2-of-2 multisig keypair
curl -X POST http://localhost:3000/api/bitcoin/wsh/keypair
# Save: key1WIF, key2WIF, witnessScript, and the p2wsh or p2sh_p2wsh address

# 2. Fund the multisig address using a faucet

# 3. Build the unsigned PSBT
curl -X POST http://localhost:3000/api/bitcoin/wsh/build-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "type": "p2wsh",
    "witnessScript": "<witnessScript-hex>",
    "recipientAddress": "<recipient-address>",
    "amount": 10000
  }'
# Save psbtBase64 from the response

# 4. Sign with key1
curl -X POST http://localhost:3000/api/bitcoin/wsh/sign-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "psbtBase64": "<psbtBase64-from-step-3>",
    "privateKeyWIF": "<key1WIF>"
  }'
# Save the updated psbtBase64

# 5. Sign with key2
curl -X POST http://localhost:3000/api/bitcoin/wsh/sign-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "psbtBase64": "<psbtBase64-from-step-4>",
    "privateKeyWIF": "<key2WIF>"
  }'
# Save the updated psbtBase64 (signingStatus.complete should be true)

# 6. Finalize the PSBT
curl -X POST http://localhost:3000/api/bitcoin/wsh/finalize-psbt \
  -H "Content-Type: application/json" \
  -d '{
    "psbtBase64": "<psbtBase64-from-step-5>"
  }'
# Save txHex from the response

# 7. Broadcast the transaction
curl -X POST http://localhost:3000/api/bitcoin/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "txHex": "<txHex-from-step-6>"
  }'
```

### Wallet-Based Async Signing (Managed Flow)

This is the recommended flow for Bitcoin transactions — it mirrors the production transaction-gateway lifecycle: `createWallet → formulateTransaction → asynchronousSign → fetchSignature → broadcast`.

```bash
# 1. Create a wallet
curl -X POST http://localhost:3000/api/bitcoin/wallets \
  -H "Content-Type: application/json" \
  -d '{ "label": "my-wallet" }'
# Save the walletId and primaryAddress from the response

# 2. Fund the wallet address using a faucet:
#    Signet:  https://signetfaucet.com/
#    Testnet: https://testnet-faucet.mempool.co/

# 3. Verify funds arrived
curl http://localhost:3000/api/bitcoin/wallets/<walletId>
# Check the "balance" field in the response

# 4. Submit transaction for async signing
curl -X POST http://localhost:3000/api/bitcoin/wallets/<walletId>/send \
  -H "Content-Type: application/json" \
  -d '{
    "recipientAddress": "<recipient-address>",
    "amount": 10000
  }'
# Save the signatureId from the response

# 5. Poll for signing completion (retry until status is DONE)
curl http://localhost:3000/api/bitcoin/wallets/<walletId>/sign-transaction/<signatureId>
# 425 = still processing (retry after ~1s)
# 200 = DONE, signature ready

# 6. Broadcast the signed transaction
curl -X POST http://localhost:3000/api/bitcoin/wallets/<walletId>/broadcast/<signatureId>
# Returns txId and explorer URL

# 7. Monitor confirmation
curl http://localhost:3000/api/bitcoin/monitor/<txId>
```

### Signing Service Direct (Low-Level)

Use the signing service endpoints directly when you have a pre-built PSBT hex and want full control over the signing lifecycle.

```bash
# 1. Create a wallet (if you haven't already)
curl -X POST http://localhost:3000/api/bitcoin/wallets \
  -H "Content-Type: application/json" \
  -d '{ "label": "signer" }'
# Save walletId

# 2. Build a PSBT using existing /api/bitcoin/build-transaction, get psbt base64
#    Convert base64 to hex for the signing service:
#    echo -n '<psbtBase64>' | base64 -d | xxd -p -c0

# 3. Submit to signing service (async)
curl -X POST http://localhost:3000/api/bitcoin/signing/v1/signature-requests \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "<walletId>",
    "unsignedPayload": "<psbt-hex>",
    "signatureEncoding": "DER"
  }'
# Save the id (signatureId) from the response

# 4. Poll until DONE
curl http://localhost:3000/api/bitcoin/signing/v1/signature-requests/<signatureId>
# 425 = retry, 200 = done (signature field contains signed tx hex)

# 5. Broadcast the signed transaction
curl -X POST http://localhost:3000/api/bitcoin/broadcast \
  -H "Content-Type: application/json" \
  -d '{ "txHex": "<signature-hex-from-step-4>" }'
```

Or use synchronous signing for immediate results:

```bash
curl -X POST http://localhost:3000/api/bitcoin/signing/v1/sign \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "<walletId>",
    "unsignedPayload": "<psbt-hex>"
  }'
# Returns { signature: "02000000..." } immediately — broadcast with /api/bitcoin/broadcast
```

### Message Signing & Verification

```bash
# 1. Generate a key pair (or use an existing one)
curl -X POST http://localhost:3000/api/bitcoin/keypair

# 2. Sign a message
curl -X POST http://localhost:3000/api/bitcoin/sign-message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I own this address",
    "privateKeyWIF": "<your-privateKeyWIF>"
  }'
# Save the signature and address from the response

# 3. Verify the signature (anyone can do this)
curl -X POST http://localhost:3000/api/bitcoin/verify-message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I own this address",
    "address": "<address-from-step-2>",
    "signature": "<signature-from-step-2>"
  }'
```

---

## Key Concepts

### Address Types

| Type | Prefix | Description |
|------|--------|-------------|
| P2PKH | `m`/`n` | Legacy (highest fees) |
| P2SH | `2` | Wrapped SegWit (compatibility) |
| P2WPKH | `tb1q` | Native SegWit (recommended, lowest fees) |
| P2TR | `tb1p` | Taproot (privacy features) |

One private key derives all 4 address types. The API defaults to P2WPKH for transactions.

### UTXO Model

Bitcoin uses unspent transaction outputs (UTXOs) instead of account balances:
- **Inputs**: Entire UTXOs consumed from previous transactions
- **Outputs**: New UTXOs created (recipient + change back to sender)
- **Fee**: Total inputs - total outputs

### Fee Calculation

```
P2WPKH:  ceil(10.5 + inputs*68 + outputs*31) * feeRate sat/vB
P2WSH:   ceil(10.5 + inputs*104 + outputs*43) * feeRate sat/vB
```

### Dust Limit

Minimum output value is **546 sats**. Transactions with smaller outputs are rejected by the network.

---

## Error Handling

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Resource created (wallet) |
| `202` | Accepted — async operation started (signature request submitted) |
| `400` | Bad request (validation errors, insufficient funds, invalid keys) |
| `404` | Resource or endpoint not found |
| `408` | Request timeout (signature exceeded threshold wait time) |
| `409` | Conflict (e.g., trying to broadcast while signing is still `IN_PROCESSING`) |
| `422` | Unprocessable (signing failed) |
| `425` | Too Early — signature still `IN_PROCESSING`, caller should retry |
| `429` | Rate limit exceeded (100 requests per 15 minutes per IP) |
| `500` | Internal server error |

---

## Project Structure

```
src/
  server.js              # Express app setup, middleware, route mounting
  config/network.js      # Network config (signet/testnet, mempool.space URLs)
  lib/
    bitcoin.js           # Shared ECC/ECPair initialization
    keys.js              # Key generation, WIF import, address derivation
    utxo.js              # UTXO fetching, coin selection
    transaction.js       # P2WPKH transaction lifecycle
    message.js           # Message signing/verification
    multisig.js          # P2WSH/P2SH-P2WSH multisig operations
    wallet.js            # UUID wallet store, WalletRES shape (mirrors WalletServiceClient)
    signing.js           # Async/sync signing, threshold timeout (mirrors SigningServiceClient)
  middleware/
    validation.js        # Request validation, response helpers
  routes/
    bitcoin.js           # /api/bitcoin/* — standard P2WPKH endpoints
    multisig.js          # /api/bitcoin/wsh/* — multisig endpoints
    wallet.js            # /api/bitcoin/wallets/* — wallet management + convenience signing
    signing.js           # /api/bitcoin/signing/v1/* — signing service API endpoints
scripts/                 # CLI tools (demo, UTXO checker, signing test)
```

## Resources

- Signet Explorer: https://mempool.space/signet
- Signet Faucet: https://signetfaucet.com/
- Testnet Explorer: https://mempool.space/testnet
- Testnet Faucet: https://testnet-faucet.mempool.co/
