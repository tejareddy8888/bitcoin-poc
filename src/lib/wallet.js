const crypto = require('crypto');
const { generateKeyPair, keyPairFromWIF, deriveAddresses } = require('./keys');
const { bitcoin } = require('./bitcoin');
const { NETWORK } = require('../config/network');
const { fetchUTXOs, selectCoins } = require('./utxo');
const { estimateFee, buildTransaction } = require('./transaction');

// In-memory wallet store (POC — production would use a database)
const wallets = new Map();

// --- Enums mirroring transaction-gateway wallet-service DTOs ---

// Mirrors: wallet-service.dto.ts → WalletRESBusinessStatusEnum
const WalletBusinessStatus = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
};

// Mirrors: wallet-service.dto.ts → WalletRESBusinessTypeEnum
const WalletBusinessType = {
  VAULT: 'VAULT',
  TRADING: 'TRADING',
  PLEDGED: 'PLEDGED',
  STAKING: 'STAKING',
  OMNIBUS: 'OMNIBUS',
  FEE_SPONSOR: 'FEE_SPONSOR',
};

// --- Wallet Management ---
// Mirrors: WalletServiceClient.getWallet() → WalletRES shape

function createWallet(label, businessType) {
  const keyPair = generateKeyPair();
  const addresses = deriveAddresses(keyPair);
  const walletId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Internal representation (includes private key for POC local signing)
  const wallet = {
    id: walletId,
    privateKeyWIF: keyPair.toWIF(),
    publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
    createdAt: now,
    updatedAt: now,
    businessStatus: WalletBusinessStatus.ACTIVE,
    name: label || `bitcoin-wallet-${walletId.slice(0, 8)}`,
    businessType: businessType || WalletBusinessType.VAULT,
    technicalType: 'SEGREGATED',
    _embedded: {
      addresses: [
        { id: crypto.randomUUID(), address: addresses.p2wpkh.address, tagMemo: 'p2wpkh' },
        { id: crypto.randomUUID(), address: addresses.p2pkh.address, tagMemo: 'p2pkh' },
        { id: crypto.randomUUID(), address: addresses.p2sh.address, tagMemo: 'p2sh' },
        { id: crypto.randomUUID(), address: addresses.p2tr.address, tagMemo: 'p2tr' },
      ],
      blockchain: {
        name: 'BITCOIN',
        network: NETWORK === bitcoin.networks.testnet ? 'TESTNET' : 'MAINNET',
      },
    },
    // Convenience field (not in WalletRES, but useful for POC internal lookups)
    primaryAddress: addresses.p2wpkh.address,
  };

  wallets.set(walletId, wallet);
  return wallet;
}

function getWallet(walletId) {
  const wallet = wallets.get(walletId);
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletId}`);
  }
  return wallet;
}

// Returns WalletRES shape (no private key)
function toWalletRES(wallet) {
  return {
    id: wallet.id,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    businessStatus: wallet.businessStatus,
    name: wallet.name,
    businessType: wallet.businessType,
    technicalType: wallet.technicalType,
    _embedded: wallet._embedded,
  };
}

// Mirrors: WalletServiceClient.getPublicKey() → GetPublicKey200Response
function getPublicKey(walletId) {
  const wallet = getWallet(walletId);
  return {
    id: wallet.id,
    businessType: wallet.businessType,
    publicKey: wallet.publicKey,
  };
}

function listWallets() {
  return Array.from(wallets.values()).map(toWalletRES);
}

// --- Managed Transaction Flow ---

async function buildManagedTransaction(walletId, recipientAddress, amount) {
  const wallet = getWallet(walletId);
  const keyPair = keyPairFromWIF(wallet.privateKeyWIF);

  const utxos = await fetchUTXOs(wallet.primaryAddress);
  if (utxos.length === 0) {
    throw new Error(`No UTXOs found for wallet ${walletId}. Fund address ${wallet.primaryAddress} first.`);
  }

  const fee = estimateFee(utxos.length, 2);
  const totalNeeded = amount + fee;
  const coins = selectCoins(utxos, totalNeeded);

  const psbt = buildTransaction(keyPair.publicKey, coins, recipientAddress, amount, wallet.primaryAddress);

  return {
    psbtBase64: psbt.toBase64(),
    walletId,
    sourceAddress: wallet.primaryAddress,
    recipientAddress,
    amount,
    fee,
    inputCount: psbt.data.inputs.length,
    outputCount: psbt.data.outputs.length,
  };
}

module.exports = {
  WalletBusinessStatus,
  WalletBusinessType,
  createWallet,
  getWallet,
  toWalletRES,
  getPublicKey,
  listWallets,
  buildManagedTransaction,
};
