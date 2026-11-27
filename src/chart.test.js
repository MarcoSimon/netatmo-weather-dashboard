// Local midnight and noon depend on the zone; pin it before any Date is made.
process.env.TZ = 'Europe/Berlin';

const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const {
  CURVES,
  GAP_S,
  GUIDES,
  WEEK_S,
  WINDOW_S,
  chartContent,
  dotPath,
  guidesPath,
  linePath,
  localMarks,
  marksPath,
  reachedGuides,
  scaleFor,
  scaleWithGuides,
  valueRange,
  weekMarks,
} = await import('../public/chart.js');

const point = (time_utc, temperature) => ({ time_utc, temperature });

test('the range covers only the window and skips missing values', () => {
  const samples = [point(50, -9), point(100, 3), point(200, null), point(300, 7), point(400, 99)];
  assert.deepEqual(valueRange(samples, 'temperature', 100, 300), { min: 3, max: 7, minAt: 100, maxAt: 300 });
  assert.equal(valueRange([point(100, null)], 'temperature', 0, 1000), null);
  assert.equal(valueRange([], 'temperature', 0, 1000), null);
  assert.equal(valueRange(samples, 'humidity', 0, 1000), null, 'another quantity');
});

test('a low or high held for hours is placed at its last point', () => {
  const samples = [point(0, 22), point(300, 21), point(600, 21), point(900, 23), point(1200, 23), point(1500, 22)];
  assert.deepEqual(valueRange(samples, 'temperature', 0, 1500), { min: 21, max: 23, minAt: 600, maxAt: 1200 });
});

test('a dot is a zero-length subpath on the curve', () => {
  const frame = { fromUtc: 0, toUtc: 600, low: 10, high: 20 };
  assert.equal(dotPath(300, 20, frame), 'M500 10h0');
  assert.equal(dotPath(0, 10, frame), 'M0 90h0');
});

test('a narrow range is widened around its middle, a wide one is kept', () => {
  assert.deepEqual(scaleFor({ min: 22.9, max: 23.1 }, 2), { low: 22, high: 24 });
  assert.deepEqual(scaleFor({ min: 21, max: 21 }, 2), { low: 20, high: 22 });
  assert.deepEqual(scaleFor({ min: -3, max: 12 }, 2), { low: -3, high: 12 });
  assert.deepEqual(scaleFor({ min: 1012, max: 1014 }, 5), { low: 1010.5, high: 1015.5 });
});

test('the line spans the window, low values at the bottom', () => {
  const path = linePath([point(0, 10), point(300, 20)], { fromUtc: 0, toUtc: 600, low: 10, high: 20 }, 'temperature');
  // 10 % margin: the low sits at y=90, the high at y=10.
  assert.equal(path, 'M0 90L500 10');
});

test('a gap in the series breaks the line instead of bridging it', () => {
  const t0 = 0;
  const samples = [point(t0, 1), point(t0 + 300, 1), point(t0 + 300 + GAP_S + 1, 1), point(t0 + 300 + GAP_S + 301, 1)];
  const path = linePath(samples, { fromUtc: 0, toUtc: 3600, low: 0, high: 2 }, 'temperature');
  assert.equal(path.match(/M/g).length, 2);
  assert.equal(path.match(/L/g).length, 2);
});

test('a step of exactly the gap limit still connects', () => {
  const path = linePath([point(0, 1), point(GAP_S, 1)], { fromUtc: 0, toUtc: 3600, low: 0, high: 2 }, 'temperature');
  assert.match(path, /^M[^M]*L/);
});

test('a missing value breaks the line, and points outside the window are dropped', () => {
  const samples = [point(-300, 1), point(0, 1), point(300, null), point(600, 1), point(900, 1), point(1200, 1)];
  const path = linePath(samples, { fromUtc: 0, toUtc: 900, low: 0, high: 2 }, 'temperature');
  assert.equal(path, 'M0 50M666.7 50L1000 50');
});

test('the marks are local midnight and noon', () => {
  // 2025-09-10 10:00 local (08:00 UTC) back 24 hours: noon, then midnight.
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const marks = localMarks(now - WINDOW_S, now);
  assert.deepEqual(marks.map((m) => m.label), ['12 Uhr', '0 Uhr']);
  // Local midnight is 22:00 UTC the day before: 14 of 24 hours in.
  assert.equal(marks[1].at, 14 / 24);
});

test('the day the clocks go back still has one midnight and one noon', () => {
  // 2026-10-25 is 25 hours long in Berlin; take the window ending at 12:00 local (11:00 UTC).
  const now = Date.UTC(2026, 9, 25, 11) / 1000;
  const marks = localMarks(now - WINDOW_S, now);
  assert.deepEqual(marks.map((m) => m.label), ['0 Uhr', '12 Uhr']);
  // Midnight was 22:00 UTC, 13 hours before the end, as CEST still applied.
  assert.equal(marks[0].at, 11 / 24);
});

