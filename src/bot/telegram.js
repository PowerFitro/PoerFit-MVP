import TelegramBot from 'node-telegram-bot-api';
import * as db from '../db/supabase.js';
import * as ai from '../services/ai.js';
import { getCalendarProgramDay, getRomaniaDate } from '../utils/helpers.js';

let bot;

export function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  
  // ============================================
  // COMMAND: /start — Link Telegram to profile
  // ============================================
  // FLOW: user completează onboarding pe start.powerfitro.com → backend returnează
  // deep link cu payload = profile.id (UUID). User apasă buton → Telegram → "Start"
  // → handler primește /start cu param = UUID.
  //
  // IMPORTANT: NU folosim email ca payload — caracterele speciale (`.`, `@` encoded
  // ca `%40`) nu trec validarea Telegram (doar A-Z, a-z, 0-9, _, - sunt permise).
  // Cu email encoded, Telegram client refuză payload-ul și trimite /start gol.
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const param = match[1]?.trim(); // Payload din deep link = profile.id (UUID)
    
    console.log('[START] Received /start from userId:', userId, 'param:', JSON.stringify(param));
    
    try {
      // 1. Verifică dacă utilizatorul Telegram este deja conectat la un profil
      let profile = await db.getProfileByTelegramId(userId);
      console.log('[START] Existing profile by telegram_user_id:', profile ? profile.email : 'none');
      
      if (profile) {
        await bot.sendMessage(chatId, 
          `Bine ai revenit, ${profile.full_name}!\n\nEști la Ziua ${profile.current_day}/14 din program.\n\nScrie-mi oricând dacă ai întrebări despre antrenament sau nutriție.`
        );
        return;
      }
      
      // 2. Încearcă linking via UUID din deep link (onboarding -> Telegram)
      // Validăm format UUID v4 strict (8-4-4-4-12 hex) ca să evităm query-uri inutile
      // pe text random trimis de useri (ex: /start salut)
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      if (param && UUID_REGEX.test(param)) {
        profile = await db.getProfileById(param);
        console.log('[START] Profile lookup by id:', profile ? profile.email : 'not found');
        
        if (profile) {
          // Edge case: profilul are deja alt telegram_user_id (cineva reutilizează link)
          if (profile.telegram_user_id && profile.telegram_user_id !== userId) {
            console.warn('[START] Profile already linked to different telegram user:', 
              profile.telegram_user_id, '!=', userId);
            await bot.sendMessage(chatId,
              `Acest profil este deja conectat la alt cont Telegram.\n\nDacă e o greșeală, scrie /coach și te ajut.`
            );
            return;
          }
          
          await db.updateProfile(profile.id, {
            telegram_user_id: userId,
            telegram_chat_id: chatId,
            telegram_username: msg.from.username || null
          });
          
          const welcome = buildWelcomeMessage(profile);
          await bot.sendMessage(chatId, welcome);
          return;
        }
      }
      
      // 3. Fallback: user fără param valid sau profil negăsit
      await bot.sendMessage(chatId,
        `Salut! 👋\n\nSunt Asistentul PowerFit.\n\nPentru a te conecta, trebuie mai întâi să completezi profilul pe:\n🔗 start.powerfitro.com\n\nDupă ce completezi formularul, revino aici și apasă butonul de conectare.`
      );
    } catch (error) {
      console.error('Start command error:', error);
      await bot.sendMessage(chatId, 'A apărut o eroare. Te rog să încerci din nou în câteva momente.');
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
    
    // Verificare PRE-PROGRAM: programul nu a început calendaristic
    const calendarDay = getCalendarProgramDay(profile.program_start_date);
    if (calendarDay === null || calendarDay <= 0) {
      const startDate = profile.program_start_date;
      if (startDate) {
        await bot.sendMessage(chatId,
          `Programul începe pe ${startDate}. Până atunci nu ai antrenamente de bifat — folosește timpul pentru pregătire (calculat macronutrienți, lista de cumpărături, antrenament pregătitor).\n\nDacă ai întrebări, scrie-mi oricând.`
        );
      } else {
        await bot.sendMessage(chatId,
          'Programul nu a fost încă programat pentru tine. Scrie /coach și Sam te ajută să-l setezi.'
        );
      }
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
    
    // PENDING WORKOUT DAY: setăm ziua pe care urmează să o bifeze
    // Logică: dacă suntem în calendar 1-14 → calendarDay; altfel (recuperare) → bifate+1
    const pendingDay = (calendarDay >= 1 && calendarDay <= 14) ? calendarDay : (profile.current_day || 0) + 1;
    await db.setPendingWorkoutDay(profile.id, pendingDay);
    
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
      // Verificare PRE-PROGRAM: programul nu a început calendaristic
      const calDay = getCalendarProgramDay(profile.program_start_date);
      if (calDay === null || calDay <= 0) {
        await bot.sendMessage(chatId,
          'Programul nu a început încă. Nu ai antrenamente de bifat. Pentru întrebări scrie /coach.'
        );
        return;
      }
      
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
      // ANTI-CHEAT: verificări înainte de a incrementa
      
      // 0) Verificare PRE-PROGRAM: programul nu a început calendaristic
      const calDay = getCalendarProgramDay(profile.program_start_date);
      if (calDay === null || calDay <= 0) {
        await bot.sendMessage(chatId,
          'Programul nu a început încă. Nu ai antrenamente de bifat.'
        );
        return;
      }
      
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
      
      // PROGRAM_DAY: citim pending_workout_day ca sursa de adevăr.
      // Setat la momentul trimiterii butonului (4 puncte: morning normal, morning recovery, morning_ready, /checkin).
      // Fallback la calcul vechi DOAR dacă pending e null (defensive — n-ar trebui să se întâmple în flow normal).
      let programDay;
      if (profile.pending_workout_day !== null && profile.pending_workout_day !== undefined && profile.pending_workout_day >= 1 && profile.pending_workout_day <= 14) {
        programDay = profile.pending_workout_day;
      } else {
        // FALLBACK: pending nu e setat (race condition sau user a folosit flow neobișnuit)
        programDay = (calendarDay !== null && calendarDay >= 1 && calendarDay <= 14) ? calendarDay : (profile.current_day || 0) + 1;
        console.warn('pending_workout_day NULL pentru user', profile.id, '— fallback la', programDay);
      }
      
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
      // RESET ATOMIC pending_workout_day la null în același update (un singur round-trip DB)
      const userFinishedAllWorkouts = newDay >= 14;
      await db.updateProfile(profile.id, { 
        current_day: newDay,
        pending_workout_day: null,
        ...(userFinishedAllWorkouts ? { program_completed: true, program_completed_date: new Date().toISOString() } : {})
      });
      
      // Build response — coach uman, fără gamification
      // 3 cazuri distincte:
      // A) User a bifat toate 14 antrenamente → felicitare finală
      // B) Calendar a trecut Z14, user încă recuperează → mesaj recuperare
      // C) În program normal → mesaj standard
      let response;
      
      if (userFinishedAllWorkouts) {
        // Cazul A — terminat real
        response = `Ziua 14 bifată — programul PowerFit s-a încheiat.\n\nFelicitări că ai dus 14 zile la capăt. Sam te contactează personal pentru pașii următori.`;
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
        
        await bot.sendMessage(chatId, recommendation);
      }
    }
    
    // --- MORNING CHECK-IN RESPONSES ---
    if (data === 'morning_ready') {
      // PENDING WORKOUT DAY: ziua pe care urmează să o bifeze e current_day + 1 (flow standard)
      const expectedDay = (profile.current_day || 0) + 1;
      await db.setPendingWorkoutDay(profile.id, expectedDay);
      
      const dayInfo = getDayInfo(expectedDay);
      await bot.sendMessage(chatId,
        `Hai să facem treabă.\n\nZiua ${expectedDay}: ${dayInfo}\n\nDeschide lecția în PowerFit și urmează instrucțiunile.\n\nDupă antrenament, scrie /checkin sau apasă butonul de mai jos.`,
        { 
          reply_markup: {
            inline_keyboard: [[
              { text: 'Am terminat antrenamentul', callback_data: 'workout_yes' }
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
      
      // Save assistant message
      await db.saveMessage(profile.id, 'assistant', response);
      
      // Send response
      await bot.sendMessage(chatId, response);
      
      // Check if escalation needed (heuristic)
      const escalationKeywords = ['durere puternică', 'accidentat', 'ranit', 'urgență', 'medical'];
      if (escalationKeywords.some(kw => msg.text.toLowerCase().includes(kw))) {
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (adminChatId) {
          await bot.sendMessage(adminChatId,
            `⚠️ POSIBILĂ ESCALADARE\n\n` +
            `Client: ${profile.full_name}\n` +
            `Ziua: ${profile.current_day}/14\n` +
            `Mesaj: "${msg.text}"\n\n` +
            `Verifică conversația și intervino dacă e cazul.`
          );
        }
      }
    } catch (error) {
      console.error('Message handler error:', error);
      await bot.sendMessage(chatId, 'Am întâmpinat o problemă. Încearcă din nou peste câteva momente.');
    }
  });

  console.log('✅ Bot Telegram inițializat (polling mode)');
  return bot;
}

// ============================================
// AUTOMATED MESSAGES (called by cron)
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
    
    // PENDING WORKOUT DAY: setăm ziua pe care urmează să o recupereze (înainte de a trimite butonul)
    await db.setPendingWorkoutDay(profile.id, nextLogicDay);
    
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
  
  // PENDING WORKOUT DAY: setăm DOAR pentru zilele cu buton (antrenament + cardio)
  // Pentru zilele de odihnă NU setăm — userul nu are ce bifa
  if (!isRestDay) {
    await db.setPendingWorkoutDay(profile.id, calendarDay);
  }
  
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
  await bot.sendMessage(profile.telegram_chat_id, message);
  await db.logNotification(profile.id, 'anti_churn', 'telegram', `Risk: ${riskLevel}, days: ${daysSince}`);
  
  // If high risk, also notify admin
  if (riskLevel === 'high') {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId) {
      await bot.sendMessage(adminChatId,
        `RISC RIDICAT ABANDON\n\n` +
        `Client: ${profile.full_name} (@${profile.telegram_username || 'N/A'})\n` +
        `Ziua: ${profile.current_day}/14\n` +
        `Inactiv de ${daysSince} zile\n\n` +
        `Recomandare: contactează-l direct.`
      );
    }
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getDayInfo(dayNumber) {
  const schedule = {
    1: 'Picioare, piept și abdomen',
    2: 'Spate, umeri, abdomen și lombari',
    3: 'Brațe, picioare și gambe',
    4: 'Cardio HIIT (sau zi de pauză dacă ești obosit)',
    5: 'Exerciții fundamentale + grup muscular deficitar',
    6: 'Volum total (tracțiuni 50 + dips 80 + squat 100)',
    7: 'Zi de odihnă',
    8: 'Picioare (bază), brațe, abdomen',
    9: 'Spate, piept',
    10: 'Umeri, picioare, gambe și abdomen',
    11: 'Cardio intervale',
    12: 'Exerciții fundamentale + grup muscular deficitar',
    13: 'Volum total (tracțiuni 60 + dips 80 + squat 100)',
    14: 'Zi de odihnă',
  };
  return schedule[dayNumber] || 'Antrenament';
}

// ============================================
// WELCOME MESSAGE — Hardcoded, fără AI
// ============================================
// Decizie: zero AI în welcome ca să eliminăm risc halucinație și clișee
// motivaționale. Pattern identic cu sendPreProgramMessage — text fix +
// interpolare 2 variabile (equipment + goal). Aliniat cu D5 (mesaje
// motivaționale AI dezactivate) și D11 (plain text peste tot).
function buildWelcomeMessage(profile) {
  // Echipament: 'gym' = sală, orice altceva (outdoor/home/park) = acasă/parc
  const programLabel = profile.equipment === 'gym'
    ? 'programul de antrenament la sală'
    : 'programul de antrenament acasă sau în parc';

  // Goal labels — aliniate cu formularul de onboarding
  // (Pierdere grăsime / Tonifiere / Masă musculară)
  const goalLabels = {
    fat_loss: 'pierdere grăsime',
    toning: 'tonifiere',
    muscle_gain: 'masă musculară'
  };
  const goalLabel = goalLabels[profile.goal] || 'obiectivul tău';

  return `Bună, ${profile.full_name}. Bine ai venit în PowerFit.

Te-am înregistrat pentru ${programLabel}, cu obiectiv ${goalLabel}.

Programul de antrenament începe luni. Până atunci ești în săptămâna de pregătire — primești zilnic mesaje cu pașii importanți: calculul macronutrienților, lista de cumpărături și antrenamentul pregătitor. Parcurge-le, sunt esențiale pentru prima săptămână.

Pentru orice întrebare legată de program, antrenamente sau nutriție, scrie-mi direct aici — îți răspund non-stop.

Pentru lucruri care necesită discuție cu Sam personal, folosește /coach.`;
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
    message = 'Bună dimineața, ' + profile.full_name + '! \u{1F4AA}\n\nProgramul tău de antrenament începe luni. Până atunci, ai câteva lucruri importante de parcurs:\n\n' +
      '\u{1F4DA} Parcurge secțiunea "Informații utile" - acolo găsești strategia completă de alimentație\n' +
      '\u{1F9EE} Calculează-ți macronutrienții — folosește calculatorul din curs sau scrie-mi aici sexul, greutatea și procentul de grăsime\n' +
      '\u{1F4F1} Descarcă o aplicație de tracking nutrițional\n\nAcești pași sunt esențiali înainte de prima zi de antrenament.';
  } else if (daysUntilStart > 3) {
    message = 'Bună dimineața, ' + profile.full_name + '! \u{1F4AA}\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile până la startul programului.\n\n' +
      'Ai calculat macronutrienții? Dacă nu, scrie-mi aici datele tale și te ajut instant.\n' +
      'Fă antrenamentul pregătitor azi — te va ajuta să intri în ritm luni.\n' +
      'Verifică lista de cumpărături din secțiunea Alimentație.';
  } else if (daysUntilStart >= 2) {
    message = 'Bună dimineața, ' + profile.full_name + '! \u{1F4AA}\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile! Fă antrenamentul pregătitor dacă nu l-ai făcut încă.\n\n' +
      'Verifică că ai totul pregătit:\n' +
      '- Macronutrienții calculați\n' +
      '- Ingredientele cumpărate\n' +
      '- Aplicația de tracking instalată\n\nLuni începem la intensitate maximă!';
  } else if (daysUntilStart === 1) {
    message = 'Bună dimineața, ' + profile.full_name + '! \u{1F525}\n\n' +
      'Mâine începe programul! Ziua 1: antrenament complet + plan alimentar.\n\n' +
      'Diseară se deblochează Săptămâna 1.\n' +
      'Mâine dimineață la 8:00 primești primul reminder cu antrenamentul zilei.\n\n' +
      'Ești pregătit? \u{1F4AA}';
  } else {
    message = 'Bună dimineața, ' + profile.full_name + '! \u{1F525}\n\n' +
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

export { bot };
