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

import styles from './storyKit.module.css';

import type { ReactNode } from 'react';
import { AssistantScope } from '@/shared/ui/assistant-theme';
import type { ParagraphLabel } from '@/entities/assistant';

// Shared frames and sample data for the assistant stories. Nothing here ships in the remote.

/** A piece at the width of the real sidebar panel (370px), on the panel background. */
export const PanelFrame = ({ children, width = 370 }: { children: ReactNode; width?: number }) => (
  <AssistantScope className={styles['panel-frame']} style={{ width }}>
    {children}
  </AssistantScope>
);

/** A labelled specimen in a gallery story. */
export const Specimen = ({ label, note, children }: { label: string; note?: string; children: ReactNode }) => (
  <section className={styles['specimen']}>
    <header>
      <strong>{label}</strong>
      {note ? <span>{note}</span> : null}
    </header>
    {children}
  </section>
);

export const Gallery = ({ children }: { children: ReactNode }) => (
  <AssistantScope className={styles['gallery']}>{children}</AssistantScope>
);

export const SAMPLE_PARAGRAPHS: Record<string, ParagraphLabel> = {
  paragraph_1700000000001_1: { text: 'Load data', name: 'Load data' },
  paragraph_1700000000002_2: { text: '#2', name: 'Paragraph 2' },
  paragraph_1700000000003_3: { text: 'Daily revenue', name: 'Daily revenue' }
};
export const describeSampleParagraph = (paragraphId: string) => SAMPLE_PARAGRAPHS[paragraphId];

export const SAMPLE_ANSWER = `This notebook builds a **daily revenue** report in three steps:

1. paragraph_1700000000001_1 reads \`sales.csv\` into a Spark DataFrame.
2. paragraph_1700000000002_2 drops rows without a region.
3. paragraph_1700000000003_3 sums revenue per day and charts it.

| Region | Rows |
| --- | ---: |
| East | 12,480 |
| West | 9,311 |

To try a weekly view instead:

\`\`\`sql
SELECT date_trunc('week', ts) AS week, sum(amount) AS revenue
FROM sales
GROUP BY 1
ORDER BY 1
\`\`\`
`;

export const LOAD_DATA_BEFORE = `%spark
val sales = spark.read
  .option("header", "true")
  .csv("/data/sales.csv")
sales.createOrReplaceTempView("sales")`;

export const LOAD_DATA_AFTER = `%spark
val sales = spark.read
  .option("header", "true")
  .option("inferSchema", "true")
  .option("timestampFormat", "yyyy-MM-dd HH:mm:ss")
  .csv("/data/sales.csv")
sales.createOrReplaceTempView("sales")`;

/** Splits text into chunks the size a model streams, for stories that replay an answer. */
export const toChunks = (text: string, size = 14): string[] => {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks;
};