test('the day the clocks go forward still has one midnight and one noon', () => {
  // 2026-03-29 is 23 hours long; the window ends at 11:30 CEST (09:30 UTC).
  const now = Date.UTC(2026, 2, 29, 9, 30) / 1000;
  const marks = localMarks(now - WINDOW_S, now);
  assert.deepEqual(marks.map((m) => m.label), ['12 Uhr', '0 Uhr']);
  // Midnight was 23:00 UTC, still CET: 13.5 hours into the window.
  assert.equal(marks[1].at, 13.5 / 24);
});

test('a week has a line at each local midnight and each day named under its noon', () => {
  // 2025-09-10 10:00 local (08:00 UTC) back seven days, to Wednesday 10:00.
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const { lines, labels } = weekMarks(now - WEEK_S, now);
  assert.equal(lines.length, 7);
  // The first midnight, Thursday's, is 22:00 UTC: 14 of 168 hours in.
  assert.equal(lines[0].at, 14 / 168);
  // Wednesday's noon is two hours in, too close to the edge for its name;
  // today's noon has not come yet.
  assert.deepEqual(labels.map((l) => l.label), ['Do', 'Fr', 'Sa', 'So', 'Mo', 'Di']);
  assert.equal(labels[0].at, 26 / 168);
});

test('a week across the clocks going back still has seven midnights and each day once', () => {
  // Monday 2026-10-26 12:00 CET (11:00 UTC) back to Monday 2026-10-19 13:00 CEST.
  const now = Date.UTC(2026, 9, 26, 11) / 1000;
  const { lines, labels } = weekMarks(now - WEEK_S, now);
  // Sunday's midnight is 22:00 UTC (CEST), Monday's 23:00 UTC (CET), 25 hours apart.
  assert.deepEqual(lines.slice(-2).map((l) => l.at), [131 / 168, 156 / 168]);
  assert.equal(lines.length, 7);
  // Today's noon is the window's end and stays unnamed.
  assert.deepEqual(labels.map((l) => l.label), ['Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
});

test('a week chart takes its low and high from the whole week and leaves the night out', () => {
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const samples = [point(now - 5 * 86400, -3), point(now - 3600, 4), point(now - 3300, 6)];
  const night = { fromUtc: now - 14 * 3600, toUtc: now };
  const day = chartContent(samples, now, 'temperature', night);
  const week = chartContent(samples, now, 'temperature', null, WEEK_S);
  assert.equal(day.week, false);
  assert.equal(week.week, true);
  assert.equal(day.min, '4,0\u00a0°C', 'five days ago is outside the day');
  assert.equal(week.min, '\u22123,0\u00a0°C');
  assert.equal(week.night, null);
  assert.deepEqual(week.marks.map((m) => m.label), ['Do', 'Fr', 'Sa', 'So', 'Mo', 'Di']);
  assert.equal(week.grid.match(/M/g).length, 7, 'midnights only, no noon lines');
});

test('the marks become vertical lines through the whole height', () => {
  assert.equal(marksPath([{ at: 0.25 }, { at: 0.75 }]), 'M250 0V100M750 0V100');
});

test('a chart carries its line, its marks and the 24-hour low and high in German', () => {
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const content = chartContent([point(now - 3600, -1.25), point(now - 3300, 4)], now);
  assert.equal(content.min, '\u22121,3\u00a0°C');
  assert.equal(content.max, '4,0\u00a0°C');
  assert.equal(content.key, 'temperature');
  assert.equal(content.coloured, true);
  const frame = { fromUtc: now - WINDOW_S, toUtc: now, ...scaleFor({ min: -1.25, max: 4 }, 2) };
  assert.equal(content.minDot, dotPath(now - 3600, -1.25, frame));
  assert.equal(content.maxDot, dotPath(now - 3300, 4, frame));
  assert.match(content.line, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+$/);
  assert.equal(content.marks.length, 2);
  assert.equal(content.grid, marksPath(content.marks));
});

test('a tapped quantity gets its own curve, unit, decimals and span, with a neutral low and high', () => {
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const samples = [
    { time_utc: now - 3600, temperature: 21, humidity: 48, co2: 612, pressure: 1013.4 },
    { time_utc: now - 3300, temperature: 22, humidity: 51, co2: 655, pressure: 1014.6 },
  ];
  // The unit only once, after the high: "Min: 1013 – Max: 1015 hPa" fits on one line.
  const expect = { humidity: ['48', '51\u00a0%'], co2: ['612', '655\u00a0ppm'], pressure: ['1013', '1015\u00a0hPa'] };
  for (const [key, [min, max]] of Object.entries(expect)) {
    const content = chartContent(samples, now, key);
    assert.deepEqual([content.key, content.coloured, content.min, content.max], [key, false, min, max], key);
    const range = valueRange(samples, key, now - WINDOW_S, now);
    const frame = { fromUtc: now - WINDOW_S, toUtc: now, ...scaleFor(range, CURVES[key].minSpan) };
    assert.equal(content.line, linePath(samples, frame, key), key);
    assert.equal(content.minDot, dotPath(now - 3600, range.min, frame), key);
  }
  assert.notEqual(chartContent(samples, now, 'humidity').line, chartContent(samples, now, 'temperature').line);
});

test('a curve spans at least its minimum, so a quiet day stays flat', () => {
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const flat = [{ time_utc: now - 600, co2: 500 }, { time_utc: now - 300, co2: 510 }];
  // 10 ppm in a 200 ppm span: the two points sit 4 units apart in a 80-unit band.
  const ys = chartContent(flat, now, 'co2').line.match(/ ([\d.]+)/g).map(Number);
  assert.equal(Math.round((ys[0] - ys[1]) * 10) / 10, 4);
});

test('a module without temperatures in the window gets no chart', () => {
  assert.equal(chartContent([point(0, 5)], WINDOW_S * 3), null);
  assert.equal(chartContent([{ time_utc: 100, humidity: 50 }], 200), null);
  assert.equal(chartContent([{ time_utc: 100, temperature: 20 }], 200, 'co2'), null, 'no CO₂ outside');
});

test('a guide shows only once it is reached, on its own side', () => {
  const frost = GUIDES.outdoor.temperature;
  assert.deepEqual(reachedGuides(frost, { min: 0.1, max: 6 }), [], 'just above zero is no frost');
  assert.deepEqual(reachedGuides(frost, { min: 0, max: 6 }), frost, 'zero itself is reached');
  assert.deepEqual(reachedGuides(frost, { min: -4, max: -1 }), frost, 'a day below zero throughout');
  const co2 = GUIDES.room.co2;
  assert.deepEqual(reachedGuides(co2, { min: 450, max: 999 }), []);
  assert.deepEqual(reachedGuides(co2, { min: 450, max: 1000 }), co2);
  const humidity = GUIDES.room.humidity;
  assert.deepEqual(reachedGuides(humidity, { min: 48, max: 59 }), []);
  assert.deepEqual(reachedGuides(humidity, { min: 48, max: 61 }), humidity);
});

test('only rooms get the humidity and CO₂ guides, only the outdoor module the frost', () => {
  assert.equal(GUIDES.outdoor.humidity, undefined, 'outside air sits above 60 % most of the time');
  assert.equal(GUIDES.room.temperature, undefined);
});

test('the scale takes in a reached guide beyond the curve, and is otherwise left alone', () => {
  assert.deepEqual(scaleWithGuides({ low: -4, high: -1 }, [{ value: 0 }]), { low: -4, high: 0 });
  assert.deepEqual(scaleWithGuides({ low: -2, high: 5 }, [{ value: 0 }]), { low: -2, high: 5 });
  assert.deepEqual(scaleWithGuides({ low: -2, high: 5 }, []), { low: -2, high: 5 });
});

test('a guide is a horizontal line across the width, at its value on the curve\'s scale', () => {
  const frame = { fromUtc: 0, toUtc: 1, low: -2, high: 2 };
  // 0 is the middle of the scale: 50 units down in a 100-unit view.
  assert.equal(guidesPath([{ value: 0 }], frame), 'M0 50H1000');
  assert.equal(guidesPath([], frame), '');
});

test('a chart draws a reached guide into its grid and places its value', () => {
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const frost = GUIDES.outdoor.temperature;
  const cold = [point(now - 3600, -2), point(now - 3300, 2)];
  const content = chartContent(cold, now, 'temperature', null, WINDOW_S, frost);
  assert.equal(content.grid, marksPath(content.marks));
  assert.equal(content.guideLines, 'M0 50H1000');
  assert.deepEqual(content.guides, [{ at: 0.5, label: '0' }]);

  const mild = [point(now - 3600, 1), point(now - 3300, 5)];
  const calm = chartContent(mild, now, 'temperature', null, WINDOW_S, frost);
  assert.equal(calm.guideLines, '', 'no frost, no line');
  assert.deepEqual(calm.guides, []);
  assert.equal(calm.line, chartContent(mild, now).line, 'and the curve is untouched');
});

test('a day below zero throughout draws the frost line at the top edge of the curve', () => {
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const content = chartContent([point(now - 3600, -6), point(now - 3300, -2)], now, 'temperature', null, WINDOW_S, GUIDES.outdoor.temperature);
  // The scale runs from −6 to 0, so zero sits on the upper margin.
  assert.deepEqual(content.guides, [{ at: 0.1, label: '0' }]);
});

test('a week draws the guide too', () => {
  const now = Date.UTC(2025, 8, 10, 8) / 1000;
  const samples = [
    { time_utc: now - 4 * 86400, co2: 1180 },
    { time_utc: now - 4 * 86400 + 300, co2: 620 },
    { time_utc: now - 3600, co2: 540 },
  ];
  const week = chartContent(samples, now, 'co2', null, WEEK_S, GUIDES.room.co2);
  assert.equal(week.guides.length, 1);
  assert.equal(week.guides[0].label, '1000');
  assert.match(week.guideLines, /^M0 [\d.]+H1000$/);
  assert.deepEqual(chartContent(samples, now, 'co2', null, WINDOW_S, GUIDES.room.co2).guides, [], 'the day stayed below');
});
