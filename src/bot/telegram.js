import TelegramBot from 'node-telegram-bot-api';
import * as db from '../db/supabase.js';
import * as ai from '../services/ai.js';
import { POINTS, processWorkoutCompletion, processStreakBonus, formatLevelUpMessage, formatStreakMessage, formatPointsSummary, LEVELS } from '../services/gamification.js';
import https from 'https';

let bot;

export function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  
  // ============================================
  // COMMAND: /start — Link Telegram to profile
  // ============================================
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const param = match[1]?.trim(); // Parameter from deep link (email encoded)
    
    try {
      // Check if already linked
      let profile = await db.getProfileByTelegramId(userId);
      
      if (profile) {
        await bot.sendMessage(chatId, 
          `Bine ai revenit, ${profile.full_name}! 💪\n\n${formatPointsSummary(profile)}\n\nScrie-mi oricând dacă ai întrebări despre antrenament sau nutriție. Poți trimite și o poză cu masa ta pentru feedback.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Try to link via email parameter from onboarding
      if (param) {
        const email = decodeURIComponent(param);
        profile = await db.getProfileByEmail(email);
        
        if (profile) {
          await db.updateProfile(profile.id, {
            telegram_user_id: userId,
            telegram_chat_id: chatId,
            telegram_username: msg.from.username || null
          });
          
          const welcome = await ai.generateWelcomeMessage(profile);
          await bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
          return;
        }
      }
      
      // No profile found
      await bot.sendMessage(chatId,
        `Salut! 👋\n\nSunt Asistentul PowerFit.\n\nPentru a te conecta, trebuie mai întâi să completezi profilul pe:\n🔗 start.powerfitro.com\n\nDupă ce completezi formularul, revino aici și scrie /start`
      );
    } catch (error) {
      console.error('Start command error:', error);
      await bot.sendMessage(chatId, 'A apărut o eroare. Te rog să încerci din nou.');
    }
  });

  // ============================================
  // COMMAND: /coach — Escalate to human coach
  // ============================================
  bot.onText(/\/coach/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const profile = await db.getProfileByTelegramId(msg.from.id);
      
      if (!profile) {
        await bot.sendMessage(chatId, 'Trebuie să te conectezi mai întâi. Scrie /start');
        return;
      }
      
      // Get recent conversation for context
      let context = '';
      try {
        const recentMessages = await db.getRecentConversation(profile.id, 5);
        context = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');
      } catch (e) {
        console.error('Error getting conversation:', e.message);
      }
      
      // Create escalation
      try {
        await db.createEscalation(profile.id, 'user_requested', context);
      } catch (e) {
        console.error('Error creating escalation:', e.message);
      }
      
      // Notify admin
      const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (adminChatId) {
        try {
          const level = LEVELS[profile.current_level] || LEVELS.rookie;
          await bot.sendMessage(adminChatId,
            '⚠️ ESCALADARE\n\n' +
            'Client: ' + profile.full_name + '\n' +
            'Email: ' + profile.email + '\n' +
            'Ziua: ' + profile.current_day + '/14\n' +
            'Chat ID: ' + chatId,
            {}
          );
        } catch (e) {
          console.error('Error notifying admin:', e.message);
        }
      }
      
      const coachName = getCoachName();
      await bot.sendMessage(chatId,
        'Am transmis mesajul tău! 📩\n\n' + coachName + ' va reveni către tine în cel mai scurt timp.\n\nÎntre timp, sunt aici dacă ai alte întrebări.'
      );
      
      try {
        await db.logNotification(profile.id, 'escalation_to_coach', 'telegram', 'User requested direct coach contact');
      } catch (e) {
        console.error('Error logging notification:', e.message);
      }
    } catch (error) {
      console.error('Coach command error:', error.message);
      await bot.sendMessage(chatId, 'A apărut o eroare. Te rog să încerci din nou.');
    }
  });

  // ============================================
  // COMMAND: /status — Current progress
  // ============================================
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const profile = await db.getProfileByTelegramId(msg.from.id);
    
    if (!profile) {
      await bot.sendMessage(chatId, 'Trebuie să te conectezi mai întâi. Scrie /start');
      return;
    }
    
    const stats = await db.getCheckinStats(profile.id);
    const level = LEVELS[profile.current_level] || LEVELS.rookie;
    const todayFoodLogs = await db.getTodayFoodLogs(profile.id);
    
    const progress = Math.round((profile.current_day / 14) * 100);
    const progressBar = generateProgressBar(progress);
    
    await bot.sendMessage(chatId,
      `📊 *Statusul tău PowerFit*\n\n` +
      `${progressBar} ${progress}%\n` +
      `📅 Ziua *${profile.current_day}* din 14\n\n` +
      `${level.emoji} Nivel: *${level.name}* (${profile.total_points} puncte)\n` +
      `🔥 Streak: *${profile.current_streak}* zile (record: ${profile.max_streak})\n` +
      `💪 Antrenamente completate: *${stats.totalWorkouts}*\n` +
      `🍽️ Mese logate azi: *${todayFoodLogs.length}*\n` +
      `📈 Dificultate medie: *${stats.avgDifficulty.toFixed(1)}*/5`,
      { parse_mode: 'Markdown' }
    );
  });

  // ============================================
  // COMMAND: /help — Available commands
  // ============================================
  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `*Asistent PowerFit*\n\n` +
      `💬 *Scrie orice întrebare* — Răspund instant despre antrenament, nutriție, exerciții\n\n` +
      `📸 *Trimite o poză cu mâncarea* — Analizez caloriile și macro-urile\n\n` +
      `/status — Vezi progresul tău\n` +
      `/checkin — Loghează antrenamentul de azi\n` +
      `/coach — Vorbește direct cu antrenorul\n` +
      `/help — Această listă de comenzi`,
      { parse_mode: 'Markdown' }
    );
  });

  // ============================================
  // COMMAND: /checkin — Manual workout check-in
  // ============================================
  bot.onText(/\/checkin/, async (msg) => {
    const chatId = msg.chat.id;
    const profile = await db.getProfileByTelegramId(msg.from.id);
    
    if (!profile) {
      await bot.sendMessage(chatId, 'Trebuie să te conectezi mai întâi. Scrie /start');
      return;
    }
    
    await bot.sendMessage(chatId, 
      `Ai terminat antrenamentul de azi? 💪`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Da, l-am terminat!', callback_data: 'workout_yes' },
              { text: '⏭️ Skip azi', callback_data: 'workout_skip' }
            ]
          ]
        }
      }
    );
  });

  // ============================================
  // CALLBACK QUERIES (inline buttons)
  // ============================================
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const profile = await db.getProfileByTelegramId(query.from.id);
    
    if (!profile) {
      await bot.answerCallbackQuery(query.id, { text: 'Scrie /start mai întâi' });
      return;
    }
    
    await bot.answerCallbackQuery(query.id);
    
    // --- WORKOUT COMPLETED ---
    if (data === 'workout_yes') {
      await bot.sendMessage(chatId,
        'Cum a fost antrenamentul?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '😎 Ușor', callback_data: 'difficulty_1' },
                { text: '👍 Potrivit', callback_data: 'difficulty_3' },
              ],
              [
                { text: '😤 Greu', callback_data: 'difficulty_4' },
                { text: '🥵 Foarte greu', callback_data: 'difficulty_5' },
              ]
            ]
          }
        }
      );
    }
    
    // --- WORKOUT SKIPPED ---
    if (data === 'workout_skip') {
      await bot.sendMessage(chatId,
        `Nicio problemă! Odihna e parte din proces. 🙌\n\nMâine revenim mai puternici. Dacă ai nevoie de un antrenament express mai scurt, scrie-mi!`
      );
    }
    
    // --- DIFFICULTY RATING ---
    if (data.startsWith('difficulty_')) {
      const rating = parseInt(data.split('_')[1]);
      const today = new Date().toISOString().split('T')[0];
      
      // Save check-in
      const newDay = (profile.current_day || 0) + 1;
      await db.saveCheckin({
        user_id: profile.id,
        checkin_type: 'workout',
        checkin_date: today,
        workout_completed: true,
        difficulty_rating: rating,
        energy_level: rating <= 2 ? 'high' : rating <= 3 ? 'ok' : 'low',
        program_day: newDay
      });
      
      // Update profile day
      const isCompleted = newDay >= 14;
      await db.updateProfile(profile.id, { 
        current_day: newDay,
        ...(isCompleted ? { program_completed: true, program_completed_date: new Date().toISOString() } : {})
      });
      
      // Process points
      const pointsResult = await processWorkoutCompletion(profile.id);
      
      // Update streak
      const updatedProfile = await db.getProfileByTelegramId(query.from.id);
      const newStreak = (updatedProfile.current_streak || 0) + 1;
      const maxStreak = Math.max(newStreak, updatedProfile.max_streak || 0);
      await db.updateProfile(profile.id, { current_streak: newStreak, max_streak: maxStreak });
      
      // Build response
      let response = `✅ *Antrenament Ziua ${newDay} completat!*\n\n`;
      response += `Dificultate: ${'⭐'.repeat(rating)}${'☆'.repeat(5 - rating)}\n`;
      response += `+${POINTS.WORKOUT_COMPLETE} puncte\n`;
      
      // Check for level up
      if (pointsResult?.leveledUp) {
        response += `\n${formatLevelUpMessage(pointsResult.previousLevel, pointsResult.newLevel, pointsResult.newTotal)}\n`;
      }
      
      // Streak message
      const streakMsg = formatStreakMessage(newStreak);
      if (streakMsg) {
        response += `\n${streakMsg}\n`;
        // Process streak bonus points
        await processStreakBonus(profile.id, newStreak);
      }
      
      response += `\n${formatPointsSummary({ ...updatedProfile, current_streak: newStreak, total_points: pointsResult?.newTotal || updatedProfile.total_points, current_level: pointsResult?.newLevel || updatedProfile.current_level })}`;
      
      // Program completed!
      if (isCompleted) {
        response += `\n\n🎉🎉🎉\n*FELICITĂRI! Ai terminat PowerFit!*\nÎn curând primești raportul complet al transformării tale.`;
      }
      
      // Ask about pain zones
      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
      
      // Follow-up: pain check
      setTimeout(async () => {
        await bot.sendMessage(chatId,
          'Ai simțit disconfort sau durere undeva?',
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Niciun disconfort', callback_data: 'pain_none' },
                ],
                [
                  { text: '🦵 Genunchi', callback_data: 'pain_knee' },
                  { text: '🔙 Spate', callback_data: 'pain_back' },
                ],
                [
                  { text: '💪 Umăr', callback_data: 'pain_shoulder' },
                  { text: '📍 Altundeva', callback_data: 'pain_other' },
                ]
              ]
            }
          }
        );
      }, 2000);
    }
    
    // --- PAIN ZONES ---
    if (data.startsWith('pain_')) {
      const zone = data.replace('pain_', '');
      const today = new Date().toISOString().split('T')[0];
      
      if (zone === 'none') {
        await bot.sendMessage(chatId, 'Excelent! Corp sănătos, progres constant. 💪');
      } else {
        // Update today's check-in with pain zone
        const painMap = { knee: 'genunchi', back: 'spate', shoulder: 'umăr', other: 'altă zonă' };
        const painName = painMap[zone] || zone;
        
        // Get AI recommendation for pain
        const recommendation = await ai.getChatResponse(
          `Am simțit disconfort la ${painName} în timpul antrenamentului de azi.`,
          [],
          await db.getProfileByTelegramId(query.from.id)
        );
        
        await bot.sendMessage(chatId, recommendation, { parse_mode: 'Markdown' });
      }
    }
    
    // --- MORNING CHECK-IN RESPONSES ---
    if (data === 'morning_ready') {
      const dayInfo = getDayInfo(profile.current_day + 1);
      await bot.sendMessage(chatId,
        `💪 Hai să facem treabă!\n\n📋 *Ziua ${profile.current_day + 1}:* ${dayInfo}\n\n🔗 Deschide lecția în PowerFit și urmează instrucțiunile.\n\nDupă antrenament, scrie /checkin sau apasă butonul de mai jos:`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Am terminat antrenamentul', callback_data: 'workout_yes' }
            ]]
          }
        }
      );
    }
    
    if (data === 'morning_question') {
      await bot.sendMessage(chatId, 'Scrie-mi întrebarea ta și răspund imediat! 💬');
    }
  });

  // ============================================
  // PHOTO MESSAGE — Food Log
  // ============================================
  // DISABLED: Food photo analysis
  /* bot.on('photo_disabled', async (msg) => {
    const chatId = msg.chat.id;
    const profile = await db.getProfileByTelegramId(msg.from.id);
    
    if (!profile) {
      await bot.sendMessage(chatId, 'Trebuie să te conectezi mai întâi. Scrie /start');
      return;
    }
    
    await bot.sendMessage(chatId, '🔍 Analizez masa ta...');
    
    try {
      // Get photo file
      const photo = msg.photo[msg.photo.length - 1]; // Highest resolution
      const file = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      
      // Download and convert to base64
      const base64 = await downloadAsBase64(fileUrl);
      
      // Analyze with Claude Vision
      const analysis = await ai.analyzeFoodPhoto(base64, profile);
      
      if (analysis) {
        // Save to food log
        const today = new Date().toISOString().split('T')[0];
        await db.saveFoodLog({
          user_id: profile.id,
          log_date: today,
          meal_type: 'other',
          description: analysis.description,
          estimated_calories: analysis.calories,
          protein_g: analysis.protein,
          fat_g: analysis.fat,
          carbs_g: analysis.carbs,
          ai_feedback: analysis.feedback,
          photo_file_id: photo.file_id
        });
        
        // Add points for food logging
        const pointsResult = await db.addPoints(profile.id, POINTS.FOOD_LOG_PHOTO, 'food_log');
        
        // Get today's totals
        const todayLogs = await db.getTodayFoodLogs(profile.id);
        const totalCals = todayLogs.reduce((sum, l) => sum + (l.estimated_calories || 0), 0);
        const totalProtein = todayLogs.reduce((sum, l) => sum + (l.protein_g || 0), 0);
        const target = profile.daily_calorie_target || 2000;
        
        await bot.sendMessage(chatId,
          `🍽️ *${analysis.description}*\n\n` +
          `🔸 Calorii: *${analysis.calories}* kcal\n` +
          `🔸 Proteine: *${analysis.protein}*g\n` +
          `🔸 Grăsimi: *${analysis.fat}*g\n` +
          `🔸 Carbohidrați: *${analysis.carbs}*g\n\n` +
          `${analysis.feedback}\n\n` +
          `📊 *Total azi:* ${totalCals}/${target} kcal | ${totalProtein.toFixed(0)}g proteine\n` +
          `🍽️ Mese logate: ${todayLogs.length}\n` +
          `+${POINTS.FOOD_LOG_PHOTO} puncte`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId, 'Nu am reușit să analizez poza. Încearcă cu o poză mai clară, de sus, cu toată masa vizibilă. 📸');
      }
    } catch (error) {
      console.error('Photo processing error:', error);
      await bot.sendMessage(chatId, 'A apărut o eroare la procesarea pozei. Încearcă din nou.');
    }
  }); */

  // ============================================
  // TEXT MESSAGE — Asistentul PowerFit Chat
  // ============================================
  bot.on('message', async (msg) => {
    // Skip commands, photos, and callback queries
    if (!msg.text || msg.text.startsWith('/') || msg.photo) return;
    
    const chatId = msg.chat.id;
    const profile = await db.getProfileByTelegramId(msg.from.id);
    
    if (!profile) {
      await bot.sendMessage(chatId, 'Trebuie să te conectezi mai întâi. Scrie /start');
      return;
    }
    
    // Check if user wants to talk to coach
    const coachKeywords = ['vreau antrenorul', 'vreau sa vorbesc cu', 'antrenor real', 'om real', 'persoana reala'];
    if (coachKeywords.some(kw => msg.text.toLowerCase().includes(kw))) {
      await bot.sendMessage(chatId,
        'Înțeleg că vrei să vorbești direct cu antrenorul. Scrie /coach și îl contactez imediat! 📩'
      );
      return;
    }
    
    try {
      // Save user message
      await db.saveMessage(profile.id, 'user', msg.text);
      
      // Get conversation history
      const history = await db.getRecentConversation(profile.id, 8);
      
      // Send typing indicator
      await bot.sendChatAction(chatId, 'typing');
      
      // Get AI response
      const response = await ai.getChatResponse(msg.text, history, profile);
      
      // Save AI response
      await db.saveMessage(profile.id, 'assistant', response);
      
      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Chat error:', error);
      await bot.sendMessage(chatId, 'Scuze, am o problemă momentan. Încearcă din nou sau scrie /coach pentru antrenor.');
    }
  });

  console.log('🤖 Telegram Bot initialized');
  return bot;
}

// ============================================
// SEND FUNCTIONS (used by cron jobs)
// ============================================

export async function sendMorningCheckin(profile) {
  if (!bot || !profile.telegram_chat_id) return;
  
  const dayNumber = (profile.current_day || 0) + 1;
  if (dayNumber > 14) return;
  
  const dayInfo = getDayInfo(dayNumber);
  const isRestDay = dayNumber === 7 || dayNumber === 14;
  const isCardioDay = dayNumber === 4 || dayNumber === 11;
  
  let message = '';
  
  if (isRestDay) {
    message = 'Buna dimineata, ' + profile.full_name + '!\n\n' +
      'Ziua ' + dayNumber + '/14 — Zi de odihna.\n\n' +
      'Corpul tau se recupereaza si creste azi. Respecta planul alimentar si odihneste-te. Maine revenim la treaba.';
  } else if (isCardioDay) {
    message = 'Buna dimineata, ' + profile.full_name + '!\n\n' +
      'Ziua ' + dayNumber + '/14 — ' + dayInfo + '\n\n' +
      'Daca simti oboseala acumulata dupa primele zile, ia o pauza completa azi. Programul se decaleaza cu o zi. Daca te simti bine, hai la cardio!';
  } else {
    message = 'Buna dimineata, ' + profile.full_name + '!\n\n' +
      'Ziua ' + dayNumber + '/14 — ' + dayInfo + '\n\n' +
      'Deschide lectia in PowerFit si urmeaza instructiunile. Dupa antrenament, apasa butonul de mai jos.';
  }
  
  const keyboard = isRestDay ? [] : [[
    { text: 'Am terminat antrenamentul', callback_data: 'workout_yes' }
  ]];
  
  await bot.sendMessage(profile.telegram_chat_id, message, 
    keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {}
  );
  
  await db.logNotification(profile.id, 'morning_checkin', 'telegram', 'Day ' + dayNumber + ' morning checkin');
}

export async function sendEveningCheckin(profile) {
  if (!bot || !profile.telegram_chat_id) return;
  
  // Check if already checked in today
  const today = new Date().toISOString().split('T')[0];
  const { data: todayCheckin } = await db.supabase
    .from('daily_checkins')
    .select('id')
    .eq('user_id', profile.id)
    .eq('checkin_type', 'workout')
    .eq('checkin_date', today)
    .limit(1);
  
  if (todayCheckin && todayCheckin.length > 0) return; // Already checked in
  
  await bot.sendMessage(profile.telegram_chat_id,
    `🌙 Ai terminat antrenamentul de azi?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Da, l-am terminat!', callback_data: 'workout_yes' },
            { text: '⏭️ Nu am apucat azi', callback_data: 'workout_skip' },
          ]
        ]
      }
    }
  );
  
  await db.logNotification(profile.id, 'evening_checkin', 'telegram', 'Evening checkin prompt');
}

