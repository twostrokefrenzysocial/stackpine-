// Meal plan generation. The Anthropic API key lives only on the server and is
// never sent to the client.

import Anthropic from '@anthropic-ai/sdk';
import { db, getSettings } from '../db.js';
import { addDays, dayName } from '../util/date.js';
import { workoutsBetween } from '../planStore.js';
import { fallbackWeek } from './mealFallback.js';

const MODEL = 'claude-sonnet-4-6';

export const ALL_SLOTS = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner'];
export const SLOT_LABELS = {
  breakfast: 'breakfast',
  snack1: 'a morning snack',
  lunch: 'lunch',
  snack2: 'an afternoon snack',
  dinner: 'dinner',
};

// Which eating occasions he actually uses. Ordered as the day runs.
export function slotsFor(settings) {
  const chosen = Array.isArray(settings?.meal_slots) ? settings.meal_slots : ALL_SLOTS;
  const ordered = ALL_SLOTS.filter((s) => chosen.includes(s));
  return ordered.length ? ordered : ALL_SLOTS;
}
export const SECTIONS = [
  'Produce',
  'Meat and Seafood',
  'Dairy and Eggs',
  'Pantry',
  'Frozen',
  'Bakery',
  'Other',
];

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SCHEMA_TEXT = `{
  "week_start": "YYYY-MM-DD",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "day_name": "Monday",
      "meals": [
        {
          "slot": "SLOT_OPTIONS",
          "name": "short meal name",
          "protein_g": 40,
          "calories": 450,
          "notes": "one short line, may be empty",
          "ingredients": [
            { "item": "Chicken breast", "quantity": "6 oz", "section": "Meat and Seafood" }
          ]
        }
      ],
      "total_protein_g": 165
    }
  ],
  "notes": "one or two short lines about the week"
}`;

function buildSystemPrompt(settings) {
  const slots = slotsFor(settings);
  return [
    'You are a practical nutrition planner building one week of meals for a single adult male.',
    '',
    'About him:',
    `- Age ${settings.age}, male. Starting weight ${settings.start_weight} lbs, goal ${settings.goal_weight} lbs.`,
    settings.on_glp1
      ? '- He is on a GLP-1 medication for weight loss. Appetite is suppressed, so meals must be small, protein dense, and easy to finish. Do not stack an aggressive calorie deficit on top of the medication.'
      : '- He is losing weight through diet and training.',
    '- He is training for a police academy physical entry exam, so muscle preservation is the priority.',
    '',
    'Hard rules:',
    `- Daily protein total must land between ${settings.protein_min} and ${settings.protein_max} grams. Protein first at every meal.`,
    `- He eats ${slots.length} times a day: ${slots.map((s) => SLOT_LABELS[s]).join(', ')}. Use exactly these slot keys, in this order: ${slots.join(', ')}. Do not add any other slot.`,
    ...(slots.includes('breakfast')
      ? []
      : [
          '- He does not eat breakfast. Do not suggest one, do not mention skipping it, and do not treat the first meal of the day as a breakfast. Spread the protein across the meals he does eat, which means each one carries more than it otherwise would.',
        ]),
    '- Emphasize chicken, lean beef, eggs, Greek yogurt, cottage cheese, protein shakes, fish, vegetables, fruit, and fiber for digestion.',
    '- Budget conscious. Normal grocery store ingredients only. Simple cooking, nothing that needs specialty equipment or a long ingredient list.',
    `- Household of ${settings.household_size}. Dinners that the whole family can eat are a plus. The protein and calorie numbers are for his portion only.`,
    '- Diet Coke is fine and does not need to be mentioned or flagged.',
    '- Hydration matters. Mention water in notes when a day has a run scheduled.',
    '',
    'Output rules:',
    '- Reply with a single JSON object and nothing else. No prose before or after, no markdown code fences.',
    '- protein_g and calories are numbers, not strings.',
    '- Every meal needs at least one ingredient with a section drawn from this list: ' +
      SECTIONS.join(', ') + '.',
    '- Keep every name and note free of em dashes and emoji.',
  ].join('\n');
}

