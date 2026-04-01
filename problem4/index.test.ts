import { sum_to_n_a, sum_to_n_b, sum_to_n_c } from './index';

const implementations: Array<[string, (n: number) => number]> = [
  ['sum_to_n_a (Gauss formula)', sum_to_n_a],
  ['sum_to_n_b (iterative loop)', sum_to_n_b],
  ['sum_to_n_c (array + reduce)', sum_to_n_c],
];

describe.each(implementations)('%s', (_name, fn) => {
  it('returns 0 for n=0', () => expect(fn(0)).toBe(0));
  it('returns 1 for n=1', () => expect(fn(1)).toBe(1));
  it('returns 15 for n=5', () => expect(fn(5)).toBe(15));
  it('returns 55 for n=10', () => expect(fn(10)).toBe(55));
  it('returns 5050 for n=100', () => expect(fn(100)).toBe(5050));
  it('returns -15 for n=-5', () => expect(fn(-5)).toBe(-15));
  it('returns -1 for n=-1', () => expect(fn(-1)).toBe(-1));
});
