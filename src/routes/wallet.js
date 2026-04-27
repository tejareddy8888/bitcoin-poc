const express = require('express');
const { body, param } = require('express-validator');
const { handleValidationErrors, asyncHandler, successResponse, errorResponse } = require('../middleware/validation');
const { fetchUTXOs } = require('../lib/utxo');
const { broadcastTransaction } = require('../lib/transaction');
const { EXPLORER_URL } = require('../config/network');
const {
  WalletBusinessType,
  createWallet,
  getWallet,
  toWalletRES,
  getPublicKey,
  listWallets,
  buildManagedTransaction,
} = require('../lib/wallet');
const {
  SignatureEncoding,
  SignatureRequestStatus,
  createSignatureRequest,
  fetchSignatureRequest,
  getSignatureRequestRaw,
} = require('../lib/signing');

const router = express.Router();

// POST / - Create a new wallet (generates keypair, assigns UUID)
// Mirrors: WalletServiceClient → stores a WalletRES-shaped record
router.post('/', [
  body('businessType').optional().isIn(Object.values(WalletBusinessType))
    .withMessage(`businessType must be one of: ${Object.values(WalletBusinessType).join(', ')}`),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { label, businessType } = req.body;
    const wallet = createWallet(label, businessType);

    res.status(201).json(successResponse(toWalletRES(wallet), 'Wallet created successfully'));
  } catch (error) {
    res.status(500).json(errorResponse(error, 'Failed to create wallet'));
  }
}));

// GET / - List all wallets
// Mirrors: WalletServiceClient.getWalletByClientId() → GetWallets200Response shape
router.get('/', asyncHandler(async (req, res) => {
  try {
    const items = listWallets();

    res.json(successResponse({
      items,
      total: items.length,
      offset: 0,
      limit: items.length,
    }, 'Wallets retrieved successfully'));
  } catch (error) {
    res.status(500).json(errorResponse(error, 'Failed to list wallets'));
  }
}));

// GET /:walletId - Get wallet by ID
// Mirrors: WalletServiceClient.getWallet(walletId) → WalletRES
router.get('/:walletId', [
  param('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const wallet = getWallet(req.params.walletId);
    const walletRES = toWalletRES(wallet);

    // Enrich with live balance from mempool
    const utxos = await fetchUTXOs(wallet.primaryAddress);
    const balance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

    res.json(successResponse({
      ...walletRES,
      balance,
      utxoCount: utxos.length,
    }, 'Wallet retrieved successfully'));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json(errorResponse(error, 'Failed to get wallet'));
  }
}));

// GET /:walletId/addresses - Get wallet addresses
// Mirrors: WalletRES._embedded.addresses
router.get('/:walletId/addresses', [
  param('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const wallet = getWallet(req.params.walletId);

    res.json(successResponse({
      walletId: wallet.id,
      addresses: wallet._embedded.addresses,
      primaryAddress: wallet.primaryAddress,
    }, 'Wallet addresses retrieved successfully'));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json(errorResponse(error, 'Failed to get wallet addresses'));
  }
}));

// GET /:walletId/public-key - Get wallet public key
// Mirrors: WalletServiceClient.getPublicKey(walletId) → GetPublicKey200Response
router.get('/:walletId/public-key', [
  param('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const result = getPublicKey(req.params.walletId);

    res.json(successResponse(result, 'Public key retrieved successfully'));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json(errorResponse(error, 'Failed to get public key'));
  }
}));

// POST /:walletId/sign-transaction - Initiate asynchronous transaction signing
// Convenience wrapper: resolves walletId → private key, then delegates to signing lib
// Mirrors: WorkflowService.asynchronousSignTransaction()
//   → CustodyService.asynchronousSignTransaction()
//   → SigningServiceClient POST /v1/signature-requests
router.post('/:walletId/sign-transaction', [
  param('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  body('unsignedPayload').notEmpty().withMessage('unsignedPayload (PSBT hex) is required'),
  body('signatureEncoding').optional().isIn(Object.values(SignatureEncoding))
    .withMessage(`signatureEncoding must be one of: ${Object.values(SignatureEncoding).join(', ')}`),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { walletId } = req.params;
    const { unsignedPayload, signatureEncoding } = req.body;

    const wallet = getWallet(walletId);

    // Delegate to signing lib — returns CreateSignatureRequestRES { id, status }
    const result = createSignatureRequest(
      walletId,
      unsignedPayload,
      wallet.privateKeyWIF,
      signatureEncoding || SignatureEncoding.DER,
    );

    res.status(202).json(successResponse({
      signatureId: result.id,
      status: result.status,
      requestedTime: new Date().toISOString(),
    }, 'Signature request submitted — poll GET /:walletId/sign-transaction/:signatureId for status'));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json(errorResponse(error, 'Failed to initiate signing'));
  }
}));