function buildUserPrompt(settings, weekStart, trainingDays) {
  const slots = slotsFor(settings);
  const prefs = settings.meal_preferences?.trim();
  const excl = settings.meal_exclusions?.trim();
  const lines = [
    `Build the week that starts Monday ${weekStart}.`,
    '',
    'Training schedule for the week, so you can match food to load:',
    ...trainingDays.map((d) => `- ${d.day_name} ${d.date}: ${d.summary}`),
    '',
  ];
  if (prefs) lines.push(`Preferences he saved: ${prefs}`, '');
  if (excl) lines.push(`Do not use these at all: ${excl}`, '');
  lines.push(
    'Return JSON in exactly this shape:',
    SCHEMA_TEXT.replace('SLOT_OPTIONS', slots.join(' | '))
  );
  return lines.join('\n');
}

function trainingContext(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const rows = workoutsBetween(weekStart, weekEnd);
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row.summary);
  }
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStart, i);
    out.push({
      date,
      day_name: dayName(date),
      summary: (byDate.get(date) || ['Rest']).join(' plus '),
    });
  }
  return out;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in the response.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export function validatePlan(plan, weekStart, settings) {
  const errors = [];
  const slots = slotsFor(settings);
  if (!plan || typeof plan !== 'object') return ['Response was not an object.'];
  if (!Array.isArray(plan.days) || plan.days.length !== 7) {
    errors.push(`Expected exactly 7 days, received ${Array.isArray(plan.days) ? plan.days.length : 'none'}.`);
    return errors;
  }

  plan.days.forEach((day, index) => {
    const expectedDate = addDays(weekStart, index);
    if (day.date !== expectedDate) {
      errors.push(`Day ${index + 1} should have date ${expectedDate}, received ${day.date}.`);
    }
    if (!Array.isArray(day.meals) || day.meals.length !== slots.length) {
      errors.push(
        `Day ${index + 1} needs exactly ${slots.length} meals, one per slot: ${slots.join(', ')}.`
      );
      return;
    }
    const given = day.meals.map((m) => m.slot);
    for (const slot of slots) {
      if (!given.includes(slot)) errors.push(`Day ${index + 1} is missing the ${slot} slot.`);
    }
    for (const slot of given) {
      if (!slots.includes(slot)) {
        errors.push(`Day ${index + 1} has a ${slot} slot, which he does not eat.`);
      }
    }
    let total = 0;
    day.meals.forEach((meal, mi) => {
      if (!meal.name || typeof meal.name !== 'string') {
        errors.push(`Day ${index + 1} meal ${mi + 1} has no name.`);
      }
      const protein = Number(meal.protein_g);
      if (!Number.isFinite(protein) || protein < 0) {
        errors.push(`Day ${index + 1} meal ${mi + 1} has an invalid protein_g.`);
      } else {
        total += protein;
      }
      if (!Array.isArray(meal.ingredients) || meal.ingredients.length === 0) {
        errors.push(`Day ${index + 1} meal ${mi + 1} has no ingredients.`);
      }
    });
    // Allow a little slack around the stated target so one gram does not fail a week.
    const low = settings.protein_min - 10;
    const high = settings.protein_max + 15;
    if (total < low || total > high) {
      errors.push(
        `Day ${index + 1} total protein is ${Math.round(total)} g, outside the ${settings.protein_min} to ${settings.protein_max} g target.`
      );
    }
  });

  return errors;
}

function normalizePlan(plan, weekStart, settings) {
  const slots = slotsFor(settings);
  const days = plan.days.map((day, index) => {
    const date = addDays(weekStart, index);
    const bySlot = new Map(day.meals.map((m) => [m.slot, m]));
    const meals = slots.map((slot) => {
      const m = bySlot.get(slot) || {};
      return {
        slot,
        name: String(m.name || 'Meal'),
        protein_g: Number(m.protein_g) || 0,
        calories: Number.isFinite(Number(m.calories)) ? Number(m.calories) : null,
        notes: String(m.notes || ''),
        ingredients: (Array.isArray(m.ingredients) ? m.ingredients : []).map((ing) => ({
          item: String(ing.item || '').trim(),
          quantity: String(ing.quantity || '').trim(),
          section: SECTIONS.includes(ing.section) ? ing.section : 'Other',
        })).filter((ing) => ing.item),
      };
    });
    return {
      date,
      day_name: dayName(date),
      meals,
      total_protein_g: Math.round(meals.reduce((s, m) => s + m.protein_g, 0)),
    };
  });

  return {
    week_start: weekStart,
    days,
    notes: String(plan.notes || ''),
  };
}

