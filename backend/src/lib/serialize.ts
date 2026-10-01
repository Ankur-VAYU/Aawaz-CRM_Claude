import type { Item } from '../db/schema.js';

export function sizeLabel(item: Pick<Item, 'unit' | 'unitSize'>): string | null {
  if (item.unit === 'pc' && item.unitSize === 1) return null;
  const unit = item.unit === 'l' ? 'L' : item.unit;
  return `${Number(item.unitSize)} ${unit}`;
}

/** Name + size as the shopkeeper would say it, e.g. "Sarson tel 1 L". */
export function itemDisplayName(item: Pick<Item, 'name' | 'unit' | 'unitSize'>): string {
  const size = sizeLabel(item);
  return size ? `${item.name} ${size}` : item.name;
}
