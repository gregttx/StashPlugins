// The settings page, for every plugin in the repo at once.
//
// This suite exists because of a bug nothing else here could see. Every plugin decorates
// its own group in Settings → Plugins - the description split into paragraphs, the rest
// behind **Show more**, a labelled README link, the stale-script banner - and every plugin
// finds that group by walking Stash's markup. `tests/style.test.js` checks the CSS those
// rules are written in; nothing checked that the group is ever found. So a plugin could
// carry a perfect stylesheet, pass every suite, and decorate nothing.
//
// `FindEntitiesByTextContent` shipped exactly that. Its anchor excluded any group whose
// header row held a **button**, meaning to exclude Settings → Tasks - and Stash puts its
// own Enable/Disable button in the plugin group's header row, so the guard excluded the
// one page the decoration is for. The fix is to test by the *task caption* instead, which
// is what the older plugins already did.
//
// So both fixtures below are the point, not one of them:
//
//   - **The Plugins group carries Stash's own Disable button**, because that is the
//     detail the broken guard tripped over.
//   - **The Tasks group is headed with the same plugin name**, holds task buttons, and
//     gives every *task* row an h3 with a `.sub-heading` under it - which is the shape
//     that has twice tempted a plugin into decorating the wrong panel. Its own header row
//     carries no description, which was confirmed against a live Stash.
//
// Everything a fixture claims about Stash's markup is a claim this repo has already
// written down elsewhere; see the reference sections in the root `CLAUDE.md`.
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./npt-harness');

// prefix and id per plugin folder; everything else is read out of the yml, so a new
// plugin is one line here and nothing else.
const PLUGINS = [
  { dir: 'NormalizeParentTags', prefix: 'npt' },
  { dir: 'MergePerformerTagsToScenes', prefix: 'cpt2s' },
  { dir: 'PropagateTagsAndPerformers', prefix: 'ptp2re' },
  { dir: 'CustomFieldsBulkEditor', prefix: 'cfbe' },
  { dir: 'TagBundleClipboard', prefix: 'tbc' },
  { dir: 'SceneVariants', prefix: 'svr' },
  { dir: 'EntityNameMaintainer', prefix: 'enm' },
  { dir: 'FindEntitiesByTextContent', prefix: 'fetc' },
];

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

// ── What the yml says, which is what Stash renders ──────────────────────────

const unescape = (s) => String(s).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  .replace(/\\\\/g, '\\');

function ymlOf(p) {
  const text = read(p.dir, p.dir + '.yml');
  const name = (/^name:\s*(.+?)\s*$/m.exec(text) || [])[1];
  const version = (/^version:\s*(\S+)\s*$/m.exec(text) || [])[1];
  const description = unescape((/^description:\s*"(.*)"\s*$/m.exec(text) || [])[1] || '');
  // The `settings:` block, as [{ key, type, description }] - the type decides where Stash
  // puts the element id, which is the anchor every plugin with settings walks up from.
  const settings = [];
  let inBlock = false;
  let key = null;
  text.split('\n').forEach((line) => {
    if (/^settings:\s*$/.test(line)) { inBlock = true; return; }
    if (inBlock && /^\S/.test(line)) { inBlock = false; return; }
    if (!inBlock) return;
    const k = /^ {2}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (k) { key = k[1]; settings.push({ key: k[1] }); return; }
    const f = /^ {4}(type|description):\s*(.*)$/.exec(line);
    if (!f || !key) return;
    const on = settings[settings.length - 1];
    on[f[1]] = f[1] === 'description'
      ? unescape((/^"(.*)"$/.exec(f[2].trim()) || [])[1] || f[2].trim()) : f[2].trim();
  });
  const tasks = (text.match(/^ {2}- name:\s*(.+)$/gm) || [])
    .map((l) => l.replace(/^ {2}- name:\s*/, '').trim());
  return { name, version, description, settings, tasks };
}

// ── The two group shapes ────────────────────────────────────────────────────

