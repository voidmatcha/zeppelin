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

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantMessageItem } from './AssistantMessageItem';
import { MarkdownAnswer } from './MarkdownAnswer';

describe('AssistantMessageItem', () => {
  it('tells a question from an answer', () => {
    render(
      <>
        <AssistantMessageItem role="user" content="How is revenue calculated?" />
        <AssistantMessageItem role="assistant" content="By region." />
      </>
    );
    expect(screen.getByRole('article', { name: 'Your question' }).textContent).toBe('YouHow is revenue calculated?');
    expect(screen.getByRole('article', { name: 'Assistant answer' }).textContent).toContain('By region.');
  });

  it('shows a question as typed instead of rendering it', () => {
    render(<AssistantMessageItem role="user" content="<b>not bold</b>" renderContent={() => 'rendered'} />);
    const question = screen.getByRole('article', { name: 'Your question' });
    expect(question.textContent).toContain('<b>not bold</b>');
    expect(question.querySelector('b')).toBeNull();
  });

  it('renders an answer as Markdown by default', () => {
    render(<AssistantMessageItem role="assistant" content={'Revenue is **grouped** by `region`.'} />);
    const answer = screen.getByRole('article', { name: 'Assistant answer' });
    expect(answer.querySelector('strong')?.textContent).toBe('grouped');
    expect(answer.querySelector('code')?.textContent).toBe('region');
  });
  it.each([
    { name: 'indented code', content: '    SELECT 1', beforeCaret: 'SELECT 1' },
    { name: 'indented code with LF', content: '    SELECT 1\n', beforeCaret: 'SELECT 1\n' },
    {
      name: 'literal fences in indented code',
      content: '    ```sql\n    SELECT 1\n    ```\n',
      beforeCaret: '```sql\nSELECT 1\n```\n'
    },
    {
      name: 'literal fences in tab-indented code',
      content: '\t```sql\n\tSELECT 1\n\t```\n',
      beforeCaret: '```sql\nSELECT 1\n```\n'
    },
    {
      name: 'indented literal closing fence',
      content: '```sql\nSELECT 1\n    ```\n',
      beforeCaret: 'SELECT 1\n    ```\n'
    },
    { name: 'partial fence', content: '```sql\nSELECT 1', beforeCaret: 'SELECT 1' },
    { name: 'received newline', content: '```sql\nSELECT 1\n', beforeCaret: 'SELECT 1\n' },
    { name: 'received blank line', content: '```sql\nSELECT 1\n\n', beforeCaret: 'SELECT 1\n\n' },
    { name: 'closed fence', content: '```sql\nSELECT 1\n```', beforeCaret: 'SELECT 1' },
    { name: 'closed fence and newline', content: '```sql\nSELECT 1\n```\n', beforeCaret: 'SELECT 1' },
    { name: 'closed fence and blank line', content: '```sql\nSELECT 1\n```\n\n', beforeCaret: 'SELECT 1' },
    { name: 'blockquote prefix token', content: '> ```sql\n> SELECT 1\n>', beforeCaret: 'SELECT 1\n' },
    { name: 'nested blockquote prefix token', content: '> > ```sql\n> > SELECT 1\n> >', beforeCaret: 'SELECT 1\n' },
    { name: 'blockquote', content: '> ```sql\n> SELECT 1', beforeCaret: 'SELECT 1' },
    { name: 'list item', content: '- SQL:\n\n  ```sql\n  SELECT 1', beforeCaret: 'SELECT 1' },
    {
      name: 'reference definition after body',
      content: '```sql\nSELECT 1\n```\n\n[ref]: https://example.com',
      beforeCaret: 'SELECT 1'
    },
    {
      name: 'footnote definition after body',
      content: 'A[^1]\n\n```sql\nSELECT 1\n```\n\n[^1]: note',
      beforeCaret: 'SELECT 1'
    },
    { name: 'generated footnotes', content: 'A[^1]\n\n[^1]: note\n\n```sql\nSELECT 1', beforeCaret: 'SELECT 1' },
    { name: 'CRLF', content: '```sql\r\nSELECT 1\r\n', beforeCaret: 'SELECT 1\n' },
    { name: 'opening fence token', content: '```sql', beforeCaret: '' },
    { name: 'closed empty fence', content: '```sql\n```\n', beforeCaret: '' },
    { name: 'CR fence', content: '```sql\rSELECT 1\r```\r', beforeCaret: 'SELECT 1' },
    { name: 'empty fence', content: '```sql\n', beforeCaret: '' },
    { name: 'tilde fence', content: '~~~sql\nSELECT 1\n~~~\n', beforeCaret: 'SELECT 1' },
    { name: 'longer fence', content: '````sql\nSELECT 1\n````\n', beforeCaret: 'SELECT 1' }
  ])('preserves code text and caret location for $name', ({ content, beforeCaret }) => {
    const { container, rerender } = render(<AssistantMessageItem role="assistant" content={content} />);
    const originalText = container.querySelector('pre code')?.textContent;
    rerender(<AssistantMessageItem role="assistant" content={content} streaming />);
    const code = container.querySelector('pre code')!;
    const markers = container.querySelectorAll('[data-streaming-caret]');
    expect(markers).toHaveLength(1);
    expect(code.contains(markers[0])).toBe(true);
    expect(markers[0].getAttribute('aria-hidden')).toBe('true');
    expect(code.textContent).toBe(originalText);
    const range = document.createRange();
    range.setStart(code, 0);
    range.setEndBefore(markers[0]);
    expect(range.toString()).toBe(beforeCaret);
    rerender(<AssistantMessageItem role="assistant" content={content} />);
    expect(container.querySelectorAll('[data-streaming-caret]')).toHaveLength(1);
    expect(container.querySelector('pre code')?.textContent).toBe(originalText);
  });

  it.each([
    { content: '```sql\nSELECT 1\n', expected: 'SELECT 1\n' },
    { content: '```sql\nSELECT 1\n\n', expected: 'SELECT 1\n\n' },
    { content: '```sql\nSELECT 1\n```', expected: 'SELECT 1\n' }
  ])('preserves the exact rendered code line endings in %j', ({ content, expected }) => {
    const { container, rerender } = render(<AssistantMessageItem role="assistant" content={content} streaming />);
    expect(container.querySelector('pre code')?.textContent).toBe(expected);
    rerender(<AssistantMessageItem role="assistant" content={content} />);
    expect(container.querySelector('pre code')?.textContent).toBe(expected);
  });

  it('supports an existing custom Markdown renderer without changing its callback', () => {
    const { container } = render(
      <AssistantMessageItem
        role="assistant"
        content={'```sql\nSELECT 1'}
        streaming
        renderContent={content => <MarkdownAnswer content={content} />}
      />
    );
    expect(container.querySelector('pre code [data-streaming-caret]')).not.toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('SELECT 1\n');
  });

  it.each(['Explanation', '---', '- ', '> '])('does not mark earlier code when a following block is %j', suffix => {
    const { container } = render(
      <AssistantMessageItem role="assistant" content={`\`\`\`sql\nSELECT 1\n\`\`\`\n\n${suffix}`} streaming />
    );
    expect(container.querySelector('[data-streaming-caret]')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('SELECT 1\n');
  });
});
