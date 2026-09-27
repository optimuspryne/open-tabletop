import { applyIcons } from '../ui/icons.js';
import { notecardPreviewURL } from '../rendering/graphics.js';

// Account library and template-save UI. The editor continues to own the private draft.
export function createNotecardTemplates({ byId, editor, getRoom, canInteract }) {
  const host = byId('notecardTemplateLibrary'),
    panel = byId('notecardTemplatePanel');
  const list = byId('notecardTemplateList'),
    filter = byId('notecardTemplateFilter');
  const target = byId('notecardTemplateTarget'),
    name = byId('notecardTemplateName'),
    share = byId('notecardTemplateShare');
  const library = byId('libraryModal'),
    pane = host.closest('[data-pane]');
  let records = [],
    choices = [],
    next = null,
    choiceNext = null,
    listEpoch = 0,
    saveEpoch = 0,
    visible = false,
    loadingChoices = false,
    pendingStack = null;
  const status = (text) => {
    byId('notecardTemplateLibraryStatus').textContent = text;
  };
  const saveStatus = (text) => {
    byId('notecardTemplateStatus').textContent = text;
  };
  async function request(path = '', method = 'GET', body) {
    const response = await fetch('/notecard-templates' + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('tabletop.token') || ''),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to access notecard templates.');
    return result;
  }
  function button(label, icon, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'button';
    b.dataset.icon = icon;
    b.setAttribute('aria-label', label);
    const text = document.createElement('span');
    text.className = 'lbl';
    text.textContent = label;
    b.append(text);
    b.onclick = action;
    return b;
  }
  function icons(element) {
    applyIcons(element);
    element.querySelectorAll('button[data-icon]').forEach((b) => {
      b.title = b.getAttribute('aria-label');
    });
  }
  function field(label, value) {
    const wrap = document.createElement('label');
    wrap.className = 'field-group';
    wrap.append(document.createTextNode(label));
    const input = document.createElement('input');
    input.className = 'control';
    input.value = value;
    wrap.append(input);
    return { wrap, input };
  }
  function shareField(checked) {
    const wrap = document.createElement('label'),
      input = document.createElement('input');
    wrap.className = 'checkbox';
    input.className = 'checkbox__input';
    input.type = 'checkbox';
    input.checked = checked;
    wrap.append(input, document.createTextNode(' Share with everyone on this server'));
    return { wrap, input };
  }
  function privacy() {
    byId('notecardTemplatePrivacy').textContent = share.checked
      ? 'Everyone on this server can view this design and create copies.'
      : 'Private to your account. Available across rooms.';
  }
  function selection() {
    const chosen = choices.find((t) => t.id === target.value);
    name.value = chosen?.name || '';
    share.checked = chosen?.isPublic || false;
    privacy();
  }
  function fillChoices(selected = target.value) {
    target.replaceChildren(
      new Option('New template', ''),
      ...choices.map((t) => new Option('Replace ' + t.name, t.id)),
    );
    target.value = selected;
    byId('notecardTemplateTargetsMore').hidden = choiceNext === null;
  }
  async function openSave() {
    const context = editor.templateContext();
    if (!context.editable || context.busy) return;
    const epoch = ++saveEpoch;
    panel.hidden = false;
    loadingChoices = true;
    panel.inert = true;
    saveStatus('Loading your templates…');
    choices = [];
    choiceNext = null;
    fillChoices('');
    name.value = '';
    share.checked = false;
    privacy();
    try {
      const result = await request('?scope=managed');
      if (epoch !== saveEpoch || context.generation !== editor.templateContext().generation) return;
      choices = result.templates.filter((t) => t.canEdit);
      choiceNext = result.nextOffset;
      // Retain the source revision: a concurrent edit must conflict rather than overwrite silently.
      if (context.template?.canEdit)
        choices = [context.template, ...choices.filter((t) => t.id !== context.template.id)];
      fillChoices(context.template?.canEdit ? context.template.id : '');
      selection();
      saveStatus('');
    } catch (error) {
      if (epoch === saveEpoch) saveStatus(error.message);
    } finally {
      if (epoch === saveEpoch) {
        loadingChoices = false;
        panel.inert = editor.templateContext().busy;
        name.focus();
      }
    }
  }
  byId('notecardTemplateSave').onclick = openSave;
  byId('notecardTemplateCancel').onclick = () => {
    saveEpoch++;
    panel.hidden = true;
    byId('notecardTemplateSave').focus();
  };
  share.onchange = privacy;
  target.onchange = selection;
  byId('notecardTemplateTargetsMore').onclick = async () => {
    if (choiceNext === null) return;
    const epoch = saveEpoch;
    byId('notecardTemplateTargetsMore').disabled = true;
    try {
      const result = await request('?scope=managed&offset=' + choiceNext);
      if (epoch !== saveEpoch) return;
      for (const t of result.templates)
        if (t.canEdit && !choices.some((c) => c.id === t.id)) choices.push(t);
      choiceNext = result.nextOffset;
      fillChoices();
    } catch (error) {
      if (epoch === saveEpoch) saveStatus(error.message);
    } finally {
      byId('notecardTemplateTargetsMore').disabled = false;
    }
  };
  byId('notecardTemplateConfirm').onclick = async () => {
    const context = editor.templateContext();
    if (!context.editable || context.busy) return;
    const chosen = choices.find((t) => t.id === target.value),
      trimmed = name.value.trim();
    if (!trimmed) {
      saveStatus('Enter a template name.');
      name.focus();
      return;
    }
    let content;
    try {
      content = editor.capture();
    } catch (error) {
      saveStatus(error.message);
      return;
    }
    const epoch = ++saveEpoch;
    editor.templateBusy(true);
    saveStatus('Saving template…');
    try {
      const { template } = await request(chosen ? '/' + chosen.id : '', chosen ? 'PUT' : 'POST', {
        name: trimmed,
        isPublic: share.checked,
        content,
        ...(chosen ? { revision: chosen.revision } : {}),
      });
      if (epoch !== saveEpoch || context.generation !== editor.templateContext().generation) return;
      editor.templateSaved(template);
      panel.hidden = true;
      byId('notecardStatus').textContent = template.isPublic
        ? 'Template saved and shared with this server. Your draft is still open.'
        : 'Template saved privately to your account. Your draft is still open.';
      if (visible) load();
    } catch (error) {
      if (epoch === saveEpoch) saveStatus(error.message);
    } finally {
      if (epoch === saveEpoch && context.generation === editor.templateContext().generation) {
        editor.templateBusy(false);
        if (panel.hidden) byId('notecardTemplateSave').focus();
      }
    }
  };
  function render() {
    list.replaceChildren();
    for (const record of records) {
      const item = document.createElement('li');
      item.className = 'libCard notecard-template-card';
      const img = document.createElement('img');
      img.className = 'libThumb';
      img.src = notecardPreviewURL(
        record.content.drawing,
        record.content.paper,
        record.content.textBoxes,
        record.content.orientation,
      );
      img.alt = record.name + ' template preview';
      const preview = document.createElement('div');
      preview.className = 'libPreview';
      preview.append(img);
      const title = document.createElement('span');
      title.className = 'libName';
      title.textContent = record.name;
      title.title = record.name;
      title.id = 'notecard-template-title-' + record.id;
      const detail = document.createElement('p');
      detail.className = 'hint';
      detail.textContent =
        (record.isPublic ? 'Shared' : 'Private') + ' · ' + (record.ownerName || 'Former account');
      const meta = document.createElement('div');
      meta.className = 'libMeta';
      meta.append(title, detail);
      const actions = document.createElement('div');
      actions.className = 'button-row button-row--compact';
      const create = button('Create card', 'plus', () => open(record.id, false));
      create.classList.add('button--primary');
      create.disabled = !canInteract();
      actions.append(create);
      const copies = field('Copies', '8');
      copies.wrap.className = 'button-row';
      copies.input.type = 'number';
      copies.input.min = '2';
      copies.input.max = '16';
      copies.input.setAttribute('aria-label', 'Copies of ' + record.name);
      const stack = button('Create stack', 'cards', () =>
        createStack(record.id, Number(copies.input.value)),
      );
      stack.disabled = !canInteract() || !!pendingStack;
      const controls = document.createElement('div');
      controls.className = 'cardCtrls';
      controls.append(copies.wrap);
      actions.append(stack);
      const manage = document.createElement('div');
      manage.className = 'notecard-template-form';
      manage.hidden = true;
      if (record.canEdit)
        actions.append(button('Manage', 'settings', () => manageTemplate(record.id, manage)));
      for (const b of [...actions.querySelectorAll('button'), stack])
        b.setAttribute('aria-describedby', title.id);
      item.append(preview, meta, controls, actions, manage);
      list.append(item);
    }
    icons(list);
    byId('notecardTemplateMore').hidden = next === null;
  }
  async function load(more = false) {
    const epoch = ++listEpoch;
    status('Loading templates…');
    byId('notecardTemplateMore').disabled = true;
    if (!more) {
      records = [];
      next = null;
      render();
    }
    try {
      const result = await request('?scope=' + filter.value + (more ? '&offset=' + next : ''));
      if (epoch !== listEpoch) return;
      records = more
        ? [...records, ...result.templates.filter((t) => !records.some((r) => r.id === t.id))]
        : result.templates;
      next = result.nextOffset;
      render();
      status(
        records.length
          ? 'Each card is an independent editable copy. Stacks start face-down.'
          : 'No templates here yet. Open a notecard and choose Save template.',
      );
    } catch (error) {
      if (epoch === listEpoch) status(error.message);
    } finally {
      if (epoch === listEpoch) byId('notecardTemplateMore').disabled = false;
    }
  }
  async function open(id, editing) {
    const context = editor.templateContext(),
      room = getRoom();
    if (!canInteract()) return;
    status('Opening template…');
    try {
      const { template } = await request('/' + id);
      if (
        room !== getRoom() ||
        !canInteract() ||
        context.generation !== editor.templateContext().generation
      )
        return;
      if (editing && !template.canEdit) throw new Error('This template is no longer editable.');
      library.hidden = true;
      byId('lib2Btn')?.focus();
      if (!editor.openTemplate(template, editing)) {
        status('Finish the current notecard first.');
        return;
      }
      if (editing) await openSave();
    } catch (error) {
      status(error.message);
    }
  }
  async function createStack(id, count) {
    if (pendingStack || !canInteract()) return;
    if (!Number.isInteger(count) || count < 2 || count > 16) {
      status('Choose 2–16 copies.');
      return;
    }
    const room = getRoom();
    pendingStack = { request: crypto.randomUUID(), room };
    render();
    status('Creating stack…');
    try {
      const { template } = await request('/' + id);
      if (room !== getRoom() || !canInteract() || !pendingStack) {
        pendingStack = null;
        return;
      }
      room.send('notecardCreate', {
        request: pendingStack.request,
        content: template.content,
        destination: 'stack',
        count,
      });
    } catch (error) {
      pendingStack = null;
      render();
      status(error.message);
    }
  }
  async function manageTemplate(id, container) {
    if (!container.hidden) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    container.textContent = 'Loading template…';
    try {
      const { template } = await request('/' + id);
      if (!container.isConnected) return;
      if (!template.canEdit) throw new Error('This template is no longer editable.');
      container.replaceChildren();
      const title = field('Template name', template.name);
      title.input.maxLength = 60;
      const sharing = shareField(template.isPublic),
        hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent =
        'Others can create copies. Only you and site admins can change the original. Making it private stops future access; existing copies remain.';
      const actions = document.createElement('div');
      actions.className = 'button-row';
      const feedback = document.createElement('p');
      feedback.className = 'hint';
      feedback.setAttribute('role', 'status');
      async function mutate(method, value) {
        actions.inert = true;
        try {
          await request('/' + id, method, { ...value, revision: template.revision });
          await load();
        } catch (error) {
          feedback.textContent = error.message;
        } finally {
          actions.inert = false;
        }
      }
      const save = button('Save changes', 'device-floppy', () =>
        mutate('PATCH', { name: title.input.value.trim(), isPublic: sharing.input.checked }),
      );
      const edit = button('Edit design', 'writing', () => open(id, true));
      edit.disabled = !canInteract();
      const remove = button('Delete', 'trash', () => {
        feedback.textContent = 'Delete this template? Existing cards and stacks stay in play.';
        remove.hidden = true;
        const confirm = button('Delete template', 'trash', () => mutate('DELETE', {}));
        const cancel = button('Keep template', 'x', () => {
          confirm.remove();
          cancel.remove();
          remove.hidden = false;
          feedback.textContent = '';
          remove.focus();
        });
        actions.append(confirm, cancel);
        icons(actions);
        confirm.focus();
      });
      actions.append(save, edit, remove);
      container.append(title.wrap, sharing.wrap, hint, actions, feedback);
      icons(container);
      title.input.focus();
    } catch (error) {
      container.textContent = error.message;
    }
  }
  filter.onchange = () => load();
  byId('notecardTemplateMore').onclick = () => load(true);
  new MutationObserver(() => {
    const nowVisible =
      !library.hidden && !pane.hidden && pane.open && !pane.closest('.libGroup')?.hidden;
    if (nowVisible && !visible) {
      if (window.OTT_IS_ADMIN && !filter.querySelector('[value="managed"]'))
        filter.add(new Option('All templates (admin)', 'managed'));
      load();
    }
    visible = nowVisible;
  }).observe(library, { attributes: true, attributeFilter: ['hidden', 'open'], subtree: true });
  editor.attachTemplates({
    sync() {
      panel.inert = loadingChoices || editor.templateContext().busy;
    },
    reset() {
      saveEpoch++;
      loadingChoices = false;
      panel.inert = false;
      panel.hidden = true;
      name.value = '';
      share.checked = false;
      choices = [];
      target.replaceChildren(new Option('New template', ''));
      saveStatus('');
    },
  });
  return {
    bindRoom(room) {
      if (visible) load();
      room.onMessage('notecardCreated', ({ request }) => {
        if (pendingStack?.room === room && pendingStack.request === request) {
          pendingStack = null;
          render();
          status('Face-down stack created. Each card is independently editable.');
        }
      });
      room.onMessage('serverError', ({ operation, message }) => {
        if (operation === 'notecardCreate' && pendingStack?.room === room) {
          pendingStack = null;
          render();
          status(message);
        }
      });
      room.onStateChange?.(() => {
        list.querySelectorAll('button').forEach((b) => {
          if (['Create card', 'Create stack', 'Edit design'].includes(b.getAttribute('aria-label')))
            b.disabled =
              !canInteract() || (b.getAttribute('aria-label') === 'Create stack' && !!pendingStack);
        });
      });
      room.onLeave(() => {
        pendingStack = null;
        listEpoch++;
        records = [];
        next = null;
        render();
        status('Reconnect to use templates.');
      });
    },
  };
}
