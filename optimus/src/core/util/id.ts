let counter = 0;

/** Sortable, collision-resistant id: time prefix + counter + random suffix. */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const time = Date.now().toString(36).padStart(9, '0');
  const seq = counter.toString(36).padStart(4, '0');
  const rand = Math.floor(Math.random() * 2176782336).toString(36).padStart(6, '0');
  return `${prefix}${time}${seq}${rand}`;
}
