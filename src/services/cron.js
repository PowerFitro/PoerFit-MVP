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
          // IN-PROGRAM: send regular training check-in (gestionează intern Z7/Z14 odihnă)
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
        
        // Skip program-finished users (post-program flow preia)
        const calendarDay = getCalendarProgramDay(profile.program_start_date);
        if (calendarDay === null || calendarDay > 14) continue;
        
        // Skip rest days (Z7 și Z14 — n-are ce să bifeze)
        if (calendarDay === 7 || calendarDay === 14) continue;
        
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
        // Skip dacă e zi de odihnă în program (normal să nu bifeze nimic)
        const calendarDay = getCalendarProgramDay(profile.program_start_date);
        if (calendarDay === 7 || calendarDay === 14) continue;
        
        // Skip dacă programul nu a început sau s-a încheiat
        if (calendarDay === null || calendarDay <= 0 || calendarDay > 14) continue;
        
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
    console.log('[CRON] Weekly review starting...');
    try {
      const profiles = await db.getAllActiveProfiles();
      
      for (const profile of profiles) {
        const recentCheckins = await db.getRecentCheckins(profile.id, 7);
        const workoutCheckins = recentCheckins.filter(c => c.checkin_type === 'workout');
        
        const calendarDay = getCalendarProgramDay(profile.program_start_date);
        const weekNumber = calendarDay !== null ? Math.ceil(calendarDay / 7) : 1;
        
        const stats = {
          weekNumber: weekNumber,
          workoutsCompleted: workoutCheckins.filter(c => c.workout_completed).length,
          avgDifficulty: workoutCheckins.length > 0 
            ? workoutCheckins.reduce((s, c) => s + (c.difficulty_rating || 3), 0) / workoutCheckins.length 
            : 0,
          painZones: [...new Set(workoutCheckins.flatMap(c => c.pain_zones || []))],
          avgEnergy: workoutCheckins.length > 0
            ? workoutCheckins.map(c => c.energy_level).filter(Boolean).join(', ')
            : 'nelogată'
        };
        
        await sendWeeklyReview(profile, stats);
        await sleep(2000);
      }
      console.log('[CRON] Weekly reviews sent');
    } catch (error) {
      console.error('[CRON] Weekly review error:', error);
    }
  }, { timezone: 'Europe/Bucharest' });
  */

  // ============================================
  // Zilnic 09:30 — Auto-mark Program Complete (Z14 calendar)
  // ============================================
  // Detectează userii care au depășit Z14 calendar și marchează program_completed
  // automat. Asta declanșează post-program flow chiar dacă userul nu a bifat ultima zi.
  cron.schedule('30 9 * * *', async () => {
    console.log('[CRON] Auto-mark program complete starting...');
    try {
      const profiles = await db.getAllActiveProfiles();
      
      for (const profile of profiles) {
        // Skip cei deja marcați complete
        if (profile.program_completed) continue;
        
        // Skip dacă programul nu a început
        if (!profile.program_start_date) continue;
        
        const calendarDay = getCalendarProgramDay(profile.program_start_date);
        
        // Marchează complete dacă a depășit Z14 calendar
        if (calendarDay !== null && calendarDay >= 14) {
          // Calculez data Z14 (program_start_date + 13 zile)
          const startDate = new Date(profile.program_start_date + 'T00:00:00');
          const completedDate = new Date(startDate);
          completedDate.setDate(completedDate.getDate() + 13);
          
          await db.updateProfile(profile.id, {
            program_completed: true,
            program_completed_date: completedDate.toISOString()
          });
          
          console.log(`[CRON] Auto-marked program complete for user ${profile.id} (calendar day: ${calendarDay})`);
        }
      }
      console.log('[CRON] Auto-mark complete check finished');
    } catch (error) {
      console.error('[CRON] Auto-mark complete error:', error);
    }
  }, { timezone: 'Europe/Bucharest' });

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
        
        // Only send at specific milestones
        if ([1, 3, 7, 14, 30].includes(daysSince)) {
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
