import cron from 'node-cron';
import * as db from '../db/supabase.js';
import { sendMorningCheckin, sendEveningCheckin, sendAntiChurnMessage, sendPostProgramMessage, sendPreProgramMessage } from '../bot/telegram.js';
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
        // Skip dacă programul nu a început
        const calendarDay = getCalendarProgramDay(profile.program_start_date);
        if (calendarDay === null || calendarDay <= 0) continue;
        
        // Skip dacă e zi de odihnă în program (normal să nu bifeze nimic)
        if (calendarDay === 7 || calendarDay === 14) continue;
        
        // NOTĂ: Anti-churn rulează și pentru userii în recuperare (calendar > 14, bifate < 14)
        // pentru a-i încuraja să termine cele 14 zile.
        
        const lastCheckin = await db.getLastCheckin(profile.id);
        
        if (!lastCheckin) continue;
        
        const daysSince = Math.floor(
          (Date.now() - new Date(lastCheckin.checkin_date).getTime()) / (1000 * 60 * 60 * 24)
        );
        
        // Calculate risk score
        const riskScore = calculateRiskScore(profile, daysSince);
        
        if (riskScore >= 20) {
          const alreadySent = await db.wasNotificationSentToday(profile.id, 'anti_churn');
          if (!alreadySent) {
            await sendAntiChurnMessage(profile, 'high', daysSince);
            
            // Reset streak if inactive > 1 day
            if (daysSince > 1 && profile.current_streak > 0) {
              await db.updateProfile(profile.id, { current_streak: 0 });
            }
          }
        } else if (riskScore >= 10) {
          const alreadySent = await db.wasNotificationSentToday(profile.id, 'anti_churn');
          if (!alreadySent) {
            await sendAntiChurnMessage(profile, 'medium', daysSince);
          }
        } else if (riskScore >= 5) {
          const alreadySent = await db.wasNotificationSentToday(profile.id, 'anti_churn');
          if (!alreadySent) {
            await sendAntiChurnMessage(profile, 'low', daysSince);
          }
        }
        
        await sleep(500);
      }
      console.log('[CRON] Anti-churn scan complete');
    } catch (error) {
      console.error('[CRON] Anti-churn error:', error);
    }
  }, { timezone: 'Europe/Bucharest' });

  // ============================================
  // Weekly Review — DEZACTIVAT pentru MVP
  // ============================================
  // Motivul: prompt-ul AI generează review-uri cu halucinații (sfaturi inventate,
  // promisiuni de funcții inexistente — gen "loghează mese"). Pentru primii 10 clienți,
  // Sam trimite mesaj manual personalizat duminică seara.
  // Reactivat după validare MVP cu prompt strict, doar fapte.
  /*
  cron.schedule('0 19 * * 0', async () => {
    // ... cod arhivat
  }, { timezone: 'Europe/Bucharest' });
  */

  // ============================================
  // Auto-mark Program Complete — ELIMINAT
  // ============================================
  // Decizie strategică (script video tranziție): programul se marchează "completed" DOAR
  // când userul bifează 14 antrenamente reale (asta se întâmplă în telegram.js difficulty_rating).
  // Calendar trecut Z14 + bifate < 14 = user în recuperare, NU terminat. Va termina când recuperează.
  // Day+1 post-program (videoul de tranziție) vine ABIA după ce userul finalizează inițierea.

  // ============================================
  // Zilnic 10:00 — Post-Program Sequence Check
  // ============================================
  cron.schedule('0 10 * * *', async () => {
    console.log('[CRON] Post-program sequence check...');
    try {
      const completedProfiles = await db.getCompletedProfiles();
      
      for (const profile of completedProfiles) {
        if (!profile.program_completed_date) continue;
        
        const completedDate = new Date(profile.program_completed_date);
        const daysSince = Math.floor(
          (Date.now() - completedDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        // Trimitem doar Day+1 și Day+3 (restul sunt scoase pentru MVP)
        // sendPostProgramMessage gestionează intern care zi e validă (return early pentru altele)
        if ([1, 3].includes(daysSince)) {
          const alreadySent = await db.wasNotificationSentToday(profile.id, 'post_program');
          if (!alreadySent) {
            await sendPostProgramMessage(profile, daysSince);
            await sleep(1500);
          }
        }
      }
      console.log('[CRON] Post-program sequence check complete');
    } catch (error) {
      console.error('[CRON] Post-program error:', error);
    }
  }, { timezone: 'Europe/Bucharest' });

  console.log('⏰ Cron jobs initialized (timezone: Europe/Bucharest)');
}

// ============================================
// RISK SCORE CALCULATION
// ============================================

function calculateRiskScore(profile, daysSinceLastCheckin) {
  let score = 0;
  
  // Days without activity (biggest factor)
  score += daysSinceLastCheckin * 3;
  
  // Lost streak (was active, now isn't)
  if (profile.current_streak === 0 && profile.max_streak > 2) {
    score += 5;
  }
  
  // Early in program (days 3-7 = highest churn risk)
  if (profile.current_day >= 3 && profile.current_day <= 7) {
    score += 3;
  }
  
  return score;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
