// Park-Miller PRNG: deterministic across platforms and runs given the same seed.
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = (Math.floor(Math.abs(seed)) % 2147483646) + 1;
  }
  next() {
    this.s = (this.s * 16807) % 2147483647;
    return (this.s - 1) / 2147483646;
  }
  range(a: number, b: number) {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<K extends string>(w: Record<K, number>): K {
    const keys = Object.keys(w) as K[];
    let sum = 0;
    for (const k of keys) sum += Math.max(0, w[k]);
    let r = this.next() * sum;
    for (const k of keys) {
      r -= Math.max(0, w[k]);
      if (r <= 0) return k;
    }
    return keys[keys.length - 1];
  }
}
