import { describe, it, expect } from 'vitest';
import {
  TICKER_DEFAULTS, MAX_TICKER_TEXT_LEN, SPEED_MIN, SPEED_MAX, MIN_CRAWL_MS,
  normalizeHexColor, clampSpeed, sanitizeTickerText, normalizeTickerConfig,
  crawlDurationMs, parseTickerParams,
} from './ticker-config';

describe('normalizeHexColor', () => {
  it('#rrggbb / #rgb を受け入れる（大小文字問わず）', () => {
    expect(normalizeHexColor('#ff0000', '#000')).toBe('#ff0000');
    expect(normalizeHexColor('#FFF', '#000')).toBe('#FFF');
    expect(normalizeHexColor('  #abcdef  ', '#000')).toBe('#abcdef'); // 前後空白は許容
  });

  it('不正な色・非文字列は fallback を返す（無認証 WS の防御）', () => {
    expect(normalizeHexColor('red', '#123456')).toBe('#123456');
    expect(normalizeHexColor('#12', '#123456')).toBe('#123456');
    expect(normalizeHexColor('#gggggg', '#123456')).toBe('#123456');
    expect(normalizeHexColor('rgb(1,2,3)', '#123456')).toBe('#123456');
    expect(normalizeHexColor(123, '#123456')).toBe('#123456');
    expect(normalizeHexColor(undefined, '#123456')).toBe('#123456');
    expect(normalizeHexColor(null, '#123456')).toBe('#123456');
  });

  it('javascript: など注入文字列も弾く', () => {
    expect(normalizeHexColor('javascript:alert(1)', '#000000')).toBe('#000000');
    expect(normalizeHexColor('#000;background:url(x)', '#000000')).toBe('#000000');
  });
});

describe('clampSpeed', () => {
  it('範囲内はそのまま（整数化）', () => {
    expect(clampSpeed(90)).toBe(90);
    expect(clampSpeed(90.7)).toBe(91);
  });

  it('範囲外は SPEED_MIN..SPEED_MAX にクランプ', () => {
    expect(clampSpeed(0)).toBe(SPEED_MIN);
    expect(clampSpeed(-50)).toBe(SPEED_MIN);
    expect(clampSpeed(99999)).toBe(SPEED_MAX);
  });

  it('非数値は既定速度にフォールバック', () => {
    expect(clampSpeed('fast')).toBe(TICKER_DEFAULTS.speed);
    expect(clampSpeed(NaN)).toBe(TICKER_DEFAULTS.speed);
    expect(clampSpeed(Infinity)).toBe(TICKER_DEFAULTS.speed);
    expect(clampSpeed(undefined)).toBe(TICKER_DEFAULTS.speed);
  });
});

describe('sanitizeTickerText', () => {
  it('通常の文字列はそのまま', () => {
    expect(sanitizeTickerText('速報: トマリぐるぐる登場')).toBe('速報: トマリぐるぐる登場');
  });

  it('非文字列は空文字', () => {
    expect(sanitizeTickerText(123)).toBe('');
    expect(sanitizeTickerText(null)).toBe('');
    expect(sanitizeTickerText(undefined)).toBe('');
    expect(sanitizeTickerText({})).toBe('');
  });

  it('制御文字（改行・タブ）は空白へ畳む（1行クロール前提）', () => {
    expect(sanitizeTickerText('a\nb\tc')).toBe('a b c');
    expect(sanitizeTickerText('x\r\ny')).toBe('x  y');
  });

  it('長さ上限で切る', () => {
    const long = 'あ'.repeat(MAX_TICKER_TEXT_LEN + 50);
    expect(sanitizeTickerText(long).length).toBe(MAX_TICKER_TEXT_LEN);
  });
});