async function callClaude(messages, systemPrompt, maxTokens) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The response was cut off before the JSON finished.');
  }
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

// Generates a week. Validates the JSON, retries once with the errors fed back,
// and falls back to the static template if the second attempt also fails.
export async function generateWeekPlan(weekStart) {
  const settings = getSettings();
  const systemPrompt = buildSystemPrompt(settings);
  const userPrompt = buildUserPrompt(settings, weekStart, trainingContext(weekStart));

  if (!hasApiKey()) {
    return {
      plan: fallbackWeek(weekStart, settings),
      source: 'fallback',
      reason: 'No API key configured.',
    };
  }

  const messages = [{ role: 'user', content: userPrompt }];
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await callClaude(messages, systemPrompt, 16000);
      const parsed = extractJson(text);
      const errors = validatePlan(parsed, weekStart, settings);
      if (errors.length === 0) {
        return { plan: normalizePlan(parsed, weekStart, settings), source: 'ai' };
      }
      lastError = errors.join(' ');
      if (attempt === 1) {
        messages.push({ role: 'assistant', content: text });
        messages.push({
          role: 'user',
          content: [
            'That response did not validate. Problems found:',
            ...errors.map((e) => `- ${e}`),
            '',
            'Send the corrected full week as a single JSON object with no other text.',
          ].join('\n'),
        });
      }
    } catch (err) {
      lastError = err.message;
      if (attempt === 1) {
        // Keep the original brief and add a nudge about the output format.
        messages.length = 1;
        messages.push({
          role: 'user',
          content: `That attempt failed: ${err.message}. Send only the JSON object, with no prose and no code fences.`,
        });
      }
    }
  }

  return {
    plan: fallbackWeek(weekStart, settings),
    source: 'fallback',
    reason: lastError || 'Generation failed twice.',
  };
}

// Everything a single meal swap needs to know: the day it sits in, what the
// rest of that day already contributes, and the protein window left over.
// Shared by the API path and the paste path so both ask for the same thing.
function mealSwapContext(plan, dayIndex, slot, settings) {
  const day = plan?.days?.[dayIndex];
  if (!day) throw new Error('That day is not in the plan.');
  const current = day.meals.find((m) => m.slot === slot);
  if (!current) throw new Error('That slot is not in the plan.');

  const others = day.meals.filter((m) => m.slot !== slot);
  const otherProtein = others.reduce((s, m) => s + m.protein_g, 0);
  const targetLow = Math.max(10, settings.protein_min - otherProtein);
  const targetHigh = Math.max(targetLow + 5, settings.protein_max - otherProtein);

  return { day, current, others, targetLow, targetHigh };
}

