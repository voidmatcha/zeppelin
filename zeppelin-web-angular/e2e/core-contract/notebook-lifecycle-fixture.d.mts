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

import type { FixtureMetadata, FixtureRecord } from './notebook-transport-fixture.mjs';

export interface NoteLifecycleCaptureContext {
  activeNoteId: string;
  routeKind?: 'note';
  revisionId?: string;
}

export interface JobManagerLifecycleCaptureContext {
  routeKind: 'job-manager';
}

export type LifecycleCaptureContext = NoteLifecycleCaptureContext | JobManagerLifecycleCaptureContext;

export interface LifecycleActor {
  authentication: 'anonymous' | 'authenticated';
  contextId: string;
  id: string;
  principalAlias?: string;
}

export interface LifecycleRecord {
  actorId: string;
  authoritativeInput: 'full-note' | 'granular-event' | 'reply' | 'none';
  captureContext: LifecycleCaptureContext;
  connectionId: string;
  ingress: 'rest' | 'websocket';
  operationPath: 'rest' | 'websocket';
  sequence: number;
  transport: FixtureRecord;
}

export interface LifecycleTransition {
  actorId: string;
  afterSequence: number;
  connectionId?: string;
  kind: 'route' | 'disconnect' | 'reconnect' | 'timeout' | 'reconcile';
  reason?: string;
  elapsedMs?: number;
  observation?: 'bounded-wait';
  requestSequence?: number;
  confirmationSequence?: number;
  triggerSequence?: number;
  to?: LifecycleCaptureContext;
}

export interface LifecycleFault {
  afterSequence?: number;
  kind: 'delay' | 'drop' | 'duplicate' | 'reorder';
  sequence: number;
}

export interface NotebookLifecycleFixture {
  actors: LifecycleActor[];
  convergence?: { actorIds: string[] };
  faults?: LifecycleFault[];
  metadata: FixtureMetadata & {
    contract?: string;
    coveredOperations: string[];
    knownExclusions?: string[];
    owner: string;
    protocolGaps: string[];
    scenario: string;
  };
  records: LifecycleRecord[];
  transitions?: LifecycleTransition[];
  version: number;
}

export interface LifecycleReplayObserver {
  getActorSnapshot?: (actorId: string) => unknown | Promise<unknown>;
  getServerSnapshot?: () => unknown | Promise<unknown>;
  onRecord?: (
    record: LifecycleRecord,
    delivery: { delayed: boolean; duplicate: boolean; reordered: boolean; sourceSequence: number }
  ) => void | Promise<void>;
  onTransition?: (transition: LifecycleTransition) => void | Promise<void>;
}

export interface LifecycleStateReducer {
  apply(
    record: LifecycleRecord,
    delivery?: {
      delayed?: boolean;
      dropped?: boolean;
      duplicate?: boolean;
      reordered?: boolean;
      sourceSequence?: number;
    }
  ): void;
  assertComplete(): void;
  getCommitState(
    actorId: string,
    triggerSequence: number
  ):
    | {
        actorId: string;
        confirmationSequence?: number;
        connectionId: string;
        noteId: string;
        paragraphId: string;
        phase: 'dirty' | 'timed-out' | 'reconciling' | 'confirmed';
        triggerSequence: number;
      }
    | undefined;
  getSnapshot(
    actorId: string,
    noteId: string
  ): { id: string; paragraphs: Array<{ id: string; text: string; title: string }> } | undefined;
  transition(transition: LifecycleTransition): void;
}

export interface NotebookLifecycleRecorder {
  converge(actorIds: string[]): void;
  fault(fault: Omit<LifecycleFault, 'sequence'> & { sequence?: number }): void;
  install(options: {
    actorId: string;
    classify?: (
      record: FixtureRecord,
      context: LifecycleCaptureContext
    ) => Pick<LifecycleRecord, 'authoritativeInput' | 'operationPath'> | undefined;
    connectionId: string;
    getCaptureContext: () => LifecycleCaptureContext;
    page: import('./notebook-transport-fixture.mjs').RecorderPageLike;
  }): import('./notebook-transport-fixture.mjs').NotebookTransportRecorder;
  recordObserved(options: {
    actorId: string;
    captureContext: LifecycleCaptureContext;
    classify?: (
      record: FixtureRecord,
      context: LifecycleCaptureContext
    ) => Pick<LifecycleRecord, 'authoritativeInput' | 'operationPath'> | undefined;
    connectionId: string;
    transport: FixtureRecord;
  }): void;
  snapshot(): NotebookLifecycleFixture;
  stop(): Promise<unknown[]>;
  transition(transition: Omit<LifecycleTransition, 'afterSequence'> & { afterSequence?: number }): void;
  write(fixturePath: string): Promise<NotebookLifecycleFixture>;
}

export declare const lifecycleFixtureVersion: number;
export declare function createNotebookLifecycleRecorder(
  metadata: NotebookLifecycleFixture['metadata'],
  actors: LifecycleActor[]
): NotebookLifecycleRecorder;
export declare function sanitizeLifecycleFixture(fixture: NotebookLifecycleFixture): NotebookLifecycleFixture;
export declare function validateLifecycleFixture(fixture: unknown): string[];
export declare function validateLifecycleContractCoverage(fixture: unknown): string[];
export declare function replayLifecycleFixture(
  fixture: NotebookLifecycleFixture,
  observer?: LifecycleReplayObserver
): Promise<
  Array<{
    delayed?: boolean;
    duplicate?: boolean;
    record: LifecycleRecord;
    reordered?: boolean;
    sourceSequence: number;
  }>
>;
export declare function createLifecycleStateReducer(options?: { applyGranular?: boolean }): LifecycleStateReducer;
