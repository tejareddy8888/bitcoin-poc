const express = require('express');
const { body, param } = require('express-validator');
const { handleValidationErrors, asyncHandler, successResponse, errorResponse } = require('../middleware/validation');
const { generateKeyPair, keyPairFromWIF, deriveAddresses } = require('../lib/keys');
const { fetchUTXOs, selectCoins } = require('../lib/utxo');
const { estimateFee, buildTransaction, buildTransactionFromAddress, signTransaction, broadcastTransaction, getTransactionStatus, DUST_LIMIT } = require('../lib/transaction');
const { signMessage, verifyMessage } = require('../lib/message');
const { bitcoin } = require('../lib/bitcoin');
const { NETWORK, EXPLORER_URL } = require('../config/network');

const router = express.Router();

// POST /keypair - Generate a new Bitcoin key pair and addresses
router.post('/keypair', asyncHandler(async (req, res) => {
  try {
    const keyPair = generateKeyPair();
    const addresses = deriveAddresses(keyPair);

    res.json(successResponse({
      privateKeyWIF: keyPair.toWIF(),
      publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
      addresses: {
        p2pkh: addresses.p2pkh.address,
        p2sh: addresses.p2sh.address,
        p2wpkh: addresses.p2wpkh.address,
        p2tr: addresses.p2tr.address,
      },
    }, 'Key pair generated successfully'));
  } catch (error) {
    res.status(500).json(errorResponse(error, 'Failed to generate key pair'));
  }
}));

// GET /addresses/:privateKey - Derive addresses from a private key
router.get('/addresses/:privateKey', [
  param('privateKey').notEmpty().withMessage('Private key is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const keyPair = keyPairFromWIF(req.params.privateKey);
    const addresses = deriveAddresses(keyPair);

    res.json(successResponse({
      publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
      addresses: {
        p2pkh: addresses.p2pkh.address,
        p2sh: addresses.p2sh.address,
        p2wpkh: addresses.p2wpkh.address,
        p2tr: addresses.p2tr.address,
      },
    }, 'Addresses derived successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Invalid private key or failed to derive addresses'));
  }
}));

// GET /utxos/:address - Fetch UTXOs for an address
router.get('/utxos/:address', [
  param('address').notEmpty().withMessage('Address is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { address } = req.params;
    const utxos = await fetchUTXOs(address);
    const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

    res.json(successResponse({
      address,
      utxos,
      totalBalance,
      utxoCount: utxos.length,
    }, 'UTXOs fetched successfully'));
  } catch (error) {
    res.status(500).json(errorResponse(error, 'Failed to fetch UTXOs'));
  }
}));

// POST /select-coins - Select coins for a transaction
router.post('/select-coins', [
  body('utxos').isArray().withMessage('UTXOs must be an array'),
  body('targetAmount').isInt({ min: 1 }).withMessage('Target amount must be a positive integer'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { utxos, targetAmount } = req.body;
    const coins = selectCoins(utxos, targetAmount);

    res.json(successResponse({
      selectedUtxos: coins.selected,
      totalSelected: coins.total,
      targetAmount,
      change: coins.total - targetAmount,
    }, 'Coins selected successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to select coins'));
  }
}));

// POST /estimate-fee - Estimate transaction fee
router.post('/estimate-fee', [
  body('numInputs').isInt({ min: 1 }).withMessage('Number of inputs must be a positive integer'),
  body('numOutputs').isInt({ min: 1 }).withMessage('Number of outputs must be a positive integer'),
  body('feeRate').optional().isFloat({ min: 0.1 }).withMessage('Fee rate must be a positive number'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { numInputs, numOutputs, feeRate } = req.body;
    const estimatedFee = estimateFee(numInputs, numOutputs, feeRate);

    res.json(successResponse({
      numInputs,
      numOutputs,
      feeRate: feeRate || 1,
      estimatedFee,
    }, 'Fee estimated successfully'));
  } catch (error) {
    res.status(500).json(errorResponse(error, 'Failed to estimate fee'));
  }
}));

