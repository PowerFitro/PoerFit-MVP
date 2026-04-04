import * as db from '../db/supabase.js';

export async function registerRoutes(app) {
  
  // ============================================
  // CORS preflight
  // ============================================
  
  // ============================================
  // POST /api/onboarding — Save profile from onboarding form
  // ============================================
  app.post('/api/onboarding', async (request, reply) => {
    try {
      const data = request.body;
      
      // Validate required fields
      if (!data.email || !data.full_name) {
        return reply.status(400).send({ error: 'Email și nume sunt obligatorii' });
      }
      
      // Check if profile already exists
      const existing = await db.getProfileByEmail(data.email);
      if (existing) {
        // Update existing profile
        const updated = await db.updateProfile(existing.id, {
          ...data,
          onboarding_completed: true,
          program_start_date: new Date().toISOString().split('T')[0],
          program_type: data.equipment === 'gym' ? 'gym_week1' : 'outdoor_week1'
        });
        return reply.send({ success: true, profile: updated, isUpdate: true });
      }
      
      // Calculate daily calorie target (simplified Mifflin-St Jeor)
      const calorieTarget = calculateCalorieTarget(data);
      
      // Create new profile
      const profile = await db.createProfile({
        email: data.email,
        full_name: data.full_name,
        sex: data.sex,
        age: data.age,
        weight_kg: data.weight_kg,
        height_cm: data.height_cm,
        target_weight_kg: data.target_weight_kg,
        experience_level: data.experience_level,
        equipment: data.equipment,
        goal: data.goal,
        available_days: data.available_days || 6,
        dietary_restrictions: data.dietary_restrictions || [],
        daily_calorie_target: calorieTarget,
        sleep_hours: data.sleep_hours,
        stress_level: data.stress_level,
        onboarding_completed: true,
        program_start_date: new Date().toISOString().split('T')[0],
        program_type: data.equipment === 'gym' ? 'gym_week1' : 'outdoor_week1'
      });
      
      // Generate Telegram deep link
      const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'PowerFitCoachBot';
      const telegramLink = `https://t.me/${botUsername}?start=${encodeURIComponent(data.email)}`;
      
      return reply.send({ 
        success: true, 
        profile,
        telegramLink,
        calorieTarget,
        recommendedProgram: data.equipment === 'gym' ? 'Antrenament la sală' : 'Antrenament în aer liber'
      });
    } catch (error) {
      console.error('Onboarding error:', error);
      return reply.status(500).send({ error: 'Eroare la salvarea profilului' });
    }
  });

  // ============================================
  // GET /api/dashboard/:email — Dashboard data
  // ============================================
  app.get('/api/dashboard/:email', async (request, reply) => {
    try {
      const { email } = request.params;
      const profile = await db.getProfileByEmail(decodeURIComponent(email));
      
      if (!profile) {
        return reply.status(404).send({ error: 'Profil negăsit' });
      }
      
      const stats = await db.getCheckinStats(profile.id);
      const recentCheckins = await db.getRecentCheckins(profile.id, 14);
      const todayFoodLogs = await db.getTodayFoodLogs(profile.id);
      
      // Calculate level info
      const levelInfo = {
        rookie:   { min: 0,   emoji: '🥉', name: 'Rookie' },
        fighter:  { min: 50,  emoji: '🥊', name: 'Fighter' },
        warrior:  { min: 150, emoji: '⚔️', name: 'Warrior' },
        champion: { min: 300, emoji: '🏆', name: 'Champion' },
        legend:   { min: 450, emoji: '👑', name: 'Legend' },
      };
      
      const currentLevelInfo = levelInfo[profile.current_level] || levelInfo.rookie;
      const nextLevel = Object.entries(levelInfo).find(([_, v]) => v.min > profile.total_points);
      const pointsToNextLevel = nextLevel ? nextLevel[1].min - profile.total_points : 0;
      
      return reply.send({
        profile: {
          name: profile.full_name,
          currentDay: profile.current_day,
          totalDays: 14,
          progressPercent: Math.round((profile.current_day / 14) * 100),
          streak: profile.current_streak,
          maxStreak: profile.max_streak,
          points: profile.total_points,
          level: currentLevelInfo,
          pointsToNextLevel,
          goal: profile.goal,
          programType: profile.program_type,
          programCompleted: profile.program_completed,
        },
        stats: {
          totalWorkouts: stats.totalWorkouts,
          avgDifficulty: stats.avgDifficulty,
          mealsLoggedToday: todayFoodLogs.length,
          workoutDays: recentCheckins
            .filter(c => c.checkin_type === 'workout' && c.workout_completed)
            .map(c => c.checkin_date),
        }
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      return reply.status(500).send({ error: 'Eroare la încărcarea dashboard-ului' });
    }
  });

  // ============================================
  // GET /api/health — Health check
  // ============================================
  app.get('/api/health', async (request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  console.log('📡 API routes registered');
}

// ============================================
// CALORIE CALCULATOR (Mifflin-St Jeor simplified)
// ============================================

function calculateCalorieTarget(data) {
  const { sex, weight_kg } = data;
  if (!weight_kg) return 1600;

  if (sex === 'male') {
    if (weight_kg > 100) return 2000;
    if (weight_kg >= 80) return 1750;
    return 1650;
  } else {
    if (weight_kg > 85) return 1600;
    if (weight_kg >= 65) return 1450;
    return 1300;
  }
}
