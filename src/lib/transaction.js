const axios = require('axios');
const { bitcoin } = require('./bitcoin');
const { NETWORK, MEMPOOL_API, EXPLORER_URL } = require('../config/network');

const RECOMMENDED_FEE_RATE = 1;
const DUST_LIMIT = 546;

function createSigner(keyPair) {
  return {
    publicKey: Buffer.from(keyPair.publicKey),
    sign: (hash) => Buffer.from(keyPair.sign(hash)),
  };
}

function estimateFee(numInputs, numOutputs, feeRate = RECOMMENDED_FEE_RATE) {
  const baseSize = 10.5;
  const inputSize = 68;
  const outputSize = 31;
  const estimatedSize = Math.ceil(baseSize + (numInputs * inputSize) + (numOutputs * outputSize));
  return estimatedSize * feeRate;
}

function buildTransaction(publicKey, utxos, recipientAddress, amount, changeAddress) {
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  const numOutputs = 2;
  const fee = estimateFee(utxos.selected.length, numOutputs);
  const change = utxos.total - amount - fee;

  if (change < 0) {
    throw new Error('Insufficient funds for transaction + fee');
  }

  for (const utxo of utxos.selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({
          pubkey: publicKey instanceof Buffer ? publicKey : Buffer.from(publicKey),
          network: NETWORK,
        }).output,
        value: utxo.value,
      },
    });
  }

  psbt.addOutput({ address: recipientAddress, value: amount });

  if (change > DUST_LIMIT) {
    psbt.addOutput({ address: changeAddress, value: change });
  }

  return psbt;
}

function buildTransactionFromAddress(utxos, recipientAddress, amount, changeAddress, sourceAddress) {
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  const numOutputs = 2;
  const fee = estimateFee(utxos.selected.length, numOutputs);
  const change = utxos.total - amount - fee;

  if (change < 0) {
    throw new Error('Insufficient funds for transaction + fee');
  }

  for (const utxo of utxos.selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(sourceAddress, NETWORK),
        value: utxo.value,
      },
    });
  }

  psbt.addOutput({ address: recipientAddress, value: amount });

  if (change > DUST_LIMIT) {
    psbt.addOutput({ address: changeAddress, value: change });
  }

  return psbt;
}

function signTransaction(psbt, keyPair) {
  const signer = createSigner(keyPair);

  for (let i = 0; i < psbt.data.inputs.length; i++) {
    psbt.signInput(i, signer);
  }

  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();

  return { tx, txHex: tx.toHex(), txId: tx.getId() };
}

async function broadcastTransaction(txHex) {
  const response = await axios.post(`${MEMPOOL_API}/tx`, txHex, {
    headers: { 'Content-Type': 'text/plain' },
  });
  return response.data;
}

async function getTransactionStatus(txId) {
  const response = await axios.get(`${MEMPOOL_API}/tx/${txId}/status`);
  return {
    txId,
    confirmed: response.data.confirmed,
    blockHeight: response.data.block_height,
    explorerUrl: `${EXPLORER_URL}/tx/${txId}`,
  };
}

module.exports = {
  createSigner,
  estimateFee,
  buildTransaction,
  buildTransactionFromAddress,
  signTransaction,
  broadcastTransaction,
  getTransactionStatus,
  DUST_LIMIT,
};
