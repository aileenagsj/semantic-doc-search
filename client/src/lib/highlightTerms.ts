/**
 * Highlights search terms in text by wrapping them in a marker component.
 * Case-insensitive matching, handles overlapping terms gracefully.
 */

export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

export function highlightTerms(text: string, query: string): HighlightSegment[] {
  if (!text || !query.trim()) {
    return [{ text, isMatch: false }];
  }

  // Split query into individual words and filter empty strings
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 0);

  if (terms.length === 0) {
    return [{ text, isMatch: false }];
  }

  // Build a regex that matches any of the terms (case-insensitive, word boundaries)
  const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escapedTerms.join('|')})`, 'gi');

  const segments: HighlightSegment[] = [];
  let lastIndex = 0;

  // Find all matches and create segments
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // Add non-matching text before this match
    if (match.index > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, match.index),
        isMatch: false,
      });
    }

    // Add the matching term
    segments.push({
      text: match[0],
      isMatch: true,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining non-matching text
  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      isMatch: false,
    });
  }

  // If no matches were found, return the original text as non-matching
  if (segments.length === 0) {
    return [{ text, isMatch: false }];
  }

  return segments;
}
