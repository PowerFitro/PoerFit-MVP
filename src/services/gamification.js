import { addPoints, updateStreak } from '../db/supabase.js';

// ============================================
// POINTS CONFIGURATION
// ============================================
export const POINTS = {
  WORKOUT_COMPLETE: 15,
  NUTRITION_CHECKIN: 10,
  FOOD_LOG_PHOTO: 5,
  STREAK_3: 20,
  STREAK_7: 50,
  STREAK_14: 100,
};

export const LEVELS = {
  rookie:   { min: 0,   emoji: '🥉', name: 'Rookie',   nameRo: 'Începător' },
  fighter:  { min: 50,  emoji: '🥊', name: 'Fighter',  nameRo: 'Luptător' },
  warrior:  { min: 150, emoji: '⚔️', name: 'Warrior',  nameRo: 'Războinic' },
  champion: { min: 300, emoji: '🏆', name: 'Champion', nameRo: 'Campion' },
  legend:   { min: 450, emoji: '👑', name: 'Legend',   nameRo: 'Legendă' },
};

// ============================================
// PROCESS WORKOUT COMPLETION
// ============================================
export async function processWorkoutCompletion(userId) {
  // Adaugă punctele de bază pentru workout completat.
  // Bonusurile de streak se adaugă separat din processStreakBonus,
  // după ce streak-ul e calculat în telegram.js.
  return await addPoints(userId, POINTS.WORKOUT_COMPLETE, 'workout_complete');
}

// ============================================
// PROCESS STREAK & BONUSES
// ============================================
export async function processStreakBonus(userId, currentStreak) {
  const bonuses = [];
  
  if (currentStreak === 3) {
    await addPoints(userId, POINTS.STREAK_3, 'streak_3');
    bonuses.push({ points: POINTS.STREAK_3, reason: '3 zile consecutive' });
  }
  if (currentStreak === 7) {
    await addPoints(userId, POINTS.STREAK_7, 'streak_7');
    bonuses.push({ points: POINTS.STREAK_7, reason: '7 zile consecutive' });
  }
  if (currentStreak === 14) {
    await addPoints(userId, POINTS.STREAK_14, 'streak_14');
    bonuses.push({ points: POINTS.STREAK_14, reason: 'Program complet — 14 zile' });
  }
  
  return bonuses;
}

// ============================================
// FORMAT MESSAGES (legacy — păstrate pentru tracking intern)
// ============================================
// IMPORTANT: aceste funcții NU mai sunt apelate în mesaje user-facing
// după decizia "gamification invizibilă" (Commit 2).
// Sunt păstrate ca foundation dacă reactivăm dashboard-ul gamificat.
// Paste-urile rupte din versiunea anterioară au f
