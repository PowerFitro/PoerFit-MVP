// ============================================
// PowerFit — Program oficial 14 zile
// Sursă unică de adevăr pentru AI și bot
// 2 variante: gym (sală) și outdoor (aer liber)
// ============================================
//
// STRUCTURĂ:
// - PROGRAM[equipment][dayNumber] returnează obiectul zilei
// - Fiecare zi: { title, focus, isRest, isCardio, exercises[], cardio, notes }
// - Ziua 7 și Ziua 14 = odihnă (isRest: true, fără exerciții)
// - Ziua 4 și Ziua 11 = cardio dedicat (isCardio: true)
//
// API public:
// - getProgramDay(dayNumber, equipment) → obiectul zilei
// - formatDayForAI(dayNumber, equipment) → text structurat pentru system prompt
// - getDayShortLabel(dayNumber, equipment) → label scurt pentru morning checkin

// ============================================
// SĂPTĂMÂNA 1 — GYM (SALĂ)
// ============================================

const GYM_WEEK_1 = {
  1: {
    title: 'Picioare, Piept și Abdomen',
    focus: ['picioare', 'piept', 'abdomen'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Fandări din mers cu gantere',
        sets: '5 seturi (ultimul opțional)',
        reps: 'progresiv: 20 fără greutăți / 12 / 10 / 8 / 6-8 pe fiecare picior',
        effort: '70% → 100% în ultimele seturi',
        rest: '2,5-3 min',
        notes: 'Dacă nu atingi efortul maxim în ultimele repetări, crește greutatea.'
      },
      {
        name: 'Îndreptări parțiale cu bară',
        sets: '3',
        reps: '10',
        effort: 'aproape maxim în ultimele repetări',
        rest: '2 min'
      },
      {
        name: 'Super Set: Presă orizontală picioare + Împins gantere bancă orizontală',
        sets: '4 super seturi (+ 1 încălzire)',
        reps: '10-12 / 10-12',
        effort: '100% în ultimele repetări',
        rest: '3 min între super seturi'
      },
      {
        name: 'Împins cu gantere de pe bancă înclinată',
        sets: '4',
        reps: '8-10',
        effort: '100% (la ultimele 1-2 repetări cere asistență ușoară)',
        rest: '2 min'
      },
      {
        name: 'Crunch la aparat cu greutate (abdomen)',
        sets: '5',
        reps: 'până la epuizare musculară',
        rest: '30 sec'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm',
    notes: 'Încălzire 5 min cardio + Jumping Jacks (15 sec ON / 15 sec OFF) + stretching'
  },

  2: {
    title: 'Spate, Umeri, Abdomen, Lombari',
    focus: ['spate', 'umeri', 'abdomen', 'lombari'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Lat Pulldown cu priză largă (la aparat)',
        sets: '4 (+ 1 încălzire)',
        reps: '8-10',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Ramat cu gantera, din înclinare',
        sets: '3',
        reps: '8-10',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Ramat la cablu jos cu priză triunghiulară',
        sets: '4',
        reps: '7-8',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Super Set Umeri: Împins gantera deasupra capului + Ridicări laterale',
        sets: '4 super seturi',
        reps: '8-10 / 10-12 per braț',
        effort: '100%',
        rest: '2-3 min',
        notes: 'Execută ambele exerciții întâi cu un braț, apoi cu celălalt.'
      },
      {
        name: 'Fluturări inverse la aparat (deltoid posterior)',
        sets: '3',
        reps: '10-12',
        effort: '100%',
        rest: '1-1,5 min',
        notes: 'Concentrează-te pe control total al mișcării, fără inerție.'
      },
      {
        name: 'Super Set: Crunch + Hipereextensii',
        sets: '3 super seturi',
        reps: '20 / 12-15',
        rest: 'fără pauză între cele două',
        notes: 'Hipereextensii lente, cu pauză în contracție.'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  3: {
    title: 'Brațe, Picioare, Gambe',
    focus: ['biceps', 'triceps', 'picioare', 'gambe'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Super Set Brațe: Flexii cu bara picioare + Împins bara priză îngustă (triceps)',
        sets: '4 super seturi',
        reps: '8-10 / 8-10',
        effort: '100%',
        rest: '2 min',
        notes: 'Alternativă flexii: flexii concentrate cu gantera din șezut.'
      },
      {
        name: 'Gold Set Biceps & Triceps (circuit gigant fără pauză)',
        sets: '3-4 circuite',
        reps: 'Flexii gantere picioare 10/braț → French Press EZ până la epuizare → Flexii gantere șezut până la epuizare → Kickbacks la scripete până la epuizare',
        rest: '2-3 min între circuite',
        notes: 'Folosește o singură greutate pe parcursul circuitului. Dacă nu poți face 6 repetări, scade greutatea.'
      },
      {
        name: 'Super Set Picioare: Leg Extension + Leg Curl',
        sets: '4 super seturi',
        reps: '12-15 / 12-15',
        effort: 'aproape 100%',
        rest: '1,5-2 min',
        notes: 'Menține poziția 1 sec în contracție maximă.'
      },
      {
        name: 'Super Set Abductori + Adductori la aparat',
        sets: '3 super seturi',
        reps: '15 / 15',
        effort: '100%',
        rest: '1,5 min',
        notes: 'Femei: obligatoriu. Bărbați: opțional, recomandat pentru articulația șoldului sau peste 40 ani.'
      },
      {
        name: 'Gambe — Calf raise la presă sau din șezut/picioare',
        sets: '7 seturi consecutive',
        reps: '15 / 8 / 6 / 6 / 6 / 6 / 6',
        rest: '15 sec între seturi',
        notes: 'Greutate aleasă pentru 15 repetări de calitate. Total exercițiu: 4-5 min.'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  4: {
    title: 'Cardio HIIT',
    focus: ['cardio'],
    isRest: false,
    isCardio: true,
    exercises: [],
    cardio: 'Alergare cu intervale: 5 min lent → 6× (sprint 20-30 sec + 4 min lent) → 5-7 min revenire foarte lentă',
    notes: 'După fiecare sprint, așteaptă să scadă pulsul la 75-80% din maxim înainte de următorul. Dacă simți oboseală acumulată, ia o zi pauză completă (forță + cardio). Programul se decalează cu o zi.'
  },

  5: {
    title: 'Exerciții fundamentale + Grup muscular deficitar',
    focus: ['multiarticulare', 'deficitar'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Step-up pe bancă cu gantere',
        sets: '4',
        reps: '12-15 pe fiecare picior',
        effort: 'aproape 100%',
        rest: '2-3 min'
      },
      {
        name: 'Super Set Piept + Spate: Bench press orizontal + Ramat bara EZ',
        sets: '5 (avansați) / 3-4 (începători), + 1-2 încălzire fiecare',
        reps: '6-8 (piramidă 12-10-8-6-5) / 8-10',
        effort: '100%',
        rest: '3 min'
      },
      {
        name: 'Împins deasupra capului cu ganteră (sau kettlebell), din picioare',
        sets: '4',
        reps: '10-12 pe fiecare braț',
        effort: 'aproape 100%',
        rest: '2-3 min'
      },
      {
        name: 'Grup muscular deficitar (la alegere)',
        sets: '3-4',
        reps: 'depinde de exercițiu',
        effort: 'aproape maxim',
        rest: '1,5-2 min',
        notes: 'BĂRBAȚI: alegi tu grupa care necesită dezvoltare prioritară (ex: umeri laterali, triceps, gambe etc.) și un exercițiu de izolare. Spune-mi ce grupă alegi și-ți recomand exerciții concrete. FEMEI: Hip Thrust 4×15 + Fandări bulgărești 3×15 pe fiecare picior.'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  6: {
    title: 'Volum total — Tracțiuni 50 + Dips 80 + Sumo Squat/Leg Press 100',
    focus: ['volum total', 'spate', 'piept', 'picioare'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Tracțiuni la bară priză largă',
        sets: 'liber, până ajungi la 50 repetări',
        reps: '50 total (împarte cum poți)',
        notes: 'Fără greutăți suplimentare. Dacă nu poți face 6+ repetări, folosește bandă elastică sau gravitron pentru a ajunge la 8-10/set. Notează timpul total — săptămâna viitoare îl bați.'
      },
      {
        name: 'Dips la paralele',
        sets: 'liber, până ajungi la 80 repetări',
        reps: '80 total',
        notes: 'Fără greutăți. Asistență dacă e nevoie pentru 10-12 repetări corecte. Notează timpul.'
      },
      {
        name: 'Genuflexiuni Sumo cu gantere SAU Leg Press',
        sets: 'liber, până ajungi la 100 repetări',
        reps: '100 total',
        notes: 'Sumo Squat: gantere = 50% greutate corporală. Leg Press: greutate = greutate corporală (fără platformă). Pauze la discreție. Notează timpul.'
      }
    ],
    cardio: 'Mers în pantă 4 km, FC 115-130 bpm'
  },

  7: {
    title: 'Zi de odihnă',
    focus: ['recuperare'],
    isRest: true,
    isCardio: false,
    exercises: [],
    cardio: null,
    notes: 'Corpul se recuperează și crește azi. Respectă strict planul alimentar și odihnește-te. Mâine revenim la treabă.'
  }
};

// ============================================
// SĂPTĂMÂNA 2 — GYM (SALĂ)
// ============================================

const GYM_WEEK_2 = {
  8: {
    title: 'Picioare (bază), Brațe, Abdomen',
    focus: ['picioare', 'biceps', 'triceps', 'abdomen'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Genuflexiuni cu bară (Back Squat) — cu activare prealabilă: 40 pași fandări (20/picior)',
        sets: '4-5 (ultimul opțional)',
        reps: 'progresiv: 15 / 12 / 10 / 8-10 / 8-10',
        effort: '70% → 100% în ultimele seturi',
        rest: '3 min'
      },
      {
        name: 'Step-up pe bancă cu gantere',
        sets: '3-4 (ultimul opțional)',
        reps: '12 / 12 / 10-12 / 8-10 pe fiecare picior',
        effort: '80% → 100%',
        rest: '3 min'
      },
      {
        name: 'Super Set Brațe #1: Flexii bara la banca Scott + Pushdown scripete cu frânghie',
        sets: '3-4 (+ 1 încălzire)',
        reps: '8-10 / 10-12',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Super Set Brațe #2: Hammer curls picioare + Extensii frânghie deasupra capului',
        sets: '3-4 (+ 1 încălzire)',
        reps: '8-10 / 10-12',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Super Set Abdomen + Lombari: Ridicări picioare la paralele + Hipereextensii',
        sets: '3-4 super seturi',
        reps: 'până la epuizare / 12-15',
        rest: '30 sec',
        notes: 'Hipereextensii cu pauză scurtă în contracție.'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  9: {
    title: 'Spate, Piept',
    focus: ['spate', 'piept'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Super Set #1: Împins gantere bancă înclinată + Lat Pulldown cu priză triunghiulară',
        sets: '4 (+ 1 încălzire)',
        reps: '8-10 / 10-12',
        effort: '100%',
        rest: '2-3 min'
      },
      {
        name: 'Super Set #2: Fluturări gantere bancă orizontală + Ramat la cablu jos cu priză triunghiulară (din șezut)',
        sets: '4 (+ 1 încălzire)',
        reps: '10-12 / 8-10',
        effort: '100%',
        rest: '2-3 min'
      },
      {
        name: 'Super Set #3: Ramat ganteră din înclinare + Fluturări la cabluri (crossover)',
        sets: '4 (+ 1 încălzire)',
        reps: '8-10 per braț / 10-12',
        effort: '100%',
        rest: '2-3 min',
        notes: 'La crossover concentrează-te pe contracția pieptului, cu pauze scurte în alungire și contracție maximă.'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  10: {
    title: 'Umeri, Picioare, Gambe, Abdomen',
    focus: ['umeri', 'picioare', 'gambe', 'abdomen'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Împins deasupra capului cu gantere, din șezut',
        sets: '4 (+ 1 încălzire)',
        reps: '8-10',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Ramat vertical cu bara (tiraje la bărbie)',
        sets: '3 (+ 1 încălzire)',
        reps: '8-10',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Peck Deck pentru deltoizi posteriori (fluturări inverse la aparat)',
        sets: '3',
        reps: '10-12',
        effort: '100%',
        rest: '1-1,5 min',
        notes: 'Control maxim, inerție minimă.'
      },
      {
        name: 'Ridicări laterale la aparat (deltoid lateral)',
        sets: '4',
        reps: '12',
        effort: '100%',
        rest: '1,5 min',
        notes: 'Fără inerție.'
      },
      {
        name: 'Super Set Picioare: Leg Extension + Leg Curl',
        sets: '4 super seturi',
        reps: '12-15 / 12-15',
        effort: 'aproape 100%',
        rest: '1,5-2 min'
      },
      {
        name: 'Super Set Abductori + Adductori',
        sets: '3 super seturi',
        reps: '15 / 15',
        effort: 'aproape 100%',
        rest: '1,5 min'
      },
      {
        name: 'Gambe — Calf raise la presă sau aparat',
        sets: '7 seturi pe fiecare gambă',
        reps: '15 / 8 / 6 / 6 / 6 / 6 / 6',
        rest: '15 sec'
      },
      {
        name: 'Super Set Abdomen: Crunch clasic + Ridicări picioare',
        sets: '3 super seturi',
        reps: '20 / până la epuizare',
        rest: '45-60 sec'
      }
    ],
    cardio: 'Zi de odihnă cardio'
  },

  11: {
    title: 'Cardio Intervale',
    focus: ['cardio'],
    isRest: false,
    isCardio: true,
    exercises: [],
    cardio: 'OPȚIUNEA 1 — Tapis înclinație max: încălzire 5-7 min → sprint 30-45 sec la 8 km/h → recuperare 2 km/h sau coboară să mergi → repeti crescând la 10 km/h pentru 20-30 sec → 3 sprinturi la viteză maximă → 5-7 min lent revenire. OPȚIUNEA 2 — Teren plat/mixt: 5 min încălzire → 6× (accelerare 20-30 sec + 4 min lent) → 5 min revenire.',
    notes: 'După fiecare sprint, ține alergarea la ritm care permite scăderea pulsului la 75% din max. Nu te opri brusc — recuperare activă.'
  },

  12: {
    title: 'Exerciții fundamentale + Grup muscular deficitar',
    focus: ['multiarticulare', 'deficitar'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Fandări din mers cu gantere — încălzire fără greutăți: 40 pași',
        sets: '4',
        reps: '8-10 pe fiecare picior',
        effort: 'aproape maxim',
        rest: '3 min'
      },
      {
        name: 'Super Set Tricepși + Spate: Bench press priză îngustă + Ramat bara priză inversă',
        sets: '4 super seturi (+ 1 încălzire)',
        reps: '6-8 / 8-10',
        effort: '100%',
        rest: '2-3 min'
      },
      {
        name: 'Shoulder Press (împins deasupra capului)',
        sets: '4',
        reps: '10-12',
        effort: 'primele 2 seturi 80-90%, ultimele 2 seturi 100%',
        rest: '2 min'
      },
      {
        name: 'Grup muscular deficitar (la alegere)',
        sets: '3-4',
        reps: 'depinde de exercițiu',
        effort: 'aproape maxim',
        rest: '1,5-2 min',
        notes: 'BĂRBAȚI: alegi tu grupa care necesită dezvoltare prioritară și un exercițiu de izolare. Spune-mi ce grupă alegi. FEMEI: Hip Thrust 4×15 + Fandări bulgărești 3×15 pe fiecare picior.'
      }
    ],
    cardio: 'Mers în pantă 4 km, FC 115-130 bpm'
  },

  13: {
    title: 'Volum total — Tracțiuni 60 + Dips 80 + Sumo Squat 100',
    focus: ['volum total', 'spate', 'piept', 'picioare'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Tracțiuni la bară priză largă',
        sets: 'liber',
        reps: '60 total',
        notes: 'Fără greutăți. Asistență dacă e nevoie pentru 8-10 repetări corecte. Compară timpul cu cel din Z6 — ar trebui să fie mai rapid.'
      },
      {
        name: 'Dips la paralele',
        sets: 'liber',
        reps: '80 total',
        notes: 'Asistență dacă e nevoie pentru 10-12 repetări corecte.'
      },
      {
        name: 'Sumo Squat cu ganteră',
        sets: 'liber',
        reps: '100 total',
        notes: 'Greutate ganteră = 50% greutate corporală. Pauze la discreție. Notează timpul.'
      }
    ],
    cardio: 'Mers în pantă 4 km, FC 115-130 bpm'
  },

  14: {
    title: 'Zi de odihnă — programul s-a încheiat!',
    focus: ['recuperare', 'finalizare'],
    isRest: true,
    isCardio: false,
    exercises: [],
    cardio: null,
    notes: 'Felicitări — ai terminat PowerFit 14 zile. Azi e ultima zi de odihnă din program. În curând primești raportul complet al transformării tale.'
  }
};

// ============================================
// SĂPTĂMÂNA 1 — OUTDOOR (AER LIBER)
// ============================================

const OUTDOOR_WEEK_1 = {
  1: {
    title: 'Picioare, Piept, Abdomen',
    focus: ['picioare', 'piept', 'abdomen'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Fandări din mers cu gantere',
        sets: '5 (ultimul opțional)',
        reps: 'progresiv: 20 fără greutăți / 12 / 10 / 8 / 6-8 pe fiecare picior',
        effort: '70% → 100%',
        rest: '2,5-3 min'
      },
      {
        name: 'Îndreptări parțiale cu gantere',
        sets: '3',
        reps: '10',
        effort: 'aproape maxim',
        rest: '2 min'
      },
      {
        name: 'Super Set Picioare/Piept: Sumo Squat ganteră + Pullover ganteră',
        sets: '4 super seturi (+ 1 încălzire)',
        reps: '10-12 / 10-12',
        effort: '100%',
        rest: '3 min'
      },
      {
        name: 'Super Set Piept: Împins gantere de pe sol/bancă + Flotări clasice',
        sets: '4 super seturi',
        reps: '10-12 / până la epuizare',
        effort: '100%',
        rest: '2 min',
        notes: 'La împins concentrează-te pe control și contracție. La flotări menține forma corectă, nu lăsa trunchiul să cadă pe final.'
      },
      {
        name: 'Crunch clasic',
        sets: '5',
        reps: 'până la epuizare',
        rest: '30 sec'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  2: {
    title: 'Spate, Umeri, Abdomen, Lombari',
    focus: ['spate', 'umeri', 'abdomen', 'lombari'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Tracțiuni la bară cu priză largă',
        sets: '4',
        reps: '8-10',
        effort: '100%',
        rest: '2 min',
        notes: 'Asistență cu bandă elastică dacă nu poți finaliza, sau adaugă greutate dacă e prea ușor.'
      },
      {
        name: 'Tracțiuni cu priză inversă (supinație)',
        sets: '3',
        reps: '8-10',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Ramat cu gantera (un braț)',
        sets: '4 (+ 1 încălzire)',
        reps: '8-10 pe fiecare braț',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Super Set Umeri: Împins ganteră deasupra capului + Ridicări laterale',
        sets: '4 super seturi',
        reps: '8-10 / 10-12 per braț',
        effort: '100%',
        rest: '2-3 min',
        notes: 'Execută ambele exerciții cu un braț, apoi cu celălalt.'
      },
      {
        name: 'Ridicări laterale la 90° pentru deltoid posterior',
        sets: '3',
        reps: '10-12',
        effort: 'execuție strictă, control total',
        rest: '2 min'
      },
      {
        name: 'Super Set Abdomen: Crunch + Plank',
        sets: '3 super seturi',
        reps: '20 / 20 sec',
        rest: 'fără pauză între exerciții',
        notes: 'Plank: linie perfect dreaptă cap-călcâie.'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  3: {
    title: 'Brațe, Picioare, Gambe',
    focus: ['biceps', 'triceps', 'picioare', 'gambe'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Super Set Biceps + Triceps: Flexii ganteră picioare + Dips paralele',
        sets: '4 super seturi',
        reps: '10 / 8-10',
        effort: '100%',
        rest: '2 min',
        notes: 'Dips: poți adăuga greutate sau folosi elastic de asistență.'
      },
      {
        name: 'Gold Set Biceps & Triceps (4 exerciții fără pauză)',
        sets: '3-4 circuite',
        reps: 'Flexii concentrate ganteră șezut 8-10/braț → Extensii triceps ganteră un braț epuizare → Flexii ganteră picioare epuizare → Kickbacks gantere epuizare',
        rest: '2-3 min între circuite'
      },
      {
        name: 'Super Set Picioare: Fandări bulgărești cu gantere + Sumo Squat ganteră',
        sets: '4 super seturi',
        reps: '12 pe fiecare parte / până la epuizare',
        effort: 'intens',
        rest: '2-3 min'
      },
      {
        name: 'Gambe — Ridicări pe vârfuri unilateral cu ganteră (în picioare)',
        sets: '7 pe fiecare gambă',
        reps: '15 / 8 / 6 / 6 / 6 / 6 / 6',
        rest: '15 sec',
        notes: 'Ganteră într-o mână, sprijin ușor cu cealaltă pentru echilibru. Coborâre lentă, contracție sus.'
      }
    ],
    cardio: 'Mers 6-7 km în ritm moderat'
  },

  4: GYM_WEEK_1[4],

  5: {
    title: 'Circuit Complet — Total Body',
    focus: ['full body', 'circuit'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Circuit Total Body — 6 exerciții consecutive',
        sets: '6 runde',
        reps: 'Fandări mers gantere 10/picior → Flotări 12-15 → Tracțiuni Australian (bară joasă) 15 → Mountain climber 30 sec → Plank dinamic 30 sec → Jump Squat 12-15',
        rest: '3 min între runde',
        notes: 'Toate exercițiile fără pauză între ele. Pauza vine doar la finalul rundei.'
      }
    ],
    cardio: 'Mers ritm moderat 3,5 km',
    notes: 'Ideal în aer liber sau parc.'
  },

  6: GYM_WEEK_1[6],

  7: GYM_WEEK_1[7]
};

// ============================================
// SĂPTĂMÂNA 2 — OUTDOOR (AER LIBER)
// ============================================

const OUTDOOR_WEEK_2 = {
  8: {
    title: 'Picioare (bază), Brațe, Abdomen',
    focus: ['picioare', 'biceps', 'triceps', 'abdomen'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Genuflexiuni Sumo cu ganteră',
        sets: '4-5 (ultimul opțional)',
        reps: 'progresiv: 15 / 15 / 12 / 10-12 / 10-12',
        effort: '70% → 100%',
        rest: '3 min',
        notes: 'Dacă nu ai greutăți mari, execută mai multe repetări până la epuizare musculară completă.'
      },
      {
        name: 'Step-up pe bancă cu gantere',
        sets: '3-4 (ultimul opțional)',
        reps: '12 / 12 / 10-12 / 8-10 pe fiecare picior',
        effort: '80% → 100%',
        rest: '3 min',
        notes: 'Dacă greutățile sunt mici, execută mai multe repetări până la cedare musculară.'
      },
      {
        name: 'Super Set Brațe #1: Hammer curls alternativ + Extensii triceps unilateral ganteră',
        sets: '3-4 super seturi (+ 1 încălzire)',
        reps: '8-10 / 10 pe fiecare braț',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Super Set Brațe #2: Flexii concentrate ganteră (șezut) + French Press cu gantere (culcat)',
        sets: '3-4 super seturi (+ 1 încălzire)',
        reps: '8 pe fiecare braț / 10-12',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Super Set Abdomen: Ridicări picioare la paralele + Plank',
        sets: '3-4 super seturi',
        reps: 'până la epuizare / 20-30 sec',
        rest: '30 sec'
      }
    ],
    cardio: 'Mers rapid 4 km',
    notes: 'Folosește ceas smart sau aplicație tracking pentru distanță și ritm cardiac.'
  },

  9: {
    title: 'Spate, Piept',
    focus: ['spate', 'piept'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Super Set Piept + Spate: Flotări clasice + Tracțiuni priză inversă',
        sets: '4 super seturi',
        reps: 'până la epuizare / 10-12',
        effort: '100%',
        rest: '2-3 min',
        notes: 'Poți adăuga greutate sau folosi elastic de asistență.'
      },
      {
        name: 'Super Set Piept + Spate: Fluturări gantere bancă orizontală + Ramat ganteră (un braț, sprijinit pe bancă)',
        sets: '4 super seturi',
        reps: '10-12 / 8-10',
        effort: '100%',
        rest: '2-3 min',
        notes: 'Control total, fără balans. Concentrează-te pe contracție maximă.'
      },
      {
        name: 'Set Gigant (4 exerciții fără pauză): Dips paralele epuizare → Plank 20 sec → Pullover ganteră 12 → Tracțiuni Australian epuizare',
        sets: '4',
        reps: 'conform fiecărui exercițiu',
        rest: '3 min între seturi gigante',
        notes: 'Toate cele 4 exerciții consecutiv, fără pauză.'
      }
    ],
    cardio: 'Mers în pantă 3 km, FC 115-130 bpm'
  },

  10: {
    title: 'Umeri, Picioare, Gambe, Abdomen',
    focus: ['umeri', 'picioare', 'gambe', 'abdomen'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Împins deasupra capului cu gantere, din șezut',
        sets: '4 (+ 1 încălzire)',
        reps: '8-10',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Ramat vertical cu gantere (la bărbie)',
        sets: '3 (+ 1 încălzire)',
        reps: '8-10',
        effort: '100%',
        rest: '2 min'
      },
      {
        name: 'Ridicări laterale cu gantere',
        sets: '3',
        reps: '10-12 pe fiecare braț',
        effort: '100%',
        rest: '1-1,5 min',
        notes: 'Control total, fără inerție.'
      },
      {
        name: 'Ridicări laterale pentru deltoid posterior (cu gantere, aplecat)',
        sets: '4',
        reps: '12',
        effort: '100%',
        rest: '1-1,5 min',
        notes: 'Concentrează-te pe contracția mușchiului, fără balans.'
      },
      {
        name: 'Super Set Picioare: Fandări bulgărești cu gantere + Squat isometric (perete sau aer)',
        sets: '3 super seturi',
        reps: '12 pe fiecare parte / 30 sec',
        rest: '1,5-2 min',
        notes: 'Squat isometric: spate drept, coapse paralele cu solul.'
      },
      {
        name: 'Gambe — Ridicări pe vârfuri unilateral cu ganteră',
        sets: '7 pe fiecare gambă',
        reps: '15 / 8 / 6 / 6 / 6 / 6 / 6',
        rest: '15 sec',
        notes: 'Sprijin ușor cu cealaltă mână pentru echilibru.'
      },
      {
        name: 'Super Set Abdomen: Crunch oblice + Ridicări picioare la paralele',
        sets: '3 super seturi',
        reps: 'până la epuizare / până la epuizare',
        rest: '45-60 sec',
        notes: 'Execuție controlată, fără smucituri.'
      }
    ],
    cardio: 'Zi de odihnă cardio'
  },

  11: GYM_WEEK_2[11],

  12: {
    title: 'Exerciții fundamentale + Grup muscular deficitar',
    focus: ['multiarticulare', 'deficitar'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Fandări din mers cu gantere — încălzire 40 pași fără greutăți',
        sets: '4',
        reps: '10-12 pe fiecare picior',
        effort: 'aproape maxim',
        rest: '3 min'
      },
      {
        name: 'Flotări',
        sets: '5',
        reps: '10-12',
        effort: 'tehnică perfectă, control maxim',
        rest: '1,5 min',
        notes: 'Dacă peste 12 e ușor: încetinește ritmul, pauze isometrice, sau ridică picioarele pe bancă.'
      },
      {
        name: 'Super Set: Overhead Press cu gantere + Tracțiuni Australian (bară joasă)',
        sets: '5',
        reps: '10-12 / 10-12',
        effort: '100%',
        rest: '1,5 min',
        notes: 'Control pe toată amplitudinea. Dacă e prea ușor: tempo controlat sau fază negativă încetinită.'
      },
      {
        name: 'Jump Squat (genuflexiuni cu săritură)',
        sets: '5',
        reps: '12',
        effort: 'explozie + control aterizare',
        rest: '1,5 min',
        notes: 'Evită balansul sau căderea pe călcâie. Nucleu activ și stabil.'
      },
      {
        name: 'Grup muscular deficitar (la alegere)',
        sets: '3-4',
        reps: 'depinde de exercițiu',
        effort: 'aproape maxim',
        rest: '1,5-2 min',
        notes: 'BĂRBAȚI: alegi tu grupa și un exercițiu de izolare. Spune-mi ce grupă vrei să prioritizezi. FEMEI: Fandări bulgărești 3×15 pe fiecare picior + Hip Thrust 4×15.'
      },
      {
        name: 'Crunch oblice',
        sets: '4',
        reps: '15 pe fiecare parte',
        rest: '1 min'
      },
      {
        name: 'Plank dinamic',
        sets: '4',
        reps: '30 sec',
        rest: '1 min',
        notes: 'Aliniere perfectă: cap-umeri-șolduri-glezne în linie dreaptă.'
      }
    ],
    cardio: 'Mers rapid 4 km, FC 115-130 bpm'
  },

  13: {
    title: 'Volum total — Tracțiuni 60 + Dips 80 + Step-up + Plank + Fandări mers',
    focus: ['volum total', 'spate', 'piept', 'picioare'],
    isRest: false,
    isCardio: false,
    exercises: [
      {
        name: 'Tracțiuni la bară priză largă',
        sets: 'liber',
        reps: '60 total',
        notes: 'Compară timpul cu cel din Z6 — ar trebui să fie mai rapid.'
      },
      {
        name: 'Dips la paralele',
        sets: 'liber',
        reps: '80 total',
        notes: 'Asistență dacă e nevoie.'
      },
      {
        name: 'Step-up cu gantere',
        sets: '5',
        reps: '15 pe fiecare picior',
        rest: '1,5 min',
        notes: 'Control total al mișcării, tehnică corectă.'
      },
      {
        name: 'Plank dinamic',
        sets: '3',
        reps: '30 sec',
        rest: '1 min',
        notes: 'Linie dreaptă călcâie-umeri. Nu lăsa șoldurile.'
      },
      {
        name: 'Fandări mers cu gantere',
        sets: '4',
        reps: '20 pași (10 pe fiecare picior)',
        rest: '1 min'
      }
    ],
    cardio: 'Mers rapid 4 km, FC 115-130 bpm'
  },

  14: GYM_WEEK_2[14]
};

// ============================================
// PROGRAM GLOBAL
// ============================================

const PROGRAM = {
  gym: { ...GYM_WEEK_1, ...GYM_WEEK_2 },
  outdoor: { ...OUTDOOR_WEEK_1, ...OUTDOOR_WEEK_2 }
};

// ============================================
// API PUBLIC
// ============================================

/**
 * Returnează obiectul cu detaliile zilei.
 * @param {number} dayNumber - 1 până la 14
 * @param {string} equipment - 'gym' sau 'outdoor'
 * @returns {object|null}
 */
export function getProgramDay(dayNumber, equipment) {
  if (!dayNumber || dayNumber < 1 || dayNumber > 14) return null;
  const eq = equipment === 'outdoor' ? 'outdoor' : 'gym';
  return PROGRAM[eq][dayNumber] || null;
}

/**
 * Label scurt pentru morning checkin (compatibil cu vechiul getDayInfo).
 * @param {number} dayNumber
 * @param {string} equipment
 * @returns {string}
 */
export function getDayShortLabel(dayNumber, equipment) {
  const day = getProgramDay(dayNumber, equipment);
  if (!day) return 'Antrenament';
  return day.title;
}

/**
 * Formatează detaliile zilei ca text natural pentru system prompt AI.
 * Produce text concis dar complet — toate exercițiile, seturile, repetările.
 * @param {number} dayNumber
 * @param {string} equipment - 'gym' sau 'outdoor'
 * @returns {string}
 */
export function formatDayForAI(dayNumber, equipment) {
  const day = getProgramDay(dayNumber, equipment);
  if (!day) return `Ziua ${dayNumber}: nu există în program.`;

  const eqLabel = equipment === 'outdoor' ? 'aer liber' : 'sală';
  let text = `ZIUA ${dayNumber}/14 (${eqLabel}) — ${day.title}\n`;

  if (day.isRest) {
    text += `Tip: ZI DE ODIHNĂ\n`;
    if (day.notes) text += `Notă: ${day.notes}\n`;
    return text.trim();
  }

  if (day.isCardio) {
    text += `Tip: CARDIO DEDICAT\n`;
    if (day.cardio) text += `Program: ${day.cardio}\n`;
    if (day.notes) text += `Notă: ${day.notes}\n`;
    return text.trim();
  }

  text += `Focus: ${day.focus.join(', ')}\n\nExerciții:\n`;
  day.exercises.forEach((ex, i) => {
    text += `${i + 1}. ${ex.name}\n`;
    text += `   Seturi: ${ex.sets} | Repetări: ${ex.reps}`;
    if (ex.effort) text += ` | Efort: ${ex.effort}`;
    if (ex.rest) text += ` | Pauză: ${ex.rest}`;
    text += `\n`;
    if (ex.notes) text += `   Notă: ${ex.notes}\n`;
  });

  if (day.cardio) text += `\nCardio: ${day.cardio}\n`;
  if (day.notes) text += `\nNotă generală: ${day.notes}\n`;

  return text.trim();
}

/**
 * Formatează ziua pentru morning checkin (text scurt, prietenos pentru user).
 * Produce ceva pe care userul îl poate citi pe Telegram fără să fie copleșit.
 * @param {number} dayNumber
 * @param {string} equipment
 * @returns {string}
 */
export function formatDayForUser(dayNumber, equipment) {
  const day = getProgramDay(dayNumber, equipment);
  if (!day) return 'Antrenament';

  if (day.isRest) {
    return `Ziua ${dayNumber}/14 — Zi de odihnă`;
  }

  if (day.isCardio) {
    return `Ziua ${dayNumber}/14 — ${day.title}`;
  }

  return `Ziua ${dayNumber}/14 — ${day.title}`;
}

export { PROGRAM };
