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

import { editor, KeyCode, KeyMod } from 'monaco-editor';
import { useEffect, useRef } from 'react';

export type NotebookMonacoEditorProps = Readonly<{
  ariaLabel: string;
  disabled: boolean;
  language?: string;
  searchTerm?: string;
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
}>;

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
  searchTerm = '',
  value,
  onChange,
  onRun
}: NotebookMonacoEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const initialOptions = useRef({ ariaLabel, disabled, language: toMonacoLanguage(language), value });
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const disabledRef = useRef(disabled);
  const searchDecorations = useRef<string[]>([]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onRunRef.current = onRun;
    disabledRef.current = disabled;
  }, [onRun, disabled]);

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const model = editor.createModel(initialOptions.current.value, initialOptions.current.language);
    const nextInstance = editor.create(host.current, {
      ariaLabel: initialOptions.current.ariaLabel,
      automaticLayout: true,
      minimap: { enabled: false },
      readOnly: initialOptions.current.disabled,
      scrollBeyondLastLine: false
    });
    nextInstance.setModel(model);
    instance.current = nextInstance;
    const listener = model.onDidChangeContent(() => onChangeRef.current(model.getValue()));

    return () => {
      listener.dispose();
      model.dispose();
      nextInstance.dispose();
      instance.current = null;
    };
  }, []);

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
  }, [language]);

  useEffect(() => {
    instance.current?.updateOptions({ ariaLabel, readOnly: disabled });
  }, [ariaLabel, disabled]);

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

  return <div className="zeppelin-react-notebook-editor" ref={host} />;
};