function buildMealUserPrompt(settings, slot, ctx) {
  const { day, current, others, targetLow, targetHigh } = ctx;
  return [
    `Replace one meal on ${day.day_name} ${day.date}.`,
    `Slot to replace: ${slot}. Current meal: ${current.name}.`,
    '',
    'The rest of that day stays as is:',
    ...others.map((m) => `- ${m.slot}: ${m.name} (${m.protein_g} g protein)`),
    '',
    `The replacement should land between ${Math.round(targetLow)} and ${Math.round(targetHigh)} g of protein so the day still hits the target.`,
    'Give something different from the current meal and from the rest of the day.',
    settings.meal_exclusions?.trim() ? `Do not use: ${settings.meal_exclusions.trim()}` : '',
    '',
    'Return a single JSON object and nothing else:',
    `{ "slot": "${slot}", "name": "", "protein_g": 0, "calories": 0, "notes": "", "ingredients": [ { "item": "", "quantity": "", "section": "" } ] }`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function validateMeal(meal, slot, ctx) {
  const errors = [];
  if (!meal || typeof meal !== 'object' || Array.isArray(meal)) {
    return ['The reply was not a single meal object.'];
  }
  if (meal.days) {
    return ['That looks like a whole week, not one meal. Use the paste box on this meal only.'];
  }
  if (meal.slot && meal.slot !== slot) {
    errors.push(`The reply is for the ${meal.slot} slot, but this is the ${slot} slot.`);
  }
  if (!meal.name || typeof meal.name !== 'string') {
    errors.push('The meal has no name.');
  }
  const protein = Number(meal.protein_g);
  if (!Number.isFinite(protein) || protein < 0) {
    errors.push('protein_g is missing or is not a number.');
  } else if (ctx && (protein < ctx.targetLow - 10 || protein > ctx.targetHigh + 15)) {
    errors.push(
      `protein_g is ${Math.round(protein)} g, outside the ${Math.round(ctx.targetLow)} to ${Math.round(ctx.targetHigh)} g this slot needs.`
    );
  }
  if (!Array.isArray(meal.ingredients) || meal.ingredients.length === 0) {
    errors.push('The meal has no ingredients, so nothing would reach the grocery list.');
  }
  return errors;
}

function normalizeMeal(meal, slot) {
  return {
    slot,
    name: String(meal.name),
    protein_g: Number(meal.protein_g),
    calories: Number.isFinite(Number(meal.calories)) ? Number(meal.calories) : null,
    notes: String(meal.notes || ''),
    ingredients: (Array.isArray(meal.ingredients) ? meal.ingredients : [])
      .map((ing) => ({
        item: String(ing.item || '').trim(),
        quantity: String(ing.quantity || '').trim(),
        section: SECTIONS.includes(ing.section) ? ing.section : 'Other',
      }))
      .filter((ing) => ing.item),
  };
}

// Regenerates a single meal in an existing plan.
export async function regenerateMeal(plan, dayIndex, slot) {
  const settings = getSettings();
  const ctx = mealSwapContext(plan, dayIndex, slot, settings);

  if (!hasApiKey()) {
    throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  }

  const systemPrompt = buildSystemPrompt(settings);
  const messages = [{ role: 'user', content: buildMealUserPrompt(settings, slot, ctx) }];
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await callClaude(messages, systemPrompt, 2000);
      const parsed = extractJson(text);
      const errors = validateMeal(parsed, slot, ctx);
      if (errors.length > 0) throw new Error(errors.join(' '));
      return normalizeMeal(parsed, slot);
    } catch (err) {
      lastError = err.message;
      if (attempt === 1) {
        messages.length = 1;
        messages.push({
          role: 'user',
          content: `That did not work: ${err.message}. Send only the JSON object for the ${slot} meal.`,
        });
      }
    }
  }

  throw new Error(lastError || 'Could not regenerate that meal.');
}

// Rebuilds the grocery list from a plan, deduped across the week, keeping any
// boxes that were already ticked.
export function rebuildGrocery(weekStart, plan) {
  const previous = db
    .prepare('SELECT section, item, checked FROM grocery_items WHERE week_start = ?')
    .all(weekStart);
  const checkedKeys = new Set(
    previous.filter((r) => r.checked).map((r) => `${r.section}||${r.item.toLowerCase()}`)
  );

  const merged = new Map();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients || []) {
        const key = `${ing.section}||${ing.item.toLowerCase()}`;
        if (!merged.has(key)) {
          merged.set(key, { section: ing.section, item: ing.item, quantities: [] });
        }
        if (ing.quantity) merged.get(key).quantities.push(ing.quantity);
      }
    }
  }

  const rows = [...merged.values()].map((entry) => {
    const counts = new Map();
    for (const q of entry.quantities) counts.set(q, (counts.get(q) || 0) + 1);
    const quantity = [...counts.entries()]
      .map(([q, n]) => (n > 1 ? `${n} x ${q}` : q))
      .join(', ');
    return {
      section: entry.section,
      item: entry.item,
      quantity,
      checked: checkedKeys.has(`${entry.section}||${entry.item.toLowerCase()}`) ? 1 : 0,
    };
  });

  rows.sort((a, b) => {
    const sa = SECTIONS.indexOf(a.section);
    const sb = SECTIONS.indexOf(b.section);
    if (sa !== sb) return sa - sb;
    return a.item.localeCompare(b.item);
  });

  const insert = db.prepare(
    'INSERT INTO grocery_items (week_start, section, item, quantity, checked, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const run = db.transaction(() => {
    db.prepare('DELETE FROM grocery_items WHERE week_start = ?').run(weekStart);
    rows.forEach((row, i) => {
      insert.run(weekStart, row.section, row.item, row.quantity, row.checked, i);
    });
  });
  run();

  return rows.length;
}

