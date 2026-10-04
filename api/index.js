import mongoose from 'mongoose';
import { createApp } from '../server/src/app.js';
import { config } from '../server/src/config/env.js';
import { getSettings } from '../server/src/models/index.js';

const app = createApp();

let isConnected = false;

// Middleware to ensure DB connection is ready on serverless cold starts
app.use(async (req, res, next) => {
  if (!isConnected) {
    try {
      await mongoose.connect(config.mongoUri);
      await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
      await getSettings();
      isConnected = true;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      return res.status(500).json({ message: 'Database connection failed' });
    }
  }
  next();
});

export default app;
