const { bitcoin, ECPair } = require('./bitcoin');
const { NETWORK } = require('../config/network');

function generateKeyPair() {
  return ECPair.makeRandom({ network: NETWORK, compressed: true });
}

function keyPairFromWIF(wif) {
  return ECPair.fromWIF(wif, NETWORK);
}

function deriveAddresses(keyPair) {
  const pubkey = Buffer.from(keyPair.publicKey);

  const p2pkh = bitcoin.payments.p2pkh({ pubkey, network: NETWORK });
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: NETWORK });
  const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network: NETWORK });
  const p2tr = bitcoin.payments.p2tr({
    internalPubkey: pubkey.slice(1, 33),
    network: NETWORK,
  });

  return { p2pkh, p2sh, p2wpkh, p2tr };
}

module.exports = { generateKeyPair, keyPairFromWIF, deriveAddresses };