// POST /build-transaction - Build a Bitcoin transaction
router.post('/build-transaction', [
  body('utxos').isArray().withMessage('UTXOs must be an array'),
  body('recipientAddress').notEmpty().withMessage('Recipient address is required'),
  body('amount').isInt({ min: 1 }).withMessage('Amount must be a positive integer'),
  body('changeAddress').notEmpty().withMessage('Change address is required'),
  body('sourceAddress').optional().notEmpty().withMessage('Source address must be provided if no private key'),
  body('privateKeyWIF').optional().notEmpty().withMessage('Private key must be valid WIF format'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { privateKeyWIF, utxos, recipientAddress, amount, changeAddress, sourceAddress } = req.body;

    let inputAddress = sourceAddress;

    if (privateKeyWIF) {
      const keyPair = keyPairFromWIF(privateKeyWIF);
      const payment = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(keyPair.publicKey),
        network: NETWORK,
      });
      inputAddress = payment.address;
    }

    if (!inputAddress) {
      throw new Error('Either privateKeyWIF or sourceAddress must be provided');
    }

    const psbt = buildTransactionFromAddress(utxos, recipientAddress, amount, changeAddress, inputAddress);

    res.json(successResponse({
      psbt: psbt.toBase64(),
      inputCount: psbt.data.inputs.length,
      outputCount: psbt.data.outputs.length,
      sourceAddress: inputAddress,
    }, 'Transaction built successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to build transaction'));
  }
}));

// POST /sign-transaction - Sign a Bitcoin transaction
router.post('/sign-transaction', [
  body('privateKeyWIF').notEmpty().withMessage('Private key is required'),
  body('psbtBase64').notEmpty().withMessage('PSBT is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { privateKeyWIF, psbtBase64 } = req.body;

    const keyPair = keyPairFromWIF(privateKeyWIF);
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: NETWORK });
    const { tx, txHex, txId } = signTransaction(psbt, keyPair);

    res.json(successResponse({
      txId,
      txHex,
      size: tx.byteLength(),
    }, 'Transaction signed successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to sign transaction'));
  }
}));

// POST /broadcast - Broadcast a signed transaction
router.post('/broadcast', [
  body('txHex').notEmpty().withMessage('Transaction hex is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const txId = await broadcastTransaction(req.body.txHex);

    res.json(successResponse({
      txId,
      explorerUrl: `${EXPLORER_URL}/tx/${txId}`,
    }, 'Transaction broadcast successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to broadcast transaction'));
  }
}));

// GET /monitor/:txId - Monitor transaction status
router.get('/monitor/:txId', [
  param('txId').notEmpty().withMessage('Transaction ID is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const result = await getTransactionStatus(req.params.txId);
    res.json(successResponse(result, 'Transaction status retrieved'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to get transaction status'));
  }
}));

// POST /send - Complete flow: build, sign, and broadcast
router.post('/send', [
  body('privateKeyWIF').notEmpty().withMessage('Private key is required'),
  body('recipientAddress').notEmpty().withMessage('Recipient address is required'),
  body('amount').custom((value) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num <= 0) {
      throw new Error('Amount must be a positive integer');
    }
    return true;
  }).withMessage('Amount must be a positive integer'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { privateKeyWIF, recipientAddress, amount: amountStr } = req.body;

    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Amount must be a positive integer');
    }

    if (amount < DUST_LIMIT) {
      throw new Error(`Amount must be at least ${DUST_LIMIT} sats to avoid dust rejection`);
    }

    const keyPair = keyPairFromWIF(privateKeyWIF);
    const senderPayment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: NETWORK,
    });
    const senderAddress = senderPayment.address;

    const utxos = await fetchUTXOs(senderAddress);
    if (utxos.length === 0) {
      throw new Error('No UTXOs found. Fund this address first!');
    }

    const estimatedFee = estimateFee(utxos.length, 2);
    const totalNeeded = amount + estimatedFee;
    const coins = selectCoins(utxos, totalNeeded);

    const psbt = buildTransaction(keyPair.publicKey, coins, recipientAddress, amount, senderAddress);
    const { txHex, txId } = signTransaction(psbt, keyPair);

    await broadcastTransaction(txHex);

    res.json(successResponse({
      txId,
      fromAddress: senderAddress,
      toAddress: recipientAddress,
      amount,
      fee: estimatedFee,
      explorerUrl: `${EXPLORER_URL}/tx/${txId}`,
    }, 'Transaction sent successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to send transaction'));
  }
}));

// POST /sign-message - Sign a message with a Bitcoin private key
router.post('/sign-message', [
  body('message').notEmpty().withMessage('Message is required'),
  body('privateKeyWIF').notEmpty().withMessage('Private key is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const result = signMessage(req.body.message, req.body.privateKeyWIF);
    res.json(successResponse(result, 'Message signed successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to sign message'));
  }
}));

// POST /verify-message - Verify a message signature
router.post('/verify-message', [
  body('message').notEmpty().withMessage('Message is required'),
  body('address').notEmpty().withMessage('Address is required'),
  body('signature').notEmpty().withMessage('Signature is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { message, address, signature } = req.body;
    const isValid = verifyMessage(message, address, signature);

    res.json(successResponse({
      message,
      address,
      signature,
      valid: isValid,
    }, isValid ? 'Signature is valid' : 'Signature is invalid'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to verify message'));
  }
}));

module.exports = router;
