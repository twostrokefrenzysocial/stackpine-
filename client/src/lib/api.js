// Thin API client. The session token lives in localStorage.

const TOKEN_KEY = 'academy_ready_token';

export const API_BASE = import.meta.env.VITE_API_BASE || '';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (res.status === 401) {
    clearToken();
    if (onUnauthorized) onUnauthorized();
    throw new Error('Session expired. Sign in again.');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed with ${res.status}`);
    err.status = res.status;
    // Some endpoints return a list of specific problems alongside the message.
    if (Array.isArray(data?.details)) err.details = data.details;
    throw err;
  }
  return data;
}

export const api = {
  login: (pin) => request('/auth/login', { method: 'POST', body: { pin } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePin: (current_pin, new_pin) =>
    request('/auth/change-pin', { method: 'POST', body: { current_pin, new_pin } }),

  today: () => request('/today'),

  settings: () => request('/settings'),
  saveSettings: (patch) => request('/settings', { method: 'PUT', body: patch }),

  week: (week) => request(`/workouts/week${week ? `?week=${week}` : ''}`),
  workoutsForDate: (date) => request(`/workouts/date/${date}`),
  logWorkout: (id, payload) => request(`/workouts/${id}/log`, { method: 'POST', body: payload }),
  completeWorkout: (id, completed = true) =>
    request(`/workouts/${id}/complete`, { method: 'POST', body: { completed } }),
  swapDays: (date_a, date_b) =>
    request('/workouts/swap', { method: 'POST', body: { date_a, date_b } }),

  logWeight: (lbs, date) => request('/logs/weight', { method: 'POST', body: { lbs, date } }),
  weightHistory: () => request('/logs/weight'),
  logWater: (oz, date) => request('/logs/water', { method: 'POST', body: { oz, date } }),
  resetWater: (date) => request('/logs/water/reset', { method: 'POST', body: { date } }),
  logProtein: (grams, date) => request('/logs/protein', { method: 'POST', body: { grams, date } }),
  resetProtein: (date) => request('/logs/protein/reset', { method: 'POST', body: { date } }),
  day: (date) => request(`/logs/day${date ? `?date=${date}` : ''}`),

  tests: () => request('/tests'),
  logTest: (payload) => request('/tests', { method: 'POST', body: payload }),

  progress: () => request('/progress/summary'),

  mealPlan: (week_start) => request(`/meals/plan${week_start ? `?week_start=${week_start}` : ''}`),
  generateMeals: (week_start, force = false) =>
    request('/meals/generate', { method: 'POST', body: { week_start, force } }),
  swapMeal: (week_start, day_index, slot) =>
    request('/meals/swap-meal', { method: 'POST', body: { week_start, day_index, slot } }),
  grocery: (week_start) => request(`/meals/grocery${week_start ? `?week_start=${week_start}` : ''}`),
  checkGrocery: (id, checked) =>
    request(`/meals/grocery/${id}`, { method: 'PUT', body: { checked } }),
  resetGrocery: (week_start) =>
    request('/meals/grocery/reset', { method: 'POST', body: { week_start } }),
  mealWeeks: () => request('/meals/weeks'),
  mealPrompt: (week_start) => request(`/meals/prompt?week_start=${week_start}`),
  importMeals: (week_start, text) =>
    request('/meals/import', { method: 'POST', body: { week_start, text } }),
  singleMealPrompt: (week_start, day_index, slot) =>
    request(`/meals/meal-prompt?week_start=${week_start}&day_index=${day_index}&slot=${slot}`),
  importSingleMeal: (week_start, day_index, slot, text) =>
    request('/meals/meal-import', { method: 'POST', body: { week_start, day_index, slot, text } }),

  vapidKey: () => request('/push/vapid-public-key'),
  subscribePush: (subscription, label) =>
    request('/push/subscribe', { method: 'POST', body: { subscription, label } }),
  unsubscribePush: (endpoint) =>
    request('/push/unsubscribe', { method: 'POST', body: { endpoint } }),
  testPush: () => request('/push/test', { method: 'POST' }),
  pushSubscriptions: () => request('/push/subscriptions'),

  standards: () => request('/standards'),
};
