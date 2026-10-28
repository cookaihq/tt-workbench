"use strict";
const { VaultError: InboxError } = require("./errors.js");
const pad = value => String(value).padStart(2, "0");

function localCreation(date, timezone = "") {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new InboxError("INVALID_TIME", "无法取得有效的创建时间。");
  if (timezone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(date).map(p => [p.type, p.value]));
      return { created: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`, created_timezone: parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace("GMT", "") };
    } catch { throw new InboxError("INVALID_TIMEZONE", "指定时区无法识别，请使用 Asia/Shanghai 等 IANA 时区名。"); }
  }
  const minutes = -date.getTimezoneOffset();
  return {
    created: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    created_timezone: `${minutes >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`
  };
}

function creationInstant(created, offset) {
  if (typeof created !== "string" || typeof offset !== "string") return null;
  const time = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(created);
  const zone = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!time || !zone || +zone[2] > 23 || +zone[3] > 59) return null;
  const [year, month, day, hour, minute, second] = time.slice(1).map(Number);
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, second, 0);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day
    || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) return null;
  return wall.getTime() - (zone[1] === "+" ? 1 : -1) * (+zone[2] * 60 + +zone[3]) * 60000;
}


module.exports = {localCreation, creationInstant};
