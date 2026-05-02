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
