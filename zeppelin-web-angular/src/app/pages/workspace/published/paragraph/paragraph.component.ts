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
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  QueryList,
  TemplateRef,
  ViewChild,
  ViewChildren
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { publishedSymbol, MessageListener, ParagraphBase, Published } from '@zeppelin/core';
import {
  MessageReceiveDataTypeMap,
  OP,
  ParagraphConfigResult,
  ParagraphItem,
  ParagraphIResultsMsgItem
} from '@zeppelin/sdk';
import { HeliumService, MessageService, NgZService, NoteStatusService, ReactFeatureService } from '@zeppelin/services';
import { SpellResult } from '@zeppelin/spell';
import { isNil } from 'lodash';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NotebookParagraphResultComponent } from '../../share/result/result.component';
import { ReactHostCallbacks, ReactProps } from '../../../../share/react-mount';
import { HeliumApplicationService } from '../../../../services/helium-application.service';

@Component({
  selector: 'zeppelin-publish-paragraph',
  templateUrl: './paragraph.component.html',
  styleUrls: ['./paragraph.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class PublishedParagraphComponent extends ParagraphBase implements Published {
  readonly [publishedSymbol] = true;

  noteId: string | null = null;
  paragraphId: string | null = null;
  previewCode: string = '';
  useReact = false;
  // Separate from useReact (which is re-derived from the URL) so a failed remote stays degraded.
  reactFailed = false;
  reactApplicationFallback = false;
  isLoading = true;
  error: string | null = null;
  reactProps: ReactProps & ReactHostCallbacks = {};
  private runRequest = 0;

  @ViewChild('codePreviewModal', { static: true }) codePreviewModal!: TemplateRef<void>;
  @ViewChildren(NotebookParagraphResultComponent)
  notebookParagraphResultComponents!: QueryList<NotebookParagraphResultComponent>;

  protected get currentNoteId(): string | null {
    return this.noteId;
  }

  constructor(
    public messageService: MessageService,
    private activatedRoute: ActivatedRoute,
    private heliumService: HeliumService,
    private heliumApplicationService: HeliumApplicationService,
    private router: Router,
    private nzModalService: NzModalService,
    private reactFeature: ReactFeatureService,
    noteStatusService: NoteStatusService,
    ngZService: NgZService,
    cdr: ChangeDetectorRef
  ) {
    super(messageService, noteStatusService, ngZService, cdr, heliumService);
    this.__zeppelinMessageListeners$__?.add(
      this.heliumApplicationService.changes.subscribe(() => this.handleApplicationCacheChange())
    );
    this.activatedRoute.queryParamMap.subscribe(params => {
      this.useReact = this.reactFeature.isEnabled('publishedParagraph', params);
    });

    this.activatedRoute.params.subscribe(params => {
      if (typeof params.noteId !== 'string') {
        throw new Error(`noteId path parameter should be string, but got ${typeof params.noteId} instead.`);
      }
      this.runRequest++;
      this.noteId = params.noteId;
      this.paragraphId = params.paragraphId!;
      this.reactFailed = false;
      this.reactApplicationFallback = false;
      this.error = null;
      this.setParagraphSnapshot(undefined);
      this.messageService.getNote(params.noteId);
    });
  }

  @MessageListener(OP.NOTE)
  getNote(data: MessageReceiveDataTypeMap[OP.NOTE]) {
    const note = data.note;
    if (!isNil(note) && note.id === this.noteId) {
      this.setParagraphSnapshot(note.paragraphs.find(p => p.id === this.paragraphId));
      if (this.paragraph) {
        this.reactApplicationFallback = this.hasApplications(this.paragraph);
        if (!this.paragraph.results) {
          this.showRunConfirmationModal();
        }
        if (this.useReact && !this.reactFailed && !this.reactApplicationFallback) {
          this.reactProps = this.buildReactProps(this.paragraph);
          this.isLoading = false;
          this.cdr.markForCheck();
          return;
        }

        this.originalText = this.paragraph.text;
        this.initializeDefault(this.paragraph.config, this.paragraph.settings);
      } else {
        this.handleParagraphNotFound(note.name || this.noteId!, this.paragraphId!);
        return;
      }
    }
    this.cdr.markForCheck();
  }

  @MessageListener(OP.ERROR_INFO)
  handleError(data: MessageReceiveDataTypeMap[OP.ERROR_INFO]) {
    if (data.info && data.info.includes('404')) {
      this.handleNoteNotFound(this.noteId!);
    }
  }

  trackByIndexFn(index: number) {
    return index;
  }

  setResults(paragraph: ParagraphItem) {
    if (paragraph.results) {
      this.results = paragraph.results.msg || [];
      this.configs = paragraph.config.results || {};
    }
    if (!paragraph.config) {
      paragraph.config = {};
    }
  }

  changeColWidth(_needCommit: boolean, _updateResult?: boolean): void {
    // noop
  }

  async runParagraph(): Promise<void> {
    if (!this.paragraph) {
      throw new Error('paragraph is not defined');
    }
    const text = this.paragraph.text;
    if (text && !this.isParagraphRunning) {
      const request = ++this.runRequest;
      const paragraph = this.paragraph;
      const noteId = this.noteId;
      const paragraphId = this.paragraphId;
      const magic = SpellResult.extractMagic(this.paragraph.text);
      let hasSpell = false;
      if (magic) {
        try {
          hasSpell = await this.heliumService.hasSpell(magic);
        } catch (error) {
          console.error('Failed to initialize Helium packages', error);
        }
      }
      if (
        request !== this.runRequest ||
        this.isParagraphRunning ||
        this.paragraph !== paragraph ||
        this.noteId !== noteId ||
        this.paragraphId !== paragraphId
      ) {
        return;
      }
      if (magic && hasSpell) {
        this.runParagraphUsingSpell(text, magic, false);
      } else {
        this.runParagraphUsingBackendInterpreter(text);
      }
    }
  }

  updateParagraphResult(resultIndex: number, config: ParagraphConfigResult, result: ParagraphIResultsMsgItem): void {
    if (this.useReact && !this.reactFailed && !this.reactApplicationFallback && this.paragraph) {
      this.reactProps = this.buildReactProps(this.paragraph);
      this.cdr.markForCheck();
      return;
    }
    const resultComponent = this.notebookParagraphResultComponents.toArray()[resultIndex];
    if (resultComponent) {
      resultComponent.updateResult(config, result);
    }
  }

  override ngOnDestroy(): void {
    this.runRequest++;
    super.ngOnDestroy();
  }

  updateParagraphObjectWhenUpdated(newPara: ParagraphItem): void {
    super.updateParagraphObjectWhenUpdated(newPara);
    // A run pushes OP.PARAGRAPH, not OP.NOTE, so getNote does not rebuild the props.
    // Do it here, once the base class has merged the new results into this.paragraph.
    if (this.useReact && !this.reactFailed && !this.reactApplicationFallback && this.paragraph) {
      this.reactProps = this.buildReactProps(this.paragraph);
      this.cdr.markForCheck();
    }
  }

  private showRunConfirmationModal(): void {
    if (!this.paragraph) {
      return;
    }

    this.previewCode = this.paragraph.text || '';

    this.nzModalService.confirm({
      nzTitle: 'Run Paragraph?',
      nzContent: this.codePreviewModal,
      nzOkText: 'Run',
      nzCancelText: 'Cancel',
      nzWidth: 600,
      nzOnOk: () => this.runParagraph()
    });
  }

  private handleParagraphNotFound(noteName: string, paragraphId: string): void {
    this.router.navigate(['/']).then(() => {
      this.nzModalService.error({
        nzTitle: 'Paragraph Not Found',
        nzContent: `The paragraph "${paragraphId}" does not exist in notebook "${noteName}". You have been redirected to the home page.`,
        nzOkText: 'OK'
      });
    });
  }

  private handleNoteNotFound(noteId: string): void {
    this.router.navigate(['/']).then(() => {
      this.nzModalService.error({
        nzTitle: 'Notebook Not Found',
        nzContent: `The notebook "${noteId}" does not exist or you don't have permission to access it. You have been redirected to the home page.`,
        nzOkText: 'OK'
      });
    });
  }

  private buildReactProps(paragraph: ParagraphItem): ReactProps & ReactHostCallbacks {
    return {
      paragraphId: this.paragraphId,
      noteId: this.noteId,
      results: paragraph.results?.msg,
      config: paragraph.config?.results,
      onError: (err: unknown) => {
        console.error('[PublishedParagraph] React mount failed', err);
        this.degradeToAngular(paragraph);
      }
    };
  }

  private hasApplications(paragraph: ParagraphItem): boolean {
    return (
      (Array.isArray(paragraph.apps) && paragraph.apps.length > 0) ||
      (!!this.noteId && this.heliumApplicationService.apps(this.noteId, paragraph.id).length > 0)
    );
  }

  private handleApplicationCacheChange(): void {
    if (!this.paragraph) {
      return;
    }
    const shouldFallback = this.hasApplications(this.paragraph);
    if (shouldFallback === this.reactApplicationFallback) {
      return;
    }
    this.reactApplicationFallback = shouldFallback;
    if (shouldFallback) {
      this.originalText = this.paragraph.text;
      this.initializeDefault(this.paragraph.config, this.paragraph.settings);
    } else if (this.useReact && !this.reactFailed) {
      this.reactProps = this.buildReactProps(this.paragraph);
    }
    this.cdr.markForCheck();
  }

  private degradeToAngular(paragraph: ParagraphItem): void {
    this.reactFailed = true;
    this.error = 'Failed to load React widget';
    // The React branch skipped the Angular init path (getNote), so run it before showing the fallback.
    this.originalText = paragraph.text;
    this.initializeDefault(paragraph.config, paragraph.settings);
    this.cdr.markForCheck();
  }
}
