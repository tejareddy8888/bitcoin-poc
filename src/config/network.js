const bitcoin = require('bitcoinjs-lib');

const SUPPORTED_NETWORKS = ['testnet', 'signet'];
const networkName = (process.env.BITCOIN_NETWORK || 'signet').toLowerCase();

if (!SUPPORTED_NETWORKS.includes(networkName)) {
  throw new Error(`Unsupported BITCOIN_NETWORK="${networkName}". Use: ${SUPPORTED_NETWORKS.join(', ')}`);
}

const NETWORK = bitcoin.networks.testnet;
const MEMPOOL_API = `https://mempool.space/${networkName}/api`;
const EXPLORER_URL = `https://mempool.space/${networkName}`;
const FAUCET_URL = networkName === 'signet'
  ? 'https://signetfaucet.com/'
  : 'https://testnet-faucet.mempool.co/';

module.exports = {
  NETWORK,
  MEMPOOL_API,
  EXPLORER_URL,
  FAUCET_URL,
  networkName,
};