describe('normalizeTickerConfig', () => {
  it('空・非オブジェクトは既定へ', () => {
    expect(normalizeTickerConfig(undefined)).toEqual(TICKER_DEFAULTS);
    expect(normalizeTickerConfig(null)).toEqual(TICKER_DEFAULTS);
    expect(normalizeTickerConfig('x')).toEqual(TICKER_DEFAULTS);
    expect(normalizeTickerConfig(42)).toEqual(TICKER_DEFAULTS);
  });

  it('正しい値は正規化して通す', () => {
    expect(normalizeTickerConfig({
      text: 'BREAKING', bgColor: '#000000', textColor: '#ffffff', speed: 120, visible: true,
    })).toEqual({ text: 'BREAKING', bgColor: '#000000', textColor: '#ffffff', speed: 120, visible: true });
  });

  it('部分的に不正な値は各フィールド既定へ落とす', () => {
    expect(normalizeTickerConfig({
      text: 'ok', bgColor: 'notacolor', textColor: '#abc', speed: 'nope', visible: 1,
    })).toEqual({
      text: 'ok', bgColor: TICKER_DEFAULTS.bgColor, textColor: '#abc', speed: TICKER_DEFAULTS.speed, visible: false,
    });
  });

  it('visible は厳密 true のみ真（truthy な 1/"true" は false）', () => {
    expect(normalizeTickerConfig({ visible: true }).visible).toBe(true);
    expect(normalizeTickerConfig({ visible: 1 }).visible).toBe(false);
    expect(normalizeTickerConfig({ visible: 'true' }).visible).toBe(false);
    expect(normalizeTickerConfig({ visible: 'on' }).visible).toBe(false);
  });

  it('新しいオブジェクトを返し入力を破壊しない（immutability）', () => {
    const input = { text: 'a', bgColor: '#fff' };
    const out = normalizeTickerConfig(input);
    expect(out).not.toBe(input);
    expect(input).toEqual({ text: 'a', bgColor: '#fff' });
  });
});

describe('crawlDurationMs', () => {
  it('幅 / 速度 × 1000（ms）を返す', () => {
    expect(crawlDurationMs(900, 90)).toBe(10000);
    expect(crawlDurationMs(450, 90)).toBe(5000);
  });

  it('幅が非正・非数値なら最小値', () => {
    expect(crawlDurationMs(0, 90)).toBe(MIN_CRAWL_MS);
    expect(crawlDurationMs(-100, 90)).toBe(MIN_CRAWL_MS);
    expect(crawlDurationMs('x', 90)).toBe(MIN_CRAWL_MS);
  });

  it('極端に速い/短くても最小 MIN_CRAWL_MS を下回らない', () => {
    expect(crawlDurationMs(10, SPEED_MAX)).toBe(MIN_CRAWL_MS);
  });

  it('速度が不正でも clampSpeed 経由で有限（既定速度）で算出', () => {
    expect(crawlDurationMs(900, 'nope')).toBe(Math.round((900 / TICKER_DEFAULTS.speed) * 1000));
  });
});

describe('parseTickerParams', () => {
  it('未指定は undefined（呼び出し側で既定を決める）', () => {
    expect(parseTickerParams('').ticker).toBeUndefined();
    expect(parseTickerParams('?obs=1').ticker).toBeUndefined();
  });

  it('?ticker（値なし）・=1・=true はいずれも有効', () => {
    expect(parseTickerParams('?ticker').ticker).toBe(true);
    expect(parseTickerParams('?ticker=1').ticker).toBe(true);
    expect(parseTickerParams('?ticker=true').ticker).toBe(true);
    expect(parseTickerParams('?ticker=ON').ticker).toBe(true);
  });

  it('?ticker=0 / =false は明示的に無効化', () => {
    expect(parseTickerParams('?ticker=0').ticker).toBe(false);
    expect(parseTickerParams('?ticker=false').ticker).toBe(false);
    expect(parseTickerParams('?ticker=no').ticker).toBe(false);
  });

  it('先頭の ? は任意・他パラメータと併用できる', () => {
    expect(parseTickerParams('ticker=1').ticker).toBe(true);
    expect(parseTickerParams('?tx&ticker').ticker).toBe(true);
    expect(parseTickerParams('?rx&obs=1').ticker).toBeUndefined();
  });
});
