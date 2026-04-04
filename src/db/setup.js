// ============================================
// PowerFit MVP - Database Schema Setup
// ============================================
// Rulează acest SQL în Supabase Dashboard → SQL Editor
// SAU rulează: node src/db/setup.js

const SCHEMA_SQL = `

-- ============================================
-- 1. PROFILURI UTILIZATORI (din onboarding)
-- ============================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Identifiers
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  telegram_user_id BIGINT UNIQUE,
  telegram_chat_id BIGINT,
  telegram_username TEXT,
  
  -- Date fizice
  sex TEXT CHECK (sex IN ('male', 'female')),
  age INTEGER,
  weight_kg DECIMAL(5,1),
  height_cm INTEGER,
  target_weight_kg DECIMAL(5,1),
  
  -- Preferințe program
  experience_level TEXT CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
  equipment TEXT CHECK (equipment IN ('gym', 'home', 'outdoor')),
  goal TEXT CHECK (goal IN ('fat_loss', 'toning', 'muscle_gain')),
  available_days INTEGER DEFAULT 6,
  
  -- Nutriție
  dietary_restrictions TEXT[], -- ['lactose_free', 'gluten_free', 'vegetarian']
  daily_calorie_target INTEGER,
  
  -- Lifestyle
  sleep_hours DECIMAL(3,1),
  stress_level INTEGER CHECK (stress_level BETWEEN 1 AND 5),
  
  -- Status program
  program_type TEXT CHECK (program_type IN ('gym_week1', 'gym_week2', 'outdoor_week1', 'outdoor_week2')),
  program_start_date DATE,
  current_day INTEGER DEFAULT 0,
  program_completed BOOLEAN DEFAULT FALSE,
  program_completed_date TIMESTAMP,
  
  -- Gamification
  total_points INTEGER DEFAULT 0,
  current_level TEXT DEFAULT 'rookie',
  current_streak INTEGER DEFAULT 0,
  max_streak INTEGER DEFAULT 0,
  
  -- Meta
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. CHECK-IN-URI ZILNICE
-- ============================================
CREATE TABLE IF NOT EXISTS daily_checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  -- Ce tip de check-in
  checkin_type TEXT CHECK (checkin_type IN ('workout', 'nutrition', 'weight')),
  checkin_date DATE NOT NULL,
  
  -- Workout check-in
  workout_completed BOOLEAN,
  difficulty_rating INTEGER CHECK (difficulty_rating BETWEEN 1 AND 5),
  pain_zones TEXT[], -- ['knee', 'back', 'shoulder']
  energy_level TEXT CHECK (energy_level IN ('high', 'ok', 'low')),
  program_day INTEGER, -- Ziua 1-14
  
  -- Nutrition check-in
  meals_logged INTEGER DEFAULT 0,
  
  -- Weight check-in
  weight_kg DECIMAL(5,1),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Un singur check-in per tip per zi
  UNIQUE(user_id, checkin_type, checkin_date)
);

-- ============================================
-- 3. FOOD LOGS (analiză foto AI)
-- ============================================
CREATE TABLE IF NOT EXISTS food_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  log_date DATE NOT NULL,
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'snack1', 'lunch', 'snack2', 'dinner', 'other')),
  
  -- AI analysis results
  description TEXT,
  estimated_calories INTEGER,
  protein_g DECIMAL(5,1),
  fat_g DECIMAL(5,1),
  carbs_g DECIMAL(5,1),
  ai_feedback TEXT,
  
  -- Photo (optional - store Telegram file_id)
  photo_file_id TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 4. CONVERSAȚII AI (istoric chat)
-- ============================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  role TEXT CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  
  -- Metadata
  tokens_used INTEGER,
  model_used TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. LOG NOTIFICĂRI (tracking mesaje trimise)
-- ============================================
CREATE TABLE IF NOT EXISTS notifications_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  notification_type TEXT NOT NULL,
  -- Types: morning_checkin, evening_checkin, streak_milestone, 
  --        level_up, anti_churn, weekly_review, post_program,
  --        escalation_to_coach
  
  channel TEXT CHECK (channel IN ('telegram', 'email')),
  content TEXT,
  delivered BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 6. ESCALADĂRI LA ANTRENOR
-- ============================================
CREATE TABLE IF NOT EXISTS coach_escalations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  reason TEXT, -- 'user_requested', 'anti_churn_high_risk', 'pain_reported'
  context TEXT, -- Ultimele mesaje + context profil
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'responded', 'resolved')),
  
  coach_response TEXT,
  responded_at TIMESTAMP,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON daily_checkins(user_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON daily_checkins(checkin_date);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_telegram ON user_profiles(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON coach_escalations(status);

-- ============================================
-- FUNCTION: Update updated_at automatisch
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_user_profiles
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

`;

console.log('=== PowerFit MVP - Database Schema ===');
console.log('');
console.log('Copiază SQL-ul de mai jos în Supabase Dashboard → SQL Editor → Run:');
console.log('');
console.log(SCHEMA_SQL);
console.log('');
console.log('=== Done ===');

export { SCHEMA_SQL };
