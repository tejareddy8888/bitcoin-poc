const axios = require('axios');
const { MEMPOOL_API } = require('../config/network');

async function fetchUTXOs(address) {
  const response = await axios.get(`${MEMPOOL_API}/address/${address}/utxo`);
  return response.data;
}

function selectCoins(utxos, targetAmount) {
  const selected = [];
  let total = 0;
  const sortedUtxos = [...utxos].sort((a, b) => b.value - a.value);

  for (const utxo of sortedUtxos) {
    if (total >= targetAmount) break;
    selected.push(utxo);
    total += utxo.value;
  }

  if (total < targetAmount) {
    throw new Error(`Insufficient funds: have ${total}, need ${targetAmount}`);
  }

  return { selected, total };
}

module.exports = { fetchUTXOs, selectCoins };
