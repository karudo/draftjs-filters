// @flow
import { EditorState } from "draft-js"
import type { EditorState as EditorStateType } from "draft-js"
import { ContentState } from "draft-js"

/**
 * Applies the new content to the editor state, optionally moving the selection
 * to be on a valid block (https://github.com/thibaudcolas/draftjs-filters/issues/27).
 */
export const applyContentWithSelection = (
  editorState: EditorStateType,
  content: ContentState,
  nextContent: ContentState,
) => {
  const nextState = EditorState.set(editorState, {
    currentContent: nextContent,
  })
  const selection = editorState.getSelection()
  const anchorKey = selection.getAnchorKey()
  const anchorBlock = nextContent.getBlockForKey(anchorKey)

  // We only support moving collapsed selections, which is the only behavior of selections after paste.
  // And if the anchor block is valid, no need to move the selection.
  const shouldKeepSelection = !selection.isCollapsed() || !!anchorBlock
  if (shouldKeepSelection) {
    return nextState
  }

  const nextKeys = nextContent.getBlockMap().keySeq()

  // Find the first key whose successor is different in the old content (because a block was removed).
  // Starting from the end so the selection is preserved towards the last not-removed block in the filtered region.
  const nextAnchorKey = nextKeys
    .reverse()
    .find((k) => content.getKeyAfter(k) !== nextContent.getKeyAfter(k))

  if (nextAnchorKey) {
    const nextSelectedBlock = nextContent.getBlockForKey(nextAnchorKey)
    const blockEndOffset = nextSelectedBlock.getText().length
    const nextSelection = selection.merge({
      anchorKey: nextAnchorKey,
      focusKey: nextAnchorKey,
      anchorOffset: blockEndOffset,
      focusOffset: blockEndOffset,
    })

    return EditorState.acceptSelection(nextState, nextSelection)
  }

  return nextState
}
