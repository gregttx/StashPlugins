// Auto Prune / Auto Roll Up on entity updates: the reactive half of
// NormalizeParentTags. What matters here is mostly what it does *not* do - react to
// its own writes, react while another plugin holds a lease, or chase a mutation
// round in a circle with a plugin that disagrees with it.
'use strict';
const h = require('./npt-harness');

// Scene 10 carries Platinum (3) and both of its implied ancestors, so Prune has
// something to remove and Roll Up has nothing to add. Scene 20 carries only
// Platinum, so it is the other way round.
const SCENES = [
  { id: '10', title: 'Ten', organized: false, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] },
  { id: '20', title: 'Twenty', organized: false, tags: [{ id: '3' }] },
];
const PERFORMERS = [
  { id: '77', name: 'Jane', tags: [{ id: '1' }, { id: '2' }] },
];

const LIB = {
  findScenes: { node: 'scenes', list: SCENES },
  findPerformers: { node: 'performers', list: PERFORMERS },
};

// `modes` replaces the auto-prune-on-scenes baseline every case starts from; since
// 4.0.0 a type carries its own mode, so a case that used to flip one of two global
// booleans names the type it is about instead. `settings` is anything else.
function boot(modes, opts, settings) {
  const o = Object.assign({
    quiet: true,
    respond: h.makeResponder(Object.assign({
      entities: LIB,
      // A case naming its own `aN` key is either writing the new string or the
      // pre-4.0.0 booleans it replaced; defaulting over the second would hide the
      // migration such a case exists to exercise.
      settings: Object.assign(
        Object.keys(settings || {}).some((k) => /^a\d/.test(k))
          ? {} : { a1AutoModes: h.autoModes(modes || { scenes: 'prune' }) },
        settings),
    }, opts || {})),
  }, {});
  const env = h.makeEnv(o);
  h.run(env.ctx);
  return env;
}

const tagQueries = (calls) => calls.filter((c) => /NPTTags/.test(c.query || ''));

  // `value` is what the auto-mode field holds; pass null for a Stash whose settings
  // inputs cannot be read at all, which is what the heading fallback is for.
  function page(value, opts) {
    opts = opts || {};
    const env = boot(opts.modes, null, opts.settings);
    const other = h.makeElement('div');
    other.className = 'setting-group';
    const otherH = h.makeElement('h3');
    otherH.textContent = 'Some Other Plugin (2.0.0)';
    other.appendChild(otherH);

    const group = h.makeElement('div');
    group.className = 'setting-group collapsible';
    const header = h.makeElement('div');
    header.className = 'setting';
    const headBox = h.makeElement('div');
    const heading = h.makeElement('h3');
    heading.textContent = 'ᝯㄝₓ Normalize Parent Tags (1.2.5)';
    headBox.appendChild(heading);
    // Stash renders the description here, as a sibling of the h3 - Inputs.tsx
    // wraps both in one div inside the .setting row.
    const sub = h.makeElement('div');
    sub.className = 'sub-heading';
    sub.textContent = 'Two library-wide tasks that normalize tag hierarchies.\n\n' +
      'BACK UP YOUR DATABASE BEFORE THE FIRST RUN - Stash has no undo.';
    headBox.appendChild(sub);
    header.appendChild(headBox);
    group.appendChild(header);

    const collapsed = h.makeElement('div');
    collapsed.className = 'collapse';
    const rows = {};
    // Each row the way Inputs.tsx builds one: an <h3> for the name and a
    // .sub-heading for the description, with the id on the input rather than the row
    // (Stash puts it on the Form.Switch, and on the text input for a STRING setting).
    // a1 carries the real warning text, because keeping that in the *visible* half is
    // the point of the split; b2 is a one-paragraph description, which is the case
    // that must be left alone.
    const descs = {
      a1AutoModes:
        'What happens by itself whenever Stash saves an entity, for each of the ' +
        'seven types: PERFORMERS=OFF, STUDIOS=OFF, GROUPS=OFF, GALLERIES=OFF, ' +
        'SCENES=OFF, IMAGES=OFF, MARKERS=OFF.' +
        '\n\nWARNING: a type set to PRUNE or ROLLUP is updated immediately, with no ' +
        'dialog, no review and no undo, and PRUNE deletes tag assignments.' +
        '\n\nThe exclusion filters below still apply.',
      b2ExcludeOrganized: 'Skips any entity whose Organized flag is set.',  // one paragraph
    };
    // The two shapes Inputs.tsx renders, which are not the same shape. A BOOLEAN goes
    // through `BooleanSetting`, which puts the id on the Form.Switch inside the row;
    // a STRING goes through `ModalSetting` -> `ChangeButtonSetting`, which puts it on
    // the **row** and renders the value in a `.value` div with an Edit button beside
    // it that opens Stash's own modal. There is no text input on the page at all.
    ['a1AutoModes', 'b2ExcludeOrganized'].forEach((k) => {
      const row = h.makeElement('div');
      row.className = 'setting';
      const text = h.makeElement('div');
      const rowH = h.makeElement('h3');
      rowH.textContent = k;
      text.appendChild(rowH);
      const rowSub = h.makeElement('div');
      rowSub.className = 'sub-heading';
      rowSub.textContent = descs[k];
      const entry = { row, h3: rowH, sub: rowSub };
      if (k === 'a1AutoModes') {
        row.id = 'plugin-NormalizeParentTags-' + k;
        const val = h.makeElement('div');
        val.className = 'value';
        const span = h.makeElement('span');
        span.textContent = value === null || value === undefined ? '' : value;
        val.appendChild(span);
        text.appendChild(val);
        text.appendChild(rowSub);
        row.appendChild(text);
        const btnBox = h.makeElement('div');
        const edit = h.makeElement('button');
        edit.textContent = 'Edit';
        btnBox.appendChild(edit);
        row.appendChild(btnBox);
        entry.value = val;
        entry.edit = edit;
      } else {
        text.appendChild(rowSub);
        row.appendChild(text);
        const input = h.makeElement('input');
        input.id = 'plugin-NormalizeParentTags-' + k;
        row.appendChild(input);
        entry.input = input;
      }
      collapsed.appendChild(row);
      rows[k] = entry;
    });
    group.appendChild(collapsed);

    env.ctx.document.body.appendChild(other);
    env.ctx.document.body.appendChild(group);
    return { env, group, other, collapsed, rows, headBox, sub };
  }


