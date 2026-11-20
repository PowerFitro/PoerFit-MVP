// ============================================
// HELPERS — Funcții utilitare reutilizabile
// ============================================
// Contract: funcții pure, fără side-effects, fără dependențe externe.
// Toate calculele de timp folosesc Europe/Bucharest (TZ unic al PowerFit).

const TZ = 'Europe/Bucharest';

/**
 * Returnează componentele orei curente în Europe/Bucharest.
 * Funcționează corect indiferent de TZ-ul serverului (Railway poate fi UTC).
 */
export function getRomaniaTime() {
  const now = new Date();
  
  // Folosim Intl.DateTimeFormat cu formatToParts pentru extragere fiabilă.
  // Alternativa cu toLocaleString + parse e fragilă (format diferă pe Node versiuni).
  const parts = new Intl.DateTimeFormat('ro-RO', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false
  }).formatToParts(now);
  
  const get = (type) => parts.find(p => p.type === type)?.value;
  
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const day = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10);
  const year = parseInt(get('year'), 10);
  const weekday = get('weekday'); // ex: "marți"
  
  return {
    hour,
    minute,
    day,
    month,
    year,
    weekday,
    timeString: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
}

/**
 * Returnează fereastra semantică a zilei + instrucțiuni contextuale pentru bot.
 * 
 * Ferestrele acoperă cazurile reale din dialogul Irina:
 * - "îmi e foame" la 22:00 → bot știe că e seară târzie
 * - "ce mănânc" la 6:00 → bot știe că e dimineață devreme
 */
/**
 * Returnează data curentă în Europe/Bucharest ca string YYYY-MM-DD.
 * Înlocuitor pentru new Date().toISOString().split('T')[0] care folosea UTC.
 */
export function getRomaniaDate() {
  return getRomaniaTime().dateString;
}

/**
 * Calculează ziua calendaristică în program (1-14) folosind data RO.
 * Returnează null dacă programStartDate lipsește.
 * Returnează 0 sau negativ dacă programul nu a început încă.
 * Returnează > 14 dacă programul s-a încheiat calendaristic.
 */
export function getCalendarProgramDay(programStartDate) {
  if (!programStartDate) return null;
  const todayRO = getRomaniaTime().dateString;
  const start = new Date(programStartDate + 'T00:00:00');
  const today = new Date(todayRO + 'T00:00:00');
  const diffMs = today - start;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}

// ============================================
// SURSA UNICĂ DE ADEVĂR — FAZA USERULUI
// ============================================
// getUserPhase este SINGURUL loc unde se decide în ce fază e un user.
// telegram.js, ai.js și cron.js o apelează — niciodată nu calculează faza local.
// Astfel cele trei nu se pot contrazice: citesc aceeași funcție, primesc același rezultat.
//
// MODELUL "14 + 30":
//   - Programul are 14 zile calendaristice. Zilele 7 și 14 = odihnă (nu se bifează).
//   - Antrenamente reale de bifat: 12 (zilele 1-6, 8-13).
//   - După Z14 calendaristic: 30 de zile fereastră de recuperare (zilele 15-44).
//   - După ziua 44: acces expirat.
//
// CELE DOUĂ NUMERE — fiecare cu UN rol, niciodată amestecate:
//   - calendarDay = ziua calendaristică (din program_start_date). Pentru afișaj "Ziua X/14".
//   - bifate = antrenamente reale bifate (profile.current_day, 0-12). Pentru progres real.
//
// FAZE returnate (câmpul .phase):
//   'pre_program' — programul nu a început (calendarDay <= 0 sau lipsă dată)
//   'activ'       — calendarDay 1-14, mai are antrenamente de făcut
//   'terminat'    — a bifat toate 12 antrenamentele (oricând, indiferent de calendar)
//   'recuperare'  — calendarDay 15-44, încă are antrenamente nebifate
//   'expirat'     — calendarDay > 44, încă are antrenamente nebifate (acces închis)

export const TOTAL_WORKOUTS = 12;        // antrenamente reale (14 zile - 2 zile odihnă)
export const PROGRAM_CALENDAR_DAYS = 14; // durata calendaristică a programului
export const RECOVERY_WINDOW_DAYS = 30;  // fereastra de recuperare după Z14
const LAST_ACCESS_DAY = PROGRAM_CALENDAR_DAYS + RECOVERY_WINDOW_DAYS; // ziua 44

