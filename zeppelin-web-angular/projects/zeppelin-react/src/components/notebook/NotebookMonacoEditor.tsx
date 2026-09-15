/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { editor, KeyCode, KeyMod, languages } from 'monaco-editor';
import { useEffect, useRef } from 'react';
import type { NotebookCompletionItem } from '@zeppelin/notebook-core';

const inlineCompletionModels = new Set<editor.ITextModel>();
const inlineCompletionLanguages = new Set<string>();
const pointsToPixels = (points: number): number => (points * 96) / 72;

const inlineCompletionEnabled = (): boolean => {
  const page = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  return page.get('aiInlineComplete') === 'true' || hash.get('aiInlineComplete') === 'true';
};

const historySuggestion = (model: editor.ITextModel, lineNumber: number, column: number): string | null => {
  if (
    model
      .getLineContent(lineNumber)
      .slice(column - 1)
      .trim()
  )
    return null;
  const prefix = model.getLineContent(lineNumber).slice(0, column - 1);
  if (prefix.trim().length < 3) return null;
  const findMatch = (candidate: editor.ITextModel, lines: readonly number[]): string | null => {
    if (candidate.getLanguageId() !== model.getLanguageId()) return null;
    for (const line of lines) {
      if (candidate === model && line === lineNumber) continue;
      const content = candidate.getLineContent(line);
      if (content.startsWith(prefix)) {
        const remainder = content.slice(prefix.length).replace(/\s+$/, '');
        if (remainder) return remainder;
      }
    }
    return null;
  };
  const localLines: number[] = [];
  const localLimit = Math.min(model.getLineCount(), 400);
  for (let distance = 1; distance <= localLimit; distance += 1) {
    if (lineNumber - distance >= 1) localLines.push(lineNumber - distance);
    if (lineNumber + distance <= model.getLineCount()) localLines.push(lineNumber + distance);
  }
  const localMatch = findMatch(model, localLines);
  if (localMatch) return localMatch;
  for (const candidate of inlineCompletionModels) {
    if (candidate === model) continue;
    const limit = Math.min(candidate.getLineCount(), 4000);
    const match = findMatch(
      candidate,
      Array.from({ length: limit }, (_, index) => index + 1)
    );
    if (match) return match;
  }
  return null;
};

const registerInlineCompletion = (model: editor.ITextModel): (() => void) => {
  if (!inlineCompletionEnabled() || !['python', 'scala'].includes(model.getLanguageId())) return () => undefined;
  inlineCompletionModels.add(model);
  const language = model.getLanguageId();
  if (!inlineCompletionLanguages.has(language)) {
    inlineCompletionLanguages.add(language);
    languages.registerInlineCompletionsProvider(language, {
      provideInlineCompletions(candidate, position) {
        if (!inlineCompletionEnabled() || !inlineCompletionModels.has(candidate)) return { items: [] };
        const insertText = historySuggestion(candidate, position.lineNumber, position.column);
        return insertText
          ? {
              items: [
                {
                  insertText,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                  }
                }
              ]
            }
          : { items: [] };
      },
      freeInlineCompletions() {}
    });
  }
  return () => {
    inlineCompletionModels.delete(model);
  };
};

export type NotebookMonacoEditorProps = Readonly<{
  ariaLabel: string;
  disabled: boolean;
  language?: string;
  fontSize?: number;
  lineNumbers?: boolean;
  searchTerm?: string;
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  requestCompletions?: (buffer: string, cursor: number) => Promise<readonly NotebookCompletionItem[]>;
}>;

type NotebookMonacoEditorHost = HTMLDivElement & {
  __zeppelinNotebookEditorValue?: string;
};

const toMonacoLanguage = (language?: string): string => {
  switch (language) {
    case 'markdown':
    case 'python':
    case 'scala':
    case 'shell':
    case 'sql':
      return language;
    case 'sh':
      return 'shell';
    default:
      return 'plaintext';
  }
};

