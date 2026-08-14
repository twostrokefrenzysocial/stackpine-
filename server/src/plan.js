// The Academy Ready training plan generator.
//
// Week 1 is a partial week that starts Friday 2026-08-14. Every week after that
// runs Monday through Sunday. Everything below is derived from the week number,
// so any future week can be generated on demand.

import { addDays, dayOfWeek, dayName, diffDays, formatSeconds } from './util/date.js';

export const PLAN_START = '2026-08-14'; // Friday, day 1
const FIRST_FULL_MONDAY = '2026-08-17';

export const INCLINE_LEVELS = [
  { key: 'counter', label: 'Counter height' },
  { key: 'bench', label: 'Bench height' },
  { key: 'low_box', label: 'Low box' },
  { key: 'floor', label: 'Floor' },
];

export function inclineLabel(key) {
  const found = INCLINE_LEVELS.find((l) => l.key === key);
  return found ? found.label : 'Counter height';
}

export function nextIncline(key) {
  const idx = INCLINE_LEVELS.findIndex((l) => l.key === key);
  if (idx < 0 || idx >= INCLINE_LEVELS.length - 1) return null;
  return INCLINE_LEVELS[idx + 1].key;
}

export function weekStartFor(weekNumber) {
  if (weekNumber <= 1) return PLAN_START;
  return addDays(FIRST_FULL_MONDAY, (weekNumber - 2) * 7);
}

export function weekEndFor(weekNumber) {
  if (weekNumber <= 1) return '2026-08-16';
  return addDays(weekStartFor(weekNumber), 6);
}

export function weekNumberFor(dateISO) {
  if (dateISO < PLAN_START) return 0;
  if (dateISO < FIRST_FULL_MONDAY) return 1;
  return 2 + Math.floor(diffDays(FIRST_FULL_MONDAY, dateISO) / 7);
}

// Monday of the calendar week containing the given date, used for meal plans.
export function mondayOf(dateISO) {
  const d = dayOfWeek(dateISO);
  const back = d === 0 ? 6 : d - 1;
  return addDays(dateISO, -back);
}

export function phaseForWeek(weekNumber, override = null) {
  if (override) return Number(override);
  if (weekNumber <= 4) return 1;
  if (weekNumber <= 8) return 2;
  if (weekNumber <= 16) return 3;
  return 4;
}

export function isTimeTrialWeek(weekNumber) {
  return weekNumber > 0 && weekNumber % 4 === 0;
}

export const PHASE_NOTES = {
  1: 'Phase 1, weeks 1 to 4. Build the walking base and start jog intervals.',
  2: 'Phase 2, weeks 5 to 8. Stretch the jog intervals until 20 minutes is continuous. Pace does not matter.',
  3: 'Phase 3, weeks 9 to 16. Two easy runs plus one interval day at goal pace.',
  4: 'Phase 4, week 17 onward. Same structure, tighter intervals, one easy run stretching toward 3 miles.',
};

// Mon 1, Tue 2, Wed 3, Thu 4, Fri 5, Sat 6, Sun 0
const WEEK_TEMPLATE = {
  1: ['run', 'pushups_situps'],
  2: ['strength'],
  3: ['run'],
  4: ['pushups_situps'],
  5: ['run', 'strength'],
  6: ['pushups_situps'],
  0: ['rest'],
};

const RUN_INDEX_BY_DOW = { 1: 1, 3: 2, 5: 3 };

export const STRENGTH_EXERCISES = [
  { key: 'squat', name: 'Squat or leg press' },
  { key: 'row', name: 'Dumbbell row' },
  { key: 'bench', name: 'Dumbbell bench press' },
  { key: 'carry', name: 'Farmer carries' },
];

const PHASE2_JOG_LADDER = [3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 20];

