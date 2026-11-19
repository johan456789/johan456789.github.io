import { useEffect, useMemo, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { Button, Field, Sheet, Switch } from '../components/ui';
import type { Meta, MetaPatch } from '../frontmatter';
import { fromInputValue, toInputValue } from '../util';
import { app } from '../sync';
import { useStore } from '../state';

export function DetailsSheet(props: {
  open: boolean;
  onClose: () => void;
  file: string;
  meta: Meta;
  applyMeta: (p: MetaPatch) => void;
}) {
  const { meta, applyMeta } = props;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [date, setDate] = useState('');
  const [draft, setDraft] = useState(false);
  const posts = useStore(app, (s) => s.posts);

  // seed the form each time the sheet opens
  useEffect(() => {
    if (!props.open) return;
    setTitle(meta.title);
    setDescription(meta.description);
    setTags(meta.tags);
    setTagDraft('');
    setDate(toInputValue(meta.date));
    setDraft(meta.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const suggestions = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of posts) for (const t of p.tags) count.set(t, (count.get(t) || 0) + 1);
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
      .filter((t) => !tags.includes(t))
      .slice(0, 8);
  }, [posts, tags]);

  const commitTags = (next: string[]) => {
    setTags(next);
    applyMeta({ tags: next });
  };
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').replace(/,$/, '').trim();
    if (!t || tags.includes(t)) {
      setTagDraft('');
      return;
    }
    commitTags([...tags, t]);
    setTagDraft('');
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Post details"
      tall
      footer={
        <Button kind="primary" class="wide" onClick={props.onClose}>
          Done
        </Button>
      }
    >
      <div class="form">
        <Field label="Title" for="d-title">
          <input
            id="d-title"
            class="input"
            type="text"
            autoCapitalize="sentences"
            enterKeyHint="next"
            value={title}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setTitle(v);
              applyMeta({ title: v });
            }}
          />
        </Field>
        <Field label="Description" for="d-desc" hint="Shown in search results and link previews.">
          <textarea
            id="d-desc"
            class="input"
            rows={3}
            autoCapitalize="sentences"
            value={description}
            onInput={(e) => {
              const v = (e.target as HTMLTextAreaElement).value;
              setDescription(v);
              applyMeta({ description: v });
            }}
          />
        </Field>
        <Field label="Tags" for="d-tags">
          <div class="chip-input">
            {tags.map((t) => (
              <span class="chip" key={t}>
                {t}
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => commitTags(tags.filter((x) => x !== t))}>
                  <X size={14} />
                </button>
              </span>
            ))}
            <input
              id="d-tags"
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellcheck={false}
              enterKeyHint="done"
              placeholder={tags.length ? 'Add tag' : 'Add a tag'}
              value={tagDraft}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.endsWith(',')) addTag(v);
                else setTagDraft(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagDraft);
                } else if (e.key === 'Backspace' && !tagDraft && tags.length) commitTags(tags.slice(0, -1));
              }}
              onBlur={() => tagDraft && addTag(tagDraft)}
            />
          </div>
          {suggestions.length > 0 && (
            <div class="suggest" aria-label="Suggested tags">
              {suggestions.map((t) => (
                <button type="button" class="chip chip-suggest" key={t} onClick={() => commitTags([...tags, t])}>
                  + {t}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Date" for="d-date">
          <input
            id="d-date"
            class="input"
            type="datetime-local"
            value={date}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setDate(v);
              const iso = fromInputValue(v);
              if (iso) applyMeta({ date: iso });
            }}
          />
        </Field>
        <div class="row-field">
          <div>
            <label class="field-label" for="d-draft">
              Draft
            </label>
            <div class="field-hint">Drafts are not shown on the published blog.</div>
          </div>
          <Switch
            id="d-draft"
            label="Draft"
            checked={draft}
            onChange={(v) => {
              setDraft(v);
              applyMeta({ draft: v });
            }}
          />
        </div>
        <div class="file-line">
          <span>File</span>
          <code>{props.file}</code>
        </div>
      </div>
    </Sheet>
  );
}
