const UNIX_EPOCH_OFFSET = 719_468;

export interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function calendarDateParts(value: string): CalendarDateParts {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    throw new Error("INVALID_DATE");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("INVALID_DATE");
  }
  return { year, month, day };
}

export function isCalendarDate(value: string): boolean {
  try {
    calendarDateParts(value);
    return true;
  } catch {
    return false;
  }
}

export function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return days[month - 1] ?? 0;
}

/** Gregorian calendar day ordinal with 1970-01-01 equal to zero. */
export function calendarDayOrdinal(value: string): number {
  const { year: inputYear, month, day } = calendarDateParts(value);
  let year = inputYear;
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) +
    day -
    1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - UNIX_EPOCH_OFFSET;
}

export function calendarDateFromDayOrdinal(ordinal: number): string {
  if (!Number.isSafeInteger(ordinal)) {
    throw new Error("INVALID_DATE");
  }
  const day = ordinal + UNIX_EPOCH_OFFSET;
  const era = Math.floor(day / 146_097);
  const dayOfEra = day - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra +
      Math.floor(yearOfEra / 4) -
      Math.floor(yearOfEra / 100));
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153);
  const month = monthPart + (monthPart < 10 ? 3 : -9);
  const monthDay =
    dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1;
  year += month <= 2 ? 1 : 0;
  if (year < 1 || year > 9999) {
    throw new Error("INVALID_DATE");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(monthDay).padStart(2, "0")}`;
}

export function calendarWeekdayIndex(value: string): number {
  // 1970-01-01 was Thursday. Monday is the stable zero bucket.
  return ((calendarDayOrdinal(value) + 3) % 7 + 7) % 7;
}

export function calendarMonthKey(value: string): string {
  return value.slice(0, 7);
}

export function calendarYearKey(value: string): string {
  return value.slice(0, 4);
}

export function calendarMonthStartOrdinal(year: number, month: number): number {
  return calendarDayOrdinal(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
  );
}

export function calendarMonthEndOrdinal(year: number, month: number): number {
  return calendarMonthStartOrdinal(year, month) + daysInMonth(year, month) - 1;
}
