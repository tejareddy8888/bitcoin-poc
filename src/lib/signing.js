const crypto = require('crypto');
const { keyPairFromWIF } = require('./keys');
const { bitcoin } = require('./bitcoin');
const { NETWORK } = require('../config/network');
const { createSigner } = require('./transaction');

// In-memory store (POC — production calls external signing service)
const signatureRequests = new Map();

// Mirrors: signing-service.dto.ts → CreateSignatureRequestRESStatusEnum
const SignatureRequestStatus = {
  IN_PROCESSING: 'IN_PROCESSING',
  DONE: 'DONE',
  FAILED: 'FAILED',
};

// Mirrors: signing-service.dto.ts → SignatureEncoding
const SignatureEncoding = {
  DER: 'DER',
  RAW: 'RAW',
};

// Default: 60 seconds — mirrors SIGNING_SERVICE_ASYNCHRONOUS_SIGNATURE_MAX_WAIT_TIME_FOR_IN_SECONDS
const MAX_WAIT_TIME_SECONDS = parseInt(process.env.SIGNING_MAX_WAIT_TIME_SECONDS || '60', 10);

// Signing failure message — mirrors SIGNING_FAILURE_ERROR_MESSAGE in custody.service.ts
const SIGNING_FAILURE_ERROR_MESSAGE = 'SIGNING_FAILURE';

// --- Custody Service Layer ---
// Mirrors: custody.service.ts → asynchronousSignTransaction + fetchAsynchronousSignedTransaction

/**
 * Initiate an asynchronous signature request.
 * Mirrors: CustodyService.asynchronousSignTransaction()
 *   1. Converts hex payload → base64 (as the real signing service expects base64)
 *   2. Calls signing service POST /v1/signature-requests
 *   3. Returns { id, status } (CreateSignatureRequestRES)
 *
 * @param {string} walletId - UUID of the wallet to sign with
 * @param {string} unsignedPayloadHex - Hex-encoded unsigned transaction (PSBT hex or signing digest)
 * @param {string} privateKeyWIF - WIF private key for local POC signing
 * @param {string} [signatureEncoding] - DER for Bitcoin, RAW for others
 * @returns {{ id: string, status: string }} CreateSignatureRequestRES
 */
function createSignatureRequest(walletId, unsignedPayloadHex, privateKeyWIF, signatureEncoding) {
  const signatureId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Convert hex → base64 (mirrors custody.service.ts line 282-284)
  const unsignedPayloadBase64 = Buffer.from(unsignedPayloadHex, 'hex').toString('base64');

  // Stored request — mirrors GetSignatureRequestRES
  const request = {
    id: signatureId,
    createdAt: now,
    updatedAt: now,
    payload: {
      walletId,
      unsignedPayload: unsignedPayloadBase64,
      ...(signatureEncoding && { signatureEncoding }),
    },
    status: SignatureRequestStatus.IN_PROCESSING,
    signature: null,       // base64 when DONE (mirrors real signing service)
    failureReason: null,
    // POC internals for local signing
    _privateKeyWIF: privateKeyWIF,
    _unsignedPayloadHex: unsignedPayloadHex,
  };

  signatureRequests.set(signatureId, request);

  // Simulate custody provider processing in background
  setImmediate(() => processSignatureRequestAsync(signatureId));

  // Return shape: CreateSignatureRequestRES { id, status }
  return {
    id: signatureId,
    status: request.status,
  };
}

/**
 * Background processing — simulates the external signing service doing the work.
 * After a delay, signs the PSBT and stores the base64 signature.
 */
async function processSignatureRequestAsync(signatureId) {
  const request = signatureRequests.get(signatureId);
  if (!request) return;

  // Simulate custody provider latency
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const keyPair = keyPairFromWIF(request._privateKeyWIF);
    const signer = createSigner(keyPair);
    const psbt = bitcoin.Psbt.fromHex(request._unsignedPayloadHex, { network: NETWORK });

    // Sign all inputs
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      psbt.signInput(i, signer);
    }

    // Finalize and extract
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    const signatureHex = tx.toHex();

    // Store as base64 — mirrors real signing service which returns base64
    request.signature = Buffer.from(signatureHex, 'hex').toString('base64');
    request.status = SignatureRequestStatus.DONE;
    request.updatedAt = new Date().toISOString();
  } catch (error) {
    request.status = SignatureRequestStatus.FAILED;
    request.failureReason = error.message;
    request.updatedAt = new Date().toISOString();
  }
}