/**
 * Determină faza curentă a unui user. Funcție pură — nu scrie nimic, nu apelează DB.
 *
 * @param {Object} profile - profilul userului (are nevoie de program_start_date și current_day)
 * @returns {Object} obiect cu:
 *   - phase: 'pre_program' | 'activ' | 'terminat' | 'recuperare' | 'expirat'
 *   - calendarDay: number|null — ziua calendaristică (null dacă nu există dată de start)
 *   - bifate: number — antrenamente reale bifate (0-12)
 *   - ramase: number — antrenamente rămase de bifat (0-12)
 *   - isRestDay: boolean — true dacă azi e zi calendaristică de odihnă (7 sau 14)
 *   - daysUntilAccessEnds: number|null — zile rămase până expiră accesul (doar în faza recuperare)
 */
export function getUserPhase(profile) {
  const calendarDay = getCalendarProgramDay(profile?.program_start_date);

  // bifate = antrenamente reale bifate. Sanitizare: clamp în [0, TOTAL_WORKOUTS].
  // Dacă current_day e null/undefined/negativ → 0. Dacă depășește 12 → 12.
  let bifate = Number(profile?.current_day) || 0;
  if (bifate < 0) bifate = 0;
  if (bifate > TOTAL_WORKOUTS) bifate = TOTAL_WORKOUTS;
  const ramase = TOTAL_WORKOUTS - bifate;

  const finishedAll = bifate >= TOTAL_WORKOUTS;

  // PRE-PROGRAM: programul nu a început încă (sau lipsă dată de start)
  if (calendarDay === null || calendarDay <= 0) {
    return {
      phase: 'pre_program',
      calendarDay,
      bifate,
      ramase,
      isRestDay: false,
      daysUntilAccessEnds: null,
    };
  }

  // TERMINAT: a bifat toate 12 antrenamentele. Are prioritate peste calendar —
  // un user care termină devreme e "terminat", indiferent ce zi calendaristică e.
  if (finishedAll) {
    return {
      phase: 'terminat',
      calendarDay,
      bifate,
      ramase: 0,
      isRestDay: calendarDay === 7 || calendarDay === 14,
      daysUntilAccessEnds: null,
    };
  }

  // De aici încolo: finishedAll === false (mai are antrenamente de făcut).
  const isRestDay = calendarDay === 7 || calendarDay === 14;

  // ACTIV: în interiorul celor 14 zile calendaristice
  if (calendarDay >= 1 && calendarDay <= PROGRAM_CALENDAR_DAYS) {
    return {
      phase: 'activ',
      calendarDay,
      bifate,
      ramase,
      isRestDay,
      daysUntilAccessEnds: null,
    };
  }

  // RECUPERARE: calendarul a trecut de Z14, dar mai sunt zile de acces (15-44)
  if (calendarDay > PROGRAM_CALENDAR_DAYS && calendarDay <= LAST_ACCESS_DAY) {
    return {
      phase: 'recuperare',
      calendarDay,
      bifate,
      ramase,
      isRestDay: false, // în recuperare nu mai există zile de odihnă programate
      daysUntilAccessEnds: LAST_ACCESS_DAY - calendarDay,
    };
  }

  // EXPIRAT: calendarul a depășit ziua 44 și userul tot nu a terminat
  return {
    phase: 'expirat',
    calendarDay,
    bifate,
    ramase,
    isRestDay: false,
    daysUntilAccessEnds: 0,
  };
}

/**
 * Mapează "al N-lea antrenament" la ziua de program corespunzătoare.
 * Zilele 7 și 14 sunt odihnă (fără antrenament), deci numerotarea sare peste ele.
 *
 *   antrenament 1..6  → ziua 1..6
 *   antrenament 7     → ziua 8   (sare peste ziua 7 = odihnă)
 *   antrenament 8..12 → ziua 9..13
 *
 * @param {number} workoutNumber - al câtelea antrenament (1-12)
 * @returns {number|null} ziua de program (1-13), sau null dacă workoutNumber e în afara 1-12
 */
