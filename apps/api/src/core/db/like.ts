/**
 * A LIKE/ILIKE pattern matching `text` anywhere, with the wildcards a user may type (% and _)
 * taken literally: a search for "%" must not match everything.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}
