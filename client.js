/**
 * QuickPrompt panel — the prompt library as a tab on the Plugins page.
 *
 * Plain-JS Client half: the browser module table provides React, the Host
 * serves `/quickprompt/api/*` from the same plugin. No other Client package is
 * imported, so nothing here breaks when the host's internals change.
 */

const LABELS = {
  zh: {
    tab: '提示词库',
    title: '提示词库',
    subtitle: '在这里查看、编辑、新建提示词；保存后 /qp-<slug> 命令立刻生效。',
    empty: '库还是空的。点「新建」写一条，或回到对话用 /qp <需求> 炼化一条。',
    loading: '载入中…',
    unavailable: '面板不可用',
    unavailableHint: '当前宿主没有提供面板接口（需要 Web 宿主且插件已重载）。可以继续用 /qp 命令管理提示词。',
    newPrompt: '新建',
    save: '保存',
    remove: '删除',
    saved: '已保存',
    deleted: '已删除',
    saveFailed: '保存失败',
    deleteFailed: '删除失败',
    confirmDelete: '确定删除提示词「{name}」？对应命令 /qp-{name} 会一起移除。',
    titlePlaceholder: '标题，例如：测试工程师周报',
    slugPlaceholder: 'slug（小写字母开头，a-z 0-9 - _）',
    bodyPlaceholder: '提示词正文。用 {{变量}} 或 {{变量:默认值}} 声明变量，\\{{ 表示字面量。',
    variables: '变量',
    noVariables: '无变量',
    command: '命令',
    usage: '用过 {count} 次',
    unsaved: '有未保存的修改',
    reload: '刷新',
  },
  en: {
    tab: 'Prompt library',
    title: 'Prompt library',
    subtitle: 'View, edit, and create prompts here; saving refreshes /qp-<slug> immediately.',
    empty: 'The library is empty. Create one, or forge one in chat with /qp <request>.',
    loading: 'Loading…',
    unavailable: 'Panel unavailable',
    unavailableHint: 'This host does not expose the panel API (needs a web host and a reloaded plugin). Keep using the /qp commands.',
    newPrompt: 'New',
    save: 'Save',
    remove: 'Delete',
    saved: 'Saved',
    deleted: 'Deleted',
    saveFailed: 'Save failed',
    deleteFailed: 'Delete failed',
    confirmDelete: 'Delete prompt “{name}”? Its command /qp-{name} is removed too.',
    titlePlaceholder: 'Title, e.g. Weekly report',
    slugPlaceholder: 'slug (lowercase start, a-z 0-9 - _)',
    bodyPlaceholder: 'Prompt body. Declare slots as {{name}} or {{name:default}}; \\{{ is a literal.',
    variables: 'Variables',
    noVariables: 'none',
    command: 'Command',
    usage: 'used {count} times',
    unsaved: 'Unsaved changes',
    reload: 'Reload',
  },
}

const CSS = `
.qp-root { display: flex; flex-direction: column; gap: 12px; padding: 20px 24px; height: 100%; min-height: 480px; color: var(--dsw-alias-label-primary, #e8e8e8); }
.qp-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.qp-head h2 { margin: 0; font-size: 16px; font-weight: 600; }
.qp-head p { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.qp-body { display: flex; gap: 16px; flex: 1; min-height: 0; }
.qp-list { width: 260px; flex: 0 0 260px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1, #333); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent); padding: 6px; }
.qp-item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.qp-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.05)); }
.qp-item[data-active="true"] { border-color: var(--dsw-alias-brand-primary, #4c8dff); background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06)); }
.qp-item-title { font-size: 13px; font-weight: 600; }
.qp-item-meta { font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa0a6); margin-top: 2px; }
.qp-editor { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.qp-row { display: flex; gap: 8px; }
.qp-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.qp-field span { font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.qp-input, .qp-textarea { width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: var(--dsw-alias-bg-base, transparent); border: 1px solid var(--dsw-alias-border-l2, #444); border-radius: 6px; padding: 7px 9px; }
.qp-input { font-size: 13px; }
.qp-textarea { flex: 1; min-height: 220px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; }
.qp-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.qp-chip { padding: 2px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, #333); background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04)); font-family: ui-monospace, Menlo, Consolas, monospace; }
.qp-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.qp-btn { font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 6px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2, #444); background: var(--dsw-alias-bg-layer-1, transparent); color: inherit; }
.qp-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06)); }
.qp-btn[data-primary="true"] { background: var(--dsw-alias-brand-primary, #4c8dff); border-color: transparent; color: #fff; }
.qp-btn[data-danger="true"] { border-color: var(--dsw-alias-state-error-primary, #e5484d); color: var(--dsw-alias-state-error-primary, #e5484d); }
.qp-btn:disabled { opacity: .55; cursor: default; }
.qp-status { font-size: 12px; min-height: 16px; color: var(--dsw-alias-state-success-primary, #3fb950); }
.qp-status[data-error="true"] { color: var(--dsw-alias-state-error-primary, #e5484d); }
.qp-empty { padding: 40px 24px; font-size: 13px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
`

