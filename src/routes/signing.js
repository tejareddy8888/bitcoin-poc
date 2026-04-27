const express = require('express');
const { body, param } = require('express-validator');
const { handleValidationErrors, asyncHandler, successResponse, errorResponse } = require('../middleware/validation');
const { getWallet } = require('../lib/wallet');
const {
  SignatureRequestStatus,
  SignatureEncoding,
  createSignatureRequest,
  fetchSignatureRequest,
  getSignatureRequestRaw,
  synchronousSign,
} = require('../lib/signing');

const router = express.Router();

// POST /v1/signature-requests - Create an asynchronous signature request
// Mirrors: SigningServiceClient.asynchronousSignTransaction()
//   → POST /v1/signature-requests { walletId, unsignedPayload, signatureEncoding? }
//   → CreateSignatureRequestRES { id, status }
router.post('/v1/signature-requests', [
  body('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  body('unsignedPayload').notEmpty().withMessage('unsignedPayload (hex) is required'),
  body('signatureEncoding').optional().isIn(Object.values(SignatureEncoding))
    .withMessage(`signatureEncoding must be one of: ${Object.values(SignatureEncoding).join(', ')}`),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { walletId, unsignedPayload, signatureEncoding } = req.body;

    // Resolve wallet to get the private key for POC local signing
    const wallet = getWallet(walletId);

    const result = createSignatureRequest(
      walletId,
      unsignedPayload,
      wallet.privateKeyWIF,
      signatureEncoding,
    );

    // Return CreateSignatureRequestRES: { id, status }
    res.status(202).json(successResponse(result,
      `Signature request created — poll GET /v1/signature-requests/${result.id} for status`));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json(errorResponse(error, 'Failed to create signature request'));
  }
}));

// GET /v1/signature-requests/:signatureId - Fetch/poll an asynchronous signature
// Mirrors: SigningServiceClient.fetchAsynchronousSignedTransaction(signatureId)
//   → GET /v1/signature-requests/:signatureId
//   → GetSignatureRequestRES { id, createdAt, updatedAt, payload, status, signature?, failureReason? }
//
// Status semantics (matches CustodyService threshold logic):
//   202 — IN_PROCESSING, within threshold (retry)
//   200 — DONE, signature returned as hex
//   422 — FAILED, within threshold
//   408 — past threshold, timed out
//   425 — Too Early (raw 425 from signing service)
router.get('/v1/signature-requests/:signatureId', [
  param('signatureId').isUUID().withMessage('signatureId must be a valid UUID'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { signatureId } = req.params;
    const requestedTime = req.query.requestedTime || null;

    // Get raw request for the response envelope
    const raw = getSignatureRequestRaw(signatureId);

    // Apply threshold + status logic (throws on retry/failure)
    const { signature, status } = fetchSignatureRequest(signatureId, requestedTime);

    // DONE — return GetSignatureRequestRES with hex signature
    res.json(successResponse({
      id: raw.id,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      payload: {
        walletId: raw.payload.walletId,
        unsignedPayload: raw.payload.unsignedPayload,
        ...(raw.payload.signatureEncoding && { signatureEncoding: raw.payload.signatureEncoding }),
      },
      status,
      signature,
    }, 'Signature retrieved successfully'));
  } catch (error) {
    const code = error.statusCode || 500;

    if (code === 425) {
      // IN_PROCESSING, within threshold — caller should retry
      const raw = getSignatureRequestRaw(req.params.signatureId);
      return res.status(425).json(successResponse({
        id: raw.id,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        payload: raw.payload,
        status: raw.status,
      }, 'Signature is still being processed — retry shortly'));
    }

    res.status(code).json(errorResponse(error, 'Failed to fetch signature'));
  }
}));

// POST /v1/sign - Synchronous transaction signing
// Mirrors: SigningServiceClient.synchronousSignTransaction(walletId, challenges, unsignedPayload)
//   → POST /v1/sign { walletId, unsignedPayload, authorizationApprovals }
//   → SynchronousSignRES { signature }
router.post('/v1/sign', [
  body('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  body('unsignedPayload').notEmpty().withMessage('unsignedPayload (hex) is required'),
  body('authorizationApprovals').optional().isArray()
    .withMessage('authorizationApprovals must be an array of challenge strings'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { walletId, unsignedPayload } = req.body;

    // Resolve wallet for POC local signing
    const wallet = getWallet(walletId);

    // Synchronous sign — returns immediately
    const result = synchronousSign(unsignedPayload, wallet.privateKeyWIF);

    // Return SynchronousSignRES: { signature }
    res.json(successResponse(result, 'Transaction signed successfully'));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json(errorResponse(error, 'Failed to sign transaction'));
  }
}));

module.exports = router;
