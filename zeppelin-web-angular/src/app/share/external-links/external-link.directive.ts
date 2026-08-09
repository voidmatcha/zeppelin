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

import { Directive, ElementRef, HostBinding, Input, OnChanges, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Directive({
  // eslint-disable-next-line
  selector: 'a[href]',
  standalone: false
})
export class ExternalLinkDirective implements OnChanges {
  @HostBinding('attr.rel') relAttr: HTMLAnchorElement['rel'] | null = null;
  @HostBinding('attr.target') targetAttr: HTMLAnchorElement['target'] | null = null;
  @Input() href?: string;

  constructor(
    private elementRef: ElementRef,
    private sanitizer: DomSanitizer
  ) {}

  ngOnChanges() {
    const anchor = this.elementRef.nativeElement as HTMLAnchorElement;

    if (this.href == null) {
      anchor.removeAttribute('href');
      this.relAttr = null;
      this.targetAttr = null;
      return;
    }

    // Angular stops sanitizing a property once a directive input claims it.
    // The sanitizer it emitted for [href] never runs, so apply one here.
    const safeHref = this.sanitizer.sanitize(SecurityContext.URL, this.href) ?? '';
    anchor.href = safeHref;

    if (this.isLinkExternal(safeHref)) {
      // https://developers.google.com/web/tools/lighthouse/audits/noopener
      this.relAttr = 'noopener noreferrer';
      this.targetAttr = '_blank';
    } else {
      this.relAttr = null;
      this.targetAttr = null;
    }
  }

  private isLinkExternal(href: string): boolean {
    try {
      // Compare the whole host, not a substring.
      // `<our-host>.example.com` would otherwise read as internal and lose the noopener pair.
      return new URL(href, location.href).hostname !== location.hostname;
    } catch {
      return false;
    }
  }
}
