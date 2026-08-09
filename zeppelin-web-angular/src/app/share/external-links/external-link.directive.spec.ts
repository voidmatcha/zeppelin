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

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ExternalLinkDirective } from './external-link.directive';

@Component({
  standalone: false,
  template: `
    <a [href]="href">link</a>
  `
})
class HostComponent {
  href = '';
}

// The bug is in how Angular binds the property, so these cases only reproduce through a template.
describe('ExternalLinkDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  const render = (href: string): HTMLAnchorElement => {
    fixture.componentInstance.href = href;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
  };

  // Vitest does not reset the TestBed between specs the way the Karma runner did.
  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      declarations: [HostComponent, ExternalLinkDirective]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  // Angular skips its own URL sanitizer once a directive declares an href input.
  it('neutralizes a javascript: URL bound through the template', () => {
    const anchor = render('javascript:alert(1)');
    expect(anchor.getAttribute('href')).toBe('unsafe:javascript:alert(1)');
  });

  it('leaves a normal external URL intact and marks it external', () => {
    const anchor = render('https://external.example.com/docs');
    expect(anchor.getAttribute('href')).toBe('https://external.example.com/docs');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.getAttribute('target')).toBe('_blank');
  });

  it('does not mark a same-origin URL as external', () => {
    const anchor = render('/notebook/2A94M5J1Z');
    expect(anchor.getAttribute('rel')).toBeNull();
    expect(anchor.getAttribute('target')).toBeNull();
  });

  // A substring host check would read this as internal and drop the noopener pair.
  it('treats a host that merely starts with the current host as external', () => {
    const anchor = render(`https://${location.hostname}.evil.example.com/`);
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
