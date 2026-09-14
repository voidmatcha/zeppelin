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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InterpreterPage, InterpreterPageProps, InterpreterSetting } from './InterpreterPage';

const setting = (name: string, overrides: Partial<InterpreterSetting> = {}): InterpreterSetting => ({
  id: name,
  name,
  group: 'spark',
  status: 'READY',
  properties: {},
  dependencies: [],
  option: {
    remote: true,
    port: -1,
    isExistingProcess: false,
    setPermission: false,
    isUserImpersonate: false,
    perNote: 'shared',
    perUser: 'shared'
  },
  interpreterGroup: [{ name: 'spark', class: 'org.example.Spark', defaultInterpreter: true }],
  ...overrides
});

const props = (overrides: Partial<InterpreterPageProps> = {}): InterpreterPageProps => ({
  settings: [setting('spark'), setting('python')],
  repositories: [{ id: 'central', type: 'default', url: 'https://repo.maven.apache.org/maven2' }],
  availableInterpreters: [setting('spark-template')],
  propertyTypes: ['textarea', 'string', 'number', 'url', 'password', 'checkbox'],
  onCreateRepository: vi.fn().mockResolvedValue(undefined),
  onRemoveRepository: vi.fn().mockResolvedValue(undefined),
  onCreateSetting: vi.fn().mockResolvedValue(undefined),
  onUpdateSetting: vi.fn().mockResolvedValue(undefined),
  onRemoveSetting: vi.fn().mockResolvedValue(undefined),
  onRestartSetting: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

describe('InterpreterPage', () => {
  it('filters settings by name without hiding matching status and errors', () => {
    render(
      <InterpreterPage
        {...props({
          settings: [setting('spark'), setting('broken-python', { status: 'ERROR', errorReason: 'Download failed' })]
        })}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Search interpreters' }), { target: { value: 'python' } });

    expect(screen.queryByText('spark')).toBeNull();
    expect(screen.getByText('broken-python')).toBeTruthy();
    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(screen.getByText('Download failed')).toBeTruthy();
  });

  it('renders property values according to every server property type', () => {
    render(
      <InterpreterPage
        {...props({
          settings: [
            setting('typed', {
              properties: {
                text: { name: 'text', value: 'long text', type: 'textarea' },
                string: { name: 'string', value: 'plain', type: 'string' },
                number: { name: 'number', value: '42', type: 'number' },
                url: { name: 'url', value: 'https://zeppelin.apache.org', type: 'url' },
                password: { name: 'password', value: 'secret', type: 'password' },
                enabled: { name: 'enabled', value: true, type: 'checkbox' }
              }
            })
          ]
        })}
      />
    );

    expect(screen.getByText('long text')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://zeppelin.apache.org' }).getAttribute('href')).toBe(
      'https://zeppelin.apache.org'
    );
    expect(screen.getByText('******')).toBeTruthy();
    expect(screen.getByText('true')).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('adds a repository through the async host callback', async () => {
    const onCreateRepository = vi.fn().mockResolvedValue(undefined);
    render(<InterpreterPage {...props({ onCreateRepository })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
    fireEvent.click(screen.getByRole('button', { name: /Add repository$/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Repository ID' }), { target: { value: 'mirror' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Repository URL' }), {
      target: { value: 'https://repo.example.test' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(onCreateRepository).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mirror', url: 'https://repo.example.test', proxyProtocol: 'HTTP' })
      )
    );
  });

  it('reports validation errors before calling create', () => {
    const onCreateSetting = vi.fn().mockResolvedValue(undefined);
    render(<InterpreterPage {...props({ onCreateSetting })} />);

    fireEvent.click(screen.getByRole('button', { name: /Create$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Interpreter name and group are required.')).toBeTruthy();
    expect(onCreateSetting).not.toHaveBeenCalled();
  });

  it('normalizes property and dependency values before updating through the host', async () => {
    const onUpdateSetting = vi.fn().mockResolvedValue(undefined);
    render(
      <InterpreterPage
        {...props({
          settings: [
            setting('spark', {
              properties: {
                timeout: { name: 'timeout', value: '60000', type: 'number' },
                enabled: { name: 'enabled', value: true, type: 'checkbox' }
              },
              dependencies: [
                {
                  groupArtifactVersion: 'org.example:driver:1.0',
                  exclusions: ['org.slf4j:slf4j-api', 'commons-logging:commons-logging']
                }
              ],
              option: {
                remote: true,
                port: 12345,
                host: 'interpreter.example.test',
                isExistingProcess: true,
                setPermission: true,
                owners: ['alice'],
                isUserImpersonate: false,
                perNote: 'isolated',
                perUser: 'scoped'
              }
            })
          ],
          onUpdateSetting
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Edit$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onUpdateSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'spark',
          properties: {
            timeout: { name: 'timeout', value: '60000', type: 'number' },
            enabled: { name: 'enabled', value: true, type: 'checkbox' }
          },
          dependencies: [
            {
              groupArtifactVersion: 'org.example:driver:1.0',
              exclusions: ['org.slf4j:slf4j-api', 'commons-logging:commons-logging']
            }
          ],
          option: expect.objectContaining({
            host: 'interpreter.example.test',
            port: 12345,
            owners: ['alice'],
            perNote: 'isolated',
            perUser: 'scoped'
          })
        })
      )
    );
  });
});
