/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type NotebookParityObservation =
  | {
      status: 'observed';
      value: unknown;
      evidence?: string[];
    }
  | {
      status: 'not-implemented' | 'blocked' | 'skipped';
      reason: string;
      evidence?: string[];
    };

export type NotebookParityParticipant<TFixture> = {
  id: string;
  run(context: {
    fixture: TFixture;
    outcomeIds: string[];
    onCleanup(cleanup: () => void | Promise<void>): void;
  }):
    | Record<string, NotebookParityObservation>
    | { outcomes: Record<string, NotebookParityObservation> }
    | Promise<Record<string, NotebookParityObservation> | { outcomes: Record<string, NotebookParityObservation> }>;
};

export type NotebookParityRegistry = {
  scenarios: Array<{
    id: string;
    observableOutcomes: Array<{ id: string; description?: string }>;
  }>;
};

export type NotebookParityComparison = {
  checkpoint: {
    id: string;
    status: 'pass' | 'fail';
    requiredOutcomes: string[];
    failures: Array<{
      implementation: string;
      outcome: string;
      status: 'fail' | 'not-implemented';
      reason?: string;
    }>;
  };
  implementations: Array<{
    id: string;
    scenarios: Array<{
      id: string;
      status: 'pass' | 'fail' | 'not-implemented';
      outcomes: Array<{
        id: string;
        status: 'pass' | 'fail' | 'not-implemented';
        expected?: unknown;
        actual?: unknown;
        reason?: string;
        evidence: string[];
      }>;
    }>;
  }>;
};

export function compareNotebookParity<TFixture>(options: {
  registry: NotebookParityRegistry;
  checkpoint: { id: string; requiredOutcomes: string[] };
  fixture: TFixture;
  baseline: NotebookParityParticipant<TFixture>;
  implementations: Record<string, NotebookParityParticipant<TFixture>>;
  implementationOrder?: string[];
}): Promise<NotebookParityComparison>;