export function savePlan(weekStart, plan, source) {
  db.prepare(
    `INSERT INTO meal_plans (week_start, plan_json, source)
     VALUES (?, ?, ?)
     ON CONFLICT (week_start) DO UPDATE
       SET plan_json = excluded.plan_json,
           source = excluded.source,
           updated_at = datetime('now')`
  ).run(weekStart, JSON.stringify(plan), source);
  rebuildGrocery(weekStart, plan);
}

export function loadPlan(weekStart) {
  const row = db.prepare('SELECT * FROM meal_plans WHERE week_start = ?').get(weekStart);
  if (!row) return null;
  return { ...row, plan: JSON.parse(row.plan_json) };
}

export function listPlanWeeks() {
  return db
    .prepare('SELECT week_start, source, created_at, updated_at FROM meal_plans ORDER BY week_start DESC')
    .all();
}

// Manual path: build the exact prompt to paste into a chat assistant, and take
// the JSON that comes back. No API key involved.
export function buildPastePrompt(weekStart) {
  const settings = getSettings();
  const system = buildSystemPrompt(settings);
  const user = buildUserPrompt(settings, weekStart, trainingContext(weekStart));
  return [system, '', '---', '', user].join('\n');
}

export class PlanImportError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'PlanImportError';
    this.details = details;
  }
}

export function buildMealPastePrompt(plan, dayIndex, slot) {
  const settings = getSettings();
  const ctx = mealSwapContext(plan, dayIndex, slot, settings);
  const system = buildSystemPrompt(settings);
  const user = buildMealUserPrompt(settings, slot, ctx);
  return [system, '', '---', '', user].join('\n');
}

// Takes the assistant's reply for one meal and returns the replacement, ready
// to drop into the day. Same error shape as the week import.
export function importMealText(plan, dayIndex, slot, text) {
  const settings = getSettings();
  const ctx = mealSwapContext(plan, dayIndex, slot, settings);

  if (!text || !String(text).trim()) {
    throw new PlanImportError('Paste the reply from the assistant first.');
  }

  let parsed;
  try {
    parsed = extractJson(text);
  } catch (err) {
    throw new PlanImportError(
      `That does not look like the JSON meal. ${err.message} Copy the whole reply, including the outer curly braces.`
    );
  }

  const errors = validateMeal(parsed, slot, ctx);
  if (errors.length > 0) {
    throw new PlanImportError('The meal came back but it does not fit this day yet.', errors.slice(0, 8));
  }

  return normalizeMeal(parsed, slot);
}

// Puts a replacement meal into the day and keeps the day total honest.
export function applyMeal(plan, dayIndex, slot, replacement) {
  const day = plan.days[dayIndex];
  day.meals = day.meals.map((m) => (m.slot === slot ? replacement : m));
  day.total_protein_g = Math.round(
    day.meals.reduce((sum, m) => sum + (Number(m.protein_g) || 0), 0)
  );
  return plan;
}

export function importPlanText(weekStart, text) {
  const settings = getSettings();
  if (!text || !String(text).trim()) {
    throw new PlanImportError('Paste the reply from the assistant first.');
  }

  let parsed;
  try {
    parsed = extractJson(text);
  } catch (err) {
    throw new PlanImportError(
      `That does not look like the JSON week. ${err.message} Copy the whole reply, including the outer curly braces.`
    );
  }

  const errors = validatePlan(parsed, weekStart, settings);
  if (errors.length > 0) {
    throw new PlanImportError(
      'The week came back but it does not match your plan yet.',
      errors.slice(0, 8)
    );
  }

  return normalizePlan(parsed, weekStart, settings);
}
