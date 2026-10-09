export function isWorldDarkTime(minutes) {
    const minute = ((Math.trunc(Number(minutes) || 0) % 1440) + 1440) % 1440;
    return minute >= 22 * 60 || minute < 6 * 60;
}