export function workoutNumberToProgramDay(workoutNumber) {
  const n = Number(workoutNumber);
  if (!Number.isFinite(n) || n < 1 || n > TOTAL_WORKOUTS) return null;
  // Primele 6 antrenamente = zilele 1-6. De la al 7-lea, se adaugă 1 (ziua 7 = odihnă).
  return n <= 6 ? n : n + 1;
}

/**
 * Câte antrenamente ar trebui să aibă bifate, la ÎNCEPUTUL zilei calendaristice X,
 * un user care e "la zi". Antrenamentul zilei X se face ÎN cursul zilei X — deci
 * la începutul zilei X sunt datorate doar antrenamentele zilelor anterioare (1..X-1).
 *
 *   ziua 1   → 0  (prima zi, nimic de făcut încă)
 *   ziua 6   → 5  (zilele 1-5 făcute; ziua 6 se face azi)
 *   ziua 7   → 6  (zilele 1-6; ziua 7 = odihnă)
 *   ziua 8   → 6  (ziua 7 a fost odihnă, zero antrenament)
 *   ziua 13  → 11
 *   ziua 14  → 12 (toate; ziua 14 = odihnă)
 *
 * Folosit pentru a decide dacă un user e "în urmă" — bifate < datorate.
 *
 * @param {number} calendarDay - ziua calendaristică (1-14+)
 * @returns {number} antrenamente datorate la începutul zilei (0-12)
 */
export function expectedWorkoutsByDay(calendarDay) {
  const d = Number(calendarDay);
  if (!Number.isFinite(d) || d < 1) return 0;
  if (d > PROGRAM_CALENDAR_DAYS) return TOTAL_WORKOUTS; // după ziua 14 → toate 12
  // Datorate = zile de antrenament în intervalul [1, d-1].
  // Zilele de antrenament sunt 1-6 și 8-13 (7 și 14 = odihnă).
  let count = 0;
  for (let day = 1; day <= d - 1; day++) {
    if (day !== 7 && day !== 14) count++;
  }
  return count;
}

export function getTimeWindow(hour) {
  if (hour >= 5 && hour < 10) {
    return {
      window: 'dimineață',
      label: 'dimineața devreme',
      // Reguli care intră direct în system prompt
      rules: 'Clientul tocmai s-a trezit. Sugestii pentru mic dejun, hidratare, pregătire zi. Nu menționa antrenament dacă nu e clar că merge acum la sală.'
    };
  }
  if (hour >= 10 && hour < 12) {
    return {
      window: 'dimineață târzie',
      label: 'spre prânz',
      rules: 'Fereastră normală pentru gustare sau pregătire prânz. Antrenament posibil oricând.'
    };
  }
  if (hour >= 12 && hour < 15) {
    return {
      window: 'prânz',
      label: 'la prânz',
      rules: 'Sugestii pentru masa de prânz din program. Antrenament posibil în câteva ore.'
    };
  }
  if (hour >= 15 && hour < 18) {
    return {
      window: 'după-amiază',
      label: 'după-amiaza',
      rules: 'Fereastra cea mai comună pentru antrenament. Gustare ușoară pre-workout potrivită.'
    };
  }
  if (hour >= 18 && hour < 21) {
    return {
      window: 'seară',
      label: 'seara',
      rules: 'Antrenament încă posibil dacă nu a fost făcut. Sugestii cină din program. Nu împinge antrenament dacă pare obosit.'
    };
  }
  if (hour >= 21 && hour < 24) {
    return {
      window: 'seară târzie',
      label: 'seara târziu',
      // CRITIC: rezolvă bug-ul Irina cu pizza/foamea la 22:00
      rules: 'NU sugera antrenament. NU sugera "gustare pre-workout". Dacă cere mâncare, oferă opțiuni de cină din program sau gustare ușoară pre-somn (proteine + grăsimi bune, fără carbohidrați rapizi). Recomandă să nu se culce flămând.'
    };
  }
  // 0-5
  return {
    window: 'noapte',
    label: 'în toiul nopții',
    rules: 'Ora foarte târzie/devreme. Răspunde scurt, calm. Nu sugera antrenament sau mese complete. Eventual hidratare. Sugerează somn dacă e cazul.'
  };
}

/**
 * Construiește blocul TIME_CONTEXT pentru injectare în system prompt.
 * Include și ora ultimului antrenament bifat azi (dacă există).
 * 
 * @param {Object|null} todayWorkout - Checkin-ul de azi din daily_checkins, sau null
 * @returns {string} - Bloc text pentru system prompt
 */
