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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolStep } from '@/entities/assistant';
import type { ApprovalState } from '@/features/assistant-approval';

export interface ShowcaseMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export interface ShowcaseParagraph {
  id: string;
  title: string;
  code: string;
  status: 'READY' | 'RUNNING' | 'FINISHED' | 'ERROR';
  /** Text result, as the interpreter printed it. */
  output?: string;
  diff?: { before: string; after: string; state: ApprovalState };
  /** The paragraph footer: "Took 2 seconds. Last updated by …". */
  footer?: string;
  highlight?: boolean;
}

export interface ShowcaseApproval {
  action: string;
  paragraphId: string;
  description: string;
  state: ApprovalState;
}

export interface ShowcaseState {
  draft: string;
  messages: ShowcaseMessage[];
  steps: ToolStep[];
  approval: ShowcaseApproval | null;
  paragraphs: ShowcaseParagraph[];
  status: string | null;
  running: boolean;
  /** Index into the scenario's beats, for the timeline. */
  beat: number;
  /** Waiting for the viewer to answer an approval. */
  waiting: boolean;
}

export type Decision = 'allow' | 'skip';

/** What a scenario script can do. Every call throws once the scenario is reset, which ends the script. */
export interface ScenarioApi {
  set: (update: (state: ShowcaseState) => ShowcaseState) => void;
  wait: (ms: number) => Promise<void>;
  beat: (index: number) => void;
  type: (text: string) => Promise<void>;
  stream: (messageId: string, text: string) => Promise<void>;
  decide: () => Promise<Decision>;
}

export type ScenarioScript = (api: ScenarioApi) => Promise<void>;

class Cancelled extends Error {}

/**
 * Plays a scripted conversation against the design-system pieces. An
 * approval pauses the script until the viewer clicks Allow or Skip.
 */
export const useScenario = (initial: () => ShowcaseState, script: ScenarioScript) => {
  const [state, setState] = useState(initial);
  const [round, setRound] = useState(0);
  const generation = useRef(0);
  const resolveDecision = useRef<((decision: Decision) => void) | null>(null);

  useEffect(() => {
    const mine = ++generation.current;
    const alive = () => {
      if (generation.current !== mine) throw new Cancelled();
    };
    const set: ScenarioApi['set'] = update => {
      alive();
      setState(update);
    };
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) =>
        window.setTimeout(() => (generation.current === mine ? resolve() : reject(new Cancelled())), ms)
      );
    const api: ScenarioApi = {
      set,
      wait,
      beat: index => set(current => ({ ...current, beat: index })),
      type: async text => {
        for (let index = 3; index < text.length + 3; index += 3) {
          set(current => ({ ...current, draft: text.slice(0, index) }));
          await wait(45);
        }
      },
      stream: async (messageId, text) => {
        set(current => ({
          ...current,
          messages: [...current.messages, { id: messageId, role: 'assistant', content: '', streaming: true }]
        }));
        for (let index = 0; index < text.length; index += 5) {
          const content = text.slice(0, index + 5);
          set(current => ({
            ...current,
            messages: current.messages.map(message => (message.id === messageId ? { ...message, content } : message))
          }));
          await wait(22);
        }
        set(current => ({
          ...current,
          messages: current.messages.map(message =>
            message.id === messageId ? { ...message, streaming: false } : message
          )
        }));
      },
      decide: () => {
        set(current => ({ ...current, waiting: true }));
        return new Promise<Decision>((resolve, reject) => {
          resolveDecision.current = decision => {
            resolveDecision.current = null;
            if (generation.current !== mine) return reject(new Cancelled());
            setState(current => ({ ...current, waiting: false }));
            resolve(decision);
          };
        });
      }
    };
    setState(initial());
    script(api).catch(error => {
      if (!(error instanceof Cancelled)) throw error;
    });
    const generations = generation;
    return () => {
      generations.current++;
      resolveDecision.current = null;
    };
    // `initial` and `script` are module constants per story; a new round restarts the script.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const answer = useCallback((decision: Decision) => resolveDecision.current?.(decision), []);
  const replay = useCallback(() => setRound(value => value + 1), []);
  return { state, answer, replay };
};
