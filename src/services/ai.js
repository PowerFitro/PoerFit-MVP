import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================
// SYSTEM PROMPT - POWERFIT AI COACH
// ============================================

const COACH_SYSTEM_PROMPT = `Ești Asistentul PowerFit — parte din echipa de coaching PowerFit, condusă de antrenorul Sam.

CINE EȘTI:
- Asistentul programului PowerFit, pregătit de Sam personal
- Cunoști programul în detaliu pentru că Sam te-a instruit cu toate informațiile
- Vorbești direct, motivant, prietenos — ca un coleg de sală care știe ce face
- Răspunzi în română, scurt și la obiect (maxim 150 cuvinte per răspuns)
- Folosești emoji-uri cu moderație (1-2 per mesaj, maximum)
- Nu ești medic — dacă cineva raportează dureri persistente, recomanzi consultarea unui specialist
- NU te prezinți niciodată ca AI, bot, sau inteligență artificială
- Dacă cineva te întreabă cine ești, spui: "Sunt asistentul programului PowerFit, pregătit de Claudiu să te ajut cu orice ai nevoie legat de antrenament și nutriție."
- Dacă cineva întreabă dacă ești robot/AI, spui: "Sunt asistentul digital al echipei PowerFit. Dacă vrei să vorbești direct cu Sam, scrie /coach" 

PROGRAMUL POWERFIT (ce cunoști):
- Program de 14 zile cu 2 variante: sală și aer liber/acasă cu gantere
- Antrenamente bazate pe superseturi (2 exerciții back-to-back)
- Grupe musculare: Piept+Abdomen+Picioare (Ziua 1), Spate+Umeri+Biceps (Ziua 2), Brațe+Picioare+Gambe (Ziua 3), apoi se repetă
- Încălzire: 5 min cardio + exerciții de activare + jumping jacks (15s execuție / 15s pauză)
- Stretching la final
- Pauze între seturi: 2-3 minute (exerciții grele), 60-90 secunde (exerciții izolate)
- Pentru începători: maxim 2 seturi per exercițiu în primele 3 sesiuni
- Plan alimentar cu mese separate bărbați/femei (cantități diferite)
- Rețete simple, ingrediente din supermarket
- Calcul macro-uri disponibil

REGULI DE RĂSPUNS:
- Dacă întreabă despre înlocuirea unui exercițiu → oferă alternativă specifică cu aceeași grupă musculară
- Dacă raportează durere → sugerează alternativa cu impact redus + recomandă specialist dacă persistă
- Dacă întreabă despre nutriție → răspunde pe baza principiilor planului alimentar PowerFit
- Dacă întreabă ceva în afara fitness/nutriție → redirecționează politicos: "Nu sunt expert în asta, dar te pot ajuta cu antrenamentul și nutriția ta."
- Dacă vrea să vorbească cu Claudiu → răspunde: "Înțeleg! Scrie /coach și îl contactez imediat pe Sam."
- NICIODATĂ nu inventa exerciții sau rețete inexistente
- NICIODATĂ nu da sfaturi medicale specifice`;

// ============================================
// AI COACH - Chat Response
// ============================================

export async function getChatResponse(userMessage, conversationHistory, userProfile) {
  const profileContext = userProfile ? `
PROFILUL CLIENTULUI:
- Nume: ${userProfile.full_name}
- Sex: ${userProfile.sex === 'male' ? 'Bărbat' : 'Femeie'}
- Vârstă: ${userProfile.age} ani
- Greutate: ${userProfile.weight_kg} kg → Target: ${userProfile.target_weight_kg || 'nesetat'} kg
- Nivel: ${userProfile.experience_level}
- Echipament: ${userProfile.equipment}
- Obiectiv: ${userProfile.goal === 'fat_loss' ? 'Pierdere grăsime' : userProfile.goal === 'toning' ? 'Tonifiere' : 'Masă musculară'}
- Ziua curentă: ${userProfile.current_day}/14
- Streak: ${userProfile.current_streak} zile
- Nivel gamification: ${userProfile.current_level}
- Restricții alimentare: ${userProfile.dietary_restrictions?.join(', ') || 'Niciuna'}` : '';

  const messages = [
    ...conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: COACH_SYSTEM_PROMPT + profileContext,
      messages: messages.slice(-10) // Ultimele 10 mesaje pentru context
    });

    return response.content[0].text;
  } catch (error) {
    console.error('AI Chat error:', error);
    return 'Scuze, am o problemă tehnică momentan. Încearcă din nou în câteva secunde sau scrie /coach pentru a contacta antrenorul direct.';
  }
}

// ============================================
// AI FOOD ANALYSIS (Vision)
// ============================================

export async function analyzeFoodPhoto(photoBase64, userProfile) {
  const targetCalories = userProfile?.daily_calorie_target || 2000;
  const sex = userProfile?.sex === 'female' ? 'femeie' : 'bărbat';

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: photoBase64 }
          },
          {
            type: 'text',
            text: `Analizează această masă pentru un client PowerFit (${sex}, target zilnic: ${targetCalories} kcal).

Răspunde EXACT în acest format (fără altceva):
MASĂ: [descriere scurtă a mâncării]
CALORII: [număr] kcal
PROTEINE: [număr]g
GRĂSIMI: [număr]g
CARBOHIDRAȚI: [număr]g
VERDICT: [✅ sau ⚠️] [o propoziție scurtă de feedback]

Estimează cât mai precis pe baza porției vizibile.`
          }
        ]
      }]
    });

    return parseFoodAnalysis(response.content[0].text);
  } catch (error) {
    console.error('Food analysis error:', error);
    return null;
  }
}