export async function sendAntiChurnMessage(profile, riskLevel, daysSince) {
  if (!bot || !profile.telegram_chat_id) return;
  
  const message = await ai.generateAntiChurnMessage(profile, riskLevel, daysSince);
  await bot.sendMessage(profile.telegram_chat_id, message, { parse_mode: 'Markdown' });
  await db.logNotification(profile.id, 'anti_churn', 'telegram', `Risk: ${riskLevel}, days: ${daysSince}`);
  
  // If high risk, also notify admin
  if (riskLevel === 'high') {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId) {
      await bot.sendMessage(adminChatId,
        `🚨 *RISC RIDICAT ABANDON*\n\n` +
        `👤 ${profile.full_name} (@${profile.telegram_username || 'N/A'})\n` +
        `📅 Ziua ${profile.current_day}/14\n` +
        `⏰ Inactiv de ${daysSince} zile\n` +
        `🔥 Streak pierdut\n\n` +
        `Recomandare: contactează-l direct.`,
        { parse_mode: 'Markdown' }
      );
    }
  }
}

export async function sendWeeklyReview(profile, stats) {
  if (!bot || !profile.telegram_chat_id) return;
  
  const review = await ai.generateWeeklyReview(profile, stats);
  if (review) {
    await bot.sendMessage(profile.telegram_chat_id, review, { parse_mode: 'Markdown' });
    await db.logNotification(profile.id, 'weekly_review', 'telegram', 'Weekly review sent');
  }
}

