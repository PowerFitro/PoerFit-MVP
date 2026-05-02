import cron from 'node-cron';
import * as db from '../db/supabase.js';
import { sendMorningCheckin, sendEveningCheckin, sendAntiChurnMessage, sendWeeklyReview, sendPostProgramMessage, sendPreProgramMessage } from '../bot/telegram.js';
import { getRomaniaDate } from '../utils/helpers.js';

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
          // IN-PROGRAM: send regular training check-in
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
  // Duminică 19:00 — Weekly Review
  // ============================================
  cron.schedule('0 19 * * 0', async () => {
    console.log('[CRON] Weekly review starting...');
    try {
      const profiles = await db.getAllActiveProfiles();
      
      for (const profile of profiles) {
        const recentCheckins = await db.getRecentCheckins(profile.id, 7);
        const workoutCheckins = recentCheckins.filter(c => c.checkin_type === 'workout');
        const todayFoodLogs = await db.getTodayFoodLogs(profile.id);
        
        const stats = {
          weekNumber: Math.ceil((profile.current_day || 1) / 7),
          workoutsCompleted: workoutCheckins.filter(c => c.workout_completed).length,
          avgDifficulty: workoutCheckins.length > 0 
            ? workoutCheckins.reduce((s, c) => s + (c.difficulty_rating || 3), 0) / workoutCheckins.length 
            : 0,
          mealsLogged: todayFoodLogs.length,
          painZones: [...new Set(workoutCheckins.flatMap(c => c.pain_zones || []))],
          avgEnergy: workoutCheckins.length > 0
            ? workoutCheckins.map(c => c.energy_level).filter(Boolean).join(', ')
            : 'nelogată'
        };
        
        await sendWeeklyReview(profile, stats);
        await sleep(2000); // More delay for AI-generated content
      }
      console.log('[CRON] Weekly reviews sent');
    } catch (error) {
      console.error('[CRON] Weekly review error:', error);
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
