try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); } catch { /* dotenv optional */ }
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const bitcoinRoutes = require('./routes/bitcoin');
const multisigRoutes = require('./routes/multisig');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    nodeVersion: process.version,
    uptime: process.uptime(),
  });
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    data: {
      server: 'Bitcoin Transaction API',
      version: require('../package.json').version,
      environment: process.env.NODE_ENV || 'production',
      lastRestart: new Date().toISOString(),
      endpoints: [
        'GET  /health',
        'GET  /api/status',
        'POST /api/bitcoin/keypair',
        'GET  /api/bitcoin/addresses/:privateKey',
        'GET  /api/bitcoin/utxos/:address',
        'POST /api/bitcoin/select-coins',
        'POST /api/bitcoin/estimate-fee',
        'POST /api/bitcoin/build-transaction',
        'POST /api/bitcoin/sign-transaction',
        'POST /api/bitcoin/broadcast',
        'GET  /api/bitcoin/monitor/:txId',
        'POST /api/bitcoin/send',
        'POST /api/bitcoin/sign-message',
        'POST /api/bitcoin/verify-message',
        'POST /api/bitcoin/wsh/keypair',
        'POST /api/bitcoin/wsh/build-psbt',
        'POST /api/bitcoin/wsh/sign-psbt',
        'POST /api/bitcoin/wsh/finalize-psbt',
        'POST /api/bitcoin/wsh/send',
      ],
    },
  });
});

// Routes
app.use('/api/bitcoin', bitcoinRoutes);
app.use('/api/bitcoin/wsh', multisigRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Bitcoin API Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

module.exports = app;
