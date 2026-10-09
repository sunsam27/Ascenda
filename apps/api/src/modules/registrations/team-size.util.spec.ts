import { describePlanBand, parseTeamSize } from './team-size.util';

describe('parseTeamSize', () => {
  it('parses a single number', () => {
    expect(parseTeamSize('1')).toEqual({ min: 1, max: 1 });
    expect(parseTeamSize('25')).toEqual({ min: 25, max: 25 });
  });

  it('parses ranges using en dash, hyphen, or em dash', () => {
    expect(parseTeamSize('21–100')).toEqual({ min: 21, max: 100 });
    expect(parseTeamSize('21-100')).toEqual({ min: 21, max: 100 });
    expect(parseTeamSize('21—100')).toEqual({ min: 21, max: 100 });
  });

  it('normalises a reversed range to a single point', () => {
    expect(parseTeamSize('100–21')).toEqual({ min: 100, max: 100 });
  });

  it('parses open-ended bands', () => {
    expect(parseTeamSize('501+')).toEqual({
      min: 501,
      max: Number.MAX_SAFE_INTEGER,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseTeamSize('  1  ')).toEqual({ min: 1, max: 1 });
  });

  it('treats unknown formats as unbounded so signup is not blocked', () => {
    expect(parseTeamSize('')).toEqual({ min: 1, max: Number.MAX_SAFE_INTEGER });
    expect(parseTeamSize('abc')).toEqual({
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
  });
});

describe('describePlanBand', () => {
  it('describes a single-person plan', () => {
    expect(describePlanBand({ minHeadcount: 1, maxHeadcount: 1 })).toBe(
      '1 person',
    );
  });

  it('describes a multiple-person fixed band', () => {
    expect(describePlanBand({ minHeadcount: 2, maxHeadcount: 2 })).toBe(
      '2 people',
    );
  });

  it('describes an inclusive band', () => {
    expect(describePlanBand({ minHeadcount: 21, maxHeadcount: 100 })).toBe(
      '21–100 people',
    );
  });

  it('describes an open-ended band', () => {
    expect(describePlanBand({ minHeadcount: 501 })).toBe('501+ people');
  });

  it('describes an upper-limited band', () => {
    expect(describePlanBand({ maxHeadcount: 10 })).toBe('up to 10 people');
  });

  it('falls back to maxSeats when headcount fields are absent', () => {
    expect(describePlanBand({ maxSeats: 50 })).toBe('up to 50 people');
  });

  it('falls back to a generic description', () => {
    expect(describePlanBand({})).toBe('any team size');
  });
});