function runBlock(weekNumber, phase, runIndex, isTrial) {
  if (isTrial) {
    return {
      title: '1.5 mile time trial',
      summary:
        'Time trial. Warm up 10 minutes easy, then run 1.5 miles as hard as you can hold. Log the time.',
      details: {
        kind: 'time_trial',
        distance_mi: 1.5,
        warmup: '10 minutes easy walking or jogging',
        cooldown: '5 to 10 minutes easy walking',
        note: 'This replaces the easy run for the week. Give it a real effort so the number means something.',
      },
      is_time_trial: 1,
    };
  }

  if (phase === 1) {
    const w = Math.min(4, Math.max(1, weekNumber));
    const walkMin = [30, 35, 35, 40][w - 1];
    const reps = [8, 9, 10, 10][w - 1];
    return {
      title: 'Phase 1 run',
      summary: `${walkMin} min brisk walk, jog 1 / walk 2 x ${reps}`,
      details: {
        kind: 'walk_jog',
        total_minutes: walkMin,
        jog_minutes: 1,
        walk_minutes: 2,
        repeats: reps,
        note: 'Do as many of the jog intervals as you can hold cleanly. If a rep feels rough, walk it out and pick the next one back up.',
      },
      is_time_trial: 0,
    };
  }

  if (phase === 2) {
    const weekInPhase = Math.min(4, Math.max(1, weekNumber - 4));
    const sessionIndex = (weekInPhase - 1) * 3 + runIndex; // 1 to 12
    const jogMin = PHASE2_JOG_LADDER[Math.min(PHASE2_JOG_LADDER.length - 1, sessionIndex - 1)];
    const repeats = Math.max(1, Math.round(20 / jogMin));
    const summary =
      repeats === 1
        ? `Jog ${jogMin} min continuous`
        : `Jog ${jogMin} min / walk 2 min x ${repeats}`;
    return {
      title: 'Phase 2 run',
      summary,
      details: {
        kind: 'interval_build',
        jog_minutes: jogMin,
        walk_minutes: 2,
        repeats,
        target: 'About 20 minutes of jogging total',
        warmup: '5 minutes brisk walking',
        cooldown: '5 minutes brisk walking',
        note: 'Pace does not matter. The only goal is holding the jog for longer each session.',
      },
      is_time_trial: 0,
    };
  }

  // Phases 3 and 4 share the structure. Phase 4 tightens the pace and stretches
  // the Friday easy run toward 3 miles.
  const weeksIntoPhase4 = phase >= 4 ? Math.max(0, weekNumber - 17) : 0;

  if (runIndex === 2) {
    const reps = phase >= 4 ? Math.min(8, 6 + Math.floor(weeksIntoPhase4 / 3)) : 6;
    const paceSeconds = phase >= 4 ? Math.max(118, 124 - Math.floor(weeksIntoPhase4 / 2)) : 124;
    return {
      title: 'Interval run',
      summary: `${reps} x 400m at ${formatSeconds(paceSeconds)}, 90 sec walk rest`,
      details: {
        kind: 'intervals',
        repeats: reps,
        distance_m: 400,
        target_seconds: paceSeconds,
        target_display: formatSeconds(paceSeconds),
        rest_seconds: 90,
        warmup: '10 minutes easy jogging or brisk walking',
        cooldown: '10 minutes easy',
        note: `${formatSeconds(paceSeconds)} per 400m is the pace for a ${
          phase >= 4 ? 'sub 12:25' : '12:25'
        } 1.5 mile. Walk the full 90 seconds between reps.`,
      },
      is_time_trial: 0,
    };
  }

  let distance;
  if (phase >= 4) {
    distance = runIndex === 1 ? 2.5 : Math.min(3, Number((2.5 + 0.1 * weeksIntoPhase4).toFixed(1)));
  } else {
    distance = runIndex === 1 ? 2 : 2.5;
  }
  return {
    title: 'Easy run',
    summary: `Easy run, ${distance} miles`,
    details: {
      kind: 'easy_run',
      distance_mi: distance,
      note: 'Conversational pace. If you cannot talk in short sentences, slow down.',
    },
    is_time_trial: 0,
  };
}

