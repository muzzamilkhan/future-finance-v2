/**
 * Which day card is currently at the top of the viewport.
 *
 * The daily cards are rendered in chronological order, so "topmost visible" is just
 * the first key in that order whose card is intersecting the viewport. Keeping the
 * choice as a pure function (rather than comparing bounding rects inside the observer
 * callback) means it can be unit-tested without a DOM, and it stays correct when
 * several cards are on screen at once.
 */
export function pickTopmostVisible(
  orderedKeys: readonly string[],
  visible: ReadonlySet<string>,
): string | null {
  for (const key of orderedKeys) {
    if (visible.has(key)) return key;
  }
  return null;
}
