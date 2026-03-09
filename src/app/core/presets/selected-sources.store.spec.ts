import { PRESET_SOURCES_CATALOG } from './catalog';
import { computeTotalsFromSelectedSources } from './selected-sources.store';

describe('Selected sources store', () => {
  it('1 FortiGate con quantity 10', () => {
    const result = computeTotalsFromSelectedSources(
      [
        {
          id: 'item-1',
          presetId: 'fortinet-fortigate-syslog',
          quantity: 10,
        },
      ],
      PRESET_SOURCES_CATALOG,
      'GB10',
    );

    expect(result.items.length).toBe(1);
    expect(result.totals.totalEps).toBeCloseTo(200, 5);
    expect(result.totals.totalGbPerDay).toBeCloseTo(6.048, 3);
  });

  it('1000 users Sophos: EPS bajo y coherente', () => {
    const result = computeTotalsFromSelectedSources(
      [
        {
          id: 'item-1',
          presetId: 'sophos-central-xdr',
          quantity: 1000,
        },
      ],
      PRESET_SOURCES_CATALOG,
      'GB10',
    );

    expect(result.totals.totalEps).toBeCloseTo(30, 5);
    expect(result.totals.totalGbPerDay).toBeCloseTo(2.592, 3);
    expect(result.totals.totalEps).toBeLessThan(100);
  });

  it('mezcla de fuentes suma total correctamente', () => {
    const result = computeTotalsFromSelectedSources(
      [
        {
          id: 'item-1',
          presetId: 'fortinet-fortigate-syslog',
          quantity: 10,
        },
        {
          id: 'item-2',
          presetId: 'windows-server-security-log',
          quantity: 20,
        },
        {
          id: 'item-3',
          presetId: 'microsoft-defender-endpoint',
          quantity: 500,
        },
      ],
      PRESET_SOURCES_CATALOG,
      'GB10',
    );

    expect(result.totals.totalEps).toBeCloseTo(460, 5);
    expect(result.totals.totalGbPerDay).toBeGreaterThan(0);
    expect(result.items.reduce((sum, item) => sum + item.epsTypical, 0)).toBeCloseTo(result.totals.totalEps, 5);
  });
});