Promise.resolve()

  // ── The basic reaction, both directions ───────────────────────────────────
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a scene save triggers one bulk write', bulks.length === 1,
          'got ' + bulks.length);
        h.check('it is a REMOVE delta on the saved scene',
          bulks[0].variables.input.tag_ids.mode === 'REMOVE' &&
          bulks[0].variables.input.ids.join() === '10');
        h.check('it removes both implied ancestors, not the leaf',
          bulks[0].variables.input.tag_ids.ids.slice().sort().join() === '1,2');
      });
  })

  .then(() => {
    const env = boot({ scenes: 'rollup' });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('auto roll up adds instead', bulks.length === 1 &&
          bulks[0].variables.input.tag_ids.mode === 'ADD');
        h.check('it adds every ancestor of Platinum',
          bulks[0].variables.input.tag_ids.ids.slice().sort().join() === '1,2,6');
      });
  })

  // The console lines are the dialog's lines with no dialog around them, so the
  // notation has to be explained out here too - once per page, ahead of the first
  // line that uses it, and not again on every entity the mode reacts to.
  .then(() => {
    const info = [];
    const env = h.makeEnv({
      quiet: true,
      respond: h.makeResponder({
        entities: LIB,
        settings: { a1AutoModes: h.autoModes({ scenes: 'rollup' }) },
      }),
    });
    env.ctx.console = { log() {}, info: (m) => info.push(m), warn() {}, error() {} };
    h.run(env.ctx);
    const legends = () => info.filter((l) => l.indexOf('brackets') !== -1);
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('the first auto write says the brackets hold a id',
          legends().length === 1 && legends()[0].indexOf('id') !== -1, info.join(' | '));
        h.check('and it comes before the line it explains',
          info.indexOf(legends()[0]) <
          info.findIndex((l) => l.indexOf('Scene "Ten" (10)') !== -1), info.join(' | '));
        return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' }).then(() => h.flush());
      })
      .then(() => {
        h.check('a second reaction does not repeat it',
          h.bulkCalls(env.calls).length === 2 && legends().length === 1, info.join(' | '));
      });
  })

  // A scene that is already normalized costs a read and no write.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' })
      .then(() => h.flush()).then(() => {
        h.check('nothing to prune writes nothing', h.bulkCalls(env.calls).length === 0);
      });
  })

  // ── The settings gates ────────────────────────────────────────────────────
  .then(() => {
    const env = boot({});
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('every type OFF writes nothing', h.bulkCalls(env.calls).length === 0);
        h.check('and never loads the tag hierarchy', tagQueries(env.calls).length === 0);
      });
  })

  // A type's mode is its own: another type being set says nothing about this one.
  .then(() => {
    const env = boot({ images: 'prune' });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('a mode set for another type writes nothing',
          h.bulkCalls(env.calls).length === 0);
      });
  })

  // The pre-4.0.0 settings, migrated on the way in: an install that has not been
  // touched since 3.2.0 must still react exactly as it did.
  .then(() => {
    const env = boot(null, null, { a5EnableScenes: true, a8AutoPruneOnUpdate: true });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a pre-4.0.0 install still prunes what it was set to prune',
          bulks.length === 1 && bulks[0].variables.input.tag_ids.mode === 'REMOVE',
          'got ' + bulks.length);
        const saved = env.calls.filter((c) => /configurePlugin/.test(c.query || ''));
        h.check('and the migrated string is written back once, in canonical form',
          saved.length === 1 &&
          saved[0].variables.input.a1AutoModes === h.autoModes({ scenes: 'prune' }),
          JSON.stringify(saved.map((c) => c.variables.input)));
      });
  })

  .then(() => {
    const env = boot({ scenes: 'prune', performers: 'prune' });
    return h.entityUpdate(env.ctx, 'performerUpdate', { id: '77' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('an enabled one is', bulks.length === 1 &&
          /bulkPerformerUpdate/.test(bulks[0].query));
      });
  })

  // ── Bulk mutations ────────────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'bulkSceneUpdate', { ids: ['10', '20'] })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a bulk edit is reacted to as one write', bulks.length === 1);
        h.check('and covers only the entity that needed changing',
          bulks[0].variables.input.ids.join() === '10');
      });
  })

  // ── Not reacting to ourselves ─────────────────────────────────────────────
  //
  // Our own write is a bulkSceneUpdate, which is exactly what the wrapper watches
  // for. Two independent things stop it cascading, and on this path they overlap:
  // _writeDepth excludes the write outright, and the cooldown would drop it anyway
  // because a self-reaction always targets ids we marked a moment earlier. So this
  // asserts the outcome, not the mechanism - _writeDepth is isolated further down,
  // by the task-apply case, where nothing marks a cooldown.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush(120)).then(() => {
        h.check('an auto write does not cascade into another one',
          h.bulkCalls(env.calls).length === 1,
          'got ' + h.bulkCalls(env.calls).length);
      });
  })

  // The cooldown is the backstop for a plugin that does not honour the lease and
  // writes the tags straight back. One round, then we leave it alone.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' }))
      .then(() => h.flush()).then(() => {
        h.check('a second update to the same entity is inside the cooldown',
          h.bulkCalls(env.calls).length === 1,
          'got ' + h.bulkCalls(env.calls).length);
      });
  })

  // An entity we planned nothing for was never written, so it is not on cooldown:
  // a later edit that does make it redundant must still be caught.
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' }))
      .then(() => h.flush()).then(() => {
        h.check('an entity we did not write to is not on cooldown',
          h.bulkCalls(env.calls).length === 1);
      });
  })

  // ── Standing down ─────────────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    env.ctx.window.StashPluginCoop.leases.push({
      owner: 'SomeoneElse', label: 'bulk thing', until: Date.now() + 60000,
    });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('a live lease stands auto mode down', h.bulkCalls(env.calls).length === 0);
      });
  })

  .then(() => {
    const env = boot();
    env.ctx.window.StashPluginCoop.leases.push({
      owner: 'SomeoneElse', label: 'bulk thing', until: Date.now() - 1,
    });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('an expired lease does not', h.bulkCalls(env.calls).length === 1);
      });
  })

  .then(() => {
    const env = boot();
    h.check('the plugin registers as a lease respecter',
      env.ctx.window.StashPluginCoop.respecters.NormalizeParentTags === true);
    return null;
  })

  // A lease is taken while it writes, so a reactive sibling stands down for us.
  .then(() => {
    const env = boot();
    let heldDuringWrite = false;
    const spy = h.makeResponder({
      entities: LIB,
      settings: { a5EnableScenes: true, a8AutoPruneOnUpdate: true },
    });
    const env2 = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        if (/mutation NPT_bulk/.test(req.query || '')) {
          heldDuringWrite = env2.ctx.window.StashPluginCoop.leases.length > 0;
        }
        return spy(req, calls);
      },
    });
    h.run(env2.ctx);
    return h.entityUpdate(env2.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('a lease is held while auto mode writes', heldDuringWrite);
        h.check('and released afterwards',
          env2.ctx.window.StashPluginCoop.leases.length === 0);
        return env;
      });
  })

  // ── A rejected save is not a save ─────────────────────────────────────────
  .then(() => {
    const env = h.makeEnv({
      quiet: true,
      respond: (req) => {
        // The user's own mutation comes back with GraphQL errors at HTTP 200 -
        // "the request came back" is not "the edit was saved".
        if (/mutation Stash_/.test(req.query || '')) return { errors: [{ message: 'nope' }] };
        return h.makeResponder({
          entities: LIB,
          settings: { a5EnableScenes: true, a8AutoPruneOnUpdate: true },
        })(req);
      },
    });
    h.run(env.ctx);
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('a rejected save is not reacted to', h.bulkCalls(env.calls).length === 0);
      });
  })

  // ── The exclusion filters still apply ─────────────────────────────────────
  .then(() => {
    const env = boot(null, null, { c3ExcludeRemoveTagNameContains: 'Hair' });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a protected tag is not removed by auto mode',
          bulks.length === 1 && bulks[0].variables.input.tag_ids.ids.join() === '2');
      });
  })

  .then(() => {
    const env = boot(null, {
      entities: {
        findScenes: {
          node: 'scenes',
          list: [{ id: '10', title: 'Ten', organized: true, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }],
        },
      },
    }, { b2ExcludeOrganized: true });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('an organized entity is skipped', h.bulkCalls(env.calls).length === 0);
      });
  })

  // A configured exclusion tag that matches nothing stops auto mode rather than
  // letting it run unfiltered over the entities it was meant to protect.
  .then(() => {
    const env = boot(null, null, { b1ExcludeEntityWithTagName: 'No Such Tag' });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('an unresolvable exclusion tag stops auto mode',
          h.bulkCalls(env.calls).length === 0);
      });
  })

  // ── The task and auto mode in one tab ─────────────────────────────────────
  //
  // Phase 2 writes bulk*Update for every batch. With Auto Prune on, an unguarded
  // apply re-plans each batch it has just written.
  .then(() => {
    const env = boot();
    h.startTask(env.ctx, h.TASK_PRUNE);
    return h.flush().then(() => {
      const d = h.dialog(env.body);
      d.button('Proceed').click();
      return h.flush(120).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('the task apply is not reacted to by auto mode', bulks.length === 1,
          'got ' + bulks.length);
      });
    });
  })

  // ── The tag graph cache ───────────────────────────────────────────────────
  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '30' }))
      .then(() => h.flush()).then(() => {
        h.check('the tag hierarchy is fetched once and cached',
          tagQueries(env.calls).length === 1, 'got ' + tagQueries(env.calls).length);
      });
  })

  .then(() => {
    const env = boot();
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'tagUpdate', { id: '1' }))
      .then(() => h.flush())
      .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '30' }))
      .then(() => h.flush()).then(() => {
        h.check('a tag mutation invalidates it',
          tagQueries(env.calls).length === 2, 'got ' + tagQueries(env.calls).length);
      });
  })

  // ── A settings save reaches auto mode at once ─────────────────────────────
  //
  // Settings are cached for AUTO_SETTINGS_TTL_MS, so without invalidating on our own
  // configurePlugin, enabling a mode and immediately saving an entity would still be
  // governed by the old settings for up to ten seconds.
  .then(() => {
    let prune = false;
    const inner = h.makeResponder({ entities: LIB, settings: { a1AutoModes: h.autoModes({}) } });
    const env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        if ((req.query || '').indexOf('configuration') !== -1) {
          return { data: { configuration: { plugins: { NormalizeParentTags: {
            a1AutoModes: h.autoModes(prune ? { scenes: 'prune' } : {}) } } } } };
        }
        return inner(req, calls);
      },
    });
    h.run(env.ctx);
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('with the mode off, a save is not acted on',
          h.bulkCalls(env.calls).length === 0);
        prune = true;   // the user ticks Auto Prune; Stash saves it
        return env.ctx.window.fetch('/graphql', {
          body: JSON.stringify({
            query: 'mutation ConfigurePlugin($plugin_id: ID!, $input: Map!) { configurePlugin(plugin_id: $plugin_id, input: $input) }',
            variables: { plugin_id: 'NormalizeParentTags', input: { a8AutoPruneOnUpdate: true } },
          }),
        }).then(() => h.flush())
          .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' }))
          .then(() => h.flush()).then(() => {
            h.check('after saving settings the very next save is acted on',
              h.bulkCalls(env.calls).length === 1,
              'got ' + h.bulkCalls(env.calls).length);
          });
      });
  })

  // Another plugin's settings save is nothing to do with us: our cache must survive
  // it. Proven by the *next* reaction still being served from cache - scene 20 is
  // used because scene 10 would be inside the write cooldown and never get that far.
  .then(() => {
    const env = boot();
    const settingsReads = () => env.calls.filter((c) => /configuration/.test(c.query || '')).length;
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' })
      .then(() => h.flush()).then(() => {
        const before = settingsReads();
        h.check('the first reaction reads settings once', before === 1, 'got ' + before);
        return env.ctx.window.fetch('/graphql', {
          body: JSON.stringify({
            query: 'mutation ConfigurePlugin($plugin_id: ID!, $input: Map!) { configurePlugin(plugin_id: $plugin_id, input: $input) }',
            variables: { plugin_id: 'SomeOtherPlugin', input: {} },
          }),
        }).then(() => h.flush())
          .then(() => h.entityUpdate(env.ctx, 'sceneUpdate', { id: '20' }))
          .then(() => h.flush()).then(() => {
            h.check('another plugin being configured leaves our cache alone',
              settingsReads() === before, before + ' -> ' + settingsReads());
          });
      });
  })

  // ── Renormalizing the auto-mode setting ───────────────────────────────────
  //
  // The setting is one line of text and anything may have written it - Stash own
  // raw-text modal, a config file, an older release - so the parse is forgiving; what
  // gets stored is not. The plugin writes back what it understood, in canonical form.
  //
  // Up to 3.2.0 this section held a notice for the one configuration the old settings
  // could express and the plugin could not honour: both auto modes ticked at once,
  // which ran neither. A tri-state per type cannot say that, so there is nothing left
  // to warn about.
  //
  // The DOM mirrors what Stash builds, which for a STRING setting is a row carrying
  // the id, a `.value` div and an Edit button - not a text input:
  //
  //   <div class="setting-group collapsible">
  //     <div class="setting"><div><h3>ᝯㄝₓ Normalize Parent Tags (1.2.5)</h3></div></div>
  //     <div class="collapse">
  //       <div class="setting" id="plugin-NormalizeParentTags-a1AutoModes">
  //         <div><h3>..</h3><div class="value"><span>RAW</span></div>
  //              <div class="sub-heading">..</div></div>
  //         <div><button>Edit</button></div>
  //       </div>
  //     </div>
  //   </div>

  .then(() => {
    const RAW = 'scene=prune;  IMAGES = roll up | markers=off';
    const a = page(RAW, { settings: { a1AutoModes: RAW } });
    const saves = () => a.env.calls.filter((c) => /configurePlugin/.test(c.query || ''));
    a.env.tick();
    return h.flush().then(() => {
      h.check('a hand-edited field is rewritten in canonical form', saves().length === 1 &&
        saves()[0].variables.input.a1AutoModes ===
          h.autoModes({ scenes: 'prune', images: 'rollup' }),
        JSON.stringify(saves().map((c) => c.variables.input)));
      h.check('and it is our own plugin id it is saved under',
        saves()[0].variables.plugin_id === 'NormalizeParentTags');
      a.env.tick();
      return h.flush().then(() => {
        h.check('a second tick over the same text does not write again',
          saves().length === 1, 'got ' + saves().length);
      });
    });
  })

  // The setting row, taken over by the dialog that edits it (4.5.0). Stash renders a
  // STRING setting as a value plus an Edit button that opens its own raw-text modal;
  // both halves are replaced, and the heading and description around them are left
  // exactly as they are - 4.4.0 read the row as though it were a text input and hid
  // the lot.
  .then(() => {
    const p1 = page(h.autoModes({ scenes: 'prune' }), { modes: { scenes: 'prune' } });
    p1.env.tick();
    return h.flush().then(() => {
      const r = p1.rows.a1AutoModes;
      const line = p1.env.ctx.document.getElementById('npt-modes-line');
      const btn = p1.env.ctx.document.getElementById('npt-modes-button');
      h.check('our line replaces the raw value, beside it rather than inside it',
        !!line && line.parentNode === r.value.parentNode && r.value.style.display === 'none',
        String(!!line) + '/' + r.value.style.display);
      h.check('and the heading and description stay where Stash put them',
        r.h3.parentNode === r.value.parentNode && r.sub.parentNode === r.value.parentNode);
      // Words rather than tokens: this is a value being read, not one being typed.
      h.check('the value reads in capitalized words',
        line.textContent === 'Performers=Off, Studios=Off, Groups=Off, Galleries=Off, ' +
          'Scenes=Prune, Images=Off, Scene Markers=Off', line.textContent);
      const amber = line.descendants()
        .filter((n) => h.hasClass(n, 'npt-modestring-on')).map((n) => n.textContent);
      h.check('with the armed type marked and the bar on the row',
        amber.join(',') === 'Scenes=Prune' && h.hasClass(r.row, 'npt-armed'),
        amber.join(',') + ' / ' + r.row.className);
      h.check('Stash Edit button is hidden and ours takes its slot, teal',
        r.edit.style.display === 'none' && btn.parentNode === r.edit.parentNode &&
        btn.textContent === 'Auto Mode Settings...' && h.hasClass(btn, 'btn-info'),
        r.edit.style.display + ' / ' + btn.className);
      btn.click();
      return h.flush().then(() => {
        h.check('pressing it opens our dialog rather than Stash raw-text modal',
          h.dialog(p1.env.ctx.document.body).open);
        p1.env.tick();
        return h.flush().then(() => {
          const lines = p1.env.ctx.document.body.descendants()
            .filter((n) => n.id === 'npt-modes-line');
          h.check('and the tick that follows leaves exactly one line and one button',
            lines.length === 1 && p1.env.ctx.document.body.descendants()
              .filter((n) => n.id === 'npt-modes-button').length === 1,
            String(lines.length));
        });
      });
    });
  })

  .then(() => {
    const p2 = page(h.autoModes({}), { modes: {} });
    p2.env.tick();
    return h.flush().then(() => {
      const line = p2.env.ctx.document.getElementById('npt-modes-line');
      h.check('an all-Off setting marks nothing and wears no bar',
        !line.descendants().some((n) => h.hasClass(n, 'npt-modestring-on')) &&
        !h.hasClass(p2.rows.a1AutoModes.row, 'npt-armed'),
        p2.rows.a1AutoModes.row.className);
    });
  })

  // The value is still normalized, but from the settings rather than from a field:
  // Stash own modal is still reachable if ours never builds, and a config file can
  // hold anything. A canonical value is left alone, and an empty one means "nothing
  // configured" - writing seven OFFs into it would be the plugin saving settings for
  // someone who has only looked at the page.
  .then(() => {
    const a = page(h.autoModes({ scenes: 'prune' }), { modes: { scenes: 'prune' } });
    a.env.tick();
    return h.flush().then(() => {
      h.check('a canonical setting is left alone',
        !a.env.calls.some((c) => /configurePlugin/.test(c.query || '')),
        a.env.calls.map((c) => c.query).join(' | '));

      const b = page('scenes=prune', { settings: { a1AutoModes: 'scenes=prune' } });
      b.env.tick();
      return h.flush().then(() => {
        const w = b.env.calls.filter((c) => /configurePlugin/.test(c.query || ''));
        h.check('a hand-written one is rewritten in canonical form once',
          w.length === 1 &&
          w[0].variables.input.a1AutoModes === h.autoModes({ scenes: 'prune' }),
          w.length + ' / ' + (w[0] && w[0].variables.input.a1AutoModes));
        b.env.tick();
        return h.flush().then(() => {
          h.check('and not again on the next tick',
            b.env.calls.filter((c) => /configurePlugin/.test(c.query || '')).length === 1,
            String(b.env.calls.filter((c) => /configurePlugin/.test(c.query || '')).length));
        });
      });
    });
  })

  .then(() => {
    const a = page('   ', { settings: { a1AutoModes: '   ' } });
    a.env.tick();
    return h.flush().then(() => {
      h.check('an empty setting is not filled in',
        !a.env.calls.some((c) => /configurePlugin/.test(c.query || '')),
        a.env.calls.map((c) => c.query).join(' | '));
    });
  })

  // Our settings are not on the page: nothing rendered, and no settings query -
  // finding them is what stands in for a route test.
  .then(() => {
    const env = boot({ scenes: 'rollup' });
    const stranger = h.makeElement('div');
    stranger.className = 'setting-group';
    const input = h.makeElement('input');
    input.id = 'plugin-SomeOtherPlugin-a1Whatever';
    stranger.appendChild(input);
    env.ctx.document.body.appendChild(stranger);
    const before = env.calls.length;
    env.tick();
    return h.flush().then(() => {
      h.check('nothing is injected where our settings are not rendered',
        !env.ctx.document.getElementById('npt-readme-link'));
      h.check('and no settings query is issued there',
        env.calls.length === before, 'issued ' + (env.calls.length - before));
    });
  })

  // Fallback for a Stash that sets no ids at all: match the group heading. Each
  // string is one Stash template's exact output. The README link is the signal now -
  // it is what `ownSettingGroup` puts in a group it has found.
  .then(() => {
    function headingOnly(text) {
      const env = boot({ scenes: 'rollup' });
      const group = h.makeElement('div');
      const heading = h.makeElement('h3');
      heading.textContent = text;
      group.appendChild(heading);
      env.ctx.document.body.appendChild(group);
      env.tick();
      return h.flush().then(() => !!env.ctx.document.getElementById('npt-readme-link'));
    }
    return Promise.all([
      headingOnly('ᝯㄝₓ Normalize Parent Tags (1.2.5)'),
      headingOnly('ᝯㄝₓ Normalize Parent Tags'),
      headingOnly('ᝯㄝₓ Normalize Parent Tags undefined'),
      headingOnly('ᝯㄝₓ Normalize Parent Tags Extra'),
      headingOnly('Some Other Plugin (1.0.0)'),
    ]).then(([withVersion, plain, noVersion, namesake, other]) => {
      h.check('heading fallback: the versioned form is matched', withVersion);
      h.check('heading fallback: the bare name too (the tasks page form)', plain);
      h.check('heading fallback: and the "undefined" Stash renders with no version', noVersion);
      h.check('heading fallback: a near-namesake plugin is not', !namesake);
      h.check('heading fallback: nor an unrelated one', !other);
    });
  })

  // Settings - Tasks heads its own group with the same name, and that group is not
  // the settings one: it holds the task buttons and no settings, so the fallback must
  // not decorate it with a README link and a split description.
  .then(() => {
    const env = boot({ scenes: 'rollup' });
    const group = h.makeElement('div');
    group.className = 'setting-group';
    const heading = h.makeElement('h3');
    heading.textContent = 'ᝯㄝₓ Normalize Parent Tags';
    group.appendChild(heading);
    const row = h.makeElement('div');
    row.className = 'setting';
    const btn = h.makeElement('button');
    btn.textContent = h.TASK_RUN;
    row.appendChild(btn);
    group.appendChild(row);
    env.ctx.document.body.appendChild(group);
    env.tick();
    return h.flush().then(() => {
      h.check('heading fallback: the tasks page group is left to its buttons',
        !env.ctx.document.getElementById('npt-readme-link') &&
        !h.hasClass(group, 'npt-own-group'), group.className);
      // The buttons on it are still ours to paint, which is a different question and
      // a different function.
      h.check('and the task button on it is still repainted',
        h.hasClass(btn, 'btn-warning'), btn.className);
    });
  })

  // ── The README link ──────────────────────────────────────────────────────
  //
  // Stash's own link for `url:` is an unlabelled chain icon in the header and is
  // easy to miss; the description cannot carry an <a> because Stash passes it to
  // React as a child. So the plugin puts a labelled one in its own group.
  .then(() => {
    const p = page(h.autoModes({ scenes: 'prune' }));
    p.env.tick();
    return h.flush().then(() => {
      const link = p.env.ctx.document.getElementById('npt-readme-link');
      h.check('a labelled README link is injected', !!link);
      // Stash's .sub-heading collapses newlines, so the description's paragraphs are
      // only visible if our own group carries the class the injected CSS scopes to.
      h.check('the group is marked so the description can keep its line breaks',
        h.hasClass(p.group, 'npt-own-group'), p.group.className);
      const css = (p.env.ctx.document.getElementById('npt-style') || {}).textContent || '';
      // Present, and scoped: reflowing every plugin's description would be reaching
      // into panels that are not ours and may have been written for the collapse.
      const subRules = css.split('}').filter((r) => r.indexOf('sub-heading') !== -1);
      h.check('and the stylesheet says how, every rule scoped to that class',
        subRules.length > 0 && subRules.every((r) => r.indexOf('.npt-own-group ') === 0),
        subRules.join(' | '));
      h.check('with pre-wrap for an unsplit description and a margin for a split one',
        subRules.some((r) => r.indexOf('white-space:pre-wrap') !== -1) &&
        subRules.some((r) => /\.npt-p\{margin:0 0 \.35em;/.test(r)), subRules.join(' | '));

      // Elements, because a blank line under pre-wrap is always a whole line-height
      // and nothing can target it. The blank lines go; the margin is the gap.
      const paras = p.sub.childNodes.filter((n) => h.hasClass(n, 'npt-p'));
      h.check('the description is rebuilt as paragraph elements',
        paras.length === 2 && paras.every((n) => h.hasClass(n, 'npt-p')),
        String(paras.length) + ' paragraphs');
      h.check('and no blank line survives the split',
        paras.every((n) => n.textContent.trim() && n.textContent.indexOf('\n') === -1),
        paras.map((n) => JSON.stringify(n.textContent.slice(0, 20))).join(' | '));
      h.check('with the file name as its text',
        !!link && link.textContent === 'NormalizeParentTags/README.md', link && link.textContent);
      h.check('and a pinned https URL, opened in a new tab',
        !!link && /^https:\/\/github\.com\/.*\/NormalizeParentTags\/README\.md$/.test(link.href) &&
        link.target === '_blank', link && link.href);
      // Under the description, inside the header - so outside the Collapse, and
      // therefore visible whether or not the group is expanded.
      h.check('it sits directly under the description',
        !!link && link.parentNode === p.headBox &&
        p.headBox.childNodes.indexOf(link) === p.headBox.childNodes.indexOf(p.sub) + 1,
        link && String(p.headBox.childNodes.indexOf(link)));

      // The stale-script banner, in the same header. This plugin finds its group by
      // setting id rather than by heading text, so the check that matters here is
      // that it still reads the version off *our* heading: the fixture also mounts
      // "Some Other Plugin (2.0.0)", and reading that one would compare this script
      // against a stranger's release.
      const stale = p.env.ctx.document.getElementById('npt-stale-notice');
      h.check('a stale script is called out in the settings group', !!stale,
        stale && stale.textContent);
      h.check('with the version from our own heading, not the other plugin\'s',
        !!stale && /1\.2\.5/.test(stale.textContent) && !/2\.0\.0/.test(stale.textContent),
        stale && stale.textContent);
      h.check('and it names the key that fixes it',
        !!stale && /Ctrl\+Shift\+R/.test(stale.textContent), stale && stale.textContent);
      h.check('above the description, in the header that survives the collapse',
        !!stale && stale.parentNode === p.headBox &&
        p.headBox.childNodes.indexOf(stale) < p.headBox.childNodes.indexOf(p.sub),
        stale && String(p.headBox.childNodes.indexOf(stale)));

      // React drops anything we add whenever it re-renders the panel, so the tick
      // re-adds it - and must not end up with two.
      p.env.tick();
      p.env.tick();
      return h.flush().then(() => {
        const links = p.env.ctx.document.body.descendants()
          .filter((n) => n.id === 'npt-readme-link');
        h.check('ticking again does not add a second one', links.length === 1, String(links.length));
        h.check('nor a second stale banner', p.env.ctx.document.body.descendants()
          .filter((n) => n.id === 'npt-stale-notice').length === 1);
        links[0].parentNode.removeChild(links[0]);
        p.sub.textContent = 'One.\n\nTwo.';        // what a React re-render leaves
        p.env.tick();
        return h.flush().then(() => {
          h.check('and a re-render that drops it gets it back',
            !!p.env.ctx.document.getElementById('npt-readme-link'));
          h.check('and the description is re-split too',
            p.sub.childNodes.filter((n) => h.hasClass(n, 'npt-p')).length === 2,
            String(p.sub.childNodes.length));
        });
      });
    });
  })

  // ── 1.7.0: the description collapses, the settings hover ──────────────────
  //
  // The group description lives in the group header, outside the <Collapse>, so
  // per-plugin collapse never shortens it. Only hiding paragraphs does.
  .then(() => {
    const p = page(h.autoModes({ scenes: 'prune' }));
    p.env.tick();
    return h.flush().then(() => {
      const doc = p.env.ctx.document;
      const toggle = doc.getElementById('npt-desc-toggle');
      h.check('a multi-paragraph description gets a Show more toggle', !!toggle);
      h.check('and starts collapsed', h.hasClass(p.sub, 'npt-desc-collapsed'), p.sub.className);
      // A <span> here would fold the whole group on click: SettingGroup's onDivClick
      // walks up from the event target and returns early only for `a` and `button`.
      h.check('the toggle is a button, so clicking it cannot fold the group',
        !!toggle && String(toggle.tagName).toLowerCase() === 'button', toggle && toggle.tagName);
      h.check('and it is inside the description, after the paragraphs',
        !!toggle && toggle.parentNode === p.sub &&
        p.sub.childNodes.indexOf(toggle) === p.sub.childNodes.length - 1);

      if (toggle) toggle.click();
      h.check('clicking it expands the description',
        !h.hasClass(p.sub, 'npt-desc-collapsed'), p.sub.className);
      h.check('and the caption flips',
        !!toggle && toggle.textContent === 'Show less', toggle && toggle.textContent);
      if (toggle) toggle.click();
      h.check('clicking again collapses it', h.hasClass(p.sub, 'npt-desc-collapsed'));
      h.check('and the caption flips back',
        !!toggle && toggle.textContent === 'Show more', toggle && toggle.textContent);

      // The CSS has to actually hide them, or the toggle is decoration.
      const css = (doc.getElementById('npt-style') || {}).textContent || '';
      h.check('and the stylesheet hides every paragraph but the first',
        css.indexOf('.npt-desc-collapsed .npt-p:not(:first-child){display:none;}') !== -1);

      p.env.tick();
      p.env.tick();
      return h.flush().then(() => {
        const toggles = doc.body.descendants().filter((n) => n.id === 'npt-desc-toggle');
        h.check('ticking again does not add a second toggle',
          toggles.length === 1, String(toggles.length));
      });
    });
  })

  // Per-setting: first paragraph on the page, the rest on hover.
  .then(() => {
    const p = page(h.autoModes({ scenes: 'prune' }));
    p.env.tick();
    return h.flush().then(() => {
      const a8 = p.rows.a1AutoModes;
      const kids = a8.sub.childNodes;
      const summary = kids.filter((n) => h.hasClass(n, 'npt-sum'))[0];
      const mark = kids.filter((n) => h.hasClass(n, 'npt-tip'))[0];
      const box = kids.filter((n) => h.hasClass(n, 'npt-tipbox'))[0];
      h.check('a two-paragraph setting description keeps only its first paragraph', !!summary);
      h.check('and grows a hover mark for the rest', !!mark, a8.sub.textContent);
      // Built, not borrowed: a native `title` opens below-right of the pointer, in a
      // size CSS cannot reach, under the arrow that summoned it.
      h.check('the detail is an element, so it can be positioned and sized', !!box);
      h.check('the mark carries no native title that would double up with it',
        !!mark && !mark.title, mark && mark.title);
      h.check('and the mark is focusable, so the box is reachable without a mouse',
        !!mark && mark.tabIndex === 0, mark && String(mark.tabIndex));
      // Hover and keyboard focus both open it, on the mark and on the name alike.
      h.fire(mark, 'mouseenter');
      h.check('hovering the mark opens the box',
        h.hasClass(a8.sub, 'npt-tip-open'), a8.sub.className);
      h.fire(mark, 'mouseleave');
      h.check('and leaving closes it', !h.hasClass(a8.sub, 'npt-tip-open'));
      h.fire(mark, 'focus');
      h.check('focusing it opens the box too', h.hasClass(a8.sub, 'npt-tip-open'));
      h.fire(mark, 'blur');
      // The mark is a small target for something every row now hides half its text
      // behind, so the visible summary opens it as well.
      h.fire(summary, 'mouseenter');
      h.check('hovering the summary text opens it too',
        h.hasClass(a8.sub, 'npt-tip-open'), a8.sub.className);
      h.fire(summary, 'mouseleave');
      h.check('and that closes on the way out too', !h.hasClass(a8.sub, 'npt-tip-open'));
      h.check('the row is the positioning context, so a long summary cannot push the box off the panel',
        h.hasClass(a8.sub, 'npt-tipped'), a8.sub.className);

      // The auto-mode warning lives in the tooltip by explicit request (1.7.5); it
      // used to be pinned to the visible half. What still has to hold is that the
      // summary is only the mechanical description and the warning is intact
      // somewhere - a split that dropped it would pass a laxer check.
      h.check('the summary is the plain description, without the warning',
        !!summary && summary.textContent.indexOf('WARNING') === -1 &&
        /MARKERS=OFF\.$/.test(summary.textContent), summary && summary.textContent);
      h.check('and the warning is intact in the tooltip, ahead of the filter note',
        !!box && box.textContent.indexOf(
          'WARNING: a type set to PRUNE or ROLLUP is updated immediately, with no ' +
          'dialog, no review and no undo, and PRUNE deletes tag assignments.') === 0 &&
        box.textContent.indexOf('The exclusion filters below still apply') !== -1,
        box && box.textContent);
      // Stash's own slot for this, left empty for plugin settings by
      // SettingsPluginsPanel - there is no tooltip field on PluginSetting to declare.
      // One row, one tooltip. The name used to carry a plain `title`, so hovering it
      // showed the same words in the small browser tooltip the box exists to replace.
      h.check('the setting name has no native title of its own', !a8.h3.title, a8.h3.title);
      h.fire(a8.h3, 'mouseenter');
      h.check('and hovering it opens the very same box',
        h.hasClass(a8.sub, 'npt-tip-open'), a8.sub.className);
      h.fire(a8.h3, 'mouseleave');
      h.check('which closes again on the way out', !h.hasClass(a8.sub, 'npt-tip-open'));
      // Opened from the name the box lands over the h3, so a box that took the
      // pointer would close, hand it back, and reopen for as long as it was hovered.
      const css2 = (p.env.ctx.document.getElementById('npt-style') || {}).textContent || '';
      h.check('and the box never takes the pointer, so it cannot flicker',
        /\.npt-tipbox\{[^}]*pointer-events:none/.test(css2));

      // One paragraph has nothing to hide, so it must not sprout a mark that opens
      // on a hover to say what is already on the line.
      const a9 = p.rows.b2ExcludeOrganized;
      h.check('a one-paragraph description is left alone',
        a9.sub.childNodes.filter((n) => h.hasClass(n, 'npt-tip')).length === 0 &&
        a9.sub.textContent === 'Skips any entity whose Organized flag is set.', a9.sub.textContent);
      h.check('and its name opens nothing', !a9.h3.title &&
        (h.fire(a9.h3, 'mouseenter'), !h.hasClass(a9.sub, 'npt-tip-open')), a9.sub.className);

      p.env.tick();
      p.env.tick();
      return h.flush().then(() => {
        h.check('ticking again does not add a second mark',
          a8.sub.childNodes.filter((n) => h.hasClass(n, 'npt-tip')).length === 1,
          String(a8.sub.childNodes.length));
        // What a React re-render leaves behind: the original text node, again.
        a8.sub.textContent = 'Head.\n\nTail one.\n\nTail two.';
        p.env.tick();
        return h.flush().then(() => {
          const b = a8.sub.childNodes.filter((n) => h.hasClass(n, 'npt-tipbox'))[0];
          h.check('a re-render that drops it gets it back', !!b);
          // The <h3> is Stash's element and survives the re-renders that replace
          // everything we put in the row, so re-wiring it every rebuild would stack
          // a fresh pair of listeners on it each time.
          h.check('and the name is not wired a second time',
            (a8.h3.handlers.mouseenter || []).length === 1,
            String((a8.h3.handlers.mouseenter || []).length));
          // white-space:pre-wrap on the box honours them, and three paragraphs run
          // together read worse than the wall this replaces.
          h.check('and further paragraphs stay paragraphs in the tooltip',
            !!b && b.textContent === 'Tail one.\n\nTail two.', b && JSON.stringify(b.textContent));
        });
      });
    });
  })

  // Another plugin's group is not ours to write into, and off the settings page
  // there is nothing to find at all.
  .then(() => {
    const env = boot();
    const stranger = h.makeElement('div');
    stranger.className = 'setting-group';
    const row = h.makeElement('div');
    row.className = 'setting';
    const input = h.makeElement('input');
    input.id = 'plugin-SomeOtherPlugin-a1Whatever';
    row.appendChild(input);
    stranger.appendChild(row);
    env.ctx.document.body.appendChild(stranger);
    env.tick();
    return h.flush().then(() => {
      h.check('no link in another plugin group',
        !env.ctx.document.getElementById('npt-readme-link'));
      h.check('and none anywhere off the settings page',
        env.ctx.document.body.descendants().every((n) => n.tagName !== 'A'));
    });
  })

  .then(() => h.finish(), (e) => { console.error(e); process.exit(1); });
