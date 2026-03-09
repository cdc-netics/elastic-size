import {
  computeArchiveDaily,
  computeArchiveSizing,
  computeIndexed,
  computeRatesFromEps,
  computeRetentionTotals,
  formatBytes,
} from './archive-compression';

describe('Archive/Compression sizing', () => {
  it('scenario 1: indexed_to_archive con 2700 EPS', () => {
    const report = computeArchiveSizing({
      includeInSizing: true,
      eps: 2700,
      avgEventBytes: 800,
      retentionHotDays: 60,
      retentionArchivedDays: 275,
      indexOverheadFactor: 0.45,
      mode: 'indexed_to_archive',
      compressionFactor: 0.18,
      unitSystem: 'GB10',
    });

    expect(report.rates.events_per_day).toBe(233_280_000);
    expect(report.rates.raw_gb_per_hour).toBeCloseTo(7.776, 3);
    expect(report.rates.raw_gb_per_day).toBeCloseTo(186.624, 3);
    expect(report.rates.indexed_gb_per_day).toBeCloseTo(83.9808, 4);
    expect(report.rates.archive_gb_per_day).toBeCloseTo(15.116544, 5);
    expect(report.totals.online_total_gb).toBeCloseTo(5038.848, 3);
    expect(report.totals.archive_total_gb).toBeCloseTo(4157.0496, 4);
    expect(report.totals.total_retained_gb).toBeCloseTo(9195.8976, 4);
  });

  it('scenario 2: raw_to_archive con 1000 EPS', () => {
    const report = computeArchiveSizing({
      includeInSizing: true,
      eps: 1000,
      avgEventBytes: 500,
      retentionHotDays: 30,
      retentionArchivedDays: 335,
      indexOverheadFactor: 0.45,
      mode: 'raw_to_archive',
      compressionFactor: 0.1,
      unitSystem: 'GB10',
    });

    expect(report.rates.raw_gb_per_day).toBeCloseTo(43.2, 3);
    expect(report.rates.indexed_gb_per_day).toBeCloseTo(19.44, 3);
    expect(report.rates.archive_gb_per_day).toBeCloseTo(4.32, 3);
    expect(report.totals.online_total_gb).toBeCloseTo(583.2, 3);
    expect(report.totals.archive_total_gb).toBeCloseTo(1447.2, 3);
    expect(report.totals.total_retained_gb).toBeCloseTo(2030.4, 3);
  });

  it('scenario 3: eps=0 produce todo en cero', () => {
    const report = computeArchiveSizing({
      includeInSizing: true,
      eps: 0,
      avgEventBytes: 800,
      retentionHotDays: 60,
      retentionArchivedDays: 275,
      indexOverheadFactor: 0.45,
      mode: 'indexed_to_archive',
      compressionFactor: 0.18,
      unitSystem: 'GiB2',
    });

    expect(report.rates.events_per_day).toBe(0);
    expect(report.rates.raw_gb_per_hour).toBe(0);
    expect(report.rates.raw_gb_per_day).toBe(0);
    expect(report.rates.indexed_gb_per_day).toBe(0);
    expect(report.rates.archive_gb_per_day).toBe(0);
    expect(report.totals.online_total_gb).toBe(0);
    expect(report.totals.archive_total_gb).toBe(0);
    expect(report.totals.total_retained_gb).toBe(0);
  });

  it('expone funciones modulares reutilizables', () => {
    const rates = computeRatesFromEps(10, 1000);
    const indexed = computeIndexed(rates.rawBytesPerDay, 0.45);
    const archiveDaily = computeArchiveDaily(rates.rawBytesPerDay, indexed, 'indexed_to_archive', 0.2);
    const totals = computeRetentionTotals(indexed, archiveDaily, 10, 20);
    const formatted = formatBytes(totals.totalRetainedBytes, 'GiB2');

    expect(rates.eventsPerDay).toBe(864000);
    expect(indexed).toBeGreaterThan(0);
    expect(archiveDaily).toBeGreaterThan(0);
    expect(totals.totalRetainedBytes).toBeGreaterThan(0);
    expect(formatted.unit).toBe('GiB');
    expect(formatted.value).toBeGreaterThan(0);
  });
});
