import { describe, it, expect } from 'vitest';
import { isDragScrollMove } from './cue-bar-scroll.js';

describe('isDragScrollMove', () => {
  it('閾値未満はクリック扱い（false）', () => {
    expect(isDragScrollMove(0, 0)).toBe(false);
    expect(isDragScrollMove(3, -3)).toBe(false);
  });

  it('いずれかの軸で閾値以上ならドラッグ扱い（true）', () => {
    expect(isDragScrollMove(4, 0)).toBe(true);
    expect(isDragScrollMove(0, -4)).toBe(true);
    expect(isDragScrollMove(-12, 2)).toBe(true);
  });

  it('閾値は引数で変えられる', () => {
    expect(isDragScrollMove(5, 0, 8)).toBe(false);
    expect(isDragScrollMove(8, 0, 8)).toBe(true);
  });
});
