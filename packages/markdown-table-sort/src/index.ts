export type NumericTableSortDirection = 'ascending' | 'descending';

const PLAIN_NUMBER_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i;

type ComparableTableNumber = {
  sign: -1 | 0 | 1;
  digits: string;
  magnitude: bigint;
};

function comparableTableNumber(value: string): ComparableTableNumber | null {
  const normalized = String(value ?? '').trim();
  const match = PLAIN_NUMBER_PATTERN.exec(normalized);
  if (!match) return null;
  const integerPart = match[2] ?? '';
  const fractionalPart = match[3] ?? match[4] ?? '';
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+/, '');
  if (!digits) return { sign: 0, digits: '', magnitude: 0n };
  const exponent = BigInt(match[5] ?? '0');
  return {
    sign: match[1] === '-' ? -1 : 1,
    digits,
    magnitude: BigInt(digits.length) + exponent - BigInt(fractionalPart.length),
  };
}

function compareDigitSequences(left: string, right: string): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = left[index] ?? '0';
    const rightDigit = right[index] ?? '0';
    if (leftDigit !== rightDigit) return leftDigit < rightDigit ? -1 : 1;
  }
  return 0;
}

function compareTableNumbers(
  leftNumber: ComparableTableNumber,
  rightNumber: ComparableTableNumber,
): number {
  if (leftNumber.sign !== rightNumber.sign) return leftNumber.sign - rightNumber.sign;
  if (leftNumber.sign === 0) return 0;
  const magnitudeComparison = leftNumber.magnitude === rightNumber.magnitude
    ? 0
    : leftNumber.magnitude < rightNumber.magnitude ? -1 : 1;
  const absoluteComparison = magnitudeComparison
    || compareDigitSequences(leftNumber.digits, rightNumber.digits);
  return leftNumber.sign === 1 ? absoluteComparison : -absoluteComparison;
}

export function parsePlainTableNumber(value: string): number | null {
  const normalized = String(value ?? '').trim();
  if (!normalized || !PLAIN_NUMBER_PATTERN.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function numericTableColumnIndexes(
  rows: readonly (readonly string[])[],
  columnCount: number,
): number[] {
  if (rows.length === 0 || columnCount <= 0) return [];
  return Array.from({ length: columnCount }, (_, index) => index).filter((columnIndex) =>
    rows.every((row) => parsePlainTableNumber(row[columnIndex] ?? '') !== null),
  );
}

export function stableSortTableRows<T>(
  rows: readonly T[],
  numericValues: readonly (readonly string[])[],
  columnIndex: number,
  direction: NumericTableSortDirection,
): T[] {
  if (rows.length !== numericValues.length) return [...rows];
  const rawValues = numericValues.map((row) => row[columnIndex] ?? '');
  if (rawValues.some((value) => parsePlainTableNumber(value) === null)) return [...rows];
  const values = rawValues.map((value) => comparableTableNumber(value) as ComparableTableNumber);
  const multiplier = direction === 'ascending' ? 1 : -1;
  return rows
    .map((row, originalIndex) => ({
      row,
      originalIndex,
      value: values[originalIndex] as ComparableTableNumber,
    }))
    .sort((left, right) => {
      return compareTableNumbers(left.value, right.value) * multiplier
        || left.originalIndex - right.originalIndex;
    })
    .map(({ row }) => row);
}
