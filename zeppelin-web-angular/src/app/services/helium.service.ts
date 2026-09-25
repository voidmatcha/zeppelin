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

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  HeliumBundle,
  HeliumPackageSearchResult,
  HeliumSpell,
  HeliumSpellBundle,
  HeliumSpellConfigResponse,
  HeliumVisualizationBundle
} from '@zeppelin/interfaces/helium';
import { BaseRest } from '@zeppelin/services/base-rest';
import { BaseUrlService } from '@zeppelin/services/base-url.service';
import { createSpellConfig, normalizeSpellResults } from '@zeppelin/spell';
import { BehaviorSubject, firstValueFrom, forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class HeliumService extends BaseRest {
  private visualizationBundles$ = new BehaviorSubject<HeliumVisualizationBundle[]>([]);
  private spellPerMagic: Record<string, HeliumSpell> = {};
  private packageNamePerMagic: Record<string, string> = {};
  private packageInitialization?: Promise<void>;

  constructor(
    private http: HttpClient,
    baseUrlService: BaseUrlService
  ) {
    super(baseUrlService);
  }

  visualizationBundles() {
    return this.visualizationBundles$.asObservable();
  }

  getSpellByMagic(magic: string): HeliumSpell | null {
    return this.spellPerMagic[magic] ?? null;
  }

  async hasSpell(magic: string): Promise<boolean> {
    await this.initPackages();
    return this.getSpellByMagic(magic) !== null;
  }

  async executeSpell(magic: string, textWithoutMagic: string) {
    await this.initPackages();
    return this.executeRegisteredSpell(magic, textWithoutMagic, true);
  }

  async executeSpellAsDisplaySystem(magic: string, textWithoutMagic: string) {
    await this.initPackages();
    return this.executeRegisteredSpell(magic, textWithoutMagic.trim(), false);
  }

  private async executeRegisteredSpell(magic: string, textWithoutMagic: string, includeSourceContext: boolean) {
    const spell = this.getSpellByMagic(magic);
    const packageName = this.packageNamePerMagic[magic];
    if (!spell || !packageName) {
      throw new Error(`No enabled Helium Spell is registered for ${magic}.`);
    }

    const configResponse = await firstValueFrom(
      this.http.get<HeliumSpellConfigResponse>(this.restUrl`/helium/spell/config/${packageName}`)
    );
    const result = spell.interpret(textWithoutMagic, createSpellConfig(configResponse));
    if (!result || typeof result.getAllParsedDataWithTypes !== 'function') {
      throw new Error(`Helium Spell ${magic} returned an incompatible result.`);
    }
    const parsed = includeSourceContext
      ? await result.getAllParsedDataWithTypes(this.spellPerMagic, magic, textWithoutMagic)
      : await result.getAllParsedDataWithTypes(this.spellPerMagic);
    return normalizeSpellResults(parsed);
  }

  private getAllEnabledPackages() {
    return this.http.get<HeliumPackageSearchResult[]>(this.restUrl`/helium/enabledPackage`);
  }

  private getSingleBundle(pkgName: string) {
    return this.http
      .get(this.restUrl`/helium/bundle/load/${pkgName}`, {
        responseType: 'text'
      })
      .pipe(
        map(bundle => {
          if (typeof bundle === 'string' && bundle.substring(0, 'ERROR:'.length) === 'ERROR:') {
            console.error(`Failed to get bundle: ${pkgName}`, bundle);
            return '';
          }
          return bundle;
        }),
        catchError(error => {
          console.error(`Failed to get single bundle: ${pkgName}`, error);
          return of('');
        })
      );
  }

  private getBundlesParallel(): Observable<string[]> {
    return this.getAllEnabledPackages().pipe(
      switchMap(packages => {
        if (!packages || packages.length === 0) {
          return of([]);
        }

        const bundleRequests = packages.map(helium => this.getSingleBundle(helium.pkg.name));

        return forkJoin(bundleRequests);
      }),
      map(bundles =>
        bundles.reduce((acc, bundle) => {
          if (bundle === '') {
            return acc;
          }
          acc.push(bundle);
          return acc;
        }, [] as string[])
      )
    );
  }

  initPackages(): Promise<void> {
    if (this.packageInitialization) {
      return this.packageInitialization;
    }

    this.packageInitialization = firstValueFrom(this.getBundlesParallel())
      .then(availableBundles => {
        this.spellPerMagic = {};
        this.packageNamePerMagic = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)._heliumBundles = [] as HeliumBundle[];
        availableBundles.forEach(bundle => {
          try {
            eval(bundle);
          } catch (error) {
            console.error('Failed to evaluate Helium bundle', error);
          }
        });

        const visualizationBundles = [] as HeliumVisualizationBundle[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any)._heliumBundles as HeliumBundle[]).forEach(bundle => {
          switch (bundle.type) {
            case 'VISUALIZATION':
              visualizationBundles.push(bundle as HeliumVisualizationBundle);
              break;
            case 'SPELL': {
              const spellBundle = bundle as HeliumSpellBundle;
              try {
                const spell = new spellBundle.class();
                const magic = spell.getMagic();
                if (!magic || !magic.startsWith('%')) {
                  console.error(`Ignoring Helium Spell with invalid magic: ${spellBundle.id}`);
                  break;
                }
                this.spellPerMagic[magic] = spell;
                this.packageNamePerMagic[magic] = spellBundle.id;
              } catch (error) {
                console.error(`Failed to initialize Helium Spell: ${spellBundle.id}`, error);
              }
              break;
            }
          }
        });
        this.visualizationBundles$.next(visualizationBundles);

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (window as any)._heliumBundles;
        } catch (e) {
          console.error('Failed to delete window.heliumBundles', e);
        }
      })
      .catch(error => {
        this.packageInitialization = undefined;
        throw error;
      });
    return this.packageInitialization;
  }
}
