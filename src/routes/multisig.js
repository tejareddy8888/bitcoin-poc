const express = require('express');
const { body } = require('express-validator');
const { handleValidationErrors, asyncHandler, successResponse, errorResponse } = require('../middleware/validation');
const { generateKeyPair, keyPairFromWIF } = require('../lib/keys');
const { fetchUTXOs } = require('../lib/utxo');
const { broadcastTransaction } = require('../lib/transaction');
const { bitcoin } = require('../lib/bitcoin');
const { NETWORK, EXPLORER_URL } = require('../config/network');
const {
  buildMultisigWitnessScript,
  deriveP2WSH,
  deriveP2SH_P2WSH,
  buildP2WSH_PSBT,
  buildP2SH_P2WSH_PSBT,
  signPSBT,
  getSigningStatus,
} = require('../lib/multisig');

const router = express.Router();

// POST /keypair - Generate a 2-of-2 multisig keypair
router.post('/keypair', asyncHandler(async (req, res) => {
  try {
    const key1 = generateKeyPair();
    const key2 = generateKeyPair();

    const witnessScript = buildMultisigWitnessScript([key1.publicKey, key2.publicKey]);
    const p2wsh = deriveP2WSH(witnessScript);
    const p2sh_p2wsh = deriveP2SH_P2WSH(witnessScript);

    res.json(successResponse({
      key1WIF: key1.toWIF(),
      key2WIF: key2.toWIF(),
      key1PublicKey: Buffer.from(key1.publicKey).toString('hex'),
      key2PublicKey: Buffer.from(key2.publicKey).toString('hex'),
      witnessScript: witnessScript.toString('hex'),
      addresses: {
        p2wsh: p2wsh.address,
        p2sh_p2wsh: p2sh_p2wsh.address,
      },
    }, '2-of-2 multisig WSH keypair generated'));
  } catch (error) {
    res.status(500).json(errorResponse(error, 'Failed to generate WSH keypair'));
  }
}));

// POST /build-psbt - Build a P2WSH or P2SH-P2WSH PSBT
router.post('/build-psbt', [
  body('type').isIn(['p2wsh', 'p2sh-p2wsh']).withMessage('type must be "p2wsh" or "p2sh-p2wsh"'),
  body('witnessScript').notEmpty().withMessage('witnessScript hex is required'),
  body('recipientAddress').notEmpty().withMessage('Recipient address is required'),
  body('amount').isInt({ min: 546 }).withMessage('Amount must be >= 546 sats (dust limit)'),
  body('changeAddress').optional().notEmpty(),
  body('utxos').optional().isArray(),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { type, witnessScript: wsHex, recipientAddress, amount, changeAddress, utxos: providedUtxos } = req.body;

    const witnessScript = Buffer.from(wsHex, 'hex');
    const sourceAddress = type === 'p2wsh'
      ? deriveP2WSH(witnessScript).address
      : deriveP2SH_P2WSH(witnessScript).address;

    let utxos = providedUtxos;
    if (!utxos) {
      utxos = await fetchUTXOs(sourceAddress);
      if (utxos.length === 0) {
        throw new Error(`No UTXOs found for ${sourceAddress}. Fund it first!`);
      }
    }

    const psbt = type === 'p2wsh'
      ? buildP2WSH_PSBT(utxos, witnessScript, recipientAddress, amount, changeAddress || sourceAddress)
      : buildP2SH_P2WSH_PSBT(utxos, witnessScript, recipientAddress, amount, changeAddress || sourceAddress);

    const signingStatus = getSigningStatus(psbt);

    res.json(successResponse({
      type,
      sourceAddress,
      recipientAddress,
      amount,
      psbtBase64: psbt.toBase64(),
      psbtHex: psbt.toHex(),
      inputCount: psbt.data.inputs.length,
      outputCount: psbt.data.outputs.length,
      signingStatus,
    }, `${type.toUpperCase()} PSBT built successfully`));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to build WSH PSBT'));
  }
}));

