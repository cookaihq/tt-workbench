'use strict';
const { FIELDS, fail, hash } = require('./rules.cjs');

const noteKey = (field, rule) => JSON.stringify([field, rule.pattern, rule.caseSensitive]);
function validNotes(notes) {
  if (!Array.isArray(notes) || notes.length > 4096) return false;
  const seen = new Set();
  return notes.every(note => {
    if (!note || typeof note !== 'object' || Array.isArray(note)
        || Object.keys(note).some(key => !['field', 'pattern', 'caseSensitive', 'reason'].includes(key))
        || !FIELDS.includes(note.field) || typeof note.pattern !== 'string' || !note.pattern.trim()
        || typeof note.caseSensitive !== 'boolean' || typeof note.reason !== 'string'
        || !note.reason.trim() || note.reason.length > 4000) return false;
    const key = noteKey(note.field, note);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function normalizeNotes(notes) {
  if (!validNotes(notes)) fail('INVALID_NOTES', '说明须对应四组规则，每条不超过 4000 字，且不能重复。');
  return notes.map(({ field, pattern, caseSensitive, reason }) => ({ field, pattern, caseSensitive, reason: reason.trim() }))
    .sort((a, b) => { const left = noteKey(a.field, a), right = noteKey(b.field, b); return left < right ? -1 : left > right ? 1 : 0; });
}
function notesForRules(notes, rules) {
  const keys = new Set(FIELDS.flatMap(field => rules[field].map(rule => noteKey(field, rule))));
  return normalizeNotes(notes).filter(note => keys.has(noteKey(note.field, note)));
}
const notesRevision = state => hash(JSON.stringify(state.notesDraft || null));
function noteChanges(before, after) {
  const previous = new Map(before.map(note => [noteKey(note.field, note), note]));
  const next = new Map(after.map(note => [noteKey(note.field, note), note]));
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap(key => {
    const from = previous.get(key), to = next.get(key);
    return from?.reason === to?.reason ? [] : [{ field: (to || from).field, pattern: (to || from).pattern,
      caseSensitive: (to || from).caseSensitive, before: from?.reason || '', after: to?.reason || '' }];
  });
}
module.exports = { noteKey, validNotes, normalizeNotes, notesForRules, notesRevision, noteChanges };
