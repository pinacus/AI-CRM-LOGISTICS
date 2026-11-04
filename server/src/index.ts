import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { attachUser, ensureSeedUsers } from './auth';
import { channelModes } from './channels';
import { config } from './config';
import { hydrate, openDatabase, persist } from './db';
import { createApiRouter, type ServerContext } from './routes';
import { ensureSarvamVendor, seedStore } from './seed';
import { setMutationListener } from './simulation';
import { newStore } from './store';

export function createApp(ctx: ServerContext): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use('/api', attachUser(ctx.db));
  app.use('/api', createApiRouter(ctx));

  // Serve the built client when it exists, so `npm run build && npm start`
  // gives a single process serving the whole app.
  const candidates = [
    path.join(__dirname, '..', '..', 'web', 'dist'),
    path.join(__dirname, '..', '..', '..', 'web', 'dist'),
    path.join(__dirname, '..', '..', '..', '..', 'web', 'dist'),
    path.join(process.cwd(), 'web', 'dist'),
    path.join(process.cwd(), '..', 'web', 'dist'),
  ];
  const webDist = candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
  if (webDist) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return app;
}

function boot(): void {
  const db = openDatabase(config.dbPath);
  ensureSeedUsers(db);

  const existing = hydrate(db);
  const store = existing ?? newStore();
  const seededNow = existing === null;
  if (seededNow) {
    seedStore(store);
  }
  // Keep the Sarvam AI call target in the vendor master on every boot, so an
  // existing database also gets David Transportation added or corrected.
  const ensured = ensureSarvamVendor(store);
  if (seededNow || ensured.added) {
    persist(db, store);
  }

  const ctx: ServerContext = { store, db };
  setMutationListener(() => {
    try {
      persist(db, store);
    } catch (err) {
      console.error('persist failed:', err);
    }
  });

  const app = createApp(ctx);
  const server = app.listen(config.port, () => {
    const modes = channelModes();
    console.log(`FreightDesk API listening on http://localhost:${config.port}`);
    console.log(`Database ${config.dbPath} (${seededNow ? 'seeded fresh' : 'existing data loaded'})`);
    console.log(`Vendors ${store.vendors.length}, rate card rows ${store.rateCard.length}, requirements ${store.requirements.length}`);
    console.log(`Channels: whatsapp=${modes.whatsapp}, voice=${modes.voice}`);
    console.log(`Sarvam AI: ${config.sarvam.apiKey ? 'configured' : 'not configured'}, calls ${config.sarvam.vendorName} (${config.sarvam.vendorPhone}) only`);
    if (config.webhookToken === 'freightdesk-dev-token') {
      console.log('WEBHOOK_TOKEN is not set, using the development default.');
    }
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, persisting and shutting down`);
    try {
      persist(db, store);
    } catch (err) {
      console.error('final persist failed:', err);
    }
    try {
      db.close();
    } catch {
      // database already closed
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  boot();
}
