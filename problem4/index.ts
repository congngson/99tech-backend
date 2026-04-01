/**
 * Problem 4: Three ways to sum to n
 *
 * Provide 3 unique implementations of the following function:
 *   var sum_to_n: (n: number) => number
 *
 * sum_to_n(5) === 1 + 2 + 3 + 4 + 5 === 15
 *
 * All three implementations support positive, negative, and zero inputs.
 */

/**
 * Implementation A: Gauss closed-form formula  O(1) time / O(1) space
 *
 * For n >= 0: sum = n*(n+1)/2
 * For n < 0:  mirror the positive sum with a negative sign (sum n..-1)
 *
 * This is the most efficient approach — no loops, no recursion, just math.
 */
export function sum_to_n_a(n: number): number {
  const abs = Math.abs(n);
  return (Math.sign(n) * abs * (abs + 1)) / 2;
}

/**
 * Implementation B: Iterative accumulation  O(n) time / O(1) space
 *
 * Classic loop that accumulates integers one by one from 1 → n (or -1 → n).
 * No stack risk, constant extra memory.
 */
export function sum_to_n_b(n: number): number {
  let sum = 0;
  if (n >= 0) {
    for (let i = 1; i <= n; i++) sum += i;
  } else {
    for (let i = -1; i >= n; i--) sum += i;
  }
  return sum;
}

/**
 * Implementation C: Array + reduce  O(n) time / O(n) space
 *
 * Builds an integer sequence with Array.from then collapses it with reduce.
 * Demonstrates a functional, declarative style.
 * Note: extra O(n) space for the intermediate array.
 */
export function sum_to_n_c(n: number): number {
  if (n === 0) return 0;
  const sign = n > 0 ? 1 : -1;
  const abs = Math.abs(n);
  return (
    sign *
    Array.from({ length: abs }, (_, i) => i + 1).reduce((acc, v) => acc + v, 0)
  );
}