export function buildTimeContext(todayWorkout = null) {
  const t = getRomaniaTime();
  const w = getTimeWindow(t.hour);
  
  let workoutLine = 'Clientul NU a bifat încă antrenament astăzi.';
  if (todayWorkout && todayWorkout.workout_completed) {
    // Extragem ora bifării (created_at sau updated_at) în Europe/Bucharest
    const checkinTime = todayWorkout.created_at || todayWorkout.updated_at;
    let timeFormatted = null;
    
    if (checkinTime) {
      // Validare timestamp — dacă e invalid, nu crăpăm, doar omitem ora
      const dateObj = new Date(checkinTime);
      if (!isNaN(dateObj.getTime())) {
        try {
          const parts = new Intl.DateTimeFormat('ro-RO', {
            timeZone: TZ,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).formatToParts(dateObj);
          const h = parts.find(p => p.type === 'hour')?.value;
          const m = parts.find(p => p.type === 'minute')?.value;
          if (h && m) timeFormatted = `${h}:${m}`;
        } catch (e) {
          // Silent fail — context-ul rămâne util fără ora exactă
        }
      }
    }
    
    workoutLine = timeFormatted
      ? `Clientul A BIFAT deja antrenamentul astăzi (la ora ${timeFormatted}). NU îl mai trimite la sală pentru azi.`
      : 'Clientul A BIFAT deja antrenamentul astăzi. NU îl mai trimite la sală pentru azi.';
  }
  
  return `
=============================================
CONTEXT TEMPORAL CURENT (Europe/Bucharest)
=============================================
Ora curentă: ${t.timeString}, ${t.weekday}, ${t.dateString}
Fereastra zilei: ${w.window} (${w.label})

REGULI PENTRU FEREASTRA CURENTĂ:
${w.rules}

STATUS ANTRENAMENT AZI:
${workoutLine}
`;
}

// ============================================
// NUTRIȚIE — SURSĂ UNICĂ DE CALCUL (determinist)
// ============================================
// computeNutrition este SINGURUL loc unde se calculează aportul caloric și
// macronutrienții. Funcție pură: aceleași intrări → aceleași ieșiri, mereu.
// Apelată de routes.js (onboarding) ȘI de ai.js (context bot) — cele două nu se
// mai pot contrazice, fiindcă rulează exact aceeași funcție.
//
// MODELUL (validat pe cifrele PowerFit):
//   Caloriile depind DOAR de sex + greutate (NU de grăsime).
//   Ziua mare = funcție continuă, liniară pe segmente de greutate.
//   Ziua mică = ziua mare − 200 kcal (diferențial constant).
//   Structura săptămânii: 5 zile mari + 2 zile mici.
//
//   BĂRBAȚI, ziua mare (kcal), continuu:
//     ≤60 kg → 1500 (prag inferior)
//     60-70  → 1500…1600
//     70-80  → 1600…1700
//     80-100 → 1700…1850
//     100-110→ 1850…2000 (rampă)
//     >110   → 2000 (prag superior)
//   FEMEI, ziua mare (kcal), continuu:
//     ≤65 kg → 1300 (prag inferior)
//     65-85  → 1300…1600
//     >85    → 1600 (prag superior)
//
// MACRONUTRIENȚI (doar dacă se dă procentul de grăsime corporală):
//   Masă slabă = greutate × (1 − grăsime%/100)
//   Proteine = 2.4 g/kg masă slabă (capăt sus — protejează mușchiul în deficit)
//   Grăsimi  = 0.9 g/kg masă slabă
//   Carbohidrați = restul caloriilor, calculat SEPARAT pentru ziua mare și mică.
//   Proteinele și grăsimile sunt identice în toate zilele; doar carbohidrații diferă.

/**
 * Calculează aportul caloric (și macronutrienții, dacă e dat procentul de grăsime).
 * Funcție pură — nu scrie nimic, nu apelează DB, nu inventează.
 *
 * @param {string} sex - 'male' sau 'female'
 * @param {number} weightKg - greutatea corporală în kg
 * @param {number|null} bodyFatPct - procent grăsime corporală (ex: 20 pentru 20%). Opțional.
 * @returns {Object|null} null dacă greutatea lipsește/e invalidă. Altfel:
 *   { highDayKcal, lowDayKcal } — mereu.
 *   + { bodyFatPct, leanMassKg, proteinG, fatG, carbsHighG, carbsLowG } — dacă grăsimea e validă (3-60%).
 */
export function computeNutrition(sex, weightKg, bodyFatPct = null) {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return null;
  const isMale = sex === 'male';

  // --- ZIUA MARE: funcție continuă, liniară pe segmente ---
  let highDay;
  if (isMale) {
    if (w <= 60) highDay = 1500;
    else if (w <= 70) highDay = 1500 + (w - 60) * 10;    // 1500 → 1600
    else if (w <= 80) highDay = 1600 + (w - 70) * 10;    // 1600 → 1700
    else if (w <= 100) highDay = 1700 + (w - 80) * 7.5;  // 1700 → 1850
    else if (w <= 110) highDay = 1850 + (w - 100) * 15;  // 1850 → 2000 (rampă)
    else highDay = 2000;
  } else {
    if (w <= 65) highDay = 1300;
    else if (w <= 85) highDay = 1300 + (w - 65) * 15;    // 1300 → 1600
    else highDay = 1600;
  }

  // Rotunjire la 10 kcal — cifre curate pentru client, fără să pierdem gradientul.
  highDay = roundHalfUp(highDay / 10) * 10;
  const lowDay = highDay - 200;

  const result = { highDayKcal: highDay, lowDayKcal: lowDay };

  // --- MACRONUTRIENȚI: doar dacă procentul de grăsime e prezent și plauzibil ---
  // Aceiași pași și aceleași rotunjiri ca în fișierul Excel al cursului și în
  // calculatorul din lecție (curs.powerfitro.com): grăsimea în kg și masa slabă
  // se rotunjesc la o zecimală ÎNAINTE de a calcula gramele. Astfel botul,
  // Excel-ul și calculatorul dau aceleași cifre, la gram.
  const bf = Number(bodyFatPct);
  if (Number.isFinite(bf) && bf >= 3 && bf <= 60) {
    const fatMassKg = roundHalfUp((w * bf) / 100 * 10) / 10;
    const lean = roundHalfUp((w - fatMassKg) * 10) / 10;
    const proteinG = roundHalfUp(lean * 2.4);
    const fatG = roundHalfUp(lean * 0.9);
    // Carbohidrații = restul caloriilor. Clamp la 0 ca să nu iasă negativ la
    // cazuri extreme (foarte slab + foarte greu). Pentru publicul-țintă nu apare.
    const carbsHighG = Math.max(0, roundHalfUp((highDay - proteinG * 4 - fatG * 9) / 4));
    const carbsLowG = Math.max(0, roundHalfUp((lowDay - proteinG * 4 - fatG * 9) / 4));
    result.bodyFatPct = bf;
    result.leanMassKg = lean;
    result.proteinG = proteinG;
    result.fatG = fatG;
    result.carbsHighG = carbsHighG;
    result.carbsLowG = carbsLowG;
  }

  return result;
}

// Rotunjire obișnuită la întreg (jumătatea în sus), fără surprizele zecimalelor
// binare (ex. 64.05 * 10 = 640.4999… în JavaScript).
function roundHalfUp(x) {
  return Math.round(Number(x.toFixed(6)));
}

// ============================================
// GREUTATE ȘI PROCENT DE GRĂSIME SPUSE DE CLIENT ÎN CHAT
// ============================================
// Clientul poate scrie în mesaj o greutate diferită de cea din profil
// ("am 80 kg, 20% grăsime"). Cifrele se extrag AICI, în cod, cu reguli fixe —
// nu de către model — iar calculul rămâne în computeNutrition.
//
// Reguli prudente, ca să nu confundăm greutatea corporală cu altceva:
//  - greutate: un număr între 40 și 200 urmat de kg / kilograme / kile;
//  - nu se ia un număr care este o țintă ("vreau să ajung la 75 kg", "să slăbesc 10 kg");
//  - nu se ia din mesaje despre greutăți de antrenament ("genuflexiuni cu 80 kg"),
//    decât dacă în același mesaj apare și procentul de grăsime;
//  - fără procent în mesaj, greutatea se ia doar dacă mesajul vorbește despre
//    corp sau despre nutriție ("cântăresc", "greutatea mea", "am … kg", "calorii", "macro");
//  - procent de grăsime: un număr între 5 și 60 urmat de % / "la sută" / "procente",
//    doar dacă mesajul pomenește grăsimea, conține și greutatea corporală,
//    sau este un răspuns scurt de tipul "20%".

const KG_NUMBER = /(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:de\s+)?(?:kg|kilograme|kilogram|kile|kilo)(?![a-zăâîșț])/g;
const PCT_NUMBER = /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:%|la\s+sut[ăa]|procente?)/g;
const TARGET_BEFORE = /(ajung[ei]?\s+la|[țt]int[ăa]|obiectiv|sl[ăa]besc|sl[ăa]bi|dau\s+jos|pierd|scad|p[âa]n[ăa]\s+la)[^.!?\d]{0,25}$/;
const LOAD_WORDS = /genuflex|[îi]mpins|ramat|[îi]ndrept|trac[țt]iun|flot[ăa]r|pres[ăa](?![a-zăâîșț])|bar[ăa](?![a-zăâîșț])|halter|ganter|kettlebell|repet[ăa]r|\bseturi?\b|ridic/;
const BODY_WORDS = /c[âa]nt[ăa]r|greutat|\bam\b|\bsunt\b/;
const NUTRITION_WORDS = /calori|kcal|macro|protein|carbo|gr[ăa]sim|aport|m[ăa]n[âa]nc|nutri/;
const FAT_WORDS = /gr[ăa]sim|adipos|body\s*fat|\bbf\b/;
const SHORT_PCT_REPLY = /^\s*(?:am\s+|cam\s+|aproximativ\s+|circa\s+|vreo\s+)?\d{1,2}(?:[.,]\d{1,2})?\s*(?:%|la\s+sut[ăa]|procente?)\s*[.!]?\s*$/;

