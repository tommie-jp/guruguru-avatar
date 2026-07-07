import { describe, it, expect } from 'vitest';
import {
  CLOCK_DEFAULTS, FONT_MIN, FONT_MAX,
  normalizeHexColor, clampFontSize, normalizeClockConfig,
  formatClockTime, parseClockParams,
} from './clock-config';

describe('normalizeHexColor', () => {
  it('#rrggbb / #rgb を受け入れ、不正は fallback', () => {
    expect(normalizeHexColor('#ffffff', '#000')).toBe('#ffffff');
    expect(normalizeHexColor('#FFF', '#000')).toBe('#FFF');
    expect(normalizeHexColor('white', '#123456')).toBe('#123456');
    expect(normalizeHexColor('#000;background:url(x)', '#123456')).toBe('#123456');
    expect(normalizeHexColor(42, '#123456')).toBe('#123456');
  });
});

describe('clampFontSize', () => {
  it('範囲内はそのまま（整数化）', () => {
    expect(clampFontSize(28)).toBe(28);
    expect(clampFontSize(28.6)).toBe(29);
  });
  it('範囲外は FONT_MIN..FONT_MAX にクランプ', () => {
    expect(clampFontSize(0)).toBe(FONT_MIN);
    expect(clampFontSize(9999)).toBe(FONT_MAX);
  });
  it('非数値は既定サイズにフォールバック', () => {
    expect(clampFontSize('big')).toBe(CLOCK_DEFAULTS.fontSize);
    expect(clampFontSize(NaN)).toBe(CLOCK_DEFAULTS.fontSize);
    expect(clampFontSize(undefined)).toBe(CLOCK_DEFAULTS.fontSize);
  });
});

describe('normalizeClockConfig', () => {
  it('空・非オブジェクトは既定へ', () => {
    expect(normalizeClockConfig(undefined)).toEqual(CLOCK_DEFAULTS);
    expect(normalizeClockConfig(null)).toEqual(CLOCK_DEFAULTS);
    expect(normalizeClockConfig('x')).toEqual(CLOCK_DEFAULTS);
  });
  it('正しい値は正規化して通す', () => {
    expect(normalizeClockConfig({
      visible: true, textColor: '#00ff00', bgColor: '#111111', fontSize: 40,
    })).toEqual({ visible: true, textColor: '#00ff00', bgColor: '#111111', fontSize: 40 });
  });
  it('部分的に不正な値は各フィールド既定へ落とす', () => {
    expect(normalizeClockConfig({
      visible: 1, textColor: 'bad', bgColor: '#abc', fontSize: 'huge',
    })).toEqual({
      visible: false, textColor: CLOCK_DEFAULTS.textColor, bgColor: '#abc', fontSize: CLOCK_DEFAULTS.fontSize,
    });
  });
  it('visible は厳密 true のみ真', () => {
    expect(normalizeClockConfig({ visible: true }).visible).toBe(true);
    expect(normalizeClockConfig({ visible: 'true' }).visible).toBe(false);
    expect(normalizeClockConfig({ visible: 1 }).visible).toBe(false);
  });
  it('新しいオブジェクトを返し入力を破壊しない', () => {
    const input = { visible: true };
    const out = normalizeClockConfig(input);
    expect(out).not.toBe(input);
    expect(input).toEqual({ visible: true });
  });
});

describe('formatClockTime', () => {
  it('YYYY/MM/DD HH:mm 形式（ゼロ埋め）', () => {
    expect(formatClockTime(new Date(2026, 6, 7, 12, 34, 56))).toBe('2026/07/07 12:34');
    expect(formatClockTime(new Date(2026, 0, 3, 9, 5, 0))).toBe('2026/01/03 09:05');
    expect(formatClockTime(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026/12/31 23:59');
  });
  it('Date でない/不正な入力は空文字', () => {
    expect(formatClockTime(null)).toBe('');
    expect(formatClockTime(undefined)).toBe('');
    expect(formatClockTime('2026/07/07')).toBe('');
    expect(formatClockTime(new Date('invalid'))).toBe('');
  });
});

describe('parseClockParams', () => {
  it('未指定は undefined', () => {
    expect(parseClockParams('').clock).toBeUndefined();
    expect(parseClockParams('?tx').clock).toBeUndefined();
  });
  it('?clock（値なし）・=1・=true は有効', () => {
    expect(parseClockParams('?clock').clock).toBe(true);
    expect(parseClockParams('?clock=1').clock).toBe(true);
    expect(parseClockParams('?clock=true').clock).toBe(true);
  });
  it('?clock=0 / =false は無効', () => {
    expect(parseClockParams('?clock=0').clock).toBe(false);
    expect(parseClockParams('?clock=false').clock).toBe(false);
  });
  it('先頭の ? は任意・他パラメータと併用可', () => {
    expect(parseClockParams('clock=1').clock).toBe(true);
    expect(parseClockParams('?rx&clock').clock).toBe(true);
  });
});