// POST /sign-psbt - Partially sign a PSBT with one key
router.post('/sign-psbt', [
  body('psbtBase64').notEmpty().withMessage('PSBT base64 is required'),
  body('privateKeyWIF').notEmpty().withMessage('Private key WIF is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { psbtBase64, privateKeyWIF } = req.body;

    const keyPair = keyPairFromWIF(privateKeyWIF);
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: NETWORK });

    signPSBT(psbt, keyPair);

    const signingStatus = getSigningStatus(psbt);

    const statusMsg = signingStatus?.complete
      ? 'PSBT fully signed - ready to finalize'
      : `PSBT signed (${signingStatus?.signedCount}/${signingStatus?.requiredSignatures} signatures)`;

    res.json(successResponse({
      psbtBase64: psbt.toBase64(),
      psbtHex: psbt.toHex(),
      inputCount: psbt.data.inputs.length,
      signingStatus,
    }, statusMsg));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to sign WSH PSBT'));
  }
}));

// POST /finalize-psbt - Finalize a fully-signed PSBT
router.post('/finalize-psbt', [
  body('psbtBase64').notEmpty().withMessage('PSBT base64 is required'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const psbt = bitcoin.Psbt.fromBase64(req.body.psbtBase64, { network: NETWORK });
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();

    res.json(successResponse({
      txId: tx.getId(),
      txHex: tx.toHex(),
      size: tx.byteLength(),
      virtualSize: tx.virtualSize(),
      weight: tx.weight(),
    }, 'PSBT finalized successfully'));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to finalize PSBT. Ensure all required signatures are present.'));
  }
}));

// POST /send - Complete flow: build, sign (both keys), finalize, broadcast
router.post('/send', [
  body('type').isIn(['p2wsh', 'p2sh-p2wsh']).withMessage('type must be "p2wsh" or "p2sh-p2wsh"'),
  body('key1WIF').notEmpty().withMessage('First private key WIF is required'),
  body('key2WIF').notEmpty().withMessage('Second private key WIF is required'),
  body('recipientAddress').notEmpty().withMessage('Recipient address is required'),
  body('amount').isInt({ min: 546 }).withMessage('Amount must be >= 546 sats'),
  handleValidationErrors,
], asyncHandler(async (req, res) => {
  try {
    const { type, key1WIF, key2WIF, recipientAddress, amount } = req.body;

    const key1 = keyPairFromWIF(key1WIF);
    const key2 = keyPairFromWIF(key2WIF);

    const witnessScript = buildMultisigWitnessScript([key1.publicKey, key2.publicKey]);

    const sourceAddress = type === 'p2wsh'
      ? deriveP2WSH(witnessScript).address
      : deriveP2SH_P2WSH(witnessScript).address;

    const utxos = await fetchUTXOs(sourceAddress);
    if (utxos.length === 0) {
      throw new Error(`No UTXOs found for ${sourceAddress}. Fund it first!`);
    }

    const psbt = type === 'p2wsh'
      ? buildP2WSH_PSBT(utxos, witnessScript, recipientAddress, amount, sourceAddress)
      : buildP2SH_P2WSH_PSBT(utxos, witnessScript, recipientAddress, amount, sourceAddress);

    signPSBT(psbt, key1);
    signPSBT(psbt, key2);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txId = await broadcastTransaction(tx.toHex());

    res.json(successResponse({
      type,
      txId,
      fromAddress: sourceAddress,
      toAddress: recipientAddress,
      amount,
      size: tx.byteLength(),
      explorerUrl: `${EXPLORER_URL}/tx/${txId}`,
    }, `${type.toUpperCase()} transaction sent successfully`));
  } catch (error) {
    res.status(400).json(errorResponse(error, 'Failed to send WSH transaction'));
  }
}));

module.exports = router;
