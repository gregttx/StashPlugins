// The two dialogs are one design in two files. Neither plugin can import the
// other's stylesheet - a plugin folder is copied as-is, with no build step and no
// shared module - so each carries its own CSS string, and nothing but this suite
// stops them drifting. They did drift: the modal was #202b33 in one and #30404d in
// the other for four months, because the second was written a day after the first
// and never compared with it.
//
// Only the overlap is pinned. Each dialog has rules the other has no use for (the
// hierarchy viewer's tree and inspector, the merge log's own line kinds), and those
// are free to differ.
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./npt-harness');

const PLUGINS = [
  { name: 'NormalizeParentTags', prefix: 'npt', decl: 'var CSS =' },
  { name: 'MergePerformerTagsToScenes', prefix: 'cpt2s', decl: 'var TASK_CSS =' },
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

// selector -> declarations, with the plugin's own prefix stripped so the two are
// comparable: `.npt-modal` and `.cpt2s-modal` are both `.modal`.
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
const [npt, mpt] = parsed;

h.check('both dialogs declare a stylesheet',
  Object.keys(npt.rules).length > 5 && Object.keys(mpt.rules).length > 5,
  Object.keys(npt.rules).length + ' / ' + Object.keys(mpt.rules).length);

// The rules that exist in both are the shared dialog chrome, and every one of them
// has to agree - a difference here is two plugins disagreeing about what one dialog
// looks like.
const shared = Object.keys(npt.rules).filter((s) => Object.prototype.hasOwnProperty.call(mpt.rules, s));

h.check('the dialogs share their chrome',
  ['.backdrop', '.modal', '.head', '.title', '.warn', '.note', '.legend', '.progress',
    '.log', '.line', '.foot', '.hidden'].every((s) => shared.indexOf(s) !== -1),
  shared.join(' '));

shared.forEach((selector) => {
  h.check(selector + ' matches in both plugins', npt.rules[selector] === mpt.rules[selector],
    'npt:   ' + npt.rules[selector] + '\n        mpt:   ' + mpt.rules[selector]);
});

// The modal is the one people see first, and the two values it drifted between are
// both plausible Stash greys - so name the one that is right rather than leaving the
// check to say only that they agree. #202b33 is what the dim greys in the log and the
// tree were chosen against, and it is what both dialogs settled on.
h.check('the modal uses the grey the rest of the palette was picked against',
  /background:#202b33/.test(npt.rules['.modal'] || '') &&
  !/#30404d/.test(npt.rules['.modal'] || ''), npt.rules['.modal']);

h.finish();
