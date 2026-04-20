const { bitcoin, ecc } = require('./bitcoin');
const { keyPairFromWIF } = require('./keys');
const { NETWORK } = require('../config/network');

function signMessage(message, privateKeyWIF) {
  const keyPair = keyPairFromWIF(privateKeyWIF);

  const messagePrefix = '\x18Bitcoin Signed Message:\n';
  const messageBuffer = Buffer.from(message, 'utf8');

  const lengthBuffer = Buffer.allocUnsafe(1);
  lengthBuffer.writeUInt8(messageBuffer.length, 0);

  const fullMessage = Buffer.concat([
    Buffer.from(messagePrefix, 'binary'),
    lengthBuffer,
    messageBuffer,
  ]);

  const hash = bitcoin.crypto.hash256(fullMessage);

  const privateKey = keyPair.privateKey;
  const compressed = keyPair.compressed !== false;

  const extraData = hash;
  const sigResult = ecc.signRecoverable(hash, privateKey, extraData);

  if (!sigResult || !sigResult.signature) {
    throw new Error('Failed to create recoverable signature');
  }

  const signature = Buffer.from(sigResult.signature);
  const recoveryFlag = sigResult.recoveryId;

  const recoveredPubKey = ecc.recover(hash, signature, recoveryFlag, compressed);
  if (!recoveredPubKey || !Buffer.from(recoveredPubKey).equals(keyPair.publicKey)) {
    throw new Error('Signature recovery verification failed');
  }

  const flagByte = 27 + recoveryFlag + (compressed ? 4 : 0);

  const signatureWithRecovery = Buffer.concat([
    Buffer.from([flagByte]),
    signature,
  ]);

  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: NETWORK,
  });

  return {
    signature: signatureWithRecovery.toString('base64'),
    address: payment.address,
    message,
  };
}

function verifyMessage(message, address, signatureBase64) {
  const signatureBuffer = Buffer.from(signatureBase64, 'base64');

  if (signatureBuffer.length !== 65) {
    throw new Error(`Invalid signature length: ${signatureBuffer.length}, expected 65`);
  }

  const flagByte = signatureBuffer[0];

  if (flagByte < 27 || flagByte >= 35) {
    throw new Error(`Invalid signature flag: ${flagByte}`);
  }

  const recoveryFlag = flagByte - 27;
  const compressed = (recoveryFlag & 4) !== 0;
  const recoveryId = recoveryFlag & 3;
  const signature = signatureBuffer.slice(1);

  const messagePrefix = '\x18Bitcoin Signed Message:\n';
  const messageBuffer = Buffer.from(message, 'utf8');

  const lengthBuffer = Buffer.allocUnsafe(1);
  lengthBuffer.writeUInt8(messageBuffer.length, 0);

  const fullMessage = Buffer.concat([
    Buffer.from(messagePrefix, 'binary'),
    lengthBuffer,
    messageBuffer,
  ]);

  const hash = bitcoin.crypto.hash256(fullMessage);

  const publicKey = ecc.recover(hash, signature, recoveryId, compressed);

  if (!publicKey) {
    return false;
  }

  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(publicKey),
    network: NETWORK,
  });

  const p2pkh = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(publicKey),
    network: NETWORK,
  });

  const p2sh = bitcoin.payments.p2sh({
    redeem: p2wpkh,
    network: NETWORK,
  });

  return p2wpkh.address === address ||
         p2pkh.address === address ||
         p2sh.address === address;
}

module.exports = { signMessage, verifyMessage };
