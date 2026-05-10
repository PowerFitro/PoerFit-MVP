import { createClient } from '@supabase/supabase-js';
import { getRomaniaDate } from '../utils/helpers.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// USER PROFILES
// ============================================

export async function createProfile(data) {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return profile;
}

export async function getProfileByTelegramId(telegramUserId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
  return data;
}

export async function getProfileByEmail(email) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
// ============================================
// PENDING WORKOUT DAY — sursa de adevăr la bifare
// ============================================

// Setează ziua (1-14) pe care userul urmează să o bifeze.
// Apelată în 4 puncte din telegram.js: la trimiterea oricărui buton de bifare
// (sendMorningCheckin recovery + normal, morning_ready callback, /checkin manual).
// Citită în handler-ul difficulty_* ca singura sursă de adevăr pentru program_day.
// Reset la NULL se face ATOMIC în updateProfile (același round-trip cu current_day).
export async function setPendingWorkoutDay(userId, day) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ pending_workout_day: day })
    .eq('id', userId);
  
  if (error) {
    console.error('setPendingWorkoutDay error pentru user', userId, ':', error);
    return false;
  }
  return true;
}


export async function getAllActiveProfiles() {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('onboarding_completed', true)
    .eq('program_completed', false)
    .not('telegram_chat_id', 'is', null);
  if (error) throw error;
  return data || [];
}

export async function getCompletedProfiles() {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('program_completed', true)
    .not('telegram_chat_id', 'is', null);
  if (error) throw error;
  return data || [];
}

// ============================================
// DAILY CHECK-INS
// ============================================

export async function saveCheckin(checkinData) {
  const { data, error } = await supabase
    .from('daily_checkins')
    .upsert(checkinData, { onConflict: 'user_id,checkin_type,checkin_date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getRecentCheckins(userId, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const { data, error } = await supabase
    .from('daily_checkins')
    .select('*')
    .eq('user_id', userId)
    .gte('checkin_date', since.toISOString().split('T')[0])
    .order('checkin_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLastCheckin(userId, type = 'workout') {
  const { data, error } = await supabase
    .from('daily_checkins')
    .select('*')
    .eq('user_id', userId)
    .eq('checkin_type', type)
    .order('checkin_date', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// Verifică dacă există deja un workout bifat azi pentru user.
// Folosit la anti-cheat (Bug E) — previne incrementare multiplă.
export async function getTodayWorkoutCheckin(userId) {
  const today = getRomaniaDate();
  const { data, error } = await supabase
    .from('daily_checkins')
    .select('*')
    .eq('user_id', userId)
    .eq('checkin_type', 'workout')
    .eq('checkin_date', today)
    .eq('workout_completed', true)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getCheckinStats(userId) {
  const { data, error } = await supabase
    .from('daily_checkins')
    .select('*')
    .eq('user_id', userId)
    .eq('checkin_type', 'workout')
    .eq('workout_completed', true)
    .order('checkin_date', { ascending: true });
  if (error) throw error;
  
  const workouts = data || [];
  const totalWorkouts = workouts.length;
  const avgDifficulty = workouts.length > 0
    ? workouts.reduce((sum, w) => sum + (w.difficulty_rating || 3), 0) / workouts.length
    : 0;
  
  return { totalWorkouts, avgDifficulty, workouts };
}

// ============================================
// FOOD LOGS
// ============================================

export async function saveFoodLog(logData) {
  const { data, error } = await supabase
    .from('food_logs')
    .insert(logData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTodayFoodLogs(userId) {
  const today = getRomaniaDate();
  const { data, error } = await supabase
    .from('food_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('log_date', today);
  if (error) throw error;
  return data || [];
}

// ============================================
// CONVERSATIONS
// ============================================

export async function saveMessage(userId, role, content, meta = {}) {
  const { error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, role, content, ...meta });
  if (error) throw error;
}

export async function getRecentConversation(userId, limit = 10) {
  const { data, error } = await supabase
    .from('conversations')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse();
}

// ============================================
// CONTEXT SUMMARY (Memory Layer)
// ============================================

export async function updateContextSummary(userId, summary) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ 
      context_summary: summary, 
      summary_updated_at: new Date().toISOString() 
    })
    .eq('id', userId);
  if (error) throw error;
}

// Numără mesajele utilizator (role='user') de la ultima rezumare.
// Returnează numărul total dacă summary nu a fost generat niciodată.
export async function countMessagesSinceLastSummary(userId) {
  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('summary_updated_at')
    .eq('id', userId)
    .single();
  if (profileErr) throw profileErr;
  
  let query = supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user');
  
  // Dacă există summary anterior, numărăm doar mesajele DUPĂ acel timestamp
  if (profile?.summary_updated_at) {
    query = query.gt('created_at', profile.summary_updated_at);
  }
  
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}
// ============================================
// NOTIFICATIONS
// ============================================

export async function logNotification(userId, type, channel, content) {
  const { error } = await supabase
    .from('notifications_log')
    .insert({ user_id: userId, notification_type: type, channel, content });
  if (error) console.error('Notification log error:', error);
}

export async function wasNotificationSentToday(userId, type) {
  const today = getRomaniaDate();
  const { data, error } = await supabase
    .from('notifications_log')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_type', type)
    .gte('created_at', today + 'T00:00:00')
    .limit(1);
  if (error) return false;
  return data && data.length > 0;
}

// Verifică dacă a fost trimisă o notificare în ultimele N ore (cooldown configurabil).
// Folosit la anti-churn pentru cooldown 48h global (evită mesaje repetate în zile consecutive).
export async function wasNotificationSentInLastHours(userId, type, hours) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('notifications_log')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_type', type)
    .gte('created_at', cutoff)
    .limit(1);
  if (error) return false;
  return data && data.length > 0;
}

// Returnează timestamp-ul ultimei notificări trimise userului de un anumit tip.
// Folosit la anti-cheat (Bug E) — verifică timpul scurs de la morning checkin la bifare.
export async function getLastNotificationTime(userId, type) {
  const { data, error } = await supabase
    .from('notifications_log')
    .select('created_at')
    .eq('user_id', userId)
    .eq('notification_type', type)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') return null;
  return data ? data.created_at : null;
}

// ============================================
// ESCALATIONS
// ============================================

export async function createEscalation(userId, reason, context) {
  const { data, error } = await supabase
    .from('coach_escalations')
    .insert({ user_id: userId, reason, context })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPendingEscalations() {
  const { data, error } = await supabase
    .from('coach_escalations')
    .select('*, user_profiles(full_name, email, current_day, goal)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export { supabase };
