const fs = require('fs');
const { bitcoin } = require('./bitcoin');
const { createSigner } = require('./transaction');
const { NETWORK } = require('../config/network');

const DUST_LIMIT = 546;

function buildMultisigWitnessScript(pubkeys) {
  const sorted = pubkeys
    .map((pk) => (Buffer.isBuffer(pk) ? pk : Buffer.from(pk)))
    .sort(Buffer.compare);

  return bitcoin.script.compile([
    bitcoin.opcodes.OP_2,
    sorted[0],
    sorted[1],
    bitcoin.opcodes.OP_2,
    bitcoin.opcodes.OP_CHECKMULTISIG,
  ]);
}

function deriveP2WSH(witnessScript) {
  return bitcoin.payments.p2wsh({
    redeem: { output: witnessScript, network: NETWORK },
    network: NETWORK,
  });
}

function deriveP2SH_P2WSH(witnessScript) {
  const p2wsh = deriveP2WSH(witnessScript);
  return bitcoin.payments.p2sh({
    redeem: p2wsh,
    network: NETWORK,
  });
}

function estimateFeeWSH(numInputs, numOutputs, feeRate = 1) {
  const baseSize = 10.5;
  const inputSize = 104;
  const outputSize = 43;
  const estimatedSize = Math.ceil(baseSize + numInputs * inputSize + numOutputs * outputSize);
  return estimatedSize * feeRate;
}

function buildP2WSH_PSBT(utxos, witnessScript, recipientAddress, amount, changeAddress) {
  const p2wsh = deriveP2WSH(witnessScript);
  const psbt = new bitcoin.Psbt({ network: NETWORK });

  const fee = estimateFeeWSH(utxos.length, 2);
  const inputTotal = utxos.reduce((sum, u) => sum + u.value, 0);
  const change = inputTotal - amount - fee;

  if (change < 0) {
    throw new Error(`Insufficient funds: have ${inputTotal}, need ${amount + fee}`);
  }

  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: p2wsh.output,
        value: utxo.value,
      },
      witnessScript,
    });
  }

  psbt.addOutput({ address: recipientAddress, value: amount });
  if (change > DUST_LIMIT) {
    psbt.addOutput({ address: changeAddress || p2wsh.address, value: change });
  }

  return psbt;
}

function buildP2SH_P2WSH_PSBT(utxos, witnessScript, recipientAddress, amount, changeAddress) {
  const p2wsh = deriveP2WSH(witnessScript);
  const p2sh_p2wsh = deriveP2SH_P2WSH(witnessScript);
  const psbt = new bitcoin.Psbt({ network: NETWORK });

  const fee = estimateFeeWSH(utxos.length, 2);
  const inputTotal = utxos.reduce((sum, u) => sum + u.value, 0);
  const change = inputTotal - amount - fee;

  if (change < 0) {
    throw new Error(`Insufficient funds: have ${inputTotal}, need ${amount + fee}`);
  }

  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: p2sh_p2wsh.output,
        value: utxo.value,
      },
      redeemScript: p2wsh.output,
      witnessScript,
    });
  }

  psbt.addOutput({ address: recipientAddress, value: amount });
  if (change > DUST_LIMIT) {
    psbt.addOutput({ address: changeAddress || p2sh_p2wsh.address, value: change });
  }

  return psbt;
}

function signPSBT(psbt, keyPair) {
  const signer = createSigner(keyPair);
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    psbt.signInput(i, signer);
  }
  return psbt;
}

function getSigningStatus(psbt) {
  const input0 = psbt.data.inputs[0];
  if (!input0) return null;

  const witnessScript = input0.witnessScript;
  if (!witnessScript) return null;

  const decompiled = bitcoin.script.decompile(witnessScript);
  if (!decompiled) return null;

  const opM = decompiled[0];
  const requiredSigs = typeof opM === 'number' ? opM - bitcoin.opcodes.OP_1 + 1 : null;

  const pubkeys = decompiled
    .filter((chunk) => (chunk instanceof Uint8Array) && (chunk.length === 33 || chunk.length === 65))
    .map((pk) => Buffer.from(pk).toString('hex'));

  const partialSigs = input0.partialSig || [];
  const signedKeys = partialSigs.map((ps) => Buffer.from(ps.pubkey).toString('hex'));

  const signedBy = pubkeys.filter((pk) => signedKeys.includes(pk));
  const pendingKeys = pubkeys.filter((pk) => !signedKeys.includes(pk));

  return {
    requiredSignatures: requiredSigs,
    totalKeys: pubkeys.length,
    signedCount: signedBy.length,
    signedBy,
    pendingKeys,
    complete: signedBy.length >= (requiredSigs || pubkeys.length),
  };
}

function exportPSBT(psbt, label) {
  const base64 = psbt.toBase64();
  const hex = psbt.toHex();

  console.log(`\n=== ${label} ===`);
  console.log('Base64 PSBT:');
  console.log(base64);
  console.log('\nHex PSBT:');
  console.log(hex);

  return { base64, hex };
}

function savePSBT(psbt, filename) {
  const buf = psbt.toBuffer();
  fs.writeFileSync(filename, buf);
  console.log(`Saved binary PSBT to ${filename} (${buf.length} bytes)`);
}

module.exports = {
  buildMultisigWitnessScript,
  deriveP2WSH,
  deriveP2SH_P2WSH,
  estimateFeeWSH,
  buildP2WSH_PSBT,
  buildP2SH_P2WSH_PSBT,
  signPSBT,
  getSigningStatus,
  exportPSBT,
  savePSBT,
};