export async function sendPostProgramMessage(profile, daysSinceCompletion) {
  if (!bot || !profile.telegram_chat_id) return;
  
  let message;
  
  switch(daysSinceCompletion) {
    case 1:
      const stats = await db.getCheckinStats(profile.id);
      message = `🎉 *Raportul tău PowerFit*\n\n` +
        `📅 Program: 14 zile\n` +
        `💪 Antrenamente completate: *${stats.totalWorkouts}*\n` +
        `🔥 Streak maxim: *${profile.max_streak}* zile\n` +
        `${formatPointsSummary(profile)}\n` +
        `📈 Dificultate medie: *${stats.avgDifficulty.toFixed(1)}*/5\n\n` +
        `Ai demonstrat că poți. Asta nu e un final — e un început. 💪`;
      break;
    case 3:
      message = `Hei ${profile.full_name}! 💬\n\n` +
        `Când ai început PowerFit, ai spus că obiectivul tău e *${profile.goal === 'fat_loss' ? 'pierderea de grăsime' : profile.goal === 'toning' ? 'tonifierea' : 'creșterea masei musculare'}*.\n\n` +
        `Cum te simți acum față de atunci?\n\n` +
        `Trimite-mi 2-3 propoziții sau un voice note — vreau să știu experiența ta reală. Feedback-ul tău contează enorm! 🙏`;
      break;
    case 7:
      message = `Hei ${profile.full_name}! O săptămână de la finalizarea PowerFit. 💪\n\n` +
        `Ce faci de aici? 3 opțiuni:\n\n` +
        `1️⃣ *Repetă PowerFit* cu intensitate crescută\n` +
        `2️⃣ *Program avansat* de 30 zile (scrie-mi pentru detalii)\n` +
        `3️⃣ *Coaching 1:1* cu antrenorul (scrie /coach)\n\n` +
        `Ce te interesează?`;
      break;
    case 14:
      message = `${profile.full_name}, au trecut 2 săptămâni de la finalizare.\n\n` +
        `Ai menținut obiceiurile? Scrie-mi cum merge și cum te pot ajuta în continuare. 💬`;
      break;
    case 30:
      message = `${profile.full_name}, o lună de la PowerFit! 🗓️\n\n` +
        `Sper că obiceiurile construite în cele 14 zile au rămas. Dacă vrei să continui cu un program avansat sau coaching personalizat, sunt aici.\n\n` +
        `Mult succes în continuare! 💪🔥`;
      break;
    default:
      return;
  }
  
  await bot.sendMessage(profile.telegram_chat_id, message, { parse_mode: 'Markdown' });
  await db.logNotification(profile.id, 'post_program', 'telegram', `Day ${daysSinceCompletion} post-program`);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getDayInfo(dayNumber) {
  const schedule = {
    1: 'Picioare, Piept si Abdomen',
    2: 'Spate, Umeri, Abdomen si Lombari',
    3: 'Brate, Picioare si Gambe',
    4: 'Cardio HIIT (sau zi de pauza daca esti obosit)',
    5: 'Exercitii fundamentale + Grup muscular deficitar',
    6: 'Volum total (Tractiuni 50 + Dips 80 + Squat 100)',
    7: 'Zi de odihna',
    8: 'Picioare (baza), Brate, Abdomen',
    9: 'Spate, Piept',
    10: 'Umeri, Picioare, Gambe si Abdomen',
    11: 'Cardio intervale',
    12: 'Exercitii fundamentale + Grup muscular deficitar',
    13: 'Volum total (Tractiuni 60 + Dips 80 + Squat 100)',
    14: 'Zi de odihna - PROGRAMUL S-A INCHEIAT!',
  };
  return schedule[dayNumber] || 'Antrenament';
}

function generateProgressBar(percentage) {
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}



// ============================================
// PRE-PROGRAM MESSAGE — Preparation phase
// ============================================
export async function sendPreProgramMessage(profile, startDate) {
  if (!profile.telegram_chat_id || !bot) return;
  
  const today = new Date();
  const start = new Date(startDate + 'T00:00:00');
  const daysUntilStart = Math.ceil((start - today) / (1000 * 60 * 60 * 24));
  
  let message = '';
  
  if (daysUntilStart > 5) {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F4AA}\n\nProgramul tau de antrenament incepe luni. Pana atunci, ai cateva lucruri importante de parcurs:\n\n' +
      '\u{1F4DA} Parcurge sectiunea "Informatii utile" - acolo gasesti strategia completa de alimentatie\n' +
      '\u{1F9EE} Calculeaza-ti macronutrientii - foloseste calculatorul din curs sau scrie-mi aici sexul, greutatea si procentul de grasime\n' +
      '\u{1F4F1} Descarca o aplicatie de tracking nutritional\n\nAcesti pasi sunt esentiali inainte de prima zi de antrenament.';
  } else if (daysUntilStart > 3) {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F4AA}\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile pana la startul programului.\n\n' +
      'Ai calculat macronutrientii? Daca nu, scrie-mi aici datele tale si te ajut instant.\n' +
      'Fa antrenamentul pregatitor azi - te va ajuta sa intri in ritm luni.\n' +
      'Verifica lista de cumparaturi din sectiunea Alimentatie.';
  } else if (daysUntilStart >= 2) {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F4AA}\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile! Fa antrenamentul pregatitor daca nu l-ai facut inca.\n\n' +
      'Verifica ca ai totul pregatit:\n' +
      '- Macronutrientii calculati\n' +
      '- Ingredientele cumparate\n' +
      '- Aplicatia de tracking instalata\n\nLuni incepem la intensitate maxima!';
  } else if (daysUntilStart === 1) {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F525}\n\n' +
      'Maine incepe programul! Ziua 1: antrenament complet + plan alimentar.\n\n' +
      'Diseara se deblocheaza Saptamana 1.\n' +
      'Maine dimineata la 8:00 primesti primul reminder cu antrenamentul zilei.\n\n' +
      'Esti pregatit? \u{1F4AA}';
  } else {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F525}\n\n' +
      'Programul tau incepe luni. Parcurge materialele din curs si pregateste-te!\n\n' +
      'Scrie-mi daca ai intrebari.';
  }
  
  try {
    await bot.sendMessage(profile.telegram_chat_id, message);
    await db.logNotification(profile.id, 'morning_checkin', 'telegram', 'Pre-program preparation message');
  } catch (error) {
    console.error('Pre-program message error:', error.message);
  }
}

function getCoachName() {
  return process.env.COACH_NAME || 'Antrenorul';
}

function downloadAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('base64'));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

export { bot };
