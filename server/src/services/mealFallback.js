// Static fallback week. Used when the Anthropic call fails or returns
// something that will not validate twice in a row, so the app always has a
// usable plan and a grocery list.

const BREAKFASTS = [
  {
    name: 'Three egg scramble with turkey sausage and peppers',
    protein_g: 38,
    calories: 420,
    ingredients: [
      { item: 'Eggs', quantity: '3', section: 'Dairy and Eggs' },
      { item: 'Turkey breakfast sausage', quantity: '2 links', section: 'Meat and Seafood' },
      { item: 'Bell pepper', quantity: '1/2', section: 'Produce' },
    ],
  },
  {
    name: 'Greek yogurt bowl with berries and a scoop of protein',
    protein_g: 42,
    calories: 380,
    ingredients: [
      { item: 'Plain nonfat Greek yogurt', quantity: '1 cup', section: 'Dairy and Eggs' },
      { item: 'Frozen mixed berries', quantity: '3/4 cup', section: 'Frozen' },
      { item: 'Whey protein powder', quantity: '1 scoop', section: 'Pantry' },
    ],
  },
  {
    name: 'Cottage cheese with pineapple and a hard boiled egg',
    protein_g: 36,
    calories: 340,
    ingredients: [
      { item: 'Low fat cottage cheese', quantity: '1 cup', section: 'Dairy and Eggs' },
      { item: 'Pineapple chunks', quantity: '1/2 cup', section: 'Produce' },
      { item: 'Eggs', quantity: '1', section: 'Dairy and Eggs' },
    ],
  },
  {
    name: 'Protein shake with banana and peanut butter',
    protein_g: 40,
    calories: 430,
    ingredients: [
      { item: 'Whey protein powder', quantity: '2 scoops', section: 'Pantry' },
      { item: 'Banana', quantity: '1', section: 'Produce' },
      { item: 'Peanut butter', quantity: '1 tbsp', section: 'Pantry' },
    ],
  },
  {
    name: 'Egg white and cheddar wrap on a high fiber tortilla',
    protein_g: 35,
    calories: 360,
    ingredients: [
      { item: 'Liquid egg whites', quantity: '1 cup', section: 'Dairy and Eggs' },
      { item: 'Shredded cheddar', quantity: '1/4 cup', section: 'Dairy and Eggs' },
      { item: 'High fiber tortillas', quantity: '1', section: 'Bakery' },
    ],
  },
  {
    name: 'Overnight oats with Greek yogurt and chia',
    protein_g: 38,
    calories: 400,
    ingredients: [
      { item: 'Rolled oats', quantity: '1/2 cup', section: 'Pantry' },
      { item: 'Plain nonfat Greek yogurt', quantity: '3/4 cup', section: 'Dairy and Eggs' },
      { item: 'Chia seeds', quantity: '1 tbsp', section: 'Pantry' },
    ],
  },
  {
    name: 'Steak and eggs, small portion',
    protein_g: 45,
    calories: 460,
    ingredients: [
      { item: 'Sirloin steak', quantity: '4 oz', section: 'Meat and Seafood' },
      { item: 'Eggs', quantity: '2', section: 'Dairy and Eggs' },
    ],
  },
];

const LUNCHES = [
  {
    name: 'Grilled chicken over romaine with vinaigrette',
    protein_g: 45,
    calories: 450,
    ingredients: [
      { item: 'Chicken breast', quantity: '6 oz', section: 'Meat and Seafood' },
      { item: 'Romaine lettuce', quantity: '2 cups', section: 'Produce' },
      { item: 'Vinaigrette dressing', quantity: '2 tbsp', section: 'Pantry' },
    ],
  },
  {
    name: 'Tuna salad on cucumber slices with an apple',
    protein_g: 38,
    calories: 380,
    ingredients: [
      { item: 'Canned tuna in water', quantity: '2 cans', section: 'Pantry' },
      { item: 'Light mayo', quantity: '1 tbsp', section: 'Pantry' },
      { item: 'Cucumber', quantity: '1', section: 'Produce' },
      { item: 'Apple', quantity: '1', section: 'Produce' },
    ],
  },
  {
    name: 'Turkey and cheese roll ups with baby carrots',
    protein_g: 44,
    calories: 340,
    ingredients: [
      { item: 'Sliced deli turkey', quantity: '6 oz', section: 'Meat and Seafood' },
      { item: 'Sliced provolone', quantity: '2 slices', section: 'Dairy and Eggs' },
      { item: 'Baby carrots', quantity: '1 cup', section: 'Produce' },
    ],
  },
  {
    name: 'Leftover chili with a dollop of Greek yogurt',
    protein_g: 42,
    calories: 470,
    ingredients: [
      { item: 'Lean ground beef', quantity: '5 oz', section: 'Meat and Seafood' },
      { item: 'Kidney beans', quantity: '1/2 cup', section: 'Pantry' },
      { item: 'Diced tomatoes', quantity: '1 can', section: 'Pantry' },
    ],
  },
  {
    name: 'Chicken burrito bowl with black beans and salsa',
    protein_g: 44,
    calories: 500,
    ingredients: [
      { item: 'Chicken breast', quantity: '6 oz', section: 'Meat and Seafood' },
      { item: 'Black beans', quantity: '1/2 cup', section: 'Pantry' },
      { item: 'Salsa', quantity: '1/4 cup', section: 'Pantry' },
      { item: 'Brown rice', quantity: '1/2 cup', section: 'Pantry' },
    ],
  },
  {
    name: 'Shrimp and broccoli stir fry over rice',
    protein_g: 44,
    calories: 440,
    ingredients: [
      { item: 'Frozen raw shrimp', quantity: '6 oz', section: 'Frozen' },
      { item: 'Broccoli florets', quantity: '2 cups', section: 'Produce' },
      { item: 'Soy sauce', quantity: '2 tbsp', section: 'Pantry' },
    ],
  },
  {
    name: 'Egg salad with cottage cheese and whole grain crackers',
    protein_g: 35,
    calories: 400,
    ingredients: [
      { item: 'Eggs', quantity: '3', section: 'Dairy and Eggs' },
      { item: 'Low fat cottage cheese', quantity: '1/2 cup', section: 'Dairy and Eggs' },
      { item: 'Whole grain crackers', quantity: '10', section: 'Pantry' },
    ],
  },
];