// GET /:walletId/sign-transaction/:signatureId - Poll for async signature result
// Convenience wrapper: applies wallet ownership check, then delegates to signing lib
// Mirrors: WorkflowService.fetchAsynchronousSignedTransaction()
//   → CustodyService.fetchAsynchronousSignedTransaction() (threshold + 425 logic)
//   → SigningServiceClient GET /v1/signature-requests/:signatureId
router.get('/:walletId/sign-transaction/:signatureId', [
  param('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  param('signatureId').isUUID().withMessage('signatureId must be a valid UUID'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { walletId, signatureId } = req.params;

    getWallet(walletId);
    const raw = getSignatureRequestRaw(signatureId);

    if (raw.payload.walletId !== walletId) {
      return res.status(404).json(errorResponse(
        new Error('Signature request does not belong to this wallet'),
        'Signature request not found for wallet',
      ));
    }

    // Delegate to signing lib — applies threshold timeout + 425 retry logic
    const { signature, status } = fetchSignatureRequest(signatureId, raw.createdAt);

    // DONE — return signature (hex) + wallet address for verification
    const wallet = getWallet(walletId);
    res.json(successResponse({
      signatureId: raw.id,
      status,
      signedTransaction: {
        signature,
        address: wallet.primaryAddress,
      },
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    }, 'Transaction signed successfully'));
  } catch (error) {
    const code = error.statusCode || 500;

    // 425 = Too Early — IN_PROCESSING, within threshold
    if (code === 425) {
      const raw = getSignatureRequestRaw(req.params.signatureId);
      return res.status(425).json(successResponse({
        signatureId: raw.id,
        status: raw.status,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      }, 'Signature is still being processed — retry shortly'));
    }

    res.status(code).json(errorResponse(error, 'Failed to fetch signature status'));
  }
}));

// POST /:walletId/send - Full managed flow: formulate + async sign
// Mirrors: WorkflowService.formulateTransaction() + asynchronousSignTransaction()
router.post('/:walletId/send', [
  param('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  body('recipientAddress').notEmpty().withMessage('Recipient address is required'),
  body('amount').isInt({ min: 546 }).withMessage('Amount must be >= 546 sats (dust limit)'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { walletId } = req.params;
    const { recipientAddress, amount } = req.body;

    const wallet = getWallet(walletId);

    // 1. Formulate: build the PSBT from wallet's UTXOs
    const buildResult = await buildManagedTransaction(walletId, recipientAddress, amount);

    // 2. Convert PSBT base64 → hex for the signing service
    const psbtHex = Buffer.from(buildResult.psbtBase64, 'base64').toString('hex');

    // 3. Async sign via signing lib with DER encoding for Bitcoin
    const signResult = createSignatureRequest(
      walletId,
      psbtHex,
      wallet.privateKeyWIF,
      SignatureEncoding.DER,
    );

    res.status(202).json(successResponse({
      signatureId: signResult.id,
      status: signResult.status,
      requestedTime: new Date().toISOString(),
      walletId,
      transaction: {
        sourceAddress: buildResult.sourceAddress,
        recipientAddress: buildResult.recipientAddress,
        amount: buildResult.amount,
        fee: buildResult.fee,
        inputCount: buildResult.inputCount,
        outputCount: buildResult.outputCount,
      },
      next: `Poll GET /api/bitcoin/wallets/${walletId}/sign-transaction/${signResult.id} then POST /api/bitcoin/wallets/${walletId}/broadcast/${signResult.id}`,
    }, 'Transaction built and submitted for signing'));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json(errorResponse(error, 'Failed to send transaction'));
  }
}));

// POST /:walletId/broadcast/:signatureId - Broadcast a signed transaction
// Final step after signature status is DONE
router.post('/:walletId/broadcast/:signatureId', [
  param('walletId').isUUID().withMessage('walletId must be a valid UUID'),
  param('signatureId').isUUID().withMessage('signatureId must be a valid UUID'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { walletId, signatureId } = req.params;

    getWallet(walletId);
    const raw = getSignatureRequestRaw(signatureId);

    if (raw.payload.walletId !== walletId) {
      return res.status(404).json(errorResponse(
        new Error('Signature request does not belong to this wallet'),
        'Signature request not found for wallet',
      ));
    }

    // Fetch signature with threshold check — will throw if not DONE
    const { signature } = fetchSignatureRequest(signatureId, raw.createdAt);

    const txId = await broadcastTransaction(signature);

    res.json(successResponse({
      txId,
      walletId,
      signatureId,
      explorerUrl: `${EXPLORER_URL}/tx/${txId}`,
    }, 'Transaction broadcast successfully'));
  } catch (error) {
    const code = error.statusCode || (error.message.includes('not found') ? 404 : 400);

    if (code === 425) {
      return res.status(409).json(errorResponse(
        new Error('Signature is still being processed — wait for DONE status before broadcasting'),
        'Cannot broadcast yet',
      ));
    }

    res.status(code).json(errorResponse(error, 'Failed to broadcast transaction'));
  }
}));

module.exports = router;
