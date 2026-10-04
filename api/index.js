import mongoose from 'mongoose';
import { createApp } from '../server/src/app.js';
import { config } from '../server/src/config/env.js';
import { getSettings } from '../server/src/models/index.js';

const app = createApp();
let isConnected = false;

export default async function handler(req, res) {
  if (!isConnected) {
    try {
      await mongoose.connect(config.mongoUri);
      // Make sure unique indexes are ready
      await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
      await getSettings();
      isConnected = true;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      return res.status(500).json({ message: 'Database connection failed' });
    }
  }
  
  // Forward request to Express app
  return app(req, res);
}
