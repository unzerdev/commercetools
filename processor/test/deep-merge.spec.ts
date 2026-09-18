import { describe, expect, it } from '@jest/globals';
import { deepMerge, isPlainObject } from '../src/domain';

describe('isPlainObject', () => {
  it('is true only for non-null, non-array object literals', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(isPlainObject(1)).toBe(false);
  });
});

describe('deepMerge — the layer policy its one caller, resolve-store-config, resolves', () => {
  it('an undefined override yields the base; an undefined base yields the override', () => {
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(deepMerge(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it('plain objects merge recursively, keeping sibling keys from the base', () => {
    expect(deepMerge({ a: { x: 1, y: 2 }, b: 3 }, { a: { y: 9 } })).toEqual({ a: { x: 1, y: 9 }, b: 3 });
  });

  it('arrays are replaced wholesale by the override (never concatenated)', () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  it('scalars are replaced wholesale by the override', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(deepMerge(1, 2)).toBe(2);
  });

  it('does not mutate either input', () => {
    const base = { a: { x: 1 } };
    const override = { a: { y: 2 } };
    deepMerge(base, override);
    expect(base).toEqual({ a: { x: 1 } });
    expect(override).toEqual({ a: { y: 2 } });
  });

  it('skips __proto__ from a JSON-sourced override — never pollutes Object.prototype', () => {
    // Only JSON.parse creates '__proto__' as an OWN key; assigning it through the inherited setter on
    // the spread-copied result would rebind the merged object's prototype.
    const merged = deepMerge({ a: 1 }, JSON.parse('{"__proto__": {"polluted": 1}}')) as Record<string, unknown>;

    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect((merged as { polluted?: number }).polluted).toBeUndefined();
  });

  it('skips constructor and prototype keys alike', () => {
    const merged = deepMerge(
      { keep: 1 },
      JSON.parse('{"constructor": {"x": 1}, "prototype": {"y": 2}, "keep": 2}'),
    ) as Record<string, unknown>;

    expect(merged).toEqual({ keep: 2 });
  });
});
