import { useEffect, useState } from 'preact/hooks';
import { Button, Field, Segmented, Sheet } from '../components/ui';
import { createDoc, fileExistsKnown } from '../sync';
import { focusOnOpen, go } from '../route';
import { newPostContent, slugify } from '../util';

export function NewPostSheet(props: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [ext, setExt] = useState<'md' | 'mdx'>('mdx');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.open) {
      setTitle('');
      setBusy(false);
    }
  }, [props.open]);

  const slug = slugify(title);
  const file = `${slug}.${ext}`;
  const taken = slug && (fileExistsKnown(`${slug}.md`) || fileExistsKnown(`${slug}.mdx`));
  const can = !!slug && !taken && !busy;

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!can) return;
    setBusy(true);
    await createDoc(file, newPostContent(title.trim(), ext));
    focusOnOpen.add(file);
    props.onClose();
    go(`#/edit/${encodeURIComponent(file)}`);
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="New post"
      initialFocus="#np-title"
      footer={
        <Button kind="primary" class="wide" disabled={!can} onClick={() => void submit()}>
          Create and start writing
        </Button>
      }
    >
      <form onSubmit={submit} class="form">
        <Field label="Title" for="np-title">
          <input
            id="np-title"
            class="input input-lg"
            type="text"
            placeholder="What is this post about?"
            autoCapitalize="sentences"
            enterKeyHint="go"
            autoComplete="off"
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Field label="Format" hint={ext === 'mdx' ? 'MDX lets you use components like tabs and pictures.' : 'Plain Markdown, no components.'}>
          <Segmented<'md' | 'mdx'>
            label="File format"
            value={ext}
            onChange={setExt}
            options={[
              { value: 'mdx', label: 'MDX' },
              { value: 'md', label: 'Markdown' },
            ]}
          />
        </Field>
        <div class={`slug-preview ${taken ? 'bad' : ''}`} aria-live="polite">
          <span class="slug-label">{taken ? 'Already exists' : 'Will create'}</span>
          <code>{slug ? file : `…${'.' + ext}`}</code>
        </div>
        <button type="submit" class="visually-hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Sheet>
  );
}
