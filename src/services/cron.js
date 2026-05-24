import cron from 'node-cron';
import * as db from '../db/supabase.js';
import { sendMorningCheckin, sendEveningCheckin, sendAntiChurnMessage, sendPreProgramMessage } from '../bot/telegram.js';
import { getRomaniaDate, getCalendarProgramDay } from '../utils/helpers.js';

export function initCronJobs() {
  
  // ============================================
  // 08:00 — Morning Check-in
  // ============================================
  cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Morning check-in starting...');
    try {
      const profiles = await db.getAllActiveProfiles();
      const today = getRomaniaDate();
      
      for (const profile of profiles) {
        try {
          const alreadySent = await db.wasNotificationSentToday(profile.id, 'morning_checkin');
          if (alreadySent) continue;
          
          const startDate = profile.program_start_date;
          
          if (!startDate || today < startDate) {
            // PRE-PROGRAM: send preparation message
            await sendPreProgramMessage(profile, startDate);
            await sleep(1000);
          } else {
            // IN-PROGRAM: send regular training check-in (gestionează intern Z7/Z14 odihnă + recuperare după calendar)
            await sendMorningCheckin(profile);
            await sleep(1000);
          }
        } catch (err) {
          // CRITIC: izolăm eroarea per-user. Un user care a blocat botul (403)
          // sau orice altă eroare NU mai trebuie să oprească livrarea pentru restul.
          if (err?.response?.body?.error_code === 403) {
            console.warn(`[CRON] Morning: user ${profile.id} a blocat botul — skip`);
          } else {
            console.error(`[CRON] Morning: eroare la user ${profile.id}:`, err?.message || err);
          }
          // bucla continuă la următorul user
        }
      }
      console.log(`[CRON] Morning check-in sent to ${profiles.length} users`);
    } catch (error) {
      console.error('[CRON] Morning check-in error:', error);
    }
  }, { timezone: 'Europe/Bucharest' });

  // ============================================
  // 20:00 — Evening Check-in (if not already done)
  // ============================================
  cron.schedule('0 20 * * *', async () => {
    console.log('[CRON] Evening check-in starting...');
    try {
      const profiles = await db.getAllActiveProfiles();
      const today = getRomaniaDate();
      
      for (const profile of profiles) {
        try {
          // Skip pre-program users (no evening check-in before start)
          if (profile.program_start_date && today < profile.program_start_date) continue;
          
          // Skip rest days (Z7 și Z14 — n-are ce să bifeze)
          const calendarDay = getCalendarProgramDay(profile.program_start_date);
          if (calendarDay === null || calendarDay <= 0) continue;
          if (calendarDay === 7 || calendarDay === 14) continue;
          
          // NOTĂ: nu mai facem skip la calendar > 14. Dacă userul e în recuperare
          // (calendar trecut Z14 dar bifate < 14), evening checkin trebuie să-l încurajeze să bifeze.
          // sendEveningCheckin gestionează intern (verifică dacă a bifat deja azi).
          
          const alreadySent = await db.wasNotificationSentToday(profile.id, 'evening_checkin');
          if (!alreadySent) {
            await sendEveningCheckin(profile);
            await sleep(1000);
          }
        } catch (err) {
          // CRITIC: izolăm eroarea per-user (vezi cron morning).
          if (err?.response?.body?.error_code === 403) {
            console.warn(`[CRON] Evening: user ${profile.id} a blocat botul — skip`);
          } else {
            console.error(`[CRON] Evening: eroare la user ${profile.id}:`, err?.message || err);
          }
          // bucla continuă la următorul user
        }
      }
      console.log(`[CRON] Evening check-in sent`);
    } catch (error) {
      console.error('[CRON] Evening check-in error:', error);
    }
  }, { timezone: 'Europe/Bucharest' });

  // ============================================
  // Anti-Churn Scan — DOAR la ore civilizate (11:00 și 17:00)
  // ============================================
  cron.schedule('0 11,17 * * *', async () => {
    console.log('[CRON] Anti-churn scan starting...');
    try {
      const profiles = await db.getAllActiveProfiles();
      
      for (const profile of profiles) {
        try {
          // Skip dacă programul nu a început
          const calendarDay = getCalendarProgramDay(profile.program_start_date);
          if (calendarDay === null || calendarDay <= 0) continue;
          
          // Skip dacă e zi de odihnă în program (normal să nu bifeze nimic)
          if (calendarDay === 7 || calendarDay === 14) continue;
          
          // NOTĂ: Anti-churn rulează și pentru userii în recuperare (calendar > 14, bifate < 14)
          // pentru a-i încuraja să termine cele 14 zile.
          
          const lastCheckin = await db.getLastCheckin(profile.id);
          
          if (!lastCheckin) continue;
          
          // FIX B — daysSince corect, pe zile calendaristice.
          // checkin_date și today sunt ambele string-uri YYYY-MM-DD (date pure, fără oră).
          // Parsăm cu 'T00:00:00' — același pattern ca getCalendarProgramDay — ca să
          // evităm umflarea artificială din diferența de fus orar.
          // "S-a antrenat azi" → 0. "Ieri" → 1. "Acum 3 zile" → 3.
          const todayRO = getRomaniaDate();
          const lastDate = new Date(lastCheckin.checkin_date + 'T00:00:00');
          const todayDate = new Date(todayRO + 'T00:00:00');
          const daysSince = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
          
          // FIX A — praguri directe pe zile reale de inactivitate.
          // O zi de pauză e normală, NU e churn. Anti-churn pornește de la 2 zile.
          // Înlocuiește scoringul cu puncte (calculateRiskScore) care declanșa
          // fals pozitiv la 1 zi din cauza bonusurilor "early program" / "lost streak".
          let riskLevel = null;
          if (daysSince >= 4) {
            riskLevel = 'high';
          } else if (daysSince === 3) {
            riskLevel = 'medium';
          } else if (daysSince === 2) {
            riskLevel = 'low';
          }
          // daysSince <= 1 → riskLevel rămâne null → niciun mesaj
          
          if (!riskLevel) {
            continue;
          }
          
          // Cooldown global 48h: NU trimite anti-churn dacă s-a trimis în ultimele 48 ore
          // (indiferent de risk level — evităm mesaje în zile consecutive).
          const recentlySent = await db.wasNotificationSentInLastHours(profile.id, 'anti_churn', 48);
          if (recentlySent) {
            await sleep(500);
            continue;
          }
          
          await sendAntiChurnMessage(profile, riskLevel, daysSince);
          
          // Reset streak — userul a întrerupt activitatea (daysSince >= 2 garantat aici).
          if (profile.current_streak > 0) {
            await db.updateProfile(profile.id, { current_streak: 0 });
          }
          
          await sleep(500);
        } catch (err) {
          // CRITIC: izolăm eroarea per-user (vezi cron morning).
          if (err?.response?.body?.error_code === 403) {
            console.warn(`[CRON] Anti-churn: user ${profile.id} a blocat botul — skip`);
          } else {
            console.error(`[CRON] Anti-churn: eroare la user ${profile.id}:`, err?.message || err);
          }
          // bucla continuă la următorul user
        }
      }
      console.log('[CRON] Anti-churn scan complete');
    } catch (error) {
      console.error('[CRON] Anti-churn error:', error);
    }
  }, { timezone: 'Europe/Bucharest' });

  // ============================================
  // Weekly Review — DEZACTIVAT pentru MVP
  // ============================================
  // Halucinații în prompt. Sam scrie manual primilor 10 clienți duminică seara.
  // Reactivat după validare cu prompt strict.

  console.log('⏰ Cron jobs initialized (timezone: Europe/Bucharest)');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
