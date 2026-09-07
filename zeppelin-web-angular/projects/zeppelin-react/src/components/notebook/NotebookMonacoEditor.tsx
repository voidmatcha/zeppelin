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

import { editor } from 'monaco-editor';
import { useEffect, useRef } from 'react';

export type NotebookMonacoEditorProps = Readonly<{
  ariaLabel: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}>;

export const NotebookMonacoEditor = ({ ariaLabel, disabled, value, onChange }: NotebookMonacoEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const initialOptions = useRef({ ariaLabel, disabled, value });
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const model = editor.createModel(initialOptions.current.value, 'python');
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
    instance.current?.updateOptions({ ariaLabel, readOnly: disabled });
  }, [ariaLabel, disabled]);

  return <div className="zeppelin-react-notebook-editor" ref={host} />;
};