/** Collect declared slots the same way the Host does. */
function varsOf(body) {
  const found = []
  const seen = new Set()
  const pattern = /\\?\{\{\s*([A-Za-z0-9_.\-\u4e00-\u9fa5]+)\s*(?::\s*([^}]*))?\}\}/g
  const source = String(body ?? '')
  let match
  while ((match = pattern.exec(source)) !== null) {
    if (match[0].startsWith('\\')) continue
    if (seen.has(match[1])) continue
    seen.add(match[1])
    found.push({ name: match[1], hasDefault: match[2] !== undefined })
  }
  return found
}

const EMPTY_DRAFT = { name: '', title: '', description: '', body: '' }

async function callApi(path, options) {
  const response = await fetch(`/quickprompt/api/${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    /* a non-JSON body means the route is missing */
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

function createPanel(React, t) {
  const h = React.createElement

  return function QuickPromptPanel() {
    const [state, setState] = React.useState(null)
    const [selected, setSelected] = React.useState(null)
    const [draft, setDraft] = React.useState(EMPTY_DRAFT)
    const [status, setStatus] = React.useState('')
    const [statusError, setStatusError] = React.useState(false)
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)

    const refresh = React.useCallback(async (wanted) => {
      try {
        const data = await callApi('state')
        setState(data)
        setError('')
        setSelected((currentName) => {
          const next = wanted ?? currentName
          const exists = next && data.prompts.some((prompt) => prompt.name === next)
          return exists ? next : (data.prompts[0]?.name ?? null)
        })
      } catch (cause) {
        setError(String(cause?.message ?? cause))
      }
    }, [])

    React.useEffect(() => {
      refresh()
    }, [refresh])

    const current = state?.prompts?.find((prompt) => prompt.name === selected) ?? null

    React.useEffect(() => {
      setDraft(
        current
          ? {
              name: current.name,
              title: current.title ?? '',
              description: current.description ?? '',
              body: current.body ?? '',
            }
          : EMPTY_DRAFT,
      )
      setStatus('')
      setStatusError(false)
    }, [current?.name, current?.updatedAt])

    if (error) {
      return h('div', { className: 'qp-root' }, [
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'qp-empty', key: 'body' }, [
          h('div', { key: 'title', style: { fontWeight: 600, marginBottom: 6 } }, t('unavailable')),
          h('div', { key: 'msg' }, `${t('unavailableHint')}\n${error}`),
        ]),
      ])
    }

    if (!state) {
      return h('div', { className: 'qp-root' }, [
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'qp-empty', key: 'body' }, t('loading')),
      ])
    }

    const vars = varsOf(draft.body)
    const command = draft.name ? `/${state.prefix}-${draft.name}` : ''

    const save = async () => {
      setBusy(true)
      setStatus('')
      setStatusError(false)
      try {
        const data = await callApi('save', { method: 'POST', body: JSON.stringify(draft) })
        setState(data)
        setSelected(draft.name.trim().toLowerCase())
        setStatus(t('saved'))
        await refresh(draft.name.trim().toLowerCase())
      } catch (cause) {
        setStatus(`${t('saveFailed')}：${cause?.message ?? cause}`)
        setStatusError(true)
      } finally {
        setBusy(false)
      }
    }

    const remove = async () => {
      if (!current) return
      const ask = t('confirmDelete').replace('{name}', current.name)
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(ask)) return
      setBusy(true)
      setStatus('')
      setStatusError(false)
      try {
        const data = await callApi('delete', { method: 'POST', body: JSON.stringify({ name: current.name }) })
        setState(data)
        setSelected(null)
        setStatus(t('deleted'))
      } catch (cause) {
        setStatus(`${t('deleteFailed')}：${cause?.message ?? cause}`)
        setStatusError(true)
      } finally {
        setBusy(false)
      }
    }

    const list = state.prompts.length === 0
      ? h('div', { className: 'qp-empty', key: 'empty' }, t('empty'))
      : state.prompts.map((prompt) =>
          h('button', {
            key: prompt.name,
            type: 'button',
            className: 'qp-item',
            'data-active': String(prompt.name === selected),
            onClick: () => setSelected(prompt.name),
          }, [
            h('div', { className: 'qp-item-title', key: 't' }, prompt.title || prompt.name),
            h('div', { className: 'qp-item-meta', key: 'm' }, [
              `/${state.prefix}-${prompt.name}`,
              prompt.vars.length > 0 ? ` · ${prompt.vars.length} ${t('variables')}` : '',
              prompt.usageCount > 0 ? ` · ${t('usage').replace('{count}', String(prompt.usageCount))}` : '',
            ].join('')),
          ]))

    return h('div', { className: 'qp-root' }, [
      h('style', { key: 'style' }, CSS),
      h('div', { className: 'qp-head', key: 'head' }, [
        h('h2', { key: 'title' }, t('title')),
        h('p', { key: 'sub' }, t('subtitle')),
      ]),
      h('div', { className: 'qp-body', key: 'body' }, [
        h('div', { className: 'qp-list', key: 'list' }, list),
        h('div', { className: 'qp-editor', key: 'editor' }, [
          h('div', { className: 'qp-row', key: 'meta' }, [
            h('label', { className: 'qp-field', key: 'title' }, [
              h('span', { key: 'l' }, t('title')),
              h('input', {
                className: 'qp-input',
                value: draft.title,
                placeholder: t('titlePlaceholder'),
                onChange: (event) => setDraft({ ...draft, title: event.target.value }),
              }),
            ]),
            h('label', { className: 'qp-field', key: 'slug' }, [
              h('span', { key: 'l' }, 'slug'),
              h('input', {
                className: 'qp-input',
                value: draft.name,
                placeholder: t('slugPlaceholder'),
                onChange: (event) => setDraft({ ...draft, name: event.target.value }),
              }),
            ]),
          ]),
          h('textarea', {
            key: 'body',
            className: 'qp-textarea',
            value: draft.body,
            placeholder: t('bodyPlaceholder'),
            spellCheck: false,
            onChange: (event) => setDraft({ ...draft, body: event.target.value }),
          }),
          h('div', { className: 'qp-chips', key: 'chips' }, [
            h('span', { key: 'label' }, `${t('variables')}:`),
            ...(vars.length === 0
              ? [h('span', { key: 'none' }, t('noVariables'))]
              : vars.map((slot) =>
                  h('span', { className: 'qp-chip', key: slot.name }, slot.hasDefault ? `{{${slot.name}}}` : `{{${slot.name}}}`))),
            command ? h('span', { key: 'cmd' }, `${t('command')}: ${command}`) : null,
          ]),
          h('div', { className: 'qp-actions', key: 'actions' }, [
            h('button', {
              key: 'save',
              type: 'button',
              className: 'qp-btn',
              'data-primary': 'true',
              disabled: busy,
              onClick: save,
            }, t('save')),
            h('button', {
              key: 'new',
              type: 'button',
              className: 'qp-btn',
              disabled: busy,
              onClick: () => {
                setSelected(null)
                setDraft(EMPTY_DRAFT)
                setStatus('')
              },
            }, t('newPrompt')),
            h('button', {
              key: 'delete',
              type: 'button',
              className: 'qp-btn',
              'data-danger': 'true',
              disabled: busy || !current,
              onClick: remove,
            }, t('remove')),
            h('button', {
              key: 'reload',
              type: 'button',
              className: 'qp-btn',
              disabled: busy,
              onClick: () => refresh(),
            }, t('reload')),
          ]),
          h('div', { className: 'qp-status', key: 'status', 'data-error': String(statusError) }, status),
        ]),
      ]),
    ])
  }
}

/** Register the quickprompt locale dictionaries and return a translate function. */
function makeTranslate(ctx, zh, en) {
  const fallback = (key) => zh[key] ?? key
  const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
  if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return fallback

  const disposers = []
  const tryRegister = (attempt) => {
    try {
      const dispose = attempt()
      if (typeof dispose === 'function') disposers.push(dispose)
      return true
    } catch {
      return false
    }
  }

  // Two documented shapes: per locale (ns, localeId, dict), or all locales (ns, dicts).
  const perLocale =
    tryRegister(() => locale.register('quickprompt', 'zh', zh)) &&
    tryRegister(() => locale.register('quickprompt', 'en', en))
  if (!perLocale) {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* nothing to undo */
      }
    }
    tryRegister(() => locale.register('quickprompt', { zh, en }))
  }
  if (disposers.length === 0) return fallback

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* the locale owner already removed it */
        }
      }
    }, 'quickprompt locale')
  }
  try {
    return locale.bind('quickprompt')
  } catch {
    return fallback
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-quickprompt',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        const translate = makeTranslate(ctx, LABELS.zh, LABELS.en)
        const Panel = createPanel(React, translate)
        ctx.slots.inject('plugins.tab', () => ctx.slots.register({
          name: 'plugins.tab',
          id: 'quickprompt',
          order: 40,
          label: translate('tab'),
        }, Panel))
      },
    }
  },
})
