import TelegramBot from 'node-telegram-bot-api';
import * as db from '../db/supabase.js';
import * as ai from '../services/ai.js';
import { getCalendarProgramDay, getRomaniaDate, getUserPhase, workoutNumberToProgramDay, expectedWorkoutsByDay } from '../utils/helpers.js';
import { getDayShortLabel } from '../data/program.js';

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
        const message = buildReturningUserMessage(profile);
        await bot.sendMessage(chatId, message);
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
              `Acest profil este deja conectat la alt cont Telegram.\n\nDacă e o eroare: /coach.`
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
        'Pentru conectare, completează profilul pe:\nstart.powerfitro.com\n\nDupă ce termini formularul, revii aici și apeși butonul de conectare.'
      );
    } catch (error) {
      console.error('Start command error:', error);
      await bot.sendMessage(chatId, 'Eroare tehnică temporară. Reîncearcă în câteva momente.');
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
          const escPhase = getUserPhase(profile);
          await bot.sendMessage(adminChatId,
            'ESCALADARE\n\n' +
            'Client: ' + profile.full_name + '\n' +
            'Email: ' + profile.email + '\n' +
            'Progres: ' + escPhase.bifate + '/12 antrenamente (' + escPhase.phase + ')\n' +
            'Chat ID: ' + chatId,
            {}
          );
        } catch (e) {
          console.error('Error notifying admin:', e.message);
        }
      }
      
      const coachName = getCoachName();
      await bot.sendMessage(chatId,
        'Mesaj transmis. ' + coachName + ' revine în cel mai scurt timp.'
      );
      
      try {
        await db.logNotification(profile.id, 'escalation_to_coach', 'telegram', 'User requested direct coach contact');
      } catch (e) {
        console.error('Error logging notification:', e.message);
      }
    } catch (error) {
      console.error('Coach command error:', error.message);
      await bot.sendMessage(chatId, 'Eroare tehnică temporară. Reîncearcă în câteva momente.');
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
    const message = buildStatusMessage(profile, stats);
    await bot.sendMessage(chatId, message);
  });

  // ============================================
  // COMMAND: /help — Available commands
  // ============================================
  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `PowerFit\n\n` +
      `Scrie-mi orice întrebare — răspund despre antrenament, nutriție, exerciții.\n\n` +
      `/status — vezi progresul tău\n` +
      `/checkin — bifează antrenamentul de azi\n` +
      `/coach — vorbește direct cu Sam\n` +
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
          `Programul începe pe ${startDate}. Până atunci nu ai antrenamente de bifat — folosește timpul pentru pregătire (calcul macronutrienți, lista de cumpărături, antrenament pregătitor).\n\nPentru întrebări tehnice, scrie aici.`
        );
      } else {
        await bot.sendMessage(chatId,
          'Programul nu are dată de start setată. Pentru clarificare: /coach.'
        );
      }
      return;
    }
    
    // Anti-cheat: verifică dacă a bifat deja azi
    const existingCheckin = await db.getTodayWorkoutCheckin(profile.id);
    if (existingCheckin) {
      await bot.sendMessage(chatId,
        'Antrenamentul de azi e deja bifat. Mâine continui.'
      );
      return;
    }
    
    // PENDING WORKOUT DAY: ziua de program a antrenamentului care urmează a fi bifat.
    // = workoutNumberToProgramDay(bifate + 1). Nu ziua calendaristică — userul
    // poate fi în urmă, iar antrenamentul corect e următorul nebifat.
    const nextWorkoutCheckin = (profile.current_day || 0) + 1;
    const pendingDay = workoutNumberToProgramDay(nextWorkoutCheckin) || 1;
    await db.setPendingWorkoutDay(profile.id, pendingDay);
    
    await bot.sendMessage(chatId, 
      'Ai terminat antrenamentul de azi?',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Da, am terminat', callback_data: 'workout_yes' },
              { text: 'Sar azi', callback_data: 'workout_skip' }
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
          'Antrenamentul de azi e deja bifat. Mâine continui.'
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
        'Notat. Mâine continui cu programul.'
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
          'Antrenamentul de azi e deja bifat. Mâine continui.'
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
            // Formulare condiționată: evită „acum 0 minute" care sună absurd
            let timeRef;
            if (minutesSinceMorning === 0) {
              timeRef = 'chiar acum';
            } else if (minutesSinceMorning === 1) {
              timeRef = 'acum 1 minut';
            } else {
              timeRef = `acum ${minutesSinceMorning} minute`;
            }
            await bot.sendMessage(chatId,
              `Un antrenament corect durează 50-60 minute. Ai primit reminder-ul ${timeRef}.\n\nDă-i timpul cuvenit corpului — apoi bifează.`
            );
            return;
          }
        }
      }
      
      const rating = parseInt(data.split('_')[1]);
      const today = getRomaniaDate();
      
      // PROGRAM_DAY: citim pending_workout_day ca sursa de adevăr.
      // Setat la momentul trimiterii butonului (morning normal, morning recovery, morning_ready, /checkin).
      // Fallback DOAR dacă pending e null (race condition / flow neobișnuit):
      // ziua de program a antrenamentului următor = workoutNumberToProgramDay(bifate + 1).
      let programDay;
      if (profile.pending_workout_day !== null && profile.pending_workout_day !== undefined && profile.pending_workout_day >= 1 && profile.pending_workout_day <= 14) {
        programDay = profile.pending_workout_day;
      } else {
        // FALLBACK: pending nu e setat. Ziua de program a antrenamentului care urmează.
        const nextWorkout = (profile.current_day || 0) + 1;
        programDay = workoutNumberToProgramDay(nextWorkout) || 1;
        console.warn('pending_workout_day NULL pentru user', profile.id, '— fallback la Ziua', programDay);
      }
      
      // current_day = antrenamente reale bifate. La o bifare crește cu exact 1.
      // FĂRĂ Math.max — current_day NU mai e amestecat cu ziua calendaristică.
      // Asta elimină bug-ul de coerență (botul zicea 13 și salva 14).
      const bifateInainte = profile.current_day || 0;
      const newDay = bifateInainte + 1;
      
      // Save check-in cu ziua de program reală (din pending, setat la trimiterea butonului)
      await db.saveCheckin({
        user_id: profile.id,
        checkin_type: 'workout',
        checkin_date: today,
        workout_completed: true,
        difficulty_rating: rating,
        energy_level: rating <= 2 ? 'high' : rating <= 3 ? 'ok' : 'low',
        program_day: programDay
      });
      
      // Programul e terminat când userul a bifat toate 12 antrenamentele reale.
      // RESET ATOMIC pending_workout_day la null în același update (un singur round-trip DB)
      const userFinishedAllWorkouts = newDay >= 12;
      await db.updateProfile(profile.id, { 
        current_day: newDay,
        pending_workout_day: null,
        ...(userFinishedAllWorkouts ? { program_completed: true, program_completed_date: new Date().toISOString() } : {})
      });
      
      // Build response — faza se recalculează cu noua valoare bifate (newDay).
      // Construim un profil actualizat ca getUserPhase să vadă starea de DUPĂ bifare.
      const profileAfter = { ...profile, current_day: newDay };
      const phaseAfter = getUserPhase(profileAfter);
      
      let response;
      if (userFinishedAllWorkouts) {
        // A bifat toate 12 antrenamentele — încheiere finală.
        response = `Antrenament bifat. Ai terminat toate cele 12 antrenamente — programul PowerFit este încheiat.\n\nAi acces la materialele programului încă 30 de zile. Sam revine personal pentru pașii următori.`;
      } else if (phaseAfter.phase === 'recuperare') {
        // În fereastra de recuperare (calendar a trecut Z14, mai are antrenamente).
        response = `Antrenament bifat. Ai ${phaseAfter.bifate} din 12 antrenamente făcute. Mai ai ${phaseAfter.ramase} de recuperat în ${phaseAfter.daysUntilAccessEnds} zile.`;
      } else {
        // Faza activ — în interiorul celor 14 zile.
        response = `Antrenament bifat — ${newDay} din 12. Bun lucru.`;
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
        await bot.sendMessage(chatId, 'Bun. Continuă așa și mâine.');
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
      // Ziua de program a antrenamentului care urmează = workoutNumberToProgramDay(bifate + 1).
      const nextWorkout = (profile.current_day || 0) + 1;
      const expectedDay = workoutNumberToProgramDay(nextWorkout) || 1;
      await db.setPendingWorkoutDay(profile.id, expectedDay);
      
      const dayInfo = getDayInfo(expectedDay, profile.equipment);
      await bot.sendMessage(chatId,
        `Ziua ${expectedDay}: ${dayInfo}\n\nDeschide lecția în PowerFit și urmează instrucțiunile. După antrenament, /checkin sau butonul de mai jos.`,
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
      await bot.sendMessage(chatId, 'Scrie întrebarea.');
    }
  });

  // ============================================
  // TEXT MESSAGE — Răspuns conversațional
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
    
    // Normalizare input: lowercase + fără diacritice
    // Folosit pentru matching pe coachKeywords + escalationKeywords (intent detection).
    // Userul poate scrie cu sau fără diacritice — keyword-urile sunt scrise fără.
    const normalizedText = stripDiacritics(msg.text);
    
    // Check if user wants to talk to coach
    const coachKeywords = [
      'vreau antrenorul',
      'vreau sa vorbesc cu sam',
      'vreau sa vorbesc cu un om',
      'cu sam direct',
      'antrenor real',
      'om real',
      'persoana reala'
    ];
    if (coachKeywords.some(kw => normalizedText.includes(kw))) {
      await bot.sendMessage(chatId,
        'Pentru contact direct cu antrenorul: /coach.'
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
      const escalationKeywords = [
        'durere puternica',
        'accidentat',
        'ranit',
        'urgenta',
        'medical',
        'lesin',
        'am cazut',
        'nu pot misca'
      ];
      if (escalationKeywords.some(kw => normalizedText.includes(kw))) {
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (adminChatId) {
          const escKwPhase = getUserPhase(profile);
          await bot.sendMessage(adminChatId,
            `⚠️ POSIBILĂ ESCALADARE\n\n` +
            `Client: ${profile.full_name}\n` +
            `Progres: ${escKwPhase.bifate}/12 antrenamente (${escKwPhase.phase})\n` +
            `Mesaj: "${msg.text}"\n\n` +
            `Verifică conversația și intervino dacă e cazul.`
          );
        }
      }
    } catch (error) {
      console.error('Message handler error:', error);
      await bot.sendMessage(chatId, 'Eroare tehnică temporară. Reîncearcă în câteva momente.');
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
  
  const phase = getUserPhase(profile);
  const { calendarDay, bifate, ramase } = phase;
  
  // Pre-program, terminat, expirat → cronul nu trimite morning checkin.
  // (Remindere de recuperare sunt gestionate separat de cron — vezi cron.js.)
  if (phase.phase === 'pre_program' || phase.phase === 'terminat' || phase.phase === 'expirat') {
    return;
  }
  
  // ── FAZA RECUPERARE: calendarul a trecut Z14, userul mai are antrenamente ──
  // Mesajul indică următorul antrenament de recuperat. Cron-ul decide ZILELE
  // în care apelează această funcție (15, 30, 40) — aici doar construim mesajul.
  if (phase.phase === 'recuperare') {
    const nextWorkout = bifate + 1;                              // al câtelea antrenament
    const nextProgramDay = workoutNumberToProgramDay(nextWorkout); // ziua de program
    const nextDayInfo = getDayInfo(nextProgramDay, profile.equipment);
    
    const message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
      'Programul calendaristic de 14 zile s-a încheiat. Ai ' + bifate + ' din 12 antrenamente făcute.\n\n' +
      'Mai ai ' + ramase + ' ' + (ramase === 1 ? 'antrenament' : 'antrenamente') + ' de recuperat și ' +
      phase.daysUntilAccessEnds + ' ' + (phase.daysUntilAccessEnds === 1 ? 'zi' : 'zile') + ' de acces la program.\n\n' +
      'Următorul: Ziua ' + nextProgramDay + ' — ' + nextDayInfo;
    
    await db.setPendingWorkoutDay(profile.id, nextProgramDay);
    
    await bot.sendMessage(profile.telegram_chat_id, message, {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Recuperez Ziua ' + nextProgramDay + ' azi', callback_data: 'workout_yes' }
        ]]
      }
    });
    
    await db.logNotification(profile.id, 'morning_checkin', 'telegram', 'Recovery reminder: ' + ramase + ' workouts left');
    return;
  }
  
  // ── FAZA ACTIV: calendar între 1 și 14 ──
  const isRestDay = phase.isRestDay;          // ziua 7 sau 14
  const isCardioDay = calendarDay === 4 || calendarDay === 11;
  
  // NU mai avansăm automat current_day la zilele de odihnă.
  // current_day = strict antrenamente bifate; o zi de odihnă nu e un antrenament.
  // Userul nu rămâne "blocat": morning checkin la zi de odihnă trimite mesaj de
  // odihnă (fără buton), iar a doua zi calendarul avansează singur.
  
  let message = '';
  
  if (isRestDay) {
    // Zi de odihnă (7 sau 14). Mesaj de odihnă, fără buton de bifare.
    message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
      'Ziua ' + calendarDay + '/14 — Zi de odihnă.\n\n' +
      'Corpul se recuperează și crește azi. Respectă planul alimentar și odihnește-te. Mâine reintri în program.';
  } else {
    // Zi de antrenament (sau cardio). Antrenamentul de făcut e următorul nebifat —
    // poate diferi de ziua calendaristică dacă userul e în urmă.
    const nextWorkout = bifate + 1;
    const nextProgramDay = workoutNumberToProgramDay(nextWorkout);
    const dayInfo = getDayInfo(nextProgramDay, profile.equipment);
    const inUrma = nextProgramDay < calendarDay;
    
    if (isCardioDay && !inUrma) {
      // Zi de cardio și userul e la zi — mesaj specific cardio.
      message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
        'Ziua ' + calendarDay + '/14 — ' + dayInfo + '\n\n' +
        'Dacă simți oboseala acumulată după primele zile, ia o pauză completă azi. Programul se decalează cu o zi. Dacă te simți bine, execuți cardio conform programului.';
    } else if (inUrma) {
      // Userul e în urmă — îi dăm antrenamentul nebifat, nu ziua calendaristică.
      message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
        'Ziua ' + calendarDay + '/14 calendaristic. Ai ' + bifate + ' din 12 antrenamente făcute.\n\n' +
        'Următorul antrenament de făcut: Ziua ' + nextProgramDay + ' — ' + dayInfo + '\n\n' +
        'Deschide lecția în PowerFit și urmează instrucțiunile. După antrenament, apasă butonul de mai jos.';
    } else {
      // La zi — antrenament normal.
      message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
        'Ziua ' + calendarDay + '/14 — ' + dayInfo + '\n\n' +
        'Deschide lecția în PowerFit și urmează instrucțiunile. După antrenament, apasă butonul de mai jos.';
    }
    
    // PENDING WORKOUT DAY: ziua de program a antrenamentului care urmează.
    await db.setPendingWorkoutDay(profile.id, nextProgramDay);
  }
  
  // Buton DOAR pentru zilele de antrenament (NU pentru odihnă).
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
  
  // Evening checkin se trimite DOAR în faza activ, în zilele de antrenament.
  // Nu în pre-program, nu în zilele de odihnă (n-ai ce bifa), nu în recuperare
  // (acolo trimitem doar 3 remindere, nu mesaje zilnice), nu în terminat/expirat.
  const phase = getUserPhase(profile);
  if (phase.phase !== 'activ') return;
  if (phase.isRestDay) return;
  
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
    `Antrenamentul de azi: bifat?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Da, am terminat', callback_data: 'workout_yes' },
            { text: 'Nu am apucat azi', callback_data: 'workout_skip' },
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
      const churnPhase = getUserPhase(profile);
      await bot.sendMessage(adminChatId,
        `RISC RIDICAT ABANDON\n\n` +
        `Client: ${profile.full_name} (@${profile.telegram_username || 'N/A'})\n` +
        `Progres: ${churnPhase.bifate}/12 antrenamente (${churnPhase.phase})\n` +
        `Inactiv de ${daysSince} zile\n\n` +
        `Recomandare: contactează-l direct.`
      );
    }
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Wrapper peste sursa de adevăr (src/data/program.js).
// Înainte: dicționar hardcodat cu titluri gym, ignora equipment → useri outdoor
// primeau descrieri de sală în morning checkin normal și recovery (BUG 1+2).
// Acum: deleagă la getDayShortLabel(dayNumber, equipment) care întoarce titlul
// corect din PROGRAM[gym|outdoor]. Wrapper-ul există ca punct unic de schimbare
// în viitor (dacă vrem prefix "Ziua X" sau alt format, modificăm aici, nu în
// toate call-site-urile).
function getDayInfo(dayNumber, equipment) {
  if (equipment !== 'gym' && equipment !== 'outdoor') {
    // Defense-in-depth: onboarding-ul garantează equipment populat, dar dacă
    // ajunge null/undefined (DB inconsistent, profil corupt), logăm ca să
    // prindem în Railway. getDayShortLabel va face fallback intern la 'gym'.
    console.warn('[getDayInfo] equipment lipsă sau invalid:', equipment, '— fallback gym în program.js');
  }
  return getDayShortLabel(dayNumber, equipment);
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

  return `${profile.full_name}, profil PowerFit conectat.

