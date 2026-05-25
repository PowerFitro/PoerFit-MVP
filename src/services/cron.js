import cron from 'node-cron';
import * as db from '../db/supabase.js';
import { sendMorningCheckin, sendEveningCheckin, sendAntiChurnMessage, sendPreProgramMessage } from '../bot/telegram.js';
import { getRomaniaDate, getUserPhase } from '../utils/helpers.js';

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
            // PRE-PROGRAM: mesaj de pregătire
            await sendPreProgramMessage(profile, startDate);
            await sleep(1000);
            continue;
          }
          
          // Programul a început — determinăm faza (sursa unică: getUserPhase).
          const phase = getUserPhase(profile);
          
          if (phase.phase === 'terminat' || phase.phase === 'expirat') {
            // Program terminat sau acces expirat — cronul nu trimite morning checkin.
            continue;
          }
          
          if (phase.phase === 'recuperare') {
            // FEREASTRA DE RECUPERARE (zilele 15-44): NU trimitem zilnic.
            // Doar 3 remindere, la zilele calendaristice 15, 30 și 40 (decizia 2b).
            // În restul zilelor userul poate bifa oricând prin /checkin, dar botul tace.
            if (phase.calendarDay === 15 || phase.calendarDay === 30 || phase.calendarDay === 40) {
              await sendMorningCheckin(profile);
              await sleep(1000);
            }
            continue;
          }
          
          // FAZA ACTIV (calendar 1-14): morning checkin normal.
          // sendMorningCheckin gestionează intern zilele de odihnă Z7/Z14.
          await sendMorningCheckin(profile);
          await sleep(1000);
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
          
          // Evening checkin se trimite DOAR în faza activ (calendar 1-14, zi de
          // antrenament). sendEveningCheckin verifică intern și faza, și ziua de
          // odihnă, și dacă userul a bifat deja — dar filtrăm aici ca să nu apelăm
          // funcția degeaba pentru useri în recuperare / terminat / expirat.
          const phase = getUserPhase(profile);
          if (phase.phase !== 'activ') continue;
          if (phase.isRestDay) continue;
          
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
          // Sursa unică de adevăr pentru starea userului.
          const phase = getUserPhase(profile);
          
          // Skip dacă programul nu a început
          if (phase.phase === 'pre_program') continue;
          
          // Skip zi de odihnă (Z7/Z14) — normal să nu fi bifat nimic azi
          if (phase.isRestDay) continue;
          
          // Skip fazele terminat și expirat:
          // - terminat: userul a făcut toate 12 antrenamentele, nu există "churn"
          // - expirat: accesul s-a închis, un mesaj "mai ai de recuperat" e incoerent
          if (phase.phase === 'terminat' || phase.phase === 'expirat') continue;
          
          // Anti-churn rulează pentru faza activ ȘI recuperare (calendar 15-44,
          // bifate < 12) — în recuperare îl încurajăm să termine cele 12 antrenamente.
          
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
