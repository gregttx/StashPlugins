// The dialogs are one design in three files. No plugin can import another's
// stylesheet - a plugin folder is copied as-is, with no build step and no shared
// module - so each carries its own CSS string, and nothing but this suite stops them
// drifting. Two of them did drift: the modal was #202b33 in one and #30404d in the
// other for four months, because the second was written a day after the first and
// never compared with it.
//
// Only the overlap is pinned. Each dialog has rules the others have no use for (the
// hierarchy viewer's tree and inspector, each plugin's own log-line kinds), and
// those are free to differ - a selector only one plugin defines is ignored.
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./npt-harness');

const PLUGINS = [
  { name: 'NormalizeParentTags', prefix: 'npt', decl: 'var CSS =' },
  { name: 'MergePerformerTagsToScenes', prefix: 'cpt2s', decl: 'var TASK_CSS =' },
  { name: 'PropagateTagsAndPerformers', prefix: 'ptp2re', decl: 'var CSS =' },
];

// The CSS is a run of single-quoted fragments joined with +. Pull the block out,
// drop the comment lines and the JS quoting, and what is left is the stylesheet.
function readCss(plugin) {
  const file = path.join(__dirname, '..', plugin.name, plugin.name + '.js');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(plugin.decl);
  if (start === -1) throw new Error('no ' + plugin.decl + ' in ' + plugin.name);
  const end = src.indexOf("';", start);
  if (end === -1) throw new Error('unterminated ' + plugin.decl + ' in ' + plugin.name);
  return src.slice(start + plugin.decl.length, end + 1)
    .split('\n')
    .filter((l) => l.trim().indexOf('//') !== 0)
    .join('')
    .replace(/'\s*\+\s*'/g, '')
    .replace(/'/g, '')
    .trim();
}

// selector -> declarations, with the plugin's own prefix stripped so they are
// comparable: `.npt-modal`, `.cpt2s-modal` and `.ptp2re-modal` are all `.modal`.
function rules(css, prefix) {
  const out = {};
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].trim().split('.' + prefix + '-').join('.');
    out[selector] = m[2].trim();
  }
  return out;
}

const parsed = PLUGINS.map((p) => ({ plugin: p, rules: rules(readCss(p), p.prefix) }));

parsed.forEach((p) => {
  h.check(p.plugin.name + ' declares a stylesheet', Object.keys(p.rules).length > 5,
    String(Object.keys(p.rules).length) + ' rules');
});

// The chrome every dialog is built from. Named rather than merely compared, so a
// plugin that quietly stopped defining one of them fails here instead of passing by
// having nothing to disagree about.
const CHROME = ['.backdrop', '.modal', '.head', '.title', '.warn', '.note', '.legend',
  '.progress', '.log', '.line', '.foot', '.hidden'];

// The settings-page rules, shared since NormalizeParentTags 1.7.5 and
// MergePerformerTagsToScenes 1.11.0. Same rule as the chrome: one design, one
// stylesheet, three copies of it.
const SETTINGS = ['.own-group .sub-heading', '.tipped', '.tip', '.tipbox',
  '.tipped.tip-open .tipbox', '.desc-collapsed .p:not(:first-child)', '.desc-toggle'];

parsed.forEach((p) => {
  h.check(p.plugin.name + ' defines the shared dialog chrome',
    CHROME.every((s) => Object.prototype.hasOwnProperty.call(p.rules, s)),
    CHROME.filter((s) => !Object.prototype.hasOwnProperty.call(p.rules, s)).join(' ') || 'all present');
  h.check(p.plugin.name + ' defines the shared settings-page rules',
    SETTINGS.every((s) => Object.prototype.hasOwnProperty.call(p.rules, s)),
    SETTINGS.filter((s) => !Object.prototype.hasOwnProperty.call(p.rules, s)).join(' ') || 'all present');
});

// Any selector two or more of them define is shared by construction, and every one
// has to agree - a difference here is two plugins disagreeing about what one dialog
// looks like. A selector only one defines is that plugin's own and is skipped.
const seen = {};
parsed.forEach((p) => {
  Object.keys(p.rules).forEach((s) => {
    if (!seen[s]) seen[s] = [];
    seen[s].push(p);
  });
});

Object.keys(seen).sort().forEach((selector) => {
  const owners = seen[selector];
  if (owners.length < 2) return;
  const first = owners[0];
  const same = owners.every((p) => p.rules[selector] === first.rules[selector]);
  h.check(selector + ' matches across ' + owners.length + ' plugins', same,
    owners.map((p) => p.plugin.prefix + ': ' + p.rules[selector]).join('\n        '));
});

// The modal is the one people see first, and the two values it drifted between are
// both plausible Stash greys - so name the one that is right rather than leaving the
// check to say only that they agree. #202b33 is what the dim greys in the log and
// the tree were chosen against, and it is what all three dialogs settled on.
parsed.forEach((p) => {
  h.check(p.plugin.name + ' uses the grey the rest of the palette was picked against',
    /background:#202b33/.test(p.rules['.modal'] || '') && !/#30404d/.test(p.rules['.modal'] || ''),
    p.rules['.modal']);
});

h.finish();
