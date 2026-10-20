import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decorateInline } from '../../src/cm/decorate/inline';
import { nexusdownLivePreview } from '../../src/cm/plugin';

const views: EditorView[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount() {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '**first**\n\n' + 'paragraph\n'.repeat(100),
      extensions: [markdown(), nexusdownLivePreview({ decorators: { inline: decorateInline } })],
    }),
  });
  views.push(view);

  // JSDOM has no layout. Keep the real plugin and DOM scroll position, but
  // drive the measure callbacks after the scroll that a browser would apply.
  const measures: Array<() => void> = [];
  vi.spyOn(view, 'requestMeasure').mockImplementation((request) => {
    if (request) measures.push(() => request.write?.(request.read(view), view));
  });
  return { view, measure: () => measures.splice(0).forEach((run) => run()) };
}

describe('live preview scrolling', () => {
  it('does not undo cursor-follow scrolling after a navigation transaction', () => {
    const { view, measure } = mount();
    view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });

    view.scrollDOM.scrollTop = 900;
    measure();

    expect(view.scrollDOM.scrollTop).toBe(900);
  });

  it('does not restore a stale position over a later manual scroll', () => {
    const { view, measure } = mount();
    view.scrollDOM.scrollTop = 120;
    view.dispatch({ changes: { from: 2, insert: 'edited ' } });

    view.scrollDOM.scrollTop = 380;
    measure();

    expect(view.scrollDOM.scrollTop).toBe(380);
  });
});
