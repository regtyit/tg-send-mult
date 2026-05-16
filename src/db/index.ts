import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../logger';

let connected = false;

export async function connectMongo(): Promise<typeof mongoose> {
  if (connected) return mongoose;

  mongoose.set('strictQuery', true);
  mongoose.connection.on('connected', () => {
    logger.info({ uri: redactUri(config.MONGO_URI) }, 'mongo: connected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'mongo: connection error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('mongo: disconnected');
    connected = false;
  });

  await mongoose.connect(config.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  connected = true;
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

function redactUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

export { mongoose };
