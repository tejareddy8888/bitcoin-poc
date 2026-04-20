const axios = require('axios');
const { MEMPOOL_API, EXPLORER_URL, FAUCET_URL, networkName } = require('../src/config/network');

async function checkUTXOs(address) {
  console.log(`Checking UTXOs for: ${address}`);

  const [utxoResponse, txResponse] = await Promise.all([
    axios.get(`${MEMPOOL_API}/address/${address}/utxo`),
    axios.get(`${MEMPOOL_API}/address/${address}/txs`),
  ]);

  const utxos = utxoResponse.data;
  const transactions = txResponse.data;

  console.log(`Total UTXOs: ${utxos.length}`);

  if (utxos.length === 0) {
    console.log(`No UTXOs found. Get ${networkName} BTC: ${FAUCET_URL}`);
    return;
  }

  let totalValue = 0;
  console.log('UTXOs:');
  utxos.forEach((utxo, idx) => {
    console.log(`${idx + 1}. ${utxo.txid}:${utxo.vout} - ${utxo.value.toLocaleString()} sats ${utxo.status.confirmed ? 'confirmed' : 'pending'}`);
    totalValue += utxo.value;
  });

  console.log(`Total Balance: ${totalValue.toLocaleString()} sats (${(totalValue / 100000000).toFixed(8)} BTC)`);

  console.log(`Recent Transactions: ${transactions.length}`);
  transactions.slice(0, 3).forEach((tx, idx) => {
    console.log(`${idx + 1}. ${tx.txid.substring(0, 16)}... ${tx.status.confirmed ? 'confirmed' : 'pending'} (fee: ${tx.fee} sats)`);
  });

  console.log(`Explorer: ${EXPLORER_URL}/address/${address}`);
}

if (require.main === module) {
  const address = process.argv[2];
  if (!address) {
    console.log('Usage: node scripts/check-utxos.js <address>');
    process.exit(1);
  }
  checkUTXOs(address).catch(console.error);
}

module.exports = { checkUTXOs };