const DINNERS = [
  {
    name: 'Sheet pan chicken thighs with roasted broccoli and potatoes',
    protein_g: 48,
    calories: 560,
    family_friendly: true,
    ingredients: [
      { item: 'Boneless chicken thighs', quantity: '2 lbs', section: 'Meat and Seafood' },
      { item: 'Broccoli florets', quantity: '2 lbs', section: 'Produce' },
      { item: 'Red potatoes', quantity: '2 lbs', section: 'Produce' },
      { item: 'Olive oil', quantity: '3 tbsp', section: 'Pantry' },
    ],
  },
  {
    name: 'Taco night with lean ground beef, peppers, and shredded lettuce',
    protein_g: 45,
    calories: 540,
    family_friendly: true,
    ingredients: [
      { item: 'Lean ground beef', quantity: '2 lbs', section: 'Meat and Seafood' },
      { item: 'Taco seasoning', quantity: '2 packets', section: 'Pantry' },
      { item: 'Bell pepper', quantity: '2', section: 'Produce' },
      { item: 'Shredded lettuce', quantity: '1 bag', section: 'Produce' },
    ],
  },
  {
    name: 'Baked cod with green beans and rice',
    protein_g: 44,
    calories: 480,
    family_friendly: true,
    ingredients: [
      { item: 'Cod fillets', quantity: '2 lbs', section: 'Meat and Seafood' },
      { item: 'Green beans', quantity: '1.5 lbs', section: 'Produce' },
      { item: 'Brown rice', quantity: '2 cups dry', section: 'Pantry' },
      { item: 'Lemon', quantity: '2', section: 'Produce' },
    ],
  },
  {
    name: 'Turkey meatballs with marinara and zucchini',
    protein_g: 46,
    calories: 520,
    family_friendly: true,
    ingredients: [
      { item: 'Ground turkey', quantity: '2 lbs', section: 'Meat and Seafood' },
      { item: 'Marinara sauce', quantity: '1 jar', section: 'Pantry' },
      { item: 'Zucchini', quantity: '3', section: 'Produce' },
      { item: 'Breadcrumbs', quantity: '1/2 cup', section: 'Pantry' },
    ],
  },
  {
    name: 'Pork loin with roasted carrots and a side salad',
    protein_g: 47,
    calories: 530,
    family_friendly: true,
    ingredients: [
      { item: 'Pork loin', quantity: '2 lbs', section: 'Meat and Seafood' },
      { item: 'Carrots', quantity: '2 lbs', section: 'Produce' },
      { item: 'Mixed salad greens', quantity: '1 bag', section: 'Produce' },
    ],
  },
  {
    name: 'Chicken fajita skillet with peppers and onions',
    protein_g: 46,
    calories: 500,
    family_friendly: true,
    ingredients: [
      { item: 'Chicken breast', quantity: '2 lbs', section: 'Meat and Seafood' },
      { item: 'Bell pepper', quantity: '3', section: 'Produce' },
      { item: 'Yellow onion', quantity: '2', section: 'Produce' },
      { item: 'High fiber tortillas', quantity: '1 pack', section: 'Bakery' },
    ],
  },
  {
    name: 'Burgers on the grill with a big salad',
    protein_g: 45,
    calories: 550,
    family_friendly: true,
    ingredients: [
      { item: 'Lean ground beef', quantity: '2 lbs', section: 'Meat and Seafood' },
      { item: 'Burger buns', quantity: '1 pack', section: 'Bakery' },
      { item: 'Tomato', quantity: '2', section: 'Produce' },
      { item: 'Mixed salad greens', quantity: '1 bag', section: 'Produce' },
    ],
  },
];

