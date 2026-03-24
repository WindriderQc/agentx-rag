const path = require('path');
const connectDB = require('./config/db');
const logger = require('./config/logger');

require('dotenv').config({
  path: path.join(__dirname, '.env')
});

const PORT = process.env.PORT || 3082;
const HOST = process.env.HOST || '::';

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
});

process.on('uncaughtException', (error) => {
  if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
    logger.debug(`${error.code} ignored (closed connection)`);
    return;
  }
  logger.error('Uncaught Exception', { message: error.message, stack: error.stack });
  setTimeout(() => process.exit(1), 1000);
});

process.stdout.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });

const app = require('./app');

async function start() {
  await connectDB();
  app.listen(PORT, HOST, () => {
    logger.info(`agentx-rag listening on ${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  start().catch(err => {
    logger.error('Failed to start', { error: err.message });
    process.exit(1);
  });
}