/**
 * Fetch an asynchronous signature request with threshold timeout logic.
 * Mirrors: CustodyService.fetchAsynchronousSignedTransaction()
 *
 * Status/threshold matrix (from custody.service.ts lines 296-343):
 *   - DONE                           → return signature (base64 → hex)
 *   - IN_PROCESSING + within timeout → throw 425 (caller should retry)
 *   - IN_PROCESSING + past timeout   → throw error (retry after threshold)
 *   - FAILED + within timeout        → throw SIGNING_FAILURE
 *   - FAILED + past timeout          → throw error (retry after threshold)
 *   - no signature + past timeout    → throw error (cannot find signature)
 *
 * @param {string} signatureId - UUID from createSignatureRequest
 * @param {Date} [requestedTime] - When the request was originally submitted (for threshold calc)
 * @returns {{ signature: string, status: string }} Hex signature + status
 */
function fetchSignatureRequest(signatureId, requestedTime) {
  const request = signatureRequests.get(signatureId);
  if (!request) {
    throw Object.assign(
      new Error(`Signature request not found: ${signatureId}`),
      { statusCode: 404 },
    );
  }

  const requestedAt = requestedTime ? new Date(requestedTime) : new Date(request.createdAt);
  const isAfterThreshold = (Date.now() - requestedAt.getTime()) > (MAX_WAIT_TIME_SECONDS * 1000);

  // FAILED
  if (request.status === SignatureRequestStatus.FAILED) {
    if (isAfterThreshold) {
      throw Object.assign(
        new Error(`Signature request Failed or Rejected for id ${signatureId}, retrying after threshold`),
        { statusCode: 400 },
      );
    }
    throw Object.assign(
      new Error(`${SIGNING_FAILURE_ERROR_MESSAGE}, Failed to sign transaction for id ${signatureId}`),
      { statusCode: 422 },
    );
  }

  // No signature yet
  if (!request.signature) {
    if (isAfterThreshold) {
      throw Object.assign(
        new Error(`Cannot find signature for id ${signatureId} after threshold amount of time`),
        { statusCode: 408 },
      );
    }
    if (request.status === SignatureRequestStatus.IN_PROCESSING) {
      // 425 = Too Early — caller should retry
      throw Object.assign(
        new Error(`Cannot find signature for id ${signatureId}`),
        { statusCode: 425 },
      );
    }
  }

  // DONE — convert base64 → hex (mirrors custody.service.ts line 340-342)
  const signatureHex = Buffer.from(request.signature, 'base64').toString('hex');

  return {
    signature: signatureHex,
    status: request.status,
  };
}

/**
 * Get raw signature request state (GetSignatureRequestRES shape).
 * Used by the polling endpoint to return the full DTO.
 */
function getSignatureRequestRaw(signatureId) {
  const request = signatureRequests.get(signatureId);
  if (!request) {
    throw Object.assign(
      new Error(`Signature request not found: ${signatureId}`),
      { statusCode: 404 },
    );
  }
  return request;
}

/**
 * Synchronous signing — signs immediately and returns the signature.
 * Mirrors: SigningServiceClient.synchronousSignTransaction()
 *   POST /v1/sign { walletId, unsignedPayload, authorizationApprovals }
 *   → { signature }
 *
 * @param {string} unsignedPayloadHex - PSBT hex
 * @param {string} privateKeyWIF - WIF private key
 * @returns {{ signature: string }} SynchronousSignRES
 */
function synchronousSign(unsignedPayloadHex, privateKeyWIF) {
  const keyPair = keyPairFromWIF(privateKeyWIF);
  const signer = createSigner(keyPair);
  const psbt = bitcoin.Psbt.fromHex(unsignedPayloadHex, { network: NETWORK });

  for (let i = 0; i < psbt.data.inputs.length; i++) {
    psbt.signInput(i, signer);
  }

  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();

  return {
    signature: tx.toHex(),
  };
}

module.exports = {
  SignatureRequestStatus,
  SignatureEncoding,
  SIGNING_FAILURE_ERROR_MESSAGE,
  MAX_WAIT_TIME_SECONDS,
  createSignatureRequest,
  fetchSignatureRequest,
  getSignatureRequestRaw,
  synchronousSign,
};