const SNACK_PAIRS = [
  [
    { name: 'Beef jerky', protein_g: 22, calories: 180, ingredients: [{ item: 'Beef jerky', quantity: '2 oz', section: 'Pantry' }] },
    { name: 'String cheese and an orange', protein_g: 9, calories: 150, ingredients: [{ item: 'String cheese', quantity: '1', section: 'Dairy and Eggs' }, { item: 'Orange', quantity: '1', section: 'Produce' }] },
  ],
  [
    { name: 'Protein shake', protein_g: 25, calories: 150, ingredients: [{ item: 'Whey protein powder', quantity: '1 scoop', section: 'Pantry' }] },
    { name: 'Apple with peanut butter', protein_g: 8, calories: 230, ingredients: [{ item: 'Apple', quantity: '1', section: 'Produce' }, { item: 'Peanut butter', quantity: '1 tbsp', section: 'Pantry' }] },
  ],
  [
    { name: 'Greek yogurt cup', protein_g: 23, calories: 130, ingredients: [{ item: 'Plain nonfat Greek yogurt', quantity: '1 cup', section: 'Dairy and Eggs' }] },
    { name: 'Handful of almonds', protein_g: 6, calories: 170, ingredients: [{ item: 'Almonds', quantity: '1 oz', section: 'Pantry' }] },
  ],
  [
    { name: 'Cottage cheese with black pepper', protein_g: 24, calories: 180, ingredients: [{ item: 'Low fat cottage cheese', quantity: '1 cup', section: 'Dairy and Eggs' }] },
    { name: 'Baby carrots with hummus', protein_g: 5, calories: 150, ingredients: [{ item: 'Baby carrots', quantity: '1 cup', section: 'Produce' }, { item: 'Hummus', quantity: '3 tbsp', section: 'Pantry' }] },
  ],
  [
    { name: 'Two hard boiled eggs', protein_g: 13, calories: 150, ingredients: [{ item: 'Eggs', quantity: '2', section: 'Dairy and Eggs' }] },
    { name: 'Protein shake', protein_g: 25, calories: 150, ingredients: [{ item: 'Whey protein powder', quantity: '1 scoop', section: 'Pantry' }] },
  ],
  [
    { name: 'Turkey slices and cheese', protein_g: 24, calories: 170, ingredients: [{ item: 'Sliced deli turkey', quantity: '3 oz', section: 'Meat and Seafood' }, { item: 'Sliced provolone', quantity: '1 slice', section: 'Dairy and Eggs' }] },
    { name: 'Grapes', protein_g: 1, calories: 90, ingredients: [{ item: 'Grapes', quantity: '1 cup', section: 'Produce' }] },
  ],
  [
    { name: 'Tuna pouch', protein_g: 20, calories: 110, ingredients: [{ item: 'Tuna pouch', quantity: '1', section: 'Pantry' }] },
    { name: 'Greek yogurt with berries', protein_g: 18, calories: 180, ingredients: [{ item: 'Plain nonfat Greek yogurt', quantity: '1 cup', section: 'Dairy and Eggs' }, { item: 'Frozen mixed berries', quantity: '1/2 cup', section: 'Frozen' }] },
  ],
];

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function fallbackWeek(weekStart) {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const breakfast = { slot: 'breakfast', ...BREAKFASTS[i] };
    const lunch = { slot: 'lunch', ...LUNCHES[i] };
    const dinner = { slot: 'dinner', ...DINNERS[i] };
    const [s1, s2] = SNACK_PAIRS[i];
    const snack1 = { slot: 'snack1', ...s1 };
    const snack2 = { slot: 'snack2', ...s2 };
    const meals = [breakfast, snack1, lunch, snack2, dinner].map((m) => ({
      slot: m.slot,
      name: m.name,
      protein_g: m.protein_g,
      calories: m.calories || null,
      notes: m.family_friendly ? 'Family friendly. Cook the full pan and take your portion.' : '',
      ingredients: m.ingredients,
    }));
    days.push({
      date: addDaysISO(weekStart, i),
      day_name: DAY_NAMES[i],
      meals,
      total_protein_g: meals.reduce((sum, m) => sum + (Number(m.protein_g) || 0), 0),
    });
  }

  return {
    week_start: weekStart,
    days,
    notes:
      'Fallback week. Protein first at every meal, water on every run day, and the dinners are built to feed the whole table.',
  };
}
