/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface NotebookSearchMatch {
  paragraphId: string;
  offset: number;
}

export const findNotebookMatches = (
  paragraphs: ReadonlyArray<{ id: string; text: string }>,
  term: string
): NotebookSearchMatch[] => {
  if (!term) {
    return [];
  }
  const matches: NotebookSearchMatch[] = [];
  for (const paragraph of paragraphs) {
    let offset = 0;
    while ((offset = paragraph.text.indexOf(term, offset)) !== -1) {
      matches.push({ paragraphId: paragraph.id, offset });
      offset += term.length;
    }
  }
  return matches;
};

export const replaceNotebookMatch = (text: string, term: string, replacement: string, offset: number): string => {
  if (!term || text.slice(offset, offset + term.length) !== term) {
    return text;
  }
  return text.slice(0, offset) + replacement + text.slice(offset + term.length);
};

export const replaceAllNotebookMatches = (text: string, term: string, replacement: string): string => {
  return term ? text.split(term).join(replacement) : text;
};

export class NotebookSearchSession {
  private term = '';
  private activeMatch: NotebookSearchMatch | null = null;

  setTerm(term: string): void {
    if (this.term !== term) {
      this.term = term;
      this.activeMatch = null;
    }
  }

  next(paragraphs: ReadonlyArray<{ id: string; text: string }>, direction: -1 | 1): NotebookSearchMatch | null {
    const matches = findNotebookMatches(paragraphs, this.term);
    if (!matches.length) {
      this.activeMatch = null;
      return null;
    }
    const previousIndex = matches.findIndex(
      match => match.paragraphId === this.activeMatch?.paragraphId && match.offset === this.activeMatch.offset
    );
    const index =
      previousIndex === -1
        ? direction === 1
          ? 0
          : matches.length - 1
        : (previousIndex + direction + matches.length) % matches.length;
    this.activeMatch = matches[index];
    return this.activeMatch;
  }

  replaceCurrent(
    paragraphs: ReadonlyArray<{ id: string; text: string }>,
    replacement: string
  ): { paragraphId: string; text: string; nextMatch: NotebookSearchMatch | null } | null {
    const matches = findNotebookMatches(paragraphs, this.term);
    const current =
      this.activeMatch &&
      matches.some(
        match => match.paragraphId === this.activeMatch?.paragraphId && match.offset === this.activeMatch.offset
      )
        ? this.activeMatch
        : matches[0];
    if (!current) {
      this.activeMatch = null;
      return null;
    }
    const paragraphIndex = paragraphs.findIndex(paragraph => paragraph.id === current.paragraphId);
    const text = replaceNotebookMatch(paragraphs[paragraphIndex].text, this.term, replacement, current.offset);
    const updatedParagraphs = paragraphs.map((paragraph, index) =>
      index === paragraphIndex ? { ...paragraph, text } : paragraph
    );
    const nextMatches = findNotebookMatches(updatedParagraphs, this.term);
    this.activeMatch =
      nextMatches.find(match => {
        const index = paragraphs.findIndex(paragraph => paragraph.id === match.paragraphId);
        return (
          index > paragraphIndex || (index === paragraphIndex && match.offset >= current.offset + replacement.length)
        );
      }) ||
      nextMatches[0] ||
      null;
    return { paragraphId: current.paragraphId, text, nextMatch: this.activeMatch };
  }

  replaceAll(
    paragraphs: ReadonlyArray<{ id: string; text: string }>,
    replacement: string
  ): Array<{ id: string; text: string }> {
    this.activeMatch = null;
    return paragraphs
      .map(paragraph => ({ id: paragraph.id, text: replaceAllNotebookMatches(paragraph.text, this.term, replacement) }))
      .filter((paragraph, index) => paragraph.text !== paragraphs[index].text);
  }
}
