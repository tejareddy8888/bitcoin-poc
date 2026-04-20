const { generateKeyPair, keyPairFromWIF, deriveAddresses } = require('../src/lib/keys');
const { fetchUTXOs, selectCoins } = require('../src/lib/utxo');
const { estimateFee, buildTransaction, signTransaction, broadcastTransaction } = require('../src/lib/transaction');
const { FAUCET_URL, networkName } = require('../src/config/network');

async function demoReadOnly() {
  console.log('=== Bitcoin Transaction POC ===');

  const keyPair = generateKeyPair();
  console.log('Private Key (WIF):', keyPair.toWIF());

  const addresses = deriveAddresses(keyPair);
  console.log('P2PKH (Legacy):', addresses.p2pkh.address);
  console.log('P2SH (Wrapped):', addresses.p2sh.address);
  console.log('P2WPKH (SegWit):', addresses.p2wpkh.address);
  console.log('P2TR (Taproot):', addresses.p2tr.address);

  console.log(`\nGet ${networkName} BTC: ${FAUCET_URL}`);
}

async function demoFullTransaction(privateKeyWIF, recipientAddress, amountSats) {
  console.log('=== Sending Bitcoin Transaction ===');

  const keyPair = keyPairFromWIF(privateKeyWIF);
  const addresses = deriveAddresses(keyPair);
  const senderAddress = addresses.p2wpkh.address;

  console.log(`From: ${senderAddress}`);
  console.log(`To: ${recipientAddress}`);
  console.log(`Amount: ${amountSats} sats`);

  const utxos = await fetchUTXOs(senderAddress);
  if (utxos.length === 0) {
    throw new Error('No UTXOs found. Fund this address first!');
  }

  const estimatedFee = estimateFee(utxos.length, 2);
  const totalNeeded = amountSats + estimatedFee;
  const coins = selectCoins(utxos, totalNeeded);

  const psbt = buildTransaction(keyPair.publicKey, coins, recipientAddress, amountSats, senderAddress);
  const { txHex, txId } = signTransaction(psbt, keyPair);

  const broadcastResult = await broadcastTransaction(txHex);
  console.log(`Transaction broadcast: ${broadcastResult}`);
  console.log('COMPLETE');
}

const args = process.argv.slice(2);

if (args.length === 0) {
  demoReadOnly().catch(console.error);
} else if (args.length === 3) {
  const [privateKey, recipient, amount] = args;
  demoFullTransaction(privateKey, recipient, parseInt(amount)).catch(console.error);
} else {
  console.log('Usage:');
  console.log('  Demo:        node scripts/demo.js');
  console.log('  Transaction: node scripts/demo.js <privateKeyWIF> <recipient> <amount>');
}