function parseFoodAnalysis(text) {
  try {
    const lines = text.split('\n').filter(l => l.trim());
    const get = (prefix) => {
      const line = lines.find(l => l.startsWith(prefix));
      return line ? line.replace(prefix, '').trim() : null;
    };
    
    return {
      description: get('MASĂ:') || 'Masă analizată',
      calories: parseInt(get('CALORII:')) || 0,
      protein: parseFloat(get('PROTEINE:')) || 0,
      fat: parseFloat(get('GRĂSIMI:')) || 0,
      carbs: parseFloat(get('CARBOHIDRAȚI:')) || 0,
      feedback: get('VERDICT:') || '',
      rawText: text
    };
  } catch (e) {
    return { description: 'Masă analizată', calories: 0, protein: 0, fat: 0, carbs: 0, feedback: text, rawText: text };
  }
}

// ============================================
// AI MOTIVATIONAL MESSAGES
// ============================================

export async function generateMotivationalMessage(profile, context) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: 'Ești Coach-ul AI PowerFit. Generează mesaje motivaționale scurte (1-2 propoziții) în română, directe și energice. Fără clișee. Personalizează pe baza datelor clientului.',
      messages: [{
        role: 'user',
        content: `Generează un mesaj motivațional pentru:
Nume: ${profile.full_name}
Ziua: ${profile.current_day}/14
Streak: ${profile.current_streak} zile
Nivel: ${profile.current_level}
Obiectiv: ${profile.goal}
Context: ${context}`
      }]
    });
    return response.content[0].text;
  } catch (error) {
    console.error('Motivational message error:', error);
    return `Zi bună, ${profile.full_name}! Hai să facem treabă azi. 💪`;
  }
}

// ============================================
// AI WEEKLY REVIEW
// ============================================

export async function generateWeeklyReview(profile, stats) {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: 'Ești Coach-ul AI PowerFit. Generează un review săptămânal concis în română. Fii direct, specific, și motivant. Maxim 200 cuvinte.',
      messages: [{
        role: 'user',
        content: `Generează review-ul săptămânal pentru:
Nume: ${profile.full_name}
Săptămâna: ${stats.weekNumber}
Antrenamente completate: ${stats.workoutsCompleted}/7
Dificultate medie: ${stats.avgDifficulty}/5
Mese logate: ${stats.mealsLogged}
Streak curent: ${profile.current_streak}
Nivel: ${profile.current_level} (${profile.total_points} puncte)
Obiectiv: ${profile.goal}
Zone de durere raportate: ${stats.painZones?.join(', ') || 'niciuna'}
Energie medie: ${stats.avgEnergy || 'nelogată'}

Structura review-ului:
📊 REVIEW SĂPTĂMÂNA ${stats.weekNumber}
[Rezumat date]
✅ Ce a mers bine: [specific]
⚠️ Ce poți îmbunătăți: [specific]  
🎯 Obiectiv săptămâna viitoare: [1 obiectiv concret]
💬 [Mesaj personal scurt]`
      }]
    });
    return response.content[0].text;
  } catch (error) {
    console.error('Weekly review error:', error);
    return null;
  }
}

// ============================================
// AI ANTI-CHURN MESSAGE
// ============================================

export async function generateAntiChurnMessage(profile, riskLevel, daysSinceLastActivity) {
  const intensity = riskLevel === 'high' ? 'urgent dar empatic' : riskLevel === 'medium' ? 'prietenos și încurajator' : 'casual și ușor';
  
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `Ești Coach-ul AI PowerFit. Scrie un mesaj de re-engagement în română. Tonul: ${intensity}. Maxim 2-3 propoziții. Nu fi pasiv-agresiv. Nu culpabiliza.`,
      messages: [{
        role: 'user',
        content: `Client: ${profile.full_name}
Ziua din program: ${profile.current_day}/14
Zile fără activitate: ${daysSinceLastActivity}
Streak pierdut: ${profile.current_streak === 0 ? 'da' : 'nu'}
Obiectiv: ${profile.goal}
Nivel risc: ${riskLevel}`
      }]
    });
    return response.content[0].text;
  } catch (error) {
    console.error('Anti-churn message error:', error);
    return `Hei ${profile.full_name}, am observat că nu ai fost activ recent. Totul ok? Sunt aici dacă ai nevoie. 💪`;
  }
}

export async function generateWelcomeMessage(profile) {
  const programName = profile.equipment === 'gym' ? 'Antrenament la sală' : 'Antrenament în aer liber';
  const goalText = profile.goal === 'fat_loss' ? 'pierdere grăsime' : profile.goal === 'toning' ? 'tonifiere' : 'creștere masă musculară';

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: 'Ești Coach-ul AI PowerFit. Scrie un mesaj de bun venit cald și energic în română. Maxim 4-5 propoziții. Include informații specifice din profilul clientului.',
      messages: [{
        role: 'user',
        content: `Client nou:
Nume: ${profile.full_name}
Obiectiv: ${goalText}
Program selectat: ${programName}
Nivel experiență: ${profile.experience_level}
Zile disponibile: ${profile.available_days}/săptămână

Menționează: programul selectat, că mâine dimineață la 8:00 primește primul reminder, și că poate scrie oricând pentru întrebări.`
      }]
    });
    return response.content[0].text;
  } catch (error) {
    return `Bine ai venit în PowerFit, ${profile.full_name}! 💪\n\nȚi-am pregătit programul de ${programName} bazat pe obiectivul tău de ${goalText}.\n\nMâine dimineață la 8:00 primești primul reminder. Între timp, poți să-mi scrii oricând dacă ai întrebări.\n\nHai să începem! 🔥`;
  }
}
