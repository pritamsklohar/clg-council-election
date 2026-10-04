import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { getSettings } from './models/index.js';

await mongoose.connect(config.mongoUri);
// Make sure the unique indexes exist before accepting traffic: they enforce one vote per voter.
await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
await getSettings();

createApp().listen(config.port, () => {
  console.log(`Voting server running on http://localhost:${config.port} (mail mode: ${config.mailMode})`);
});
