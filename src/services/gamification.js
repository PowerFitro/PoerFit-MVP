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
  rookie:   { min: 0,   emoji: 'medal', name: 'Rookie',   nameRo: 'Incepator' },
  fighter:  { min: 50,  emoji: 'glove', name: 'Fighter',  nameRo: 'Luptator' },
  warrior:  { min: 150, emoji: 'sword', name: 'Warrior',  nameRo: 'Razboinic' },
  champion: { min: 300, emoji: 'cup',   name: 'Champion', nameRo: 'Campion' },
  legend:   { min: 450, emoji: 'crown', name: 'Legend',   nameRo: 'Legenda' },
};

// ============================================
// PROCESS WORKOUT COMPLETION
// ============================================
export async function processWorkoutCompletion(userId) {
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
    bonuses.push({ points: POINTS.STREAK_14, reason: 'Program complet 14 zile' });
  }

  return bonuses;
}

// ============================================
// FORMAT MESSAGES (legacy)
// ============================================
export function formatLevelUpMessage(previousLevel, newLevel, totalPoints) {
  const prev = LEVELS[previousLevel] || LEVELS.rookie;
  const next = LEVELS[newLevel] || LEVELS.rookie;
  return 'LEVEL UP! ' + prev.name + ' -> ' + next.name + '. Ai ' + totalPoints + ' puncte.';
}

export function formatStreakMessage(streak) {
  if (streak === 3) return '3 zile consecutive! +' + POINTS.STREAK_3 + ' puncte bonus.';
  if (streak === 7) return '7 zile consecutive! +' + POINTS.STREAK_7 + ' puncte bonus.';
  if (streak === 14) return '14 zile consecutive! Program complet. +' + POINTS.STREAK_14 + ' puncte bonus.';
  if (streak >= 5) return streak + ' zile consecutive.';
  return null;
}

export function formatPointsSummary(profile) {
  const level = LEVELS[profile.current_level] || LEVELS.rookie;
  return level.name + ' - ' + profile.total_points + ' puncte | Streak: ' + profile.current_streak + ' zile';
}
