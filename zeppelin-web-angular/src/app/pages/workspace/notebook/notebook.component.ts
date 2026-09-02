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

import { MessageListener, MessageListenersManager } from '@zeppelin/core';
import { Permissions } from '@zeppelin/interfaces';
import {
  DynamicFormParams,
  InterpreterBindingItem,
  MessageReceiveDataTypeMap,
  Note,
  OP,
  RevisionListItem
} from '@zeppelin/sdk';
import {
  MessageService,
  NgZService,
  NoteStatusService,
  NoteVarShareService,
  ReactFeatureService,
  SecurityService,
  ThemeService,
  TicketService
} from '@zeppelin/services';

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
  readonly coreProofSnapshot$ = this.notebookCoreRouteAdapter.snapshot$;
  readonly coreProofReactProps: NotebookCoreRemoteProps & Readonly<Record<string, unknown>>;
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

  @MessageListener(OP.INTERPRETER_BINDINGS)
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
    this.setNoteFormsStatus();
  }

  @MessageListener(OP.NOTE_REVISION)
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

  @MessageListener(OP.SET_NOTE_REVISION)
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

  @MessageListener(OP.NOTE_UPDATED)
  noteUpdated(data: MessageReceiveDataTypeMap[OP.NOTE_UPDATED]) {
    if (!this.note) {
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

  @MessageListener(OP.LIST_REVISION_HISTORY)
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

  saveParagraph(id: string) {
    const paragraphFound = this.listOfNotebookParagraphComponent.toArray().find(p => p.paragraph.id === id);
    if (!paragraphFound) {
      throw new Error(`Paragraph ${id} not found`);
    }
    paragraphFound.saveParagraph();
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
    private reactFeature: ReactFeatureService,
    private notebookCoreRouteAdapter: NotebookCoreRouteAdapter
  ) {
    super(messageService);
    this.coreProofReactProps = {
      core: notebookCoreRouteAdapter.port,
      expectedCore: notebookCoreRouteAdapter.port
    };
  }

  ngOnInit() {
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
    this.destroy$.next();
    this.destroy$.complete();
    this.titleService.setTitle('Zeppelin');
  }

  private requestCurrentNote(): void {
    const { noteId, revisionId } = this.activatedRoute.snapshot.params;
    if (!noteId) {
      throw new Error('Route parameter `noteId` is required.');
    }
    if (revisionId) {
      this.messageService.noteRevision(noteId, revisionId);
    } else {
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
