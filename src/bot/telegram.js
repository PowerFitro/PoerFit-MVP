import TelegramBot from 'node-telegram-bot-api';
import * as db from '../db/supabase.js';
import * as ai from '../services/ai.js';
import { processWorkoutCompletion, processStreakBonus } from '../services/gamification.js';
import { getCalendarProgramDay, getRomaniaDate } from '../utils/helpers.js';
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
    
    console.log('[START] Received /start from userId:', userId, 'param:', JSON.stringify(param));
    
    try {
      // Check if already linked
      let profile = await db.getProfileByTelegramId(userId);
      console.log('[START] Existing profile:', profile ? profile.email : 'none');
      
      if (profile) {
        await bot.sendMessage(chatId, 
          `Bine ai revenit, ${profile.full_name}!\n\nEști la Ziua ${profile.current_day}/14 din program.\n\nScrie-mi oricând dacă ai întrebări despre antrenament sau nutriție.`
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
          await bot.sendMessage(adminChatId,
            'ESCALADARE\n\n' +
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
    const bifate = profile.current_day || 0;
    const ramase = Math.max(0, 14 - bifate);
    const avgDiff = stats.avgDifficulty ? stats.avgDifficulty.toFixed(1) : '—';
    
    let message = `Ești la Ziua ${bifate}/14, ai bifat ${stats.totalWorkouts} antrenamente.\n`;
    if (ramase > 0) {
      message += `Mai ai ${ramase} ${ramase === 1 ? 'zi' : 'zile'} până la final.\n\n`;
    } else {
      message += `Programul s-a încheiat. Felicitări!\n\n`;
    }
    message += `Dificultate medie: ${avgDiff}/5\n\nȚine-o tot așa.`;
    
    await bot.sendMessage(chatId, message);
  });

  // ============================================
  // COMMAND: /help — Available commands
  // ============================================
  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `Asistent PowerFit\n\n` +
      `Scrie-mi orice întrebare — răspund despre antrenament, nutriție, exerciții.\n\n` +
      `/status — vezi progresul tău\n` +
      `/checkin — bifează antrenamentul de azi\n` +
      `/coach — vorbește direct cu antrenorul\n` +
      `/help — această listă`
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
    
    // Anti-cheat: verifică dacă a bifat deja azi
    const existingCheckin = await db.getTodayWorkoutCheckin(profile.id);
    if (existingCheckin) {
      await bot.sendMessage(chatId,
        'Ai bifat deja antrenamentul de azi. Mâine continuăm.'
      );
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
      // Anti-cheat: verifică dacă a bifat deja azi (între /checkin și butonul Da)
      const existingCheckin = await db.getTodayWorkoutCheckin(profile.id);
      if (existingCheckin) {
        await bot.sendMessage(chatId,
          'Ai bifat deja antrenamentul de azi. Mâine continuăm.'
        );
        return;
      }
      
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
      // ANTI-CHEAT: 3 verificări înainte de a incrementa
      
      // 1) Există deja un workout bifat azi? → block
      const existingCheckin = await db.getTodayWorkoutCheckin(profile.id);
      if (existingCheckin) {
        await bot.sendMessage(chatId,
          'Ai bifat deja antrenamentul de azi. Mâine continuăm.'
        );
        return;
      }
      
      // 2) A fost trimis morning checkin azi? Dacă nu, lasă să bifeze (poate folosi /checkin manual înainte de morning)
      // 3) Dacă a fost morning checkin trimis, verifică să fi trecut minim 30 minute (anti-cheat)
      const lastMorningTime = await db.getLastNotificationTime(profile.id, 'morning_checkin');
      if (lastMorningTime) {
        const today = getRomaniaDate();
        const lastDate = new Date(lastMorningTime).toISOString().split('T')[0];
        // Doar dacă morning checkin a fost trimis AZI verificăm timpul minim
        if (lastDate === today) {
          const minutesSinceMorning = Math.floor((Date.now() - new Date(lastMorningTime).getTime()) / 60000);
          if (minutesSinceMorning < 30) {
            await bot.sendMessage(chatId,
              `Un antrenament corect durează 50-60 minute. Ai primit reminder-ul acum ${minutesSinceMorning} ${minutesSinceMorning === 1 ? 'minut' : 'minute'}.\n\nDă-i timpul cuvenit corpului — apoi bifează.`
            );
            return;
          }
        }
      }
      
      const rating = parseInt(data.split('_')[1]);
      const today = getRomaniaDate();
      
      // Calculez ziua calendaristică reală (sursa de adevăr — nu current_day + 1)
      const calendarDay = getCalendarProgramDay(profile.program_start_date);
      const programDay = (calendarDay !== null && calendarDay >= 1 && calendarDay <= 14) ? calendarDay : (profile.current_day || 0) + 1;
      
      // current_day reprezintă progresul userului (numărul de zile bifate)
      // Avansează la programDay (ziua calendaristică actuală) după bifare
      const newDay = Math.max((profile.current_day || 0) + 1, programDay);
      
      // Save check-in cu ziua calendaristică reală
      await db.saveCheckin({
        user_id: profile.id,
        checkin_type: 'workout',
        checkin_date: today,
        workout_completed: true,
        difficulty_rating: rating,
        energy_level: rating <= 2 ? 'high' : rating <= 3 ? 'ok' : 'low',
        program_day: programDay
      });
      
      // Update profile day — programul s-a încheiat dacă userul a bifat 14 antrenamente reale
      // (NU mai marcăm program_completed pe baza calendarDay aici — cron-ul auto-mark face asta separat)
      const userFinishedAllWorkouts = newDay >= 14;
      await db.updateProfile(profile.id, { 
        current_day: newDay,
        ...(userFinishedAllWorkouts ? { program_completed: true, program_completed_date: new Date().toISOString() } : {})
      });
      
      // Tracking intern (gamification invizibilă către user)
      await processWorkoutCompletion(profile.id);
      
      // Update streak (intern, nu se afișează)
      const updatedProfile = await db.getProfileByTelegramId(query.from.id);
      const newStreak = (updatedProfile.current_streak || 0) + 1;
      const maxStreak = Math.max(newStreak, updatedProfile.max_streak || 0);
      await db.updateProfile(profile.id, { current_streak: newStreak, max_streak: maxStreak });
      
      // Procesăm bonus streak intern (fără afișare)
      if (newStreak === 3 || newStreak === 7 || newStreak === 14) {
        await processStreakBonus(profile.id, newStreak);
      }
      
      // Build response — coach uman, fără gamification
      // 3 cazuri distincte:
      // A) User a bifat toate 14 antrenamente → felicitare finală
      // B) Calendar a trecut Z14, user încă recuperează → mesaj recuperare
      // C) În program normal → mesaj standard
      let response;
      
      if (userFinishedAllWorkouts) {
        // Cazul A — terminat real
        response = `Ziua 14 bifată — programul PowerFit s-a încheiat oficial.\n\nFelicitări că ai dus 14 zile la capăt. În curând primești raportul complet al transformării tale.`;
      } else if (calendarDay !== null && calendarDay > 14) {
        // Cazul B — recuperare după ce calendarul a trecut
        const daysOverdue = calendarDay - 14;
        response = `Ziua ${programDay} bifată. Programul calendar s-a încheiat acum ${daysOverdue} ${daysOverdue === 1 ? 'zi' : 'zile'}, dar continui să recuperezi. Bun lucru.`;
      } else {
        // Cazul C — în program normal
        response = `Ziua ${programDay} bifată. Bun lucru.`;
      }
      
      // Ask about pain zones
      await bot.sendMessage(chatId, response);
      
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
      const today = getRomaniaDate();
      
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
  
  // Calculăm ziua calendaristică din program_start_date
  const calendarDay = getCalendarProgramDay(profile.program_start_date);
  const bifate = profile.current_day || 0;
  
  // Programul nu a început (pre-program)
  if (calendarDay === null || calendarDay <= 0) return;
  
  // CAZ SPECIAL: Calendar > 14 + USER A BIFAT TOATE 14 → terminat real, nu mai trimitem morning
  if (calendarDay > 14 && bifate >= 14) return;
  
  // CAZ SPECIAL: Calendar > 14 + USER N-A bifat 14 → recuperare post-calendar
  if (calendarDay > 14 && bifate < 14) {
    const ramase = 14 - bifate;
    const nextLogicDay = bifate + 1;
    const nextDayInfo = getDayInfo(nextLogicDay);
    const daysOverdue = calendarDay - 14;
    
    const message = 'Bună dimineața, ' + profile.full_name + '!\n\n' +
      'Programul calendar de 14 zile s-a încheiat acum ' + daysOverdue + ' ' + (daysOverdue === 1 ? 'zi' : 'zile') + '.\n' +
      'Tu mai ai ' + ramase + ' ' + (ramase === 1 ? 'antrenament' : 'antrenamente') + ' de făcut pentru a finaliza programul de bază.\n\n' +
      'Următorul ar fi Ziua ' + nextLogicDay + ' — ' + nextDayInfo + '\n\n' +
      'Te încurajez să termini ce-ai început. După ce bifezi toate 14, primești instrucțiunile pentru ce urmează.';
    
    await bot.sendMessage(profile.telegram_chat_id, message, {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Recuperez Ziua ' + nextLogicDay + ' azi', callback_data: 'workout_yes' }
        ]]
      }
    });
    
    await db.logNotification(profile.id, 'morning_checkin', 'telegram', 'Recovery: ' + ramase + ' workouts left, calendar overdue');
    return;
  }
  
  // De aici încolo: calendar e între 1 și 14 (program normal)
  const dayInfo = getDayInfo(calendarDay);
  const isRestDay = calendarDay === 7 || calendarDay === 14;
  const isCardioDay = calendarDay === 4 || calendarDay === 11;
  
  // Pentru zilele de odihnă: avansăm automat current_day ca să nu rămână userul blocat
  // Asta evită bucla infinită cu Z7/Z14 (Bug B)
  if (isRestDay && bifate < calendarDay) {
    await db.updateProfile(profile.id, { current_day: calendarDay });
  }
  
  let message = '';
  
  if (isRestDay) {
    if (calendarDay === 14) {
      // Z14 calendar — mesaj diferit dacă user a bifat tot vs n-a bifat tot
      if (bifate >= 14) {
        // A terminat real — felicitare
        message = 'Bună dimineața, ' + profile.full_name + '!\n\n' +
          'Ziua 14/14 — Zi de odihnă. Ai dus la capăt programul de 14 zile.\n\n' +
          'Felicitări. Azi te odihnești complet. Mâine primești instrucțiunile pentru ce urmează.';
      } else {
        // Calendar a ajuns la Z14 dar userul n-a bifat tot — onestitate
        const ramase = 14 - bifate;
        message = 'Bună dimineața, ' + profile.full_name + '!\n\n' +
          'Ziua 14/14 calendaristic — Zi de odihnă.\n\n' +
          'Ai bifat ' + bifate + ' din 14 antrenamente. Mai sunt ' + ramase + ' ' + (ramase === 1 ? 'antrenament' : 'antrenamente') + ' nefăcute. Le poți recupera în zilele următoare — programul nu se închide până nu termini.';
      }
    } else {
      // Z7 odihnă
      message = 'Bună dimineața, ' + profile.full_name + '!\n\n' +
        'Ziua ' + calendarDay + '/14 — Zi de odihnă.\n\n' +
        'Corpul tău se recuperează și crește azi. Respectă planul alimentar și odihnește-te. Mâine revenim la treabă.';
    }
  } else if (isCardioDay) {
    message = 'Bună dimineața, ' + profile.full_name + '!\n\n' +
      'Ziua ' + calendarDay + '/14 — ' + dayInfo + '\n\n' +
      'Dacă simți oboseala acumulată după primele zile, ia o pauză completă azi. Programul se decalează cu o zi. Dacă te simți bine, hai la cardio!';
  } else {
    message = 'Bună dimineața, ' + profile.full_name + '!\n\n' +
      'Ziua ' + calendarDay + '/14 — ' + dayInfo + '\n\n' +
      'Deschide lecția în PowerFit și urmează instrucțiunile. După antrenament, apasă butonul de mai jos.';
  }
  
  // Buton DOAR pentru zilele de antrenament și cardio (NU pentru odihnă)
  const keyboard = isRestDay ? [] : [[
    { text: 'Am terminat antrenamentul', callback_data: 'workout_yes' }
  ]];
  
  await bot.sendMessage(profile.telegram_chat_id, message, 
    keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {}
  );
  
  await db.logNotification(profile.id, 'morning_checkin', 'telegram', 'Calendar day ' + calendarDay + ' morning checkin');
}

