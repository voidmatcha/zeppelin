/*
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

angular.module('zeppelinWebApp').controller('SearchResultCtrl', SearchResultCtrl);

function SearchResultCtrl($scope, $routeParams, searchService) {
  'ngInject';

  $scope.isResult = true;
  $scope.searchTerm = $routeParams.searchTerm;
  let results = searchService.search({'q': $routeParams.searchTerm}).query();

  function detectLang(text) {
    if (!text) {
      return '';
    }
    if (/^%(\w*\.)?sql/i.test(text)) {
      return 'sql';
    }
    if (/^%(\w*\.)?py/i.test(text)) {
      return 'python';
    }
    if (/^%md/i.test(text)) {
      return 'md';
    }
    if (/^%sh/i.test(text)) {
      return 'sh';
    }
    if (!text.startsWith('%')) {
      if (/\b(?:SELECT|INSERT|CREATE|FROM|WHERE)\b/i.test(text)
          && /\b(?:SELECT|FROM)\b/i.test(text)) {
        return 'sql';
      }
      if (/import |def |class /i.test(text)) {
        return 'python';
      }
    }
    return '';
  }

  results.$promise.then(function(result) {
    $scope.notes = result.body.map(function(note) {
      if (!/\/paragraph\//.test(note.id)) {
        return note;
      }
      note.id = note.id.replace('paragraph/', '?paragraph=') +
        '&term=' + $routeParams.searchTerm;

      let snippetHtml = (note.snippet || '').replace(/<B>/gi, '<mark>').replace(/<\/B>/gi, '</mark>');
      let snippetText = (note.snippet || '').replace(/<\/?B>/gi, '');
      let titleHtml = (note.title || '').replace(/<B>/gi, '<mark>').replace(/<\/B>/gi, '</mark>');
      let titleText = (note.title || '').replace(/<\/?B>/gi, '');
      let codeHtml = titleHtml ? titleHtml + '\n\n' + snippetHtml : snippetHtml;
      let code = titleText ? titleText + '\n\n' + snippetText : snippetText;

      let tables = (note.tables || '').trim().split(/\s+/).filter(function(t) { return t; }).join(', ');

      note.codeText = code;
      note.codeHtml = codeHtml;
      note.outputText = note.output || '';
      note.tablesText = tables;
      note.langBadge = detectLang(snippetText);

      return note;
    });

    $scope.isResult = $scope.notes.length > 0;

    $scope.$on('$routeChangeStart', function(event, next, current) {
      if (next.originalPath !== '/search/:searchTerm') {
        searchService.searchTerm = '';
      }
    });
  });
}
