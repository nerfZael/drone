export type FitTableColumnMetric = {
  preferredWeight: number;
  minimumWidth: number;
};

const WIDTH_DECIMAL_PLACES = 3;

function roundWidth(value: number): number {
  return Number(value.toFixed(WIDTH_DECIMAL_PLACES));
}

function exactWidthStrings(values: number[], total: number, unit: '%' | 'px'): string[] {
  let used = 0;
  return values.map((value, index) => {
    const rounded =
      index === values.length - 1 ? roundWidth(total - used) : roundWidth(value);
    used = roundWidth(used + rounded);
    return `${rounded.toFixed(WIDTH_DECIMAL_PLACES)}${unit}`;
  });
}

export function allocateFitTableColumnWidths(
  metrics: FitTableColumnMetric[],
  availableWidth: number | null,
): string[] {
  if (metrics.length === 0) return [];

  const totalWeight = metrics.reduce((sum, metric) => sum + metric.preferredWeight, 0);
  if (availableWidth == null || availableWidth <= 0) {
    const percentages = metrics.map(
      (metric) => (metric.preferredWeight / totalWeight) * 100,
    );
    return exactWidthStrings(percentages, 100, '%');
  }

  const totalMinimumWidth = metrics.reduce((sum, metric) => sum + metric.minimumWidth, 0);
  const widths =
    availableWidth >= totalMinimumWidth
      ? metrics.map(
          (metric) =>
            metric.minimumWidth +
            ((availableWidth - totalMinimumWidth) * metric.preferredWeight) / totalWeight,
        )
      : metrics.map(
          (metric) => (metric.minimumWidth / totalMinimumWidth) * availableWidth,
        );

  return exactWidthStrings(widths, availableWidth, 'px');
}