export const NotebookMonacoEditor = ({
  ariaLabel,
  disabled,
  language = 'plaintext',
  fontSize,
  lineNumbers = false,
  searchTerm = '',
  value,
  onChange,
  onRun,
  requestCompletions
}: NotebookMonacoEditorProps) => {
  const host = useRef<NotebookMonacoEditorHost>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const initialOptions = useRef({
    ariaLabel,
    disabled,
    fontSize,
    language: toMonacoLanguage(language),
    lineNumbers,
    value
  });
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const disabledRef = useRef(disabled);
  const requestCompletionsRef = useRef(requestCompletions);
  const unregisterInlineCompletion = useRef<() => void>(() => undefined);
  const searchDecorations = useRef<string[]>([]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onRunRef.current = onRun;
    disabledRef.current = disabled;
  }, [onRun, disabled]);

  useEffect(() => {
    requestCompletionsRef.current = requestCompletions;
  }, [requestCompletions]);

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const model = editor.createModel(initialOptions.current.value, initialOptions.current.language);
    const nextHost = host.current;
    Object.defineProperty(nextHost, '__zeppelinNotebookEditorValue', {
      configurable: true,
      get: () => model.getValue(),
      set: (nextValue: string) => model.setValue(nextValue)
    });
    const nextInstance = editor.create(host.current, {
      ariaLabel: initialOptions.current.ariaLabel,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: initialOptions.current.fontSize ? pointsToPixels(initialOptions.current.fontSize) : undefined,
      lineNumbers: initialOptions.current.lineNumbers ? 'on' : 'off',
      readOnly: initialOptions.current.disabled,
      scrollBeyondLastLine: false
    });
    nextInstance.setModel(model);
    instance.current = nextInstance;
    const listener = model.onDidChangeContent(() => onChangeRef.current(model.getValue()));
    nextInstance.addCommand(
      KeyCode.Escape,
      () => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      },
      '!suggestWidgetVisible && !inlineSuggestionVisible'
    );

    return () => {
      listener.dispose();
      unregisterInlineCompletion.current();
      delete nextHost.__zeppelinNotebookEditorValue;
      model.dispose();
      nextInstance.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const model = instance.current?.getModel();
    if (!model || !requestCompletions || !['python', 'scala'].includes(model.getLanguageId())) {
      return;
    }
    const registration = languages.registerCompletionItemProvider(model.getLanguageId(), {
      provideCompletionItems(candidate, position) {
        if (candidate !== model || !requestCompletionsRef.current) {
          return { suggestions: [] };
        }
        const word = candidate.getWordUntilPosition(position);
        return requestCompletionsRef.current(candidate.getValue(), candidate.getOffsetAt(position)).then(items => ({
          suggestions: items.map(item => ({
            kind: languages.CompletionItemKind.Keyword,
            label: item.name,
            insertText: item.value ?? item.name,
            detail: item.meta,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn
            }
          }))
        }));
      }
    });
    return () => registration.dispose();
  }, [language, requestCompletions]);

  useEffect(() => {
    const model = instance.current?.getModel();
    if (model && model.getValue() !== value) {
      model.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    const model = instance.current?.getModel();
    const monacoLanguage = toMonacoLanguage(language);
    if (model && model.getLanguageId() !== monacoLanguage) {
      editor.setModelLanguage(model, monacoLanguage);
    }
    if (model) {
      unregisterInlineCompletion.current();
      unregisterInlineCompletion.current = registerInlineCompletion(model);
    }
  }, [language]);

  useEffect(() => {
    instance.current?.updateOptions({
      ariaLabel,
      readOnly: disabled,
      fontSize: fontSize ? pointsToPixels(fontSize) : undefined,
      lineNumbers: lineNumbers ? 'on' : 'off'
    });
  }, [ariaLabel, disabled, fontSize, lineNumbers]);

  useEffect(() => {
    const nextInstance = instance.current;
    const model = nextInstance?.getModel();
    if (!nextInstance || !model || !searchTerm) {
      searchDecorations.current = nextInstance?.deltaDecorations(searchDecorations.current, []) ?? [];
      return;
    }
    const decorations: editor.IModelDeltaDecoration[] = [];
    const text = model.getValue();
    let startIndex = 0;
    while (startIndex < text.length) {
      const index = text.indexOf(searchTerm, startIndex);
      if (index === -1) {
        break;
      }
      const start = model.getPositionAt(index);
      const end = model.getPositionAt(index + searchTerm.length);
      decorations.push({
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column
        },
        options: { inlineClassName: 'editor-search-highlight' }
      });
      startIndex = index + searchTerm.length;
    }
    searchDecorations.current = nextInstance.deltaDecorations(searchDecorations.current, decorations);
  }, [searchTerm, value]);

  useEffect(() => {
    const nextInstance = instance.current;
    if (!nextInstance) {
      return;
    }
    const action = nextInstance.addAction({
      id: 'zeppelin-notebook-run-paragraph',
      keybindings: [KeyMod.Shift | KeyCode.Enter],
      label: 'Run paragraph',
      run: () => {
        if (!disabledRef.current) {
          onRunRef.current?.();
        }
      }
    });
    return () => action.dispose();
  }, []);

  return <div className="zeppelin-react-notebook-editor" ref={host} style={{ height: 180 }} />;
};