export async function sendEveningCheckin(profile) {
  if (!bot || !profile.telegram_chat_id) return;
  
  // Nu trimite evening checkin în zilele de odihnă (Z7, Z14) — n-ai ce să bifezi
  const calendarDay = getCalendarProgramDay(profile.program_start_date);
  if (calendarDay === 7 || calendarDay === 14 || calendarDay === null || calendarDay <= 0 || calendarDay > 14) return;
  
  // Check if already checked in today
  const today = getRomaniaDate();
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
  // DEZACTIVAT pentru MVP — prompt-ul AI generează halucinații (sfaturi inventate,
  // promisiuni de funcții inexistente). Sam trimite mesaj manual personalizat duminică seara.
  // Reactivat după validare MVP cu prompt strict, doar fapte.
  return;
}

export async function sendPostProgramMessage(profile, daysSinceCompletion) {
  if (!bot || !profile.telegram_chat_id) return;
  
  let message;
  
  switch(daysSinceCompletion) {
    case 1:
      // Felicitare + anunț video tranziție (Sam îl trimite manual)
      const stats = await db.getCheckinStats(profile.id);
      const avgD = stats.avgDifficulty ? stats.avgDifficulty.toFixed(1) : '—';
      message = `Felicitări, ${profile.full_name}!\n\n` +
        `Ai dus la capăt programul de 14 zile.\n` +
        `Antrenamente completate: ${stats.totalWorkouts}\n` +
        `Dificultate medie: ${avgD}/5\n\n` +
        `Acum urmează partea importantă — tranziția. Sam îți trimite în următoarele 24 de ore un video de 16 minute care îți explică exact ce ai de făcut mai departe (alimentație, antrenamente, opțiuni reale).\n\n` +
        `Între timp, sunt aici pentru orice întrebare despre cele 14 zile pe care tocmai le-ai dus la capăt.`;
      break;
    case 3:
      // Re-engagement scurt — verifică dacă a primit/văzut video-ul
      message = `${profile.full_name}, ai apucat să vezi videoul de tranziție trimis de Sam?\n\n` +
        `Dacă da și ai întrebări — sunt aici. Dacă încă nu l-ai primit, scrie /coach și îl anunț pe Sam.`;
      break;
    default:
      // Day+7, +14, +30 scoase pentru MVP — Sam contactează manual primii clienți
      return;
  }
  
  await bot.sendMessage(profile.telegram_chat_id, message);
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
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F4AA}\n\nProgramul tău de antrenament începe luni. Până atunci, ai câteva lucruri importante de parcurs:\n\n' +
      '\u{1F4DA} Parcurge secțiunea "Informatii utile" - acolo găsești strategia completă de alimentație\n' +
      '\u{1F9EE} Calculează-ți macronutrienții — folosește calculatorul din curs sau scrie-mi aici sexul, greutatea și procentul de grăsime\n' +
      '\u{1F4F1} Descarcă o aplicație de tracking nutrițional\n\nAcești pași sunt esențiali înainte de prima zi de antrenament.';
  } else if (daysUntilStart > 3) {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F4AA}\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile până la startul programului.\n\n' +
      'Ai calculat macronutrienții? Dacă nu, scrie-mi aici datele tale și te ajut instant.\n' +
      'Fă antrenamentul pregătitor azi — te va ajuta să intri în ritm luni.\n' +
      'Verifică lista de cumpărături din secțiunea Alimentație.';
  } else if (daysUntilStart >= 2) {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F4AA}\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile! Fă antrenamentul pregătitor dacă nu l-ai făcut încă.\n\n' +
      'Verifică că ai totul pregătit:\n' +
      '- Macronutrienții calculați\n' +
      '- Ingredientele cumpărate\n' +
      '- Aplicația de tracking instalată\n\nLuni începem la intensitate maximă!';
  } else if (daysUntilStart === 1) {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F525}\n\n' +
      'Mâine începe programul! Ziua 1: antrenament complet + plan alimentar.\n\n' +
      'Diseară se deblochează Săptămâna 1.\n' +
      'Mâine dimineață la 8:00 primești primul reminder cu antrenamentul zilei.\n\n' +
      'Ești pregătit? \u{1F4AA}';
  } else {
    message = 'Buna dimineata, ' + profile.full_name + '! \u{1F525}\n\n' +
      'Programul tău începe luni. Parcurge materialele din curs și pregătește-te!\n\n' +
      'Scrie-mi dacă ai întrebări.';
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
