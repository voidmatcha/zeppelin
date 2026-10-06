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

import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeBlock, MarkdownAnswer, ParagraphLink } from '@/entities/assistant';
import { Gallery, PanelFrame, SAMPLE_ANSWER, Specimen, describeSampleParagraph } from './storyKit';

/**
 * Model output is untrusted: Markdown without raw HTML, images replaced by their alt text, unsafe URLs shown as
 * text. Paragraph ids that exist in the note become chips that scroll to the paragraph.
 */
const meta: Meta<typeof MarkdownAnswer> = {
  title: 'Assistant/Components/Answer',
  component: MarkdownAnswer,
  parameters: {
    layout: 'padded'
  }
};
export default meta;
type Story = StoryObj<typeof MarkdownAnswer>;

export const Markdown: Story = {
  args: { content: SAMPLE_ANSWER },
  render: args => (
    <PanelFrame>
      <MarkdownAnswer {...args} describeParagraph={describeSampleParagraph} onOpenParagraph={() => undefined} />
    </PanelFrame>
  )
};

export const UntrustedOutput: Story = {
  args: {
    content: `Raw HTML stays text: <b onclick="alert(1)">bold?</b>

![tracking pixel](https://example.com/pixel.png)

[a script link](javascript:alert(1)) and [the docs](https://zeppelin.apache.org/docs/latest/).

paragraph_9_9 is not in this note, so it stays text.`
  },
  render: args => (
    <PanelFrame>
      <MarkdownAnswer {...args} describeParagraph={describeSampleParagraph} onOpenParagraph={() => undefined} />
    </PanelFrame>
  )
};

export const Pieces: Story = {
  render: () => (
    <Gallery>
      <Specimen label="Paragraph link" note="Title when the paragraph has one, else its position">
        <p style={{ margin: 0 }}>
          See{' '}
          <ParagraphLink
            paragraphId="paragraph_1"
            label={{ text: 'Load data', name: 'Load data' }}
            onOpen={() => undefined}
          />{' '}
          and{' '}
          <ParagraphLink
            paragraphId="paragraph_2"
            label={{ text: '#2', name: 'Paragraph 2' }}
            onOpen={() => undefined}
          />
          .
        </p>
      </Specimen>
      <Specimen label="Code block">
        <CodeBlock language="python" code={'df = spark.table("sales")\ndf.groupBy("region").count().show()'} />
      </Specimen>
      <Specimen label="Streaming fence" note="An unclosed fence renders as code while tokens arrive">
        <MarkdownAnswer content={'Try this:\n\n```scala\nval df = spark.read\n  .option("header"'} />
      </Specimen>
    </Gallery>
  )
};