function pushupsSitupsBlock(isTestDay, inclineKey) {
  const label = inclineLabel(inclineKey);
  const summary = isTestDay
    ? `Weekly test day. 1 min max push-ups and 1 min max sit-ups, then the working sets.`
    : `Push-ups 5 x (max clean reps minus 2) at ${label}, sit-ups 4 x max, planks 3 x 30 to 60 sec`;
  return {
    title: isTestDay ? 'Push-ups and sit-ups, test day' : 'Push-ups and sit-ups',
    summary,
    details: {
      kind: 'calisthenics',
      incline: inclineKey,
      incline_label: label,
      pushups: {
        sets: 5,
        prescription: 'Max clean reps minus 2',
        rest_seconds: 90,
        progression:
          'When you hit 15 reps on every set at this incline, drop to the next lower incline.',
      },
      situps: {
        sets: 4,
        prescription: 'Max reps in test format: knees bent, feet anchored, hands behind head',
        rest_seconds: 60,
      },
      planks: {
        sets: 3,
        seconds: '30 to 60',
      },
      tests: isTestDay
        ? [
            'One minute max push-ups in OPOTC format. Rest only in the up position.',
            'One minute max sit-ups in OPOTC format.',
          ]
        : [],
    },
    is_test_day: isTestDay ? 1 : 0,
  };
}

function strengthBlock() {
  return {
    title: 'Strength',
    summary: 'Squat or leg press, dumbbell row, dumbbell bench, farmer carries. 3 x 8 to 12 each.',
    details: {
      kind: 'strength',
      sets: 3,
      rep_range: '8 to 12',
      exercises: STRENGTH_EXERCISES,
      note: 'This is the muscle preservation work. On a GLP-1 it matters more than the running does. Take the sets close to hard but leave a rep or two in reserve.',
    },
  };
}

function restBlock() {
  return {
    title: 'Rest day',
    summary: 'Full rest. Walk if you feel like it, eat your protein, drink your water.',
    details: {
      kind: 'rest',
      note: 'At least one full rest day per week is part of the plan, not a break from it.',
    },
  };
}

// Builds every scheduled block for one date.
export function blocksForDate(dateISO, opts = {}) {
  const weekNumber = opts.weekNumber ?? weekNumberFor(dateISO);
  if (weekNumber < 1) return [];
  const phase = phaseForWeek(weekNumber, opts.phaseOverride);
  const dow = dayOfWeek(dateISO);
  const inclineKey = opts.inclineKey || 'counter';
  const template = WEEK_TEMPLATE[dow] || [];
  const trialWeek = isTimeTrialWeek(weekNumber);

  const out = [];
  template.forEach((block, index) => {
    let built;
    if (block === 'run') {
      const runIndex = RUN_INDEX_BY_DOW[dow] || 1;
      const isTrial = trialWeek && dow === 3;
      built = runBlock(weekNumber, phase, runIndex, isTrial);
    } else if (block === 'pushups_situps') {
      built = pushupsSitupsBlock(dow === 6, inclineKey);
    } else if (block === 'strength') {
      built = strengthBlock();
    } else {
      built = restBlock();
    }

    out.push({
      date: dateISO,
      week_number: weekNumber,
      phase,
      day_of_week: dow,
      block,
      title: built.title,
      summary: built.summary,
      details: JSON.stringify(built.details),
      is_test_day: built.is_test_day || 0,
      is_time_trial: built.is_time_trial || 0,
      sort_order: index,
    });
  });

  return out;
}

export function datesForWeek(weekNumber) {
  const start = weekStartFor(weekNumber);
  const end = weekEndFor(weekNumber);
  const out = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function weekSummary(weekNumber, phaseOverride = null) {
  const phase = phaseForWeek(weekNumber, phaseOverride);
  return {
    week_number: weekNumber,
    week_start: weekStartFor(weekNumber),
    week_end: weekEndFor(weekNumber),
    phase,
    phase_note: PHASE_NOTES[phase],
    time_trial_week: isTimeTrialWeek(weekNumber),
    partial: weekNumber === 1,
  };
}

export function describeDay(dateISO) {
  return `${dayName(dateISO)} ${dateISO}`;
}
