// OPOTC physical fitness reference data, male age 30 to 39.
// Entry standard is what you must pass to be admitted.
// Exit standard is what the academy trains you toward.

export const STANDARDS = {
  cohort: 'OPOTC male, age 30 to 39',
  entry: {
    label: 'Entry standard',
    situps: 28,
    pushups: 15,
    run_seconds: 913, // 15:13 for 1.5 miles
    run_display: '15:13',
  },
  exit: {
    label: 'Academy exit standard',
    situps: 36,
    pushups: 27,
    run_seconds: 745, // 12:25 for 1.5 miles
    run_display: '12:25',
  },
  events: [
    {
      key: 'situp',
      name: 'Sit-ups',
      unit: 'reps in 1 minute',
      entry: 28,
      exit: 36,
      higherIsBetter: true,
      rules: [
        'Bent knee position, roughly 90 degrees at the knee.',
        'Hands interlocked behind the head and kept there for the whole minute.',
        'Feet anchored by a partner or a holder.',
        'A rep counts when the elbows touch or pass the knees and the shoulder blades return to the mat.',
        'One minute, as many correct reps as possible. Resting is allowed but the clock keeps running.',
      ],
    },
    {
      key: 'pushup',
      name: 'Push-ups',
      unit: 'reps in 1 minute',
      entry: 15,
      exit: 27,
      higherIsBetter: true,
      rules: [
        'Hands roughly shoulder width, body straight from head to heels.',
        'Lower until the upper arms are at least parallel to the floor, then push back to full lockout.',
        'Rest is allowed only in the up position. Dropping to the knees or resting on the floor ends the test.',
        'One minute, as many correct reps as possible.',
      ],
    },
    {
      key: 'run_trial',
      name: '1.5 mile run',
      unit: 'time',
      entry: 913,
      exit: 745,
      higherIsBetter: false,
      rules: [
        'A timed 1.5 mile run on a measured course or track.',
        'Walking is allowed but the clock does not stop.',
        'Pace check: the 12:25 exit standard is about 2:04 per 400 meters, or about 8:17 per mile.',
      ],
    },
  ],
  disclaimer:
    'These figures are recorded here as a personal training reference. Confirm current requirements with the Akron Police Department and the Ohio Peace Officer Training Commission before your test date.',
};

export function standardFor(type) {
  return STANDARDS.events.find((e) => e.key === type) || null;
}

// Returns 'green', 'yellow', or 'red' for a result against the standards.
export function readinessFor(type, value) {
  const ev = standardFor(type);
  if (!ev || value === null || value === undefined) return 'unknown';
  if (ev.higherIsBetter) {
    if (value >= ev.exit) return 'green';
    if (value >= ev.entry) return 'yellow';
    return 'red';
  }
  if (value <= ev.exit) return 'green';
  if (value <= ev.entry) return 'yellow';
  return 'red';
}
