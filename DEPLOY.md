# PowerFit MVP — Ghid de Deploy

## Arhitectura

```
start.powerfitro.com (Vercel)     →  Formular onboarding
   ↓ POST /api/onboarding
Backend (Railway)                  →  API + Telegram Bot + Cron Jobs
   ↓ citește/scrie
Supabase                           →  Baza de date PostgreSQL
   ↓ trimite mesaje
Telegram Bot (@PowerFitCoachBot)   →  Interfața clientului
```

---

## Pașii de Deploy (în ordine)

### Pas 1: Creează proiectul Supabase (5 min)

1. Du-te la https://supabase.com → New Project
2. Nume: `powerfit-mvp`
3. Parolă: generează una puternică
4. Regiunea: Frankfurt (EU Central) — cel mai aproape de România
5. După creare → Settings → API → copiază `URL` și `service_role key`
6. Du-te la SQL Editor → New Query
7. Copiază și rulează tot SQL-ul din `src/db/setup.js` (între backtick-uri)
8. Verifică în Table Editor că tabelele s-au creat

### Pas 2: Creează Telegram Bot (3 min)

1. Deschide Telegram → caută @BotFather
2. Scrie `/newbot`
3. Nume: `PowerFit Coach`
4. Username: `PowerFitCoachBot` (sau alt username disponibil)
5. Copiază token-ul primit
6. Scrie `/setdescription` → selectează bot-ul → scrie:
   `Coach-ul tău AI PowerFit. Antrenament, nutriție, și motivație — 24/7.`
7. `/setcommands` → selectează bot-ul → scrie:
   ```
   start - Conectează-te la PowerFit
   checkin - Loghează antrenamentul de azi
   status - Vezi progresul tău
   coach - Vorbește cu antrenorul
   help - Lista de comenzi
   ```
8. Trimite un mesaj bot-ului tău
9. Deschide: `https://api.telegram.org/bot<TOKEN>/getUpdates`
10. Copiază `chat.id` din răspuns — acesta e `TELEGRAM_ADMIN_CHAT_ID`

### Pas 3: Ia API key Claude (2 min)

1. Du-te la https://console.anthropic.com
2. Settings → API Keys → Create Key
3. Copiază cheia

### Pas 4: Deploy Backend pe Railway (10 min)

1. Du-te la https://railway.app → New Project → Deploy from GitHub repo
2. (Sau) New Project → Empty → Add Service → Docker (folosește `node:20`)
3. Încarcă codul din acest folder sau conectează repo-ul GitHub
4. Variables → Add toate variabilele din `.env.example`:
   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_KEY=...
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_ADMIN_CHAT_ID=...
   ANTHROPIC_API_KEY=...
   PORT=3000
   NODE_ENV=production
   TELEGRAM_BOT_USERNAME=PowerFitCoachBot
   COACH_NAME=NumeleAntrenorului
   ```
5. Settings → Start Command: `npm start`
6. Deploy → Verifică logurile

### Pas 5: Creează pagina de Onboarding (separat — React app pe Vercel)

Pagina de onboarding este o aplicație React separată care se deployează pe Vercel.
URL final: `start.powerfitro.com` (sau orice subdomain).

Aceasta este un formular multi-step care la submit face POST la:
`https://<railway-url>/api/onboarding`

(Codul pentru pagina de onboarding se va crea separat — este o aplicație React independentă)

### Pas 6: Configurare în ClickFunnels (15 min)

1. **Redenumește secțiunile:**
   - "Cosa fare una volta finito la sfida" → "După Program"
   - "First Section" → șterge sau redenumește

2. **Adaugă Dashboard iframe pe prima pagină:**
   - Editează prima pagină din membership area
   - Adaugă un Custom HTML block CA PRIM ELEMENT
   - Codul:
   ```html
   <div style="width:100%;max-width:800px;margin:0 auto;">
     <iframe 
       src="https://start.powerfitro.com/dashboard?email={{contact.email}}"
       style="width:100%;height:600px;border:none;border-radius:12px;"
       loading="lazy"
     ></iframe>
   </div>
   ```
   NOTĂ: `{{contact.email}}` este variabila ClickFunnels pentru email-ul logat.
   Dacă nu funcționează, testează cu `{{email}}` sau verifică documentația CF.

3. **Adaugă link onboarding în prima lecție:**
   - Sub dashboard, adaugă un text block:
   ```
   ⚡ Primul pas: Completează profilul tău de fitness
   👉 [Link: start.powerfitro.com]
   
   ⚡ Al doilea pas: Activează Coach-ul AI pe Telegram
   👉 [Link: t.me/PowerFitCoachBot]
   ```

---

## Testare

### Test 1: API Health Check
```bash
curl https://<railway-url>/api/health
# Răspuns: {"status":"ok","timestamp":"..."}
```

### Test 2: Onboarding
```bash
curl -X POST https://<railway-url>/api/onboarding \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@test.com",
    "full_name": "Test User",
    "sex": "male",
    "age": 30,
    "weight_kg": 85,
    "height_cm": 180,
    "experience_level": "beginner",
    "equipment": "gym",
    "goal": "fat_loss",
    "stress_level": 3,
    "sleep_hours": 7
  }'
```

### Test 3: Telegram Bot
1. Deschide bot-ul pe Telegram
2. Scrie `/start test@test.com` (email-ul de test)
3. Ar trebui să primești mesaj de bun venit
4. Scrie o întrebare: "Pot înlocui genuflexiunile?"
5. Trimite o poză cu mâncare
6. Scrie `/status`
7. Scrie `/checkin`
8. Scrie `/coach`

### Test 4: Dashboard
```bash
curl https://<railway-url>/api/dashboard/test@test.com
```

---

## Structura Fișierelor

```
powerfit-mvp/
├── package.json
├── .env.example
├── DEPLOY.md              ← Acest fișier
│
├── src/
│   ├── index.js           ← Entry point: startează tot
│   │
│   ├── api/
│   │   └── routes.js      ← Fastify API endpoints
│   │
│   ├── bot/
│   │   └── telegram.js    ← Telegram Bot: comenzi, chat AI, food log
│   │
│   ├── db/
│   │   ├── setup.js       ← Schema SQL pentru Supabase
│   │   └── supabase.js    ← Database queries
│   │
│   └── services/
│       ├── ai.js          ← Claude API: coach, food analysis, messages
│       ├── gamification.js← Puncte, nivele, streak-uri
│       └── cron.js        ← Scheduled jobs: check-in, anti-churn, review
│
└── onboarding/            ← (de creat separat) React app pentru formular
```

---

## Costuri Estimate (lunare, 20 useri activi)

| Serviciu | Plan | Cost |
|---|---|---|
| Railway | Hobby ($5) + usage | ~$8-12 |
| Supabase | Free tier | $0 |
| Claude API | Pay-per-use | ~$15-30 |
| Vercel | Free tier | $0 |
| Telegram | Gratuit | $0 |
| **Total** | | **~$23-42/lună** |

---

## Ce urmează după MVP

1. **Pagina de onboarding** (React app pe Vercel) — 3 zile
2. **Dashboard widget** (React component simplu) — 2 zile
3. **Testare cu 3-5 clienți beta** — 1 săptămână
4. **Iterație pe baza feedback-ului** — ongoing
5. **Faza 2: Leaderboard pe Telegram + Challenge-uri** — 2-3 zile extra
