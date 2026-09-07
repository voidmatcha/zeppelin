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

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { isNil } from 'lodash';
import { combineLatest, Subject } from 'rxjs';
import { distinctUntilChanged, distinctUntilKeyChanged, startWith, takeUntil } from 'rxjs/operators';

import { NzResizeEvent } from 'ng-zorro-antd/resizable';
import { NzModalService } from 'ng-zorro-antd/modal';

import { MessageListener, MessageListenersManager } from '@zeppelin/core';
import { Permissions } from '@zeppelin/interfaces';
import {
  DynamicFormParams,
  InterpreterBindingItem,
  MessageReceiveDataTypeMap,
  Note,
  OP,
  ParagraphConfigResult,
  ReceivedMessage,
  RevisionListItem
} from '@zeppelin/sdk';
import {
  MessageService,
  ConfigurationService,
  NgZService,
  NoteStatusService,
  NoteVarShareService,
  ReactFeatureService,
  SecurityService,
  SaveAsService,
  ThemeService,
  TicketService
} from '@zeppelin/services';
import { NoteCreateComponent, ShortcutComponent } from '@zeppelin/share';

import { scrollIntoViewIfNeeded } from '@zeppelin/utility';
import type { NotebookCoreRemoteProps, NotebookCoreSnapshot } from '@zeppelin/notebook-core';
import { NotebookCoreRouteAdapter } from './notebook-core-route.adapter';
import { NotebookParagraphComponent } from './paragraph/paragraph.component';

type LoadedNote = Exclude<Note['note'], undefined>;
type LoadedParagraph = LoadedNote['paragraphs'][number];