const toNumber = (s) => Number(String(s).replace(',', '.'));

/**
 * Extrage dintr-un singur mesaj greutatea corporală și procentul de grăsime,
 * dacă sunt spuse limpede. Funcție pură.
 * @param {string} text
 * @returns {{ weightKg: number|null, bodyFatPct: number|null }}
 */
export function parseBodyNumbers(text) {
  const out = { weightKg: null, bodyFatPct: null };
  if (typeof text !== 'string' || !text.trim()) return out;
  const t = text.toLowerCase();

  // --- candidați pentru greutate ---
  let weight = null;
  for (const m of t.matchAll(KG_NUMBER)) {
    const value = toNumber(m[1]);
    if (!(value >= 40 && value <= 200)) continue;
    if (TARGET_BEFORE.test(t.slice(0, m.index))) continue;
    weight = value;
    break;
  }

  // --- candidați pentru procentul de grăsime ---
  let pct = null;
  for (const m of t.matchAll(PCT_NUMBER)) {
    const value = toNumber(m[1]);
    if (!(value >= 5 && value <= 60)) continue;
    pct = value;
    break;
  }
  const pctIsBodyFat = pct !== null && (FAT_WORDS.test(t) || weight !== null || SHORT_PCT_REPLY.test(t));
  if (pctIsBodyFat) out.bodyFatPct = pct;

  if (weight !== null) {
    const aboutBody = BODY_WORDS.test(t) || NUTRITION_WORDS.test(t);
    if (out.bodyFatPct !== null || (!LOAD_WORDS.test(t) && aboutBody)) out.weightKg = weight;
  }
  return out;
}

/**
 * Caută în conversație (de la cel mai nou mesaj al clientului spre cele vechi)
 * ultima greutate corporală și ultimul procent de grăsime spuse de client.
 * @param {Array<{role: string, content: string}>} messages - în ordine cronologică
 * @returns {{ weightKg: number|null, bodyFatPct: number|null }}
 */
export function findStatedBodyNumbers(messages) {
  const out = { weightKg: null, bodyFatPct: null };
  if (!Array.isArray(messages)) return out;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;
    const found = parseBodyNumbers(msg.content);
    if (out.weightKg === null && found.weightKg !== null) out.weightKg = found.weightKg;
    if (out.bodyFatPct === null && found.bodyFatPct !== null) out.bodyFatPct = found.bodyFatPct;
    if (out.weightKg !== null && out.bodyFatPct !== null) break;
  }
  return out;
}