function elem(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Settings → Plugins. One `.setting-group` per plugin: a header row holding the heading
// (name plus version in brackets), the description, and **Stash's own Disable button**,
// then one row per declared setting.
//
// Where the element id lands depends on the setting's type, and the difference is not
// cosmetic - it is the reference note in the root CLAUDE.md, read off Stash's
// `Inputs.tsx`. A BOOLEAN puts it on the Form.Switch *input* inside the row; a STRING or
// NUMBER puts it on the `.setting` row div itself, and renders no input at all.
function pluginsPage(doc, body, yml, id, version) {
  const group = elem(doc, 'div', 'setting-group');
  const header = elem(doc, 'div', 'setting');
  const left = elem(doc, 'div');
  left.appendChild(elem(doc, 'h3', null, yml.name + ' (' + version + ')'));
  left.appendChild(elem(doc, 'div', 'sub-heading', yml.description));
  header.appendChild(left);
  const right = elem(doc, 'div');
  right.appendChild(elem(doc, 'button', 'btn btn-secondary', 'Disable'));
  header.appendChild(right);
  group.appendChild(header);

  yml.settings.forEach((s) => {
    const row = elem(doc, 'div', 'setting');
    const box = elem(doc, 'div');
    box.appendChild(elem(doc, 'h3', null, s.key));
    box.appendChild(elem(doc, 'div', 'sub-heading', s.description || ''));
    row.appendChild(box);
    if (s.type === 'BOOLEAN') {
      const input = elem(doc, 'input');
      input.id = 'plugin-' + id + '-' + s.key;
      row.appendChild(input);
      row.appendChild(elem(doc, 'label', 'custom-control-label', ''));
    } else {
      row.id = 'plugin-' + id + '-' + s.key;
    }
    group.appendChild(row);
  });
  body.appendChild(group);
  return group;
}

// Settings → Tasks. Headed with the same plugin name and **no version**, its header row
// carrying no description of its own - and one row per task, each with an h3 and a
// `.sub-heading`, which is the description a loose anchor finds and decorates.
function tasksPage(doc, body, yml) {
  const group = elem(doc, 'div', 'setting-group');
  const header = elem(doc, 'div', 'setting');
  header.appendChild(elem(doc, 'h3', null, yml.name));
  group.appendChild(header);
  yml.tasks.forEach((t) => {
    const row = elem(doc, 'div', 'setting');
    const box = elem(doc, 'div');
    box.appendChild(elem(doc, 'h3', null, t));
    box.appendChild(elem(doc, 'div', 'sub-heading', 'What this task does.\n\nAt length.'));
    row.appendChild(box);
    row.appendChild(elem(doc, 'button', 'btn btn-secondary', t));
    group.appendChild(row);
  });
  body.appendChild(group);
  return group;
}

function load(p, build, opts) {
  const env = h.makeEnv(Object.assign({ quiet: true, respond: () => ({ data: {} }) }, opts || {}));
  h.run(env.ctx, path.join(__dirname, '..', p.dir, p.dir + '.js'));
  const group = build(env.ctx.document, env.body);
  env.tick();
  return { env, group };
}

const kids = (node, cls) => node.descendants().filter((n) => h.hasClass(n, cls));
const one = (node, cls) => kids(node, cls)[0] || null;

// ── Every plugin, on both pages ─────────────────────────────────────────────

PLUGINS.forEach((p) => {
  const yml = ymlOf(p);
  const id = p.dir;
  const src = read(p.dir, p.dir + '.js');
  const scriptVersion = (/var PLUGIN_VERSION\s*= '([^']+)'/.exec(src) || [])[1];
  const readmeUrl = (/var README_URL = '([^']+)'/.exec(src) || [])[1];

  // ── Settings → Plugins ────────────────────────────────────────────────────
  {
    const { env, group } = load(p, (doc, body) => pluginsPage(doc, body, yml, id, yml.version));
    const sub = one(group, 'sub-heading');

    h.check(p.dir + ' claims its own group on the settings page',
      h.hasClass(group, p.prefix + '-own-group'), group.className);

    const paras = kids(sub, p.prefix + '-p');
    h.check(p.dir + ' splits its description into paragraphs', paras.length > 1,
      h.plural(paras.length, 'paragraph'));
    h.check(p.dir + ' loses no text in the split',
      paras.map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').indexOf(
        yml.description.split(/\n{2,}/)[0].replace(/\s+/g, ' ')) === 0,
      paras.length ? paras[0].textContent.slice(0, 60) : '(none)');

    const toggle = one(group, p.prefix + '-desc-toggle');
    h.check(p.dir + ' puts everything after the first paragraph behind Show more',
      !!toggle && toggle.textContent === 'Show more' &&
        h.hasClass(sub, p.prefix + '-desc-collapsed'),
      (toggle && toggle.textContent) + ' / ' + sub.className);
    if (toggle) {
      toggle.click();
      h.check(p.dir + ' expands and re-collapses from the same button',
        toggle.textContent === 'Show less' && !h.hasClass(sub, p.prefix + '-desc-collapsed'),
        toggle.textContent + ' / ' + sub.className);
      toggle.click();
      h.check(p.dir + ' goes back to Show more',
        toggle.textContent === 'Show more' && h.hasClass(sub, p.prefix + '-desc-collapsed'));
    }

    const link = one(group, p.prefix + '-readme');
    h.check(p.dir + ' links its README from the group', !!link && link.href === readmeUrl,
      String(link && link.href));
    h.check(p.dir + ' puts the link under the description, not inside it',
      !!link && link.parentNode === sub.parentNode && sub.nextSibling === link,
      link ? 'parent ' + (link.parentNode === sub.parentNode) : '(no link)');

    h.check(p.dir + ' leaves Stash\'s own button in the header alone',
      group.descendants().some((n) => n.tagName === 'BUTTON' && n.textContent === 'Disable'));

    h.check(p.dir + ' says nothing about staleness when the versions agree',
      !one(group, p.prefix + '-stale'),
      String(one(group, p.prefix + '-stale') && one(group, p.prefix + '-stale').textContent));

    // Every setting row gets the hover box, where the description has something to hide.
    yml.settings.filter((s) => (s.description || '').indexOf('\n\n') !== -1).forEach((s) => {
      const row = env.body.descendants().filter((n) => h.hasClass(n, 'setting') &&
        (n.id === 'plugin-' + id + '-' + s.key ||
          n.descendants().some((k) => k.id === 'plugin-' + id + '-' + s.key)))[0];
      const rsub = row && one(row, 'sub-heading');
      h.check(p.dir + '.' + s.key + ' keeps a summary on the row and the rest in a box',
        !!rsub && h.hasClass(rsub, p.prefix + '-tipped') &&
          !!one(rsub, p.prefix + '-tip') && !!one(rsub, p.prefix + '-tipbox'),
        rsub ? rsub.className : '(no row)');
    });
    if (!yml.settings.length) {
      h.check(p.dir + ' declares no settings, so it styles no setting row',
        src.indexOf(p.prefix + '-tipbox') === -1);
    }
  }

  // ── Settings → Plugins, with the script older than the manifest ───────────
  {
    const { group } = load(p, (doc, body) => pluginsPage(doc, body, yml, id, '99.0.0'));
    const stale = one(group, p.prefix + '-stale');
    h.check(p.dir + ' warns when the page is running an older script than the manifest',
      !!stale && /99\.0\.0/.test(stale.textContent) &&
        stale.textContent.indexOf(scriptVersion) !== -1,
      String(stale && stale.textContent).slice(0, 90));
    const sub = one(group, 'sub-heading');
    h.check(p.dir + ' puts the banner above the description, where it is read first',
      !!stale && stale.nextSibling === sub, String(stale && !!stale.nextSibling));
  }

  // ── Settings → Tasks ──────────────────────────────────────────────────────
  if (yml.tasks.length) {
    const { env, group } = load(p, (doc, body) => tasksPage(doc, body, yml));
    h.check(p.dir + ' does not decorate the Tasks group, which wears the same name',
      !h.hasClass(group, p.prefix + '-own-group'), group.className);
    h.check(p.dir + ' puts no README link on the Tasks page',
      !one(group, p.prefix + '-readme'));
    h.check(p.dir + ' splits no task description into paragraphs',
      kids(group, p.prefix + '-p').length === 0,
      h.plural(kids(group, p.prefix + '-p').length, 'paragraph'));
    yml.tasks.forEach((t) => {
      h.check(p.dir + ' leaves its task button "' + t + '" intact',
        env.body.descendants().some((n) => n.tagName === 'BUTTON' && n.textContent === t));
    });
  }
});

h.finish();
