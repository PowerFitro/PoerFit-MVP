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
  const result = await addPoints(userId, POINTS.WORKOUT_COMPLETE, 'workout_complete');
  
  // Check streak bonuses
  const streakBonuses = [];
  if (result) {
    const profile = result; // addPoints returns updated data
    // Streak bonuses are checked separately after streak update
  }
  
  return result;
}

// ============================================
// PROCESS STREAK & BONUSES
// ============================================

export async function processStreakBonus(userId, currentStreak) {
  const bonuses = [];
  
  if (currentStreak === 3) {
    const r = await addPoints(userId, POINTS.STREAK_3, 'streak_3');
    bonuses.push({ points: POINTS.STREAK_3, reason: '3 zile consecutive!' });
  }
  if (currentStreak === 7) {
    const r = await addPoints(userId, POINTS.STREAK_7, 'streak_7');
    bonuses.push({ points: POINTS.STREAK_7, reason: '7 zile consecutive!' });
  }
  if (currentStreak === 14) {
    const r = await addPoints(userId, POINTS.STREAK_14, 'streak_14');
    bonuses.push({ points: POINTS.STREAK_14, reason: 'Program complet — 14 zile!' });
  }
  
  return bonuses;
}

// ============================================
// FORMAT LEVEL-UP MESSAGE
// ============================================

export function formatLevelUpMessage(previousLevel, newLevel, totalPoints) {
  const prev = LEVELS[previousLevel];
  const next = LEVELS[newLevel];
  
  return `🏆 *LEVEL UP!*\n\n${prev.emoji} ${prev.name} → ${next.emoji} *${next.name}*\n\nAi acumulat *${totalPoints} puncte*.\nContinuă așa! 💪`;
}

export function formatStreakMessage(streak) {
  if (streak === 3) return `🔥 *3 zile consecutive!* +${POINTS.STREAK_3} puncte bonus!`;
  if (streak === 7) return `🔥🔥 *7 zile consecutive!* O săptămână completă! +${POINTS.STREAK_7} puncte bonus!`;
  if (streak === 14) return `🔥🔥🔥 *14 zile consecutive!* Ai terminat programul fără nicio pauză! +${POINTS.STREAK_14} puncte bonus! Ești o mașină!`;
  if (streak >= 5) return `🔥 *${streak} zile consecutive!* Consistency bate intensity!`;
  return null;
}

export function formatPointsSummary(profile) {
  const level = LEVELS[profile.current_level] || LEVELS.rookie;
  return `${level.emoji} *${level.name}* — ${profile.total_points} puncte | 🔥 Streak: ${profile.current_streak} zile`;
}
