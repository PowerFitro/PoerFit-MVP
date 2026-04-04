import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initBot } from './bot/telegram.js';
import { registerRoutes } from './api/routes.js';
import { initCronJobs } from './services/cron.js';

// ============================================
// PowerFit MVP — Main Entry Point
// ============================================

async function start() {
  console.log('🚀 PowerFit MVP starting...');
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // --- Validate environment ---
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
    console.error('   Copiază .env.example ca .env și completează valorile.');
    process.exit(1);
  }
  
  // --- Init Fastify API ---
  const app = Fastify({ logger: false });
  
  await app.register(cors, {
    origin: [
      'https://www.powerfitro.com',
      'https://powerfitro.com',
      'https://start.powerfitro.com',
      /\.vercel\.app$/,
      /localhost/,/powerfitro.github.io/
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  });
  
  await registerRoutes(app);
  
  const port = parseInt(process.env.PORT || '3000');
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🌐 API server running on port ${port}`);
  
  // --- Init Telegram Bot ---
  initBot();
  
  // --- Init Cron Jobs ---
  initCronJobs();
  
  console.log('');
  console.log('✅ PowerFit MVP is LIVE!');
  console.log('');
  console.log('Components:');
  console.log('  🌐 API:      http://localhost:' + port);
  console.log('  🤖 Telegram: Bot polling active');
  console.log('  ⏰ Cron:     Scheduled jobs active');
  console.log('');
}

start().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
