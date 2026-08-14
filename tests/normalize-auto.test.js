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

// `settings` is merged over the auto-prune-on-scenes baseline every case starts from.
function boot(settings, opts) {
  const o = Object.assign({
    quiet: true,
    respond: h.makeResponder(Object.assign({
      entities: LIB,
      settings: Object.assign({ a5EnableScenes: true, a8AutoPruneOnUpdate: true }, settings),
    }, opts || {})),
  }, {});
  const env = h.makeEnv(o);
  h.run(env.ctx);
  return env;
}

const tagQueries = (calls) => calls.filter((c) => /NPTTags/.test(c.query || ''));

  // `checks` sets the two checkboxes; pass null for a Stash whose settings inputs
  // cannot be read, which is the only case that falls back to querying the server.
  function page(checks, opts) {
    opts = opts || {};
    const env = boot(opts.settings);
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
    heading.textContent = 'GTTx Normalize Parent Tags (1.2.5)';
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
    // (Stash puts it on the Form.Switch). a8 carries the real warning text, because
    // keeping that in the *visible* half is the point of the split.
    const descs = {
      a8AutoPruneOnUpdate:
        'Whenever Stash saves an entity of an enabled type above, immediately remove ' +
        'any tag on it that another tag on the same entity already implies.' +
        '\n\nWARNING: Updates immediately, with no dialog, no review and no undo, ' +
        'and it deletes tag assignments.' +
        '\n\nThe exclusion filters below still apply. ' +
        'Has no effect if Auto Roll Up is also enabled.',
      a9AutoRollUpOnUpdate: 'Adds every ancestor as Stash saves.',   // one paragraph
    };
    [['a8AutoPruneOnUpdate', 0], ['a9AutoRollUpOnUpdate', 1]].forEach(([k, i]) => {
      const row = h.makeElement('div');
      row.className = 'setting';
      const rowH = h.makeElement('h3');
      rowH.textContent = k;
      row.appendChild(rowH);
      const rowSub = h.makeElement('div');
      rowSub.className = 'sub-heading';
      rowSub.textContent = descs[k];
      row.appendChild(rowSub);
      const input = h.makeElement('input');
      input.id = 'plugin-NormalizeParentTags-' + k;
      if (checks) input.checked = checks[i];
      row.appendChild(input);
      collapsed.appendChild(row);
      rows[k] = { row, input, h3: rowH, sub: rowSub };
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
    const env = boot({ a8AutoPruneOnUpdate: false, a9AutoRollUpOnUpdate: true });
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
        settings: { a5EnableScenes: true, a9AutoRollUpOnUpdate: true },
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
    const env = boot({ a8AutoPruneOnUpdate: false });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('both modes off writes nothing', h.bulkCalls(env.calls).length === 0);
        h.check('and never loads the tag hierarchy', tagQueries(env.calls).length === 0);
      });
  })

  // Exact opposites: one adds what the other removes, so both on runs neither.
  .then(() => {
    const env = boot({ a9AutoRollUpOnUpdate: true });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('both modes on writes nothing', h.bulkCalls(env.calls).length === 0);
      });
  })

  // The a1-a7 toggles scope auto mode exactly as they scope the tasks.
  .then(() => {
    const env = boot({ a1EnablePerformers: false });
    return h.entityUpdate(env.ctx, 'performerUpdate', { id: '77' })
      .then(() => h.flush()).then(() => {
        h.check('a disabled entity type is not reacted to',
          h.bulkCalls(env.calls).length === 0);
      });
  })

  .then(() => {
    const env = boot({ a1EnablePerformers: true });
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
    const env = boot({ c3ExcludeRemoveTagNameContains: 'Hair' });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        const bulks = h.bulkCalls(env.calls);
        h.check('a protected tag is not removed by auto mode',
          bulks.length === 1 && bulks[0].variables.input.tag_ids.ids.join() === '2');
      });
  })

  .then(() => {
    const env = boot({ b2ExcludeOrganized: true }, {
      entities: {
        findScenes: {
          node: 'scenes',
          list: [{ id: '10', title: 'Ten', organized: true, tags: [{ id: '1' }, { id: '2' }, { id: '3' }] }],
        },
      },
    });
    return h.entityUpdate(env.ctx, 'sceneUpdate', { id: '10' })
      .then(() => h.flush()).then(() => {
        h.check('an organized entity is skipped', h.bulkCalls(env.calls).length === 0);
      });
  })

  // A configured exclusion tag that matches nothing stops auto mode rather than
  // letting it run unfiltered over the entities it was meant to protect.
  .then(() => {
    const env = boot({ b1ExcludeEntityWithTagName: 'No Such Tag' });
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
    const inner = h.makeResponder({ entities: LIB, settings: { a5EnableScenes: true } });
    const env = h.makeEnv({
      quiet: true,
      respond: (req, calls) => {
        if ((req.query || '').indexOf('configuration') !== -1) {
          return { data: { configuration: { plugins: { NormalizeParentTags: {
            a5EnableScenes: true, a8AutoPruneOnUpdate: prune } } } } };
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

  // ── The both-modes-on notice on the settings page ─────────────────────────
  //
  // Both modes on runs neither, which is safe and invisible. The notice makes it
  // visible, next to the two checkboxes, and must never do more than report.
  //
  // The DOM mirrors what Stash builds. Earlier versions of this suite invented it
  // from the same guesses as the code, so they agreed with the bugs:
  //
  //   <div class="setting-group collapsible">
  //     <div class="setting"><div><h3>GTTx Normalize Parent Tags (1.2.5)</h3></div></div>
  //     <div class="collapse">
  //       <div class="setting"><input id="plugin-NormalizeParentTags-a8..." checked></div>
  //       <div class="setting"><input id="plugin-NormalizeParentTags-a9..." checked></div>
  //     </div>
  //   </div>

  .then(() => {
    const notice = (env) => env.ctx.document.getElementById('npt-conflict-notice');

    const a = page([true, true]);
    const before = a.env.calls.length;
    a.env.tick();
    return h.flush().then(() => {
      const n = notice(a.env);
      h.check('both boxes ticked shows a notice', !!n);
      h.check('it names both settings and says neither is running',
        !!n && n.textContent.indexOf('Auto Prune on Entity Updates') !== -1 &&
        n.textContent.indexOf('Auto Roll Up on Entity Updates') !== -1 &&
        n.textContent.indexOf('neither is running') !== -1, n && n.textContent);
      // Beside the checkboxes it is about, not up at the group header where an
      // expanded group puts it off the top of the screen.
      h.check('it sits immediately above the Auto Prune row',
        !!n && n.parentNode === a.collapsed &&
        a.collapsed.childNodes.indexOf(n) === a.collapsed.childNodes.indexOf(a.rows.a8AutoPruneOnUpdate.row) - 1,
        n ? 'at ' + a.collapsed.childNodes.indexOf(n) : 'missing');
      h.check('and not in the other plugin group',
        a.other.descendants().indexOf(n) === -1);
      // The whole point of reading the DOM: no round trip, so no lag.
      h.check('reading the checkboxes costs no settings query',
        a.env.calls.length === before, 'issued ' + (a.env.calls.length - before));

      a.env.tick();
      return h.flush().then(() => {
        const all = a.env.ctx.document.body.descendants()
          .filter((x) => x.id === 'npt-conflict-notice');
        h.check('repeated ticks do not duplicate it', all.length === 1, 'got ' + all.length);
        h.check('it writes nothing', h.bulkCalls(a.env.calls).length === 0 &&
          !a.env.calls.some((c) => /configurePlugin/.test(c.query || '')));

        // Untick one: the notice must follow the checkbox, not the saved config.
        // The responder still reports both modes on, so anything reading the server
        // would leave the notice up.
        a.rows.a9AutoRollUpOnUpdate.input.checked = false;
        a.env.tick();
        return h.flush().then(() => {
          h.check('unticking one takes it down at once, without waiting for a save',
            !notice(a.env));
          a.rows.a9AutoRollUpOnUpdate.input.checked = true;
          a.env.tick();
          return h.flush().then(() => {
            h.check('and re-ticking brings it straight back', !!notice(a.env));
          });
        });
      });
    });
  })

  // One box ticked: nothing to say.
  .then(() => {
    const env = boot();
    const group = h.makeElement('div');
    group.className = 'setting-group';
    [['a8AutoPruneOnUpdate', true], ['a9AutoRollUpOnUpdate', false]].forEach(([k, c]) => {
      const row = h.makeElement('div');
      row.className = 'setting';
      const input = h.makeElement('input');
      input.id = 'plugin-NormalizeParentTags-' + k;
      input.checked = c;
      row.appendChild(input);
      group.appendChild(row);
    });
    env.ctx.document.body.appendChild(group);
    env.tick();
    return h.flush().then(() => {
      h.check('one box ticked shows no notice',
        !env.ctx.document.getElementById('npt-conflict-notice'));
    });
  })

  // Our settings are not on the page: nothing rendered, and no settings query -
  // finding them is what stands in for a route test.
  .then(() => {
    const env = boot({ a9AutoRollUpOnUpdate: true });
    const stranger = h.makeElement('div');
    stranger.className = 'setting-group';
    const input = h.makeElement('input');
    input.id = 'plugin-SomeOtherPlugin-a1Whatever';
    stranger.appendChild(input);
    env.ctx.document.body.appendChild(stranger);
    const before = env.calls.length;
    env.tick();
    return h.flush().then(() => {
      h.check('no notice where our settings are not rendered',
        !env.ctx.document.getElementById('npt-conflict-notice'));
      h.check('and no settings query is issued there',
        env.calls.length === before, 'issued ' + (env.calls.length - before));
    });
  })

  // Inputs present but unreadable (a Stash that renders these some other way):
  // fall back to the saved config, lag and all.
  .then(() => {
    const env = boot({ a9AutoRollUpOnUpdate: true });
    const group = h.makeElement('div');
    group.className = 'setting-group';
    ['a8AutoPruneOnUpdate', 'a9AutoRollUpOnUpdate'].forEach((k) => {
      const row = h.makeElement('div');
      row.className = 'setting';
      const input = h.makeElement('input');
      input.id = 'plugin-NormalizeParentTags-' + k;   // no `checked` property
      row.appendChild(input);
      group.appendChild(row);
    });
    env.ctx.document.body.appendChild(group);
    env.tick();
    return h.flush().then(() => {
      h.check('unreadable checkboxes fall back to the saved settings',
        !!env.ctx.document.getElementById('npt-conflict-notice'));
    });
  })

  // Fallback for a Stash that sets no ids at all: match the group heading. Each
  // string is one Stash template's exact output.
  .then(() => {
    function headingOnly(text) {
      const env = boot({ a9AutoRollUpOnUpdate: true });
      const group = h.makeElement('div');
      const heading = h.makeElement('h3');
      heading.textContent = text;
      group.appendChild(heading);
      env.ctx.document.body.appendChild(group);
      env.tick();
      return h.flush().then(() =>
        !!env.ctx.document.getElementById('npt-conflict-notice'));
    }
    return Promise.all([
      headingOnly('GTTx Normalize Parent Tags (1.2.5)'),
      headingOnly('GTTx Normalize Parent Tags'),
      headingOnly('GTTx Normalize Parent Tags undefined'),
      headingOnly('GTTx Normalize Parent Tags Extra'),
      headingOnly('Some Other Plugin (1.0.0)'),
    ]).then(([withVersion, plain, noVersion, namesake, other]) => {
      h.check('heading fallback: the versioned form is matched', withVersion);
      h.check('heading fallback: the bare name too (the tasks page form)', plain);
      h.check('heading fallback: and the "undefined" Stash renders with no version', noVersion);
      h.check('heading fallback: a near-namesake plugin is not', !namesake);
      h.check('heading fallback: nor an unrelated one', !other);
    });
  })

  // ── The README link ──────────────────────────────────────────────────────
  //
  // Stash's own link for `url:` is an unlabelled chain icon in the header and is
  // easy to miss; the description cannot carry an <a> because Stash passes it to
  // React as a child. So the plugin puts a labelled one in its own group.
  .then(() => {
    const p = page([false, false]);
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

      // React drops anything we add whenever it re-renders the panel, so the tick
      // re-adds it - and must not end up with two.
      p.env.tick();
      p.env.tick();
      return h.flush().then(() => {
        const links = p.env.ctx.document.body.descendants()
          .filter((n) => n.id === 'npt-readme-link');
        h.check('ticking again does not add a second one', links.length === 1, String(links.length));
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
    const p = page([false, false]);
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
    const p = page([false, false]);
    p.env.tick();
    return h.flush().then(() => {
      const a8 = p.rows.a8AutoPruneOnUpdate;
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
        /implies\.$/.test(summary.textContent), summary && summary.textContent);
      h.check('and the warning is intact in the tooltip, ahead of the filter note',
        !!box && box.textContent.indexOf(
          'WARNING: Updates immediately, with no dialog, no review and no undo, ' +
          'and it deletes tag assignments.') === 0 &&
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
      const a9 = p.rows.a9AutoRollUpOnUpdate;
      h.check('a one-paragraph description is left alone',
        a9.sub.childNodes.filter((n) => h.hasClass(n, 'npt-tip')).length === 0 &&
        a9.sub.textContent === 'Adds every ancestor as Stash saves.', a9.sub.textContent);
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
