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

import { useMemo, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { ReactErrorBoundary } from '../components/paragraph/ReactErrorBoundary';
import { ZeppelinThemeProvider } from '../theme/ZeppelinThemeProvider';

export type InterpreterPropertyType = 'textarea' | 'string' | 'number' | 'url' | 'password' | 'checkbox';
export type IsolationMode = 'shared' | 'scoped' | 'isolated';

export interface InterpreterProperty {
  name: string;
  value: string | boolean;
  type: InterpreterPropertyType;
  defaultValue?: string | boolean;
  description?: string;
}

export interface InterpreterDependency {
  groupArtifactVersion: string;
  exclusions: string[];
  local?: boolean;
}

export interface InterpreterOption {
  remote: boolean;
  port: number;
  isExistingProcess: boolean;
  setPermission: boolean;
  isUserImpersonate: boolean;
  host?: string;
  owners?: string[];
  perNote?: string;
  perUser?: string;
}

export interface InterpreterSetting {
  id: string;
  name: string;
  group: string;
  status: string;
  errorReason?: string;
  properties: Record<string, InterpreterProperty>;
  dependencies: InterpreterDependency[];
  option: InterpreterOption;
  interpreterGroup: Array<{ name: string; class: string; defaultInterpreter: boolean }>;
}

export interface InterpreterRepository {
  id: string;
  type: string;
  url: string;
}

export interface InterpreterSettingRequest {
  name: string;
  group: string;
  option: {
    remote: boolean;
    port: number | null;
    isExistingProcess: boolean;
    setPermission: boolean;
    isUserImpersonate: boolean;
    host: string;
    owners: string[];
    perNote: IsolationMode;
    perUser: IsolationMode;
  };
  properties: Record<string, InterpreterProperty>;
  dependencies: Array<{ groupArtifactVersion: string; exclusions: string[] }>;
}

export interface CreateRepositoryRequest {
  id: string;
  url: string;
  snapshot: boolean;
  username: string;
  password: string;
  proxyProtocol: string;
  proxyHost: string;
  proxyPort: string | null;
  proxyLogin: string;
  proxyPassword: string;
}

export interface InterpreterPageProps {
  settings: InterpreterSetting[];
  repositories: InterpreterRepository[];
  availableInterpreters: InterpreterSetting[];
  propertyTypes: InterpreterPropertyType[];
  onCreateRepository: (repository: CreateRepositoryRequest) => Promise<void>;
  onRemoveRepository: (id: string) => Promise<void>;
  onCreateSetting: (setting: InterpreterSettingRequest) => Promise<void>;
  onUpdateSetting: (setting: InterpreterSettingRequest) => Promise<void>;
  onRemoveSetting: (id: string) => Promise<void>;
  onRestartSetting: (id: string) => Promise<void>;
  onError?: (error: unknown) => void;
}

interface PropertyRow extends InterpreterProperty {
  key: string;
}

interface Draft {
  name: string;
  group: string;
  properties: PropertyRow[];
  dependencies: Array<{ key: string; groupArtifactVersion: string; exclusions: string }>;
  option: InterpreterSettingRequest['option'];
}

const blankOption = (): InterpreterSettingRequest['option'] => ({
  remote: true,
  port: null,
  isExistingProcess: false,
  setPermission: false,
  isUserImpersonate: false,
  host: '',
  owners: [],
  perNote: 'shared',
  perUser: 'shared'
});

const asIsolationMode = (value?: string): IsolationMode =>
  value === 'scoped' || value === 'isolated' ? value : 'shared';

const createDraft = (setting?: InterpreterSetting): Draft => ({
  name: setting?.name ?? '',
  group: setting?.group ?? '',
  properties: setting ? Object.entries(setting.properties).map(([key, property]) => ({ ...property, key })) : [],
  dependencies:
    setting?.dependencies.map((dependency, index) => ({
      key: `${dependency.groupArtifactVersion}-${index}`,
      groupArtifactVersion: dependency.groupArtifactVersion,
      exclusions: (dependency.exclusions ?? []).join(', ')
    })) ?? [],
  option: setting
    ? {
        remote: setting.option.remote,
        port: setting.option.port === -1 ? null : setting.option.port,
        isExistingProcess: setting.option.isExistingProcess,
        setPermission: setting.option.setPermission,
        isUserImpersonate: setting.option.isUserImpersonate,
        host: setting.option.host ?? '',
        owners: setting.option.owners ?? [],
        perNote: asIsolationMode(setting.option.perNote),
        perUser: asIsolationMode(setting.option.perUser)
      }
    : blankOption()
});

const propertyInput = (row: PropertyRow, disabled: boolean, onChange?: (value: string | boolean) => void) => {
  if (disabled) {
    if (row.type === 'password') return '******';
    if (row.type === 'url')
      return (
        <a href={String(row.value)} target="_blank" rel="noreferrer">
          {String(row.value)}
        </a>
      );
    return String(row.value);
  }
  if (row.type === 'checkbox') {
    return <Checkbox checked={row.value === true} onChange={event => onChange?.(event.target.checked)} />;
  }
  if (row.type === 'textarea') {
    return (
      <Input.TextArea value={String(row.value)} autoSize={{ maxRows: 3 }} onChange={e => onChange?.(e.target.value)} />
    );
  }
  return (
    <Input
      type={row.type === 'string' ? 'text' : row.type}
      value={String(row.value)}
      onChange={event => onChange?.(event.target.value)}
    />
  );
};

interface SettingEditorProps {
  availableInterpreters: InterpreterSetting[];
  existingNames: Set<string>;
  propertyTypes: InterpreterPropertyType[];
  setting?: InterpreterSetting;
  onCancel: () => void;
  onSave: (setting: InterpreterSettingRequest) => Promise<void>;
}

const SettingEditor = ({
  availableInterpreters,
  existingNames,
  propertyTypes,
  setting,
  onCancel,
  onSave
}: SettingEditorProps) => {
  const [draft, setDraft] = useState<Draft>(() => createDraft(setting));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCreate = !setting;

  const updateProperty = (index: number, patch: Partial<PropertyRow>) => {
    setDraft(current => ({
      ...current,
      properties: current.properties.map((property, propertyIndex) =>
        propertyIndex === index ? { ...property, ...patch } : property
      )
    }));
  };

  const updateDependency = (index: number, patch: Partial<Draft['dependencies'][number]>) => {
    setDraft(current => ({
      ...current,
      dependencies: current.dependencies.map((dependency, dependencyIndex) =>
        dependencyIndex === index ? { ...dependency, ...patch } : dependency
      )
    }));
  };

  const selectGroup = (group: string) => {
    const templates = availableInterpreters.filter(interpreter => interpreter.group === group);
    const properties = templates.flatMap(interpreter =>
      Object.entries(interpreter.properties).map(([key, property]) => ({
        ...property,
        key,
        value: property.defaultValue ?? ''
      }))
    );
    setDraft(current => ({ ...current, group, properties }));
  };

  const submit = async () => {
    const name = draft.name.trim();
    if (!name || !draft.group) {
      setError('Interpreter name and group are required.');
      return;
    }
    if (isCreate && existingNames.has(name)) {
      setError(`Name '${name}' already exists`);
      return;
    }
    if (draft.option.isExistingProcess && (!draft.option.host || draft.option.port === null)) {
      setError('Host and port are required when connecting to an existing process.');
      return;
    }
    const properties = Object.fromEntries(
      draft.properties
        .filter(property => property.key.trim())
        .map(property => [
          property.key.trim(),
          {
            name: property.key.trim(),
            type: property.type,
            value: property.type === 'checkbox' ? property.value === true : String(property.value ?? '')
          }
        ])
    );
    const request: InterpreterSettingRequest = {
      name,
      group: draft.group,
      option: draft.option,
      properties,
      dependencies: draft.dependencies
        .filter(dependency => dependency.groupArtifactVersion.trim())
        .map(dependency => ({
          groupArtifactVersion: dependency.groupArtifactVersion.trim(),
          exclusions: dependency.exclusions
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
        }))
    };
    setSaving(true);
    setError(null);
    try {
      await onSave(request);
      onCancel();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save interpreter setting.');
    } finally {
      setSaving(false);
    }
  };

  const propertyColumns = [
    {
      title: 'Name',
      render: (_: unknown, row: PropertyRow, index: number) => (
        <Input
          value={row.key}
          aria-label="Property name"
          onChange={event => updateProperty(index, { key: event.target.value })}
        />
      )
    },
    {
      title: 'Value',
      render: (_: unknown, row: PropertyRow, index: number) =>
        propertyInput(row, false, value => updateProperty(index, { value }))
    },
    {
      title: 'Type',
      render: (_: unknown, row: PropertyRow, index: number) => (
        <Select
          aria-label="Property type"
          value={row.type}
          options={propertyTypes.map(type => ({ value: type, label: type }))}
          onChange={(type: InterpreterPropertyType) =>
            updateProperty(index, { type, value: type === 'checkbox' ? false : type === 'number' ? '0' : '' })
          }
        />
      )
    },
    {
      title: 'Action',
      render: (_: unknown, _row: PropertyRow, index: number) => (
        <Button
          aria-label="Remove property"
          icon={<DeleteOutlined />}
          onClick={() =>
            setDraft(current => ({ ...current, properties: current.properties.filter((_, i) => i !== index) }))
          }
        />
      )
    }
  ];

  return (
    <Card title={isCreate ? 'Create new interpreter' : `Edit ${setting.name}`}>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <label>
          Interpreter Name
          <Input
            value={draft.name}
            disabled={!isCreate}
            onChange={event => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          Interpreter group
          <Select
            aria-label="Interpreter group"
            style={{ width: '100%' }}
            showSearch
            disabled={!isCreate}
            value={draft.group || undefined}
            options={Array.from(new Set(availableInterpreters.map(interpreter => interpreter.group))).map(group => ({
              value: group,
              label: group
            }))}
            onChange={selectGroup}
          />
        </label>
        <Typography.Title level={4}>Option</Typography.Title>
        <Space wrap>
          <label>
            Per note
            <Select
              aria-label="Per note isolation"
              value={draft.option.perNote}
              options={['shared', 'scoped', 'isolated'].map(value => ({ value, label: value }))}
              onChange={(perNote: IsolationMode) => setDraft({ ...draft, option: { ...draft.option, perNote } })}
            />
          </label>
          <label>
            Per user
            <Select
              aria-label="Per user isolation"
              value={draft.option.perUser}
              options={['shared', 'scoped', 'isolated'].map(value => ({ value, label: value }))}
              onChange={(perUser: IsolationMode) => setDraft({ ...draft, option: { ...draft.option, perUser } })}
            />
          </label>
          <Checkbox
            checked={draft.option.isUserImpersonate}
            onChange={event =>
              setDraft({ ...draft, option: { ...draft.option, isUserImpersonate: event.target.checked } })
            }
          >
            User Impersonate
          </Checkbox>
          <Checkbox
            checked={draft.option.isExistingProcess}
            onChange={event =>
              setDraft({ ...draft, option: { ...draft.option, isExistingProcess: event.target.checked } })
            }
          >
            Connect to existing process
          </Checkbox>
        </Space>
        {draft.option.isExistingProcess ? (
          <Space wrap>
            <label>
              Host
              <Input
                value={draft.option.host}
                onChange={event => setDraft({ ...draft, option: { ...draft.option, host: event.target.value } })}
              />
            </label>
            <label>
              Port
              <InputNumber
                min={1}
                max={65535}
                value={draft.option.port}
                onChange={port => setDraft({ ...draft, option: { ...draft.option, port } })}
              />
            </label>
          </Space>
        ) : null}
        <Checkbox
          checked={draft.option.setPermission}
          onChange={event => setDraft({ ...draft, option: { ...draft.option, setPermission: event.target.checked } })}
        >
          Set permission
        </Checkbox>
        {draft.option.setPermission ? (
          <label>
            Owners
            <Select
              aria-label="Owners"
              mode="tags"
              tokenSeparators={[',']}
              style={{ width: '100%' }}
              value={draft.option.owners}
              onChange={owners => setDraft({ ...draft, option: { ...draft.option, owners } })}
            />
            <Typography.Text type="secondary">Empty (*) allows anyone to run this interpreter.</Typography.Text>
          </label>
        ) : null}
        <Typography.Title level={4}>Properties</Typography.Title>
        <Table rowKey="key" size="small" pagination={false} dataSource={draft.properties} columns={propertyColumns} />
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            setDraft(current => ({
              ...current,
              properties: [
                ...current.properties,
                { key: `property-${current.properties.length + 1}`, name: '', value: '', type: 'string' }
              ]
            }))
          }
        >
          Add property
        </Button>
        <Typography.Title level={4}>Dependencies</Typography.Title>
        {draft.dependencies.map((dependency, index) => (
          <Space key={dependency.key} wrap>
            <Input
              aria-label="Dependency artifact"
              placeholder="groupId:artifactId:version or local file path"
              value={dependency.groupArtifactVersion}
              onChange={event => updateDependency(index, { groupArtifactVersion: event.target.value })}
            />
            <Input.TextArea
              aria-label="Dependency exclusions"
              placeholder="Comma separated groupId:artifactId list"
              value={dependency.exclusions}
              autoSize={{ maxRows: 3 }}
              onChange={event => updateDependency(index, { exclusions: event.target.value })}
            />
            <Button
              aria-label="Remove dependency"
              icon={<DeleteOutlined />}
              onClick={() =>
                setDraft(current => ({
                  ...current,
                  dependencies: current.dependencies.filter((_, dependencyIndex) => dependencyIndex !== index)
                }))
              }
            />
          </Space>
        ))}
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            setDraft(current => ({
              ...current,
              dependencies: [
                ...current.dependencies,
                { key: `dependency-${current.dependencies.length + 1}`, groupArtifactVersion: '', exclusions: '' }
              ]
            }))
          }
        >
          Add dependency
        </Button>
        <Space>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            Save
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Space>
      </Space>
    </Card>
  );
};