@Component({
  selector: 'zeppelin-notebook',
  templateUrl: './notebook.component.html',
  styleUrls: ['./notebook.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [NotebookCoreRouteAdapter],
  standalone: false
})
export class NotebookComponent extends MessageListenersManager implements OnInit, AfterViewInit, OnDestroy {
  @ViewChildren(NotebookParagraphComponent) listOfNotebookParagraphComponent!: QueryList<NotebookParagraphComponent>;
  coreProofEnabled = false;
  useReactNotebook = false;
  reactNotebookFailed = false;
  readonly coreProofSnapshot$ = this.notebookCoreRouteAdapter.snapshot$;
  coreProofReactProps: NotebookCoreRemoteProps & Readonly<Record<string, unknown>>;
  note?: LoadedNote;
  permissions?: Permissions;
  selectId: string | null = null;
  scrolledId: string | null = null;
  isOwner = true;
  noteRevisions: RevisionListItem[] = [];
  currentRevision?: string;
  collaborativeMode = false;
  revisionView = false;
  collaborativeModeUsers: string[] = [];
  isNoteDirty: boolean | null = false;
  isShowNoteForms = false;
  saveTimer: ReturnType<typeof setTimeout> | null = null;
  interpreterBindings: InterpreterBindingItem[] = [];
  activatedExtension: 'interpreter' | 'permissions' | 'revisions' | 'hide' = 'hide';
  sidebarWidth = 370;
  sidebarAnimationFrame = -1;
  isSidebarOpen = false;
  useReactFooter = false;
  private destroy$ = new Subject<void>();
  private searchTerm = '';

  @MessageListener(OP.NOTE)
  getNote(data: MessageReceiveDataTypeMap[OP.NOTE]) {
    const note = data.note;
    if (isNil(note)) {
      this.router.navigate(['/']).then();
    } else {
      const paragraphs = this.notebookCoreRouteAdapter.acceptNote(note, null);
      if (!paragraphs) {
        return;
      }
      this.removeParagraphFromNgZ();
      this.note = { ...note, paragraphs: [...paragraphs] };
      this.refreshCoreProofReactProps();
      const { paragraphId } = this.activatedRoute.snapshot.params;
      if (paragraphId) {
        this.note = this.cleanParagraphExcept(this.note, paragraphId);
        this.initializeLookAndFeel(this.note);
      } else {
        this.initializeLookAndFeel(this.note);
        this.getInterpreterBindings(this.note);
        this.getPermissions(this.note);
        this.note.config.personalizedMode =
          this.note.config.personalizedMode === undefined ? 'false' : this.note.config.personalizedMode;
      }
      if (this.note!.noteForms && this.note!.noteParams) {
        this.saveNoteForms({
          formsData: {
            forms: this.note!.noteForms,
            params: this.note!.noteParams
          }
        });
      }
      this.titleService.setTitle(`${this.note?.name} - Zeppelin`);
      this.themeService.updateMonacoTheme();
      this.cdr.markForCheck();
    }
  }

  loadInterpreterBindings(data: MessageReceiveDataTypeMap[OP.INTERPRETER_BINDINGS]) {
    this.interpreterBindings = data.interpreterBindings;
    if (!this.interpreterBindings.some(item => item.selected)) {
      this.activatedExtension = 'interpreter';
    }
    this.cdr.markForCheck();
  }

  @MessageListener(OP.PARAGRAPH_REMOVED)
  removeParagraph(data: MessageReceiveDataTypeMap[OP.PARAGRAPH_REMOVED]) {
    const { paragraphId } = this.activatedRoute.snapshot.params;
    if (paragraphId || this.revisionView) {
      return;
    }
    if (!this.note) {
      return;
    }
    const definedNote = this.note;
    const paragraphIndex = definedNote.paragraphs.findIndex(p => p.id === data.id);
    const paragraphs = this.notebookCoreRouteAdapter.acceptParagraphRemoved(data.id);
    if (!this.renderParagraphProjection(paragraphs)) {
      return;
    }
    const adjustedCursorIndex =
      paragraphIndex === this.note.paragraphs.length ? paragraphIndex - 1 : paragraphIndex + 1;
    const targetParagraph = this.listOfNotebookParagraphComponent.find((_, index) => index === adjustedCursorIndex);
    if (targetParagraph) {
      targetParagraph.focusEditor();
    }
    this.cdr.markForCheck();
  }

  @MessageListener(OP.PARAGRAPH_ADDED)
  addParagraph(data: MessageReceiveDataTypeMap[OP.PARAGRAPH_ADDED]) {
    const { paragraphId } = this.activatedRoute.snapshot.params;
    if (paragraphId || this.revisionView) {
      return;
    }
    if (!this.note) {
      return;
    }
    const paragraphs = this.notebookCoreRouteAdapter.acceptParagraphAdded(data.paragraph, data.index);
    if (!this.renderParagraphProjection(paragraphs)) {
      return;
    }
    const paragraphIndex = this.note.paragraphs.findIndex(p => p.id === data.paragraph.id);

    this.note.paragraphs[paragraphIndex].focus = true;
    this.cdr.markForCheck();

    // Focus the editor only for a clone/insert initiated by this client (not auto-append on run or remote inserts).
    // Defer a tick so the new paragraph's editor child exists, since `focus = true` alone misses it.
    if (this.messageService.consumeLocalAddFocusMsgId(data.msgId)) {
      const addedId = data.paragraph.id;
      setTimeout(() => {
        const added = this.listOfNotebookParagraphComponent?.find(e => e.paragraph.id === addedId);
        added?.focusEditor();
        added?.notebookParagraphCodeEditorComponent?.setRestorePosition();
      });
    }
  }

  @MessageListener(OP.SAVE_NOTE_FORMS)
  saveNoteForms(data: MessageReceiveDataTypeMap[OP.SAVE_NOTE_FORMS]) {
    if (!this.note) {
      return;
    }
    const definedNote = this.note;
    definedNote.noteForms = data.formsData.forms;
    definedNote.noteParams = data.formsData.params;
    this.notebookCoreRouteAdapter.acceptNoteForms(definedNote.noteForms, definedNote.noteParams);
    this.setNoteFormsStatus();
  }

  getNoteRevision(data: MessageReceiveDataTypeMap[OP.NOTE_REVISION]) {
    const note = data.note;
    if (isNil(note)) {
      this.router.navigate(['/']).then();
    } else {
      const paragraphs = this.notebookCoreRouteAdapter.acceptNote(note, data.revisionId);
      if (!paragraphs) {
        return;
      }
      this.note = { ...note, paragraphs: [...paragraphs] };
      this.initializeLookAndFeel(this.note);
      this.cdr.markForCheck();
    }
  }

  setNoteRevision(_data: MessageReceiveDataTypeMap[OP.SET_NOTE_REVISION]) {
    const { noteId } = this.activatedRoute.snapshot.params;
    this.router.navigate(['/notebook', noteId]).then();
  }

  @MessageListener(OP.PARAGRAPH_MOVED)
  moveParagraph(data: MessageReceiveDataTypeMap[OP.PARAGRAPH_MOVED]) {
    if (!this.note) {
      return;
    }
    if (!this.revisionView) {
      const paragraphs = this.notebookCoreRouteAdapter.acceptParagraphMoved(data.id, data.index);
      if (this.renderParagraphProjection(paragraphs)) {
        const paragraphComponent = this.listOfNotebookParagraphComponent.find(e => e.paragraph.id === data.id);
        this.cdr.markForCheck();
        if (paragraphComponent) {
          // Call when next tick
          setTimeout(() => {
            scrollIntoViewIfNeeded(paragraphComponent.getElement());
            paragraphComponent.focusEditor();
          });
        }
      }
    }
  }

  @MessageListener(OP.COLLABORATIVE_MODE_STATUS)
  getCollaborativeModeStatus(data: MessageReceiveDataTypeMap[OP.COLLABORATIVE_MODE_STATUS]) {
    this.collaborativeMode = Boolean(data.status);
    this.collaborativeModeUsers = data.users;
    this.notebookCoreRouteAdapter.acceptCollaborativeModeStatus(
      this.collaborativeMode ? this.collaborativeModeUsers : null
    );
    this.cdr.markForCheck();
  }

  @MessageListener(OP.PARAGRAPH)
  updateCoreParagraph(data: MessageReceiveDataTypeMap[OP.PARAGRAPH]) {
    this.notebookCoreRouteAdapter.acceptParagraphUpdated(data.paragraph);
  }

  @MessageListener(OP.PARAGRAPH_STATUS)
  updateCoreParagraphStatus(data: MessageReceiveDataTypeMap[OP.PARAGRAPH_STATUS]) {
    this.notebookCoreRouteAdapter.acceptParagraphStatus(data.id, data.status);
  }

  @MessageListener(OP.PROGRESS)
  updateCoreParagraphProgress(data: MessageReceiveDataTypeMap[OP.PROGRESS]) {
    this.notebookCoreRouteAdapter.acceptParagraphProgress(data.id, data.progress);
  }

  updateCoreParagraphOutput(data: MessageReceiveDataTypeMap[OP.PARAGRAPH_UPDATE_OUTPUT]) {
    this.notebookCoreRouteAdapter.acceptParagraphOutputUpdate(data.paragraphId, data.index, data.type, data.data);
    this.cdr.markForCheck();
  }

  appendCoreParagraphOutput(data: MessageReceiveDataTypeMap[OP.PARAGRAPH_APPEND_OUTPUT]) {
    this.notebookCoreRouteAdapter.acceptParagraphOutputAppend(data.paragraphId, data.index, data.data);
    this.cdr.markForCheck();
  }

  @MessageListener(OP.PATCH_PARAGRAPH)
  patchParagraph(data: MessageReceiveDataTypeMap[OP.PATCH_PARAGRAPH]) {
    this.collaborativeMode = true;
    if (!this.notebookCoreRouteAdapter.acceptParagraphPatch(data.paragraphId, data.patch)) {
      this.requestCurrentNote();
    }
    this.cdr.markForCheck();
  }

  updateCoreParagraphText({ paragraphId, text }: { paragraphId: string; text: string }): void {
    this.notebookCoreRouteAdapter.acceptParagraphText(paragraphId, text);
  }

  insertCoreParagraph(index: number): void {
    if (!this.revisionView) {
      this.messageService.insertParagraph(index);
    }
  }

  removeCoreParagraph(paragraphId: string): void {
    if (!this.revisionView) {
      this.messageService.paragraphRemove(paragraphId);
    }
  }

  moveCoreParagraph(paragraphId: string, index: number): void {
    if (!this.revisionView) {
      this.messageService.moveParagraph(paragraphId, index);
    }
  }

  renameCoreNotebook(title: string): void {
    const snapshot = this.notebookCoreRouteAdapter.port.getSnapshot();
    if (!this.revisionView && title && title !== snapshot.title) {
      this.messageService.noteRename(snapshot.noteId, title, true);
    }
  }

  @MessageListener(OP.NOTE_UPDATED)
  noteUpdated(data: MessageReceiveDataTypeMap[OP.NOTE_UPDATED]) {
    // NOTE_UPDATED carries the live note, so applying it while a revision is open would
    // overwrite the historical snapshot with current values.
    if (!this.note || this.revisionView) {
      return;
    }
    if (data.name !== this.note.name) {
      this.note.name = data.name;
    }
    this.note.config = data.config;
    this.note.info = data.info;
    this.notebookCoreRouteAdapter.acceptNoteUpdated(data.name);
    this.initializeLookAndFeel(this.note);
    this.cdr.markForCheck();
  }

  listRevisionHistory(data: MessageReceiveDataTypeMap[OP.LIST_REVISION_HISTORY]) {
    this.noteRevisions = data.revisionList;
    if (this.noteRevisions) {
      if (this.noteRevisions.length === 0 || this.noteRevisions[0].id !== 'Head') {
        this.noteRevisions.splice(0, 0, { id: 'Head', message: 'Head' });
      }
      const { revisionId } = this.activatedRoute.snapshot.params;
      if (revisionId) {
        const revisionItemFound = this.noteRevisions.find(r => r.id === revisionId);
        if (!revisionItemFound) {
          throw new Error(`Revision ${revisionId} not found`);
        }
        this.currentRevision = revisionItemFound.message;
      } else {
        this.currentRevision = 'Head';
      }
    }
    this.refreshCoreProofReactProps();
    this.cdr.markForCheck();
  }

  onParagraphSearch(term: string) {
    this.searchTerm = term || '';
    this.highlightSearchTerm();
  }

  coreProofParagraphIds(snapshot: NotebookCoreSnapshot): string {
    return snapshot.paragraphs.map(paragraph => paragraph.id).join(',');
  }

  coreProofParagraphTexts(snapshot: NotebookCoreSnapshot): string {
    return JSON.stringify(snapshot.paragraphs.map(paragraph => paragraph.text));
  }

  coreProofParagraphStatuses(snapshot: NotebookCoreSnapshot): string {
    return JSON.stringify(snapshot.paragraphs.map(paragraph => paragraph.status));
  }

  coreProofParagraphResults(snapshot: NotebookCoreSnapshot): string {
    return JSON.stringify(snapshot.paragraphs.map(paragraph => paragraph.results ?? []));
  }

  saveParagraph(id: string) {
    this.notebookCoreRouteAdapter.port.dispatch({ type: 'commit-paragraph', paragraphId: id });
  }

  runParagraph(id: string) {
    this.notebookCoreRouteAdapter.port.dispatch({ type: 'run-paragraph', paragraphId: id });
  }

  cancelParagraph(id: string) {
    this.notebookCoreRouteAdapter.port.dispatch({ type: 'cancel-paragraph', paragraphId: id });
  }

  requestParagraphPatch({ paragraphId, patch }: { paragraphId: string; patch: string }) {
    this.notebookCoreRouteAdapter.sendParagraphPatch(paragraphId, patch);
  }

  killSaveTimer() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  startSaveTimer() {
    this.killSaveTimer();
    this.isNoteDirty = true;
    this.saveTimer = setTimeout(() => {
      this.saveNote();
    }, 10000);
  }

  onParagraphSelect(id: string | null) {
    this.selectId = id;
  }

  onParagraphScrolled(id: string | null) {
    this.scrolledId = id;
  }

  onSelectAtIndex(index: number) {
    if (!this.note) {
      throw new Error(`"note" is not defined. Please check if note data is loaded before calling this method.`);
    }
    const scopeIndex = Math.min(this.note.paragraphs.length, Math.max(0, index));
    if (this.note.paragraphs[scopeIndex]) {
      this.selectId = this.note.paragraphs[scopeIndex].id;
    }
  }

  saveNote() {
    if (this.note && this.note.paragraphs && this.listOfNotebookParagraphComponent) {
      this.listOfNotebookParagraphComponent.toArray().forEach(p => {
        p.saveParagraph();
      });
      this.isNoteDirty = null;
      this.cdr.markForCheck();
    }
  }

  getInterpreterBindings(note: Exclude<Note['note'], undefined>) {
    this.messageService.getInterpreterBindings(note.id);
  }

  getPermissions(note: Exclude<Note['note'], undefined>) {
    this.securityService.getPermissions(note.id).subscribe(data => {
      this.permissions = data;
      this.isOwner = !(
        this.permissions.owners.length && this.permissions.owners.indexOf(this.ticketService.ticket.principal) < 0
      );
      this.refreshCoreProofReactProps();
      this.cdr.markForCheck();
    });
  }

  get viewOnly(): boolean {
    if (!this.note) {
      return false;
    }
    return this.noteStatusService.viewOnly(this.note);
  }

  initializeLookAndFeel(note: Exclude<Note['note'], undefined>) {
    note.config.looknfeel = note.config.looknfeel || 'default';
    if (note.paragraphs && note.paragraphs[0]) {
      note.paragraphs[0].focus = true;
    }
  }

  cleanParagraphExcept(note: Exclude<Note['note'], undefined>, paragraphId: string) {
    const targetParagraph = note.paragraphs.find(p => p.id === paragraphId);
    if (!targetParagraph) {
      throw new Error(`Paragraph ${paragraphId} not found`);
    }
    const config = targetParagraph.config || {};
    config.editorHide = true;
    config.tableHide = false;
    const paragraphs = [{ ...targetParagraph, config }];
    return { ...note, paragraphs };
  }

  setAllParagraphTableHide(tableHide: boolean) {
    this.listOfNotebookParagraphComponent.forEach(p => p.setTableHide(tableHide));
  }

  setAllParagraphEditorHide(editorHide: boolean) {
    this.listOfNotebookParagraphComponent.forEach(p => p.setEditorHide(editorHide));
  }

  onNoteFormChange(noteParams: DynamicFormParams) {
    if (!this.note) {
      throw new Error(`"note" is not defined. Please check if note data is loaded before calling this method.`);
    }
    this.notebookCoreRouteAdapter.acceptNoteForms(this.note.noteForms, noteParams);
    this.messageService.saveNoteForms({
      noteParams,
      id: this.note.id
    });
  }

  onFormNameRemove(formName: string) {
    if (!this.note) {
      throw new Error(`"note" is not defined. Please check if note data is loaded before calling this method.`);
    }
    this.messageService.removeNoteForms(this.note, formName);
  }

  onNoteTitleChange(noteFormTitle: string) {
    if (!this.note) {
      throw new Error(`"note" is not defined. Please check if note data is loaded before calling this method.`);
    }
    this.messageService.updateNote(this.note.id, this.note.name, {
      ...this.note.config,
      noteFormTitle
    });
  }

  setNoteFormsStatus() {
    this.isShowNoteForms = !!this.note && this.note.noteForms && Object.keys(this.note.noteForms).length !== 0;
    this.cdr.markForCheck();
  }

  onSidebarOpenChange(isSidebarOpen: boolean) {
    this.isSidebarOpen = isSidebarOpen;
  }

  onResizeSidebar({ width }: NzResizeEvent): void {
    cancelAnimationFrame(this.sidebarAnimationFrame);
    this.sidebarAnimationFrame = requestAnimationFrame(() => {
      this.sidebarWidth = width!;
    });
  }

  constructor(
    public messageService: MessageService,
    protected ngZService: NgZService,
    private activatedRoute: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private noteStatusService: NoteStatusService,
    private noteVarShareService: NoteVarShareService,
    private ticketService: TicketService,
    private securityService: SecurityService,
    private router: Router,
    private titleService: Title,
    private themeService: ThemeService,
    private configurationService: ConfigurationService,
    private saveAsService: SaveAsService,
    private nzModalService: NzModalService,
    private reactFeature: ReactFeatureService,
    private notebookCoreRouteAdapter: NotebookCoreRouteAdapter
  ) {
    super(messageService);
    this.coreProofReactProps = this.createCoreProofReactProps();
  }

  private refreshCoreProofReactProps(): void {
    this.coreProofReactProps = this.createCoreProofReactProps();
  }

  private createCoreProofReactProps(): NotebookCoreRemoteProps & Readonly<Record<string, unknown>> {
    return {
      core: this.notebookCoreRouteAdapter.port,
      expectedCore: this.notebookCoreRouteAdapter.port,
      readOnly: this.viewOnly,
      onParagraphTextChange: (paragraphId, text) =>
        this.notebookCoreRouteAdapter.updateParagraphText(paragraphId, text),
      onParagraphInsert: index => this.insertCoreParagraph(index),
      onParagraphRemove: paragraphId => this.removeCoreParagraph(paragraphId),
      onParagraphMove: (paragraphId, index) => this.moveCoreParagraph(paragraphId, index),
      onNotebookTitleChange: title => this.renameCoreNotebook(title),
      onCloneNotebook: () => this.cloneReactNotebook(),
      onExportNotebook: () => this.exportReactNotebook(),
      onReloadNotebook: () => this.note && this.messageService.reloadNote(this.note.id),
      canTogglePersonalizedMode: Boolean(
        this.ticketService.ticket.principal &&
        this.ticketService.ticket.principal !== 'anonymous' &&
        !this.viewOnly &&
        this.isOwner
      ),
      personalizedMode: this.note?.config.personalizedMode === 'true',
      onTogglePersonalizedMode: () => this.toggleReactPersonalizedMode(),
      canDeleteNotebook: !this.viewOnly,
      isTrashedNotebook: this.note ? this.noteStatusService.isTrash(this.note) : false,
      onDeleteNotebook: () => this.deleteReactNotebook(),
      lookAndFeel: this.note?.config.looknfeel,
      onLookAndFeelChange: lookAndFeel => this.setReactLookAndFeel(lookAndFeel),
      onShowShortcut: () => this.showReactShortcut(),
      revisions: this.noteRevisions.map(revision => ({
        id: revision.id,
        message: revision.message,
        time: revision.time
      })),
      currentRevision: this.activatedRoute.snapshot.params.revisionId ?? 'Head',
      revisionView: this.revisionView,
      onRevisionSelect: revisionId => this.selectReactRevision(revisionId),
      onCheckpointNotebook: message => this.note && this.messageService.checkpointNote(this.note.id, message),
      onSetNotebookRevision: () => this.setReactNotebookRevision(),
      scheduler: this.note?.config.isZeppelinNotebookCronEnable
        ? {
            cron: this.note.config.cron,
            releaseResource: Boolean(this.note.config.releaseresource)
          }
        : undefined,
      onScheduleChange: schedule => this.setReactSchedule(schedule),
      onExtensionChange: extension => this.setReactExtension(extension),
      onNoteFormsChange: noteParams =>
        this.onNoteFormChange(
          Object.entries(noteParams).reduce<DynamicFormParams>((params, [name, value]) => {
            params[name] = typeof value === 'string' ? value : [...value];
            return params;
          }, {})
        ),
      onParagraphResultConfigChange: (paragraphId, resultIndex, config) =>
        this.notebookCoreRouteAdapter.updateParagraphResultConfig(
          paragraphId,
          resultIndex,
          config as ParagraphConfigResult
        ),
      onError: () => {
        this.reactNotebookFailed = true;
        this.cdr.markForCheck();
      }
    };
  }

  private setReactExtension(extension: 'interpreter' | 'permissions' | 'revisions' | 'hide'): void {
    this.activatedExtension = this.activatedExtension === extension ? 'hide' : extension;
    if (this.activatedExtension === 'interpreter' && this.note) {
      this.messageService.getInterpreterBindings(this.note.id);
    }
    this.refreshCoreProofReactProps();
    this.cdr.markForCheck();
  }

  private cloneReactNotebook(): void {
    if (!this.note) {
      return;
    }
    this.nzModalService.create({
      nzTitle: 'Clone Note',
      nzContent: NoteCreateComponent,
      nzData: { cloneNote: this.note },
      nzFooter: null
    });
  }

  private async exportReactNotebook(): Promise<void> {
    if (!this.note) {
      return;
    }
    const sizeLimit = await this.configurationService.fetchWsMaxMessageSize();
    const jsonContent = JSON.stringify(this.note);
    if (jsonContent.length > sizeLimit) {
      this.nzModalService.confirm({
        nzTitle: `Note size exceeds importable limit (${sizeLimit})`,
        nzContent: 'Do you still want to export this note?',
        nzOnOk: () => this.saveAsService.saveAs(jsonContent, this.note!.name, 'zpln')
      });
      return;
    }
    this.saveAsService.saveAs(jsonContent, this.note.name, 'zpln');
  }

  private toggleReactPersonalizedMode(): void {
    if (!this.note || !this.isOwner) {
      return;
    }
    const modeText = this.note.config.personalizedMode === 'true' ? 'collaborate' : 'personalize';
    this.nzModalService.confirm({
      nzTitle: 'Setting the result display',
      nzContent: `Do you want to ${modeText} your analysis?`,
      nzOnOk: () => {
        this.note!.config.personalizedMode =
          this.note!.config.personalizedMode === undefined || this.note!.config.personalizedMode === 'true'
            ? 'false'
            : 'true';
        this.messageService.updatePersonalizedMode(this.note!.id, this.note!.config.personalizedMode);
      }
    });
  }

  private deleteReactNotebook(): void {
    if (!this.note) {
      return;
    }
    const isTrash = this.noteStatusService.isTrash(this.note);
    this.nzModalService.confirm({
      nzTitle: isTrash ? 'Remove this note permanently?' : 'Move this note to trash?',
      nzOnOk: () => {
        if (isTrash) {
          this.messageService.deleteNote(this.note!.id);
        } else {
          this.messageService.moveNoteToTrash(this.note!.id);
        }
        this.router.navigate(['/']);
      }
    });
  }

  private setReactLookAndFeel(lookAndFeel: 'report' | 'default' | 'simple'): void {
    if (!this.note || this.revisionView) {
      return;
    }
    this.note.config.looknfeel = lookAndFeel;
    this.messageService.updateNote(this.note.id, this.note.name, this.note.config);
  }

  private setReactSchedule(schedule: { cron?: string; releaseResource: boolean }): void {
    if (!this.note || this.viewOnly || this.revisionView || this.noteStatusService.isTrash(this.note)) {
      return;
    }
    if (schedule.cron) {
      if (!this.note.config.cronExecutingUser) {
        this.note.config.cronExecutingUser = this.ticketService.ticket.principal;
      }
      if (!this.note.config.cronExecutingRoles) {
        this.note.config.cronExecutingRoles = this.ticketService.ticket.roles;
      }
    } else {
      this.note.config.cronExecutingUser = '';
      this.note.config.cronExecutingRoles = '';
    }
    this.note.config.cron = schedule.cron;
    this.note.config.releaseresource = schedule.releaseResource;
    this.messageService.updateNote(this.note.id, this.note.name, this.note.config);
    this.refreshCoreProofReactProps();
  }

  private showReactShortcut(): void {
    this.nzModalService.info({
      nzTitle: 'Shortcut Info',
      nzWidth: '600px',
      nzContent: ShortcutComponent
    });
  }

  private selectReactRevision(revisionId: string): void {
    if (!this.note) {
      return;
    }
    if (revisionId === 'Head') {
      this.router.navigate(['/notebook', this.note.id]).then();
      return;
    }
    this.router.navigate(['/notebook', this.note.id, 'revision', revisionId]).then();
  }

  private setReactNotebookRevision(): void {
    const revisionId = this.activatedRoute.snapshot.params.revisionId;
    if (!this.note || !revisionId) {
      return;
    }
    this.nzModalService.confirm({
      nzTitle: 'Set revision',
      nzContent: 'Set notebook head to current revision?',
      nzOnOk: () => this.messageService.setNoteRevision(this.note!.id, revisionId)
    });
  }

  ngOnInit() {
    this.subscribeNotebookScopedReplies();
    this.messageService
      .sent()
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        this.notebookRequestCorrelation.record(message);
      });
    this.messageService
      .receive(OP.PARAGRAPH_UPDATE_OUTPUT)
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => this.updateCoreParagraphOutput(data));
    this.messageService
      .receive(OP.PARAGRAPH_APPEND_OUTPUT)
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => this.appendCoreParagraphOutput(data));
    this.activatedRoute.queryParamMap
      .pipe(startWith(this.activatedRoute.snapshot.queryParamMap), takeUntil(this.destroy$))
      .subscribe(params => {
        const id = params.get('paragraph');
        this.onParagraphSelect(id);
        this.onParagraphScrolled(id);
        this.onParagraphSearch(params.get('term') || '');
      });
    this.activatedRoute.queryParamMap
      .pipe(startWith(this.activatedRoute.snapshot.queryParamMap), takeUntil(this.destroy$))
      .subscribe(data => {
        this.useReactFooter = this.reactFeature.isEnabled('paragraphFooter', data);
        this.useReactNotebook = this.reactFeature.isEnabled('notebook', data);
        this.reactNotebookFailed = false;
        this.coreProofEnabled = data.get('coreProof') === 'true';
        this.cdr.markForCheck();
      });
    this.activatedRoute.params.pipe(takeUntil(this.destroy$), distinctUntilKeyChanged('noteId')).subscribe(() => {
      this.noteVarShareService.clear();
    });
    this.activatedRoute.params.pipe(takeUntil(this.destroy$)).subscribe(param => {
      this.revisionView = !!param.revisionId;
      this.notebookCoreRouteAdapter.enterRoute(param.noteId, param.revisionId ?? null);
      this.cdr.markForCheck();
    });
    this.revisionView = !!this.activatedRoute.snapshot.params.revisionId;

    // Fetch the note whenever the WebSocket (re)connects OR the route's noteId/revisionId changes.
    // Navigating between notes reuses this component (ngOnInit does not re-run) and keeps the socket
    // connected, so the fetch must be driven by route params too — connection status alone would
    // leave the page showing the previously loaded note after navigation.
    combineLatest([
      this.messageService.connectedStatus$.pipe(startWith(this.messageService.connectedStatus), distinctUntilChanged()),
      this.activatedRoute.params
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([connected, params]) => {
        if (!connected) {
          return;
        }
        this.requestCurrentNote();
        this.cdr.markForCheck();
        const { noteId } = params;
        this.messageService.listRevisionHistory(noteId);
        // TODO(hsuanxyz) scroll to current paragraph
      });
  }

  ngAfterViewInit(): void {
    this.highlightSearchTerm();
    this.listOfNotebookParagraphComponent.changes.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.highlightSearchTerm();
    });
  }

  removeParagraphFromNgZ(): void {
    if (this.note && Array.isArray(this.note.paragraphs)) {
      this.note.paragraphs.forEach(p => {
        this.ngZService.removeParagraph(p.id);
      });
    }
  }

  ngOnDestroy(): void {
    super.ngOnDestroy();
    this.killSaveTimer();
    this.saveNote();
    this.messageService.deactivateNotebookRoute();
    this.destroy$.next();
    this.destroy$.complete();
    this.titleService.setTitle('Zeppelin');
  }

  private subscribeNotebookScopedReplies(): void {
    this.messageService
      .receiveEnvelope(OP.INTERPRETER_BINDINGS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        if (message.data && this.isCurrentNotebookReply(message, OP.INTERPRETER_BINDINGS)) {
          this.loadInterpreterBindings(message.data);
        }
      });
    this.messageService
      .receiveEnvelope(OP.LIST_REVISION_HISTORY)
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        if (message.data && this.isCurrentNotebookReply(message, OP.LIST_REVISION_HISTORY)) {
          this.listRevisionHistory(message.data);
        }
      });
    this.messageService
      .receiveEnvelope(OP.SET_NOTE_REVISION)
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        if (message.data && this.isCurrentNotebookReply(message, OP.SET_NOTE_REVISION)) {
          this.setNoteRevision(message.data);
        }
      });
    this.messageService
      .receiveEnvelope(OP.NOTE_REVISION)
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        if (message.data && this.isCurrentNotebookReply(message, OP.NOTE_REVISION, message.data.revisionId)) {
          this.getNoteRevision(message.data);
        }
      });
    this.messageService
      .receiveEnvelope(OP.AUTH_INFO)
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        this.settleNotebookScopedFailure(message);
      });
    this.messageService
      .receiveEnvelope(OP.ERROR_INFO)
      .pipe(takeUntil(this.destroy$))
      .subscribe(message => {
        this.settleNotebookScopedFailure(message);
      });
  }

  private isCurrentNotebookReply(
    message: Parameters<MessageService['isCurrentNotebookReply']>[0],
    op: OP,
    revisionId?: string
  ): boolean {
    return this.messageService.isCurrentNotebookReply(
      message,
      op,
      this.activatedRoute.snapshot.params.noteId,
      revisionId
    );
  }

  private settleNotebookScopedFailure(message: Parameters<MessageService['settleNotebookScopedFailure']>[0]): boolean {
    return this.messageService.settleNotebookScopedFailure(
      message,
      this.activatedRoute.snapshot.params.noteId,
      this.activatedRoute.snapshot.params.revisionId
    );
  private requestCurrentNote(): void {
    const { noteId, revisionId } = this.activatedRoute.snapshot.params;
    if (!noteId) {
      throw new Error('Route parameter `noteId` is required.');
    }
    if (revisionId) {
      this.messageService.activateNotebookRoute(noteId, revisionId);
      this.messageService.noteRevision(noteId, revisionId);
    } else {
      this.messageService.activateNotebookRoute(noteId);
      this.messageService.getNote(noteId);
    }
  }

  private renderParagraphProjection(paragraphs: readonly LoadedParagraph[] | null): boolean {
    if (!this.note || !paragraphs) {
      return false;
    }
    this.note = { ...this.note, paragraphs: [...paragraphs] };
    return true;
  }

  // The term can arrive before the paragraphs exist: the query param subscription emits during
  // ngOnInit, and the paragraphs themselves are only rendered once the note arrives over the
  // WebSocket. Keep the term and (re)apply it whenever the paragraph views change.
  private highlightSearchTerm(): void {
    this.listOfNotebookParagraphComponent?.forEach(comp => comp.highlightMatches(this.searchTerm));
  }
}