Înregistrat pentru ${programLabel}, obiectiv: ${goalLabel}.

Programul începe luni. Până atunci ești în săptămâna de pregătire — primești zilnic mesaje cu pașii necesari: calculul macronutrienților, lista de cumpărături, antrenamentul pregătitor. Parcurge-le. Sunt esențiale pentru prima săptămână.

Pentru întrebări despre program, antrenament sau nutriție, scrie aici.
Pentru discuție directă cu Sam: /coach.`;
}



// ============================================
// RETURNING USER MESSAGE — /start pentru profil deja conectat
// ============================================
// Diferentiat pe cele 5 faze din getUserPhase (sursa unică de adevăr).
function buildReturningUserMessage(profile) {
  const phase = getUserPhase(profile);
  const { calendarDay, bifate, ramase } = phase;
  const name = profile.full_name;
  
  // PRE-PROGRAM — programul nu a început încă
  if (phase.phase === 'pre_program') {
    if (!profile.program_start_date) {
      return name + ', programul nu are dată de start setată. Pentru clarificare: /coach.';
    }
    const daysUntilStart = getDaysUntilStart(profile.program_start_date);
    
    if (daysUntilStart === 1) {
      return name + ', programul începe mâine. Ziua 1: antrenament complet + plan alimentar.\n\n' +
        'Mâine dimineață la 8:00 primești primul mesaj cu antrenamentul zilei.';
    }
    return name + ', programul începe în ' + daysUntilStart + ' zile. Ești în săptămâna de pregătire.\n\n' +
      'Folosește timpul pentru macronutrienți, lista de cumpărături și antrenamentul pregătitor. În secțiunile "Informații utile" și "Alimentație" ai detaliile complete.';
  }
  
  // TERMINAT — a bifat toate 12 antrenamentele
  if (phase.phase === 'terminat') {
    return name + ', ai terminat toate cele 12 antrenamente — programul PowerFit este încheiat.\n\n' +
      'Ai acces la materialele programului încă 30 de zile. Pentru pașii următori: /coach.';
  }
  
  // EXPIRAT — perioada de acces s-a încheiat
  if (phase.phase === 'expirat') {
    return name + ', perioada de acces la program s-a încheiat. Pentru reînnoire sau întrebări: /coach.';
  }
  
  // RECUPERARE — calendar a trecut Z14, mai are antrenamente
  if (phase.phase === 'recuperare') {
    const nextWorkout = bifate + 1;
    const nextProgramDay = workoutNumberToProgramDay(nextWorkout);
    const nextDayInfo = getDayInfo(nextProgramDay, profile.equipment);
    
    return name + ', programul calendaristic de 14 zile s-a încheiat. Ai ' + bifate + ' din 12 antrenamente făcute. Mai ai ' + ramase + ' de recuperat și ' +
      phase.daysUntilAccessEnds + ' ' + (phase.daysUntilAccessEnds === 1 ? 'zi' : 'zile') + ' de acces.\n\n' +
      'Următorul antrenament: Ziua ' + nextProgramDay + ' — ' + nextDayInfo + '.';
  }
  
  // ACTIV — în interiorul celor 14 zile
  const datorate = expectedWorkoutsByDay(calendarDay);
  if (bifate < datorate) {
    // În urmă față de calendar
    const nextWorkout = bifate + 1;
    const nextProgramDay = workoutNumberToProgramDay(nextWorkout);
    const nextDayInfo = getDayInfo(nextProgramDay, profile.equipment);
    
    return name + ', Ziua ' + calendarDay + '/14 calendaristic. Ai ' + bifate + ' din 12 antrenamente făcute — ești în urmă, recuperabil.\n\n' +
      'Următorul antrenament: Ziua ' + nextProgramDay + ' — ' + nextDayInfo + '.';
  }
  
  // La zi cu programul
  return name + ', Ziua ' + calendarDay + '/14. Ai ' + bifate + ' din 12 antrenamente făcute. La zi cu programul.';
}



// ============================================
// STATUS MESSAGE — /status pentru profil deja conectat
// ============================================
// Diferentiat pe cele 5 faze din getUserPhase, cu stats reale.
function buildStatusMessage(profile, stats) {
  const phase = getUserPhase(profile);
  const { calendarDay, bifate, ramase } = phase;
  const avgDiff = stats.avgDifficulty ? stats.avgDifficulty.toFixed(1) : null;
  const diffLine = avgDiff ? '\n\nDificultate medie: ' + avgDiff + '/5' : '';
  
  // PRE-PROGRAM — zero stats relevante
  if (phase.phase === 'pre_program') {
    if (!profile.program_start_date) {
      return 'Programul nu are dată de start setată. Pentru clarificare: /coach.';
    }
    const daysUntilStart = getDaysUntilStart(profile.program_start_date);
    if (daysUntilStart === 1) {
      return 'Programul începe mâine. Ești în săptămâna de pregătire — antrenamentele se bifează din Ziua 1.';
    }
    return 'Programul tău începe în ' + daysUntilStart + ' zile. Ești în săptămâna de pregătire — antrenamentele se bifează din Ziua 1.';
  }
  
  // TERMINAT
  if (phase.phase === 'terminat') {
    return 'Ai bifat toate cele 12 antrenamente. Programul PowerFit este încheiat.' + diffLine +
      '\n\nAi acces la materiale încă 30 de zile. Pentru pașii următori: /coach.';
  }
  
  // EXPIRAT
  if (phase.phase === 'expirat') {
    return 'Perioada de acces la program s-a încheiat. Pentru reînnoire: /coach.';
  }
  
  // RECUPERARE
  if (phase.phase === 'recuperare') {
    return 'Ai ' + bifate + ' din 12 antrenamente făcute. Programul calendaristic s-a încheiat — mai ai ' +
      ramase + ' de recuperat și ' + phase.daysUntilAccessEnds + ' ' +
      (phase.daysUntilAccessEnds === 1 ? 'zi' : 'zile') + ' de acces.' + diffLine;
  }
  
  // ACTIV — în program
  const datorate = expectedWorkoutsByDay(calendarDay);
  if (bifate < datorate) {
    return 'Ziua ' + calendarDay + '/14 calendaristic. Ai ' + bifate + ' din 12 antrenamente făcute — ești în urmă, recuperabil.' + diffLine;
  }
  return 'Ziua ' + calendarDay + '/14. Ai ' + bifate + ' din 12 antrenamente făcute. La zi cu programul.' + diffLine;
}



// ============================================
// PRE-PROGRAM MESSAGE — Preparation phase
// ============================================
export async function sendPreProgramMessage(profile, startDate) {
  if (!profile.telegram_chat_id || !bot) return;
  
  const daysUntilStart = getDaysUntilStart(startDate);
  if (daysUntilStart === null) {
    console.warn('[sendPreProgramMessage] startDate invalid sau absent:', startDate, 'profile:', profile.id);
    return;
  }
  
  let message = '';
  
  if (daysUntilStart > 5) {
    message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
      'Programul de antrenament începe luni. Până atunci, ai următorii pași:\n\n' +
      '- Parcurge secțiunile "Informații utile" (totul despre program) și "Alimentație" (strategia de macronutrienți).\n' +
      '- Calculează macronutrienții. Folosește calculatorul din curs sau scrie aici sexul, greutatea și procentul de grăsime.\n' +
      '- Descarcă o aplicație de tracking nutrițional.\n\n' +
      'Pași esențiali înainte de prima zi de antrenament.';
  } else if (daysUntilStart > 3) {
    message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile până la startul programului.\n\n' +
      '- Macronutrienții calculați? Dacă nu, scrie aici datele tale.\n' +
      '- Antrenamentul pregătitor azi — te ajută să intri în ritm luni.\n' +
      '- Verifică lista de cumpărături din secțiunea Alimentație.';
  } else if (daysUntilStart >= 2) {
    message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
      'Mai sunt ' + daysUntilStart + ' zile până la start. Folosește-le pentru ultimele verificări:\n\n' +
      '- Macronutrienții calculați.\n' +
      '- Ingredientele cumpărate.\n' +
      '- Aplicația de tracking instalată.\n' +
      '- Antrenamentul pregătitor făcut.\n\n' +
      'Luni intri în programul de 14 zile.';
  } else if (daysUntilStart === 1) {
    message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
      'Mâine începe programul. Ziua 1: antrenament complet + plan alimentar.\n\n' +
      'Antrenamentul de mâine se deblochează azi în curs.\n' +
      'Mâine dimineață la 8:00 primești primul mesaj cu antrenamentul zilei.';
  } else {
    message = 'Bună dimineața, ' + profile.full_name + '.\n\n' +
      'Programul începe luni. Parcurge materialele din curs până atunci.';
  }
  
  try {
    await bot.sendMessage(profile.telegram_chat_id, message);
    await db.logNotification(profile.id, 'morning_checkin', 'telegram', 'Pre-program preparation message');
  } catch (error) {
    console.error('Pre-program message error:', error.message);
  }
}

function getCoachName() {
  return process.env.COACH_NAME || 'Sam';
}

// ============================================
// TEXT NORMALIZATION — diacritice tolerante
// ============================================
// Convertim input-ul userului la lowercase + fără diacritice ca să facem
// matching pe intent (escaladare, cerere de coach uman, urgență medicală)
// indiferent dacă userul scrie "ranit" sau "rănit", "urgenta" sau "urgență".
// CONVENȚIE: keyword-urile în array-urile coachKeywords/escalationKeywords
// se scriu MEREU fără diacritice. Userul poate scrie cu sau fără.
function stripDiacritics(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// ============================================
// DATE UTILITIES — timezone-aware
// ============================================
// Calculeaza cate zile mai sunt pana la startDate, folosind getRomaniaDate()
// pentru "azi" — evita bug-ul off-by-one cand serverul e UTC si clientul
// e in Europe/Bucharest (e.g. luni 00:30 Bucharest = duminica 21:30 UTC,
// new Date() ar da diff fractional rotunjit gresit).
// Returns: integer (numar de zile), sau null daca startDate e absent/invalid.
function getDaysUntilStart(startDate) {
  if (!startDate) return null;
  const todayStr = getRomaniaDate(); // 'YYYY-MM-DD' in timezone Romania
  const today = new Date(todayStr + 'T00:00:00');
  const start = new Date(startDate + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  return Math.round((start - today) / (1000 * 60 * 60 * 24));
}

export { bot };