const RepositoryEditor = ({
  onSave,
  onCancel
}: {
  onSave: (value: CreateRepositoryRequest) => Promise<void>;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState<CreateRepositoryRequest>({
    id: '',
    url: '',
    snapshot: false,
    username: '',
    password: '',
    proxyProtocol: 'HTTP',
    proxyHost: '',
    proxyPort: null,
    proxyLogin: '',
    proxyPassword: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!value.id.trim() || !value.url.trim()) {
      setError('Repository ID and URL are required.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...value, id: value.id.trim(), url: value.url.trim() });
      onCancel();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add repository.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Add New Repository">
      {error ? <Alert type="error" message={error} /> : null}
      <Space direction="vertical" style={{ width: '100%' }}>
        <Input
          aria-label="Repository ID"
          placeholder="Repository ID"
          value={value.id}
          onChange={e => setValue({ ...value, id: e.target.value })}
        />
        <Input
          aria-label="Repository URL"
          placeholder="Repository URL"
          value={value.url}
          onChange={e => setValue({ ...value, url: e.target.value })}
        />
        <Checkbox checked={value.snapshot} onChange={e => setValue({ ...value, snapshot: e.target.checked })}>
          Snapshot
        </Checkbox>
        <Input
          placeholder="Username"
          value={value.username}
          onChange={e => setValue({ ...value, username: e.target.value })}
        />
        <Input.Password
          placeholder="Password"
          value={value.password}
          onChange={e => setValue({ ...value, password: e.target.value })}
        />
        <Select
          value={value.proxyProtocol}
          options={['HTTP', 'HTTPS'].map(v => ({ value: v, label: v }))}
          onChange={proxyProtocol => setValue({ ...value, proxyProtocol })}
        />
        <Space wrap>
          <Input
            placeholder="Proxy host"
            value={value.proxyHost}
            onChange={e => setValue({ ...value, proxyHost: e.target.value })}
          />
          <Input
            placeholder="Proxy port"
            value={value.proxyPort ?? ''}
            onChange={e => setValue({ ...value, proxyPort: e.target.value || null })}
          />
          <Input
            placeholder="Proxy login"
            value={value.proxyLogin}
            onChange={e => setValue({ ...value, proxyLogin: e.target.value })}
          />
          <Input.Password
            placeholder="Proxy password"
            value={value.proxyPassword}
            onChange={e => setValue({ ...value, proxyPassword: e.target.value })}
          />
        </Space>
        <Space>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            Add
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Space>
      </Space>
    </Card>
  );
};

export const InterpreterPage = (props: InterpreterPageProps) => {
  const [search, setSearch] = useState('');
  const [showRepositories, setShowRepositories] = useState(false);
  const [showRepositoryEditor, setShowRepositoryEditor] = useState(false);
  const [editing, setEditing] = useState<string | 'create' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const filteredSettings = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? props.settings.filter(setting => setting.name.toLocaleLowerCase().includes(needle))
      : props.settings;
  }, [props.settings, search]);
  const existingNames = useMemo(() => new Set(props.settings.map(setting => setting.name)), [props.settings]);

  const runAction = async (action: () => Promise<void>, success: string) => {
    setActionError(null);
    try {
      await action();
      setStatus(success);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The operation failed.');
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search interpreters..."
          aria-label="Search interpreters"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        <Button onClick={() => setShowRepositories(value => !value)}>Repository</Button>
      </Space>
      {status ? <Alert type="success" closable message={status} onClose={() => setStatus(null)} /> : null}
      {actionError ? <Alert type="error" closable message={actionError} onClose={() => setActionError(null)} /> : null}
      <Collapse
        activeKey={showRepositories ? ['repositories'] : []}
        items={[
          {
            key: 'repositories',
            label: 'Repositories',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Text>Available repositories used to resolve interpreter dependencies.</Typography.Text>
                <Space wrap>
                  {props.repositories.map(repository => (
                    <Tag
                      key={repository.id}
                      title={repository.url}
                      closable={!['central', 'local'].includes(repository.id)}
                      onClose={event => {
                        event.preventDefault();
                        Modal.confirm({
                          title: repository.id,
                          content: 'Do you want to delete this repository?',
                          onOk: () => runAction(() => props.onRemoveRepository(repository.id), 'Repository removed.')
                        });
                      }}
                    >
                      {repository.id}
                    </Tag>
                  ))}
                </Space>
                {showRepositoryEditor ? (
                  <RepositoryEditor onSave={props.onCreateRepository} onCancel={() => setShowRepositoryEditor(false)} />
                ) : (
                  <Button icon={<PlusOutlined />} onClick={() => setShowRepositoryEditor(true)}>
                    Add repository
                  </Button>
                )}
              </Space>
            )
          }
        ]}
      />
      {editing === 'create' ? (
        <SettingEditor
          availableInterpreters={props.availableInterpreters}
          existingNames={existingNames}
          propertyTypes={props.propertyTypes}
          onSave={props.onCreateSetting}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button icon={<PlusOutlined />} onClick={() => setEditing('create')}>
          Create
        </Button>
      )}
      {filteredSettings.map(setting =>
        editing === setting.name ? (
          <SettingEditor
            key={setting.id || setting.name}
            setting={setting}
            availableInterpreters={props.availableInterpreters}
            existingNames={existingNames}
            propertyTypes={props.propertyTypes}
            onSave={props.onUpdateSetting}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Card
            key={setting.id || setting.name}
            title={
              <Space>
                <span>{setting.name}</span>
                <Tag color={setting.status === 'READY' ? 'success' : setting.status === 'ERROR' ? 'error' : 'warning'}>
                  {setting.status}
                </Tag>
              </Space>
            }
            extra={
              <Space>
                <Button icon={<EditOutlined />} onClick={() => setEditing(setting.name)}>
                  Edit
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() =>
                    Modal.confirm({
                      title: 'Restart Interpreter',
                      content: 'Do you want to restart this interpreter?',
                      onOk: () =>
                        runAction(
                          () => props.onRestartSetting(setting.name),
                          'Interpreter stopped. It will start on the next run.'
                        )
                    })
                  }
                >
                  Restart
                </Button>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    Modal.confirm({
                      title: 'Remove Interpreter',
                      content: 'Do you want to delete this interpreter setting?',
                      onOk: () => runAction(() => props.onRemoveSetting(setting.name), 'Interpreter setting removed.')
                    })
                  }
                >
                  Remove
                </Button>
              </Space>
            }
          >
            {setting.errorReason ? <Alert type="error" showIcon message={setting.errorReason} /> : null}
            <Typography.Paragraph>
              {setting.interpreterGroup
                .map((item, index) => (index === 0 ? `%${setting.name}` : `%${setting.name}.${item.name}`))
                .join(', ')}
            </Typography.Paragraph>
            {Object.keys(setting.properties).length ? (
              <>
                <Typography.Title level={4}>Properties</Typography.Title>
                <Table
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={Object.entries(setting.properties).map(([key, value]) => ({ ...value, key }))}
                  columns={[
                    { title: 'Name', dataIndex: 'key' },
                    { title: 'Value', render: (_: unknown, row: PropertyRow) => propertyInput(row, true) }
                  ]}
                />
              </>
            ) : null}
            {setting.dependencies.length ? (
              <>
                <Typography.Title level={4}>Dependencies</Typography.Title>
                <Table
                  rowKey="groupArtifactVersion"
                  size="small"
                  pagination={false}
                  dataSource={setting.dependencies}
                  columns={[
                    { title: 'Artifact', dataIndex: 'groupArtifactVersion' },
                    {
                      title: 'Exclude',
                      render: (_: unknown, row: InterpreterDependency) => (row.exclusions ?? []).join(', ')
                    }
                  ]}
                />
              </>
            ) : null}
          </Card>
        )
      )}
    </Space>
  );
};

export interface InterpreterPageMountHandle {
  update: (props: InterpreterPageProps) => void;
  unmount: () => void;
}

export const mount = (element: HTMLElement, initialProps: InterpreterPageProps): InterpreterPageMountHandle => {
  const root: Root = createRoot(element);
  const renderWith = (props: InterpreterPageProps) => {
    root.render(
      <ReactErrorBoundary onError={props.onError}>
        <ZeppelinThemeProvider>
          <InterpreterPage {...props} />
        </ZeppelinThemeProvider>
      </ReactErrorBoundary>
    );
  };
  renderWith(initialProps);
  return { update: renderWith, unmount: () => root.unmount() };
};
