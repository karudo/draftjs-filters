// @flow
import { EditorState, CharacterMetadata } from "draft-js"
import type { DraftBlockType } from "draft-js/lib/DraftBlockType.js.flow"

const UNSTYLED = "unstyled"
const ATOMIC = "atomic"
const IMAGE = "IMAGE"
const HORIZONTAL_RULE = "HORIZONTAL_RULE"

type EntityTypes = Array<string>

/**
 * Helper functions to filter/whitelist specific formatting.
 * Meant to be used when pasting unconstrained content.
 */

/**
 * Makes atomic blocks where they would be required for a block-level entity
 * to work correctly, when such an entity exists.
 * Note: at the moment, this is only useful for IMAGE entities that Draft.js
 * injects on arbitrary blocks on paste.
 */
export const preserveAtomicBlocks = (
  editorState: EditorState,
  entityTypes: Array<string>,
) => {
  const content = editorState.getCurrentContent()
  const blockMap = content.getBlockMap()

  const perservedBlocks = blockMap
    .filter((block) => {
      const entityKey = block.getEntityAt(0)

      return (
        entityKey &&
        entityTypes.includes(content.getEntity(entityKey).getType())
      )
    })
    .map((block) => block.set("type", ATOMIC))

  if (perservedBlocks.size !== 0) {
    return EditorState.set(editorState, {
      currentContent: content.merge({
        blockMap: blockMap.merge(perservedBlocks),
      }),
    })
  }

  return editorState
}

/**
 * Resets the depth of all the content to at most maxListNesting.
 */
export const resetBlockDepth = (
  editorState: EditorState,
  maxListNesting: number,
) => {
  const content = editorState.getCurrentContent()
  const blockMap = content.getBlockMap()

  const changedBlocks = blockMap
    .filter((block) => block.getDepth() > maxListNesting)
    .map((block) => block.set("depth", maxListNesting))

  if (changedBlocks.size !== 0) {
    return EditorState.set(editorState, {
      currentContent: content.merge({
        blockMap: blockMap.merge(changedBlocks),
      }),
    })
  }

  return editorState
}

/**
 * Resets all blocks that use unavailable types to unstyled.
 */
export const resetBlockType = (
  editorState: EditorState,
  enabledTypes: Array<DraftBlockType>,
) => {
  const content = editorState.getCurrentContent()
  const blockMap = content.getBlockMap()

  const changedBlocks = blockMap
    .filter((block) => !enabledTypes.includes(block.getType()))
    .map((block) => block.set("type", UNSTYLED))

  if (changedBlocks.size !== 0) {
    return EditorState.set(editorState, {
      currentContent: content.merge({
        blockMap: blockMap.merge(changedBlocks),
      }),
    })
  }

  return editorState
}

/**
 * Removes all styles that use unavailable types.
 */
export const filterInlineStyle = (
  editorState: EditorState,
  enabledTypes: Array<string>,
) => {
  const content = editorState.getCurrentContent()
  const blockMap = content.getBlockMap()

  const blocks = blockMap.map((block) => {
    let altered = false

    const chars = block.getCharacterList().map((char) => {
      let newChar = char

      char
        .getStyle()
        .filter((type) => !enabledTypes.includes(type))
        .forEach((type) => {
          altered = true
          newChar = CharacterMetadata.removeStyle(newChar, type)
        })

      return newChar
    })

    return altered ? block.set("characterList", chars) : block
  })

  return EditorState.set(editorState, {
    currentContent: content.merge({
      blockMap: blockMap.merge(blocks),
    }),
  })
}

/**
 * Resets atomic blocks to unstyled based on which entity types are enabled,
 * and also normalises block text to a single "space" character.
 */
export const resetAtomicBlocks = (
  editorState: EditorState,
  enabledTypes: Array<string>,
) => {
  const content = editorState.getCurrentContent()
  const blockMap = content.getBlockMap()
  let blocks = blockMap

  const normalisedBlocks = blocks
    .filter(
      (block) =>
        block.getType() === ATOMIC &&
        (block.getText() !== " " || block.getInlineStyleAt(0).size !== 0),
    )
    .map((block) => {
      // Retain only the first character, and remove all of its styles.
      const chars = block
        .getCharacterList()
        .slice(0, 1)
        .map((char) => {
          let newChar = char

          char.getStyle().forEach((type) => {
            newChar = CharacterMetadata.removeStyle(newChar, type)
          })

          return newChar
        })
      return block.merge({
        text: " ",
        characterList: chars,
      })
    })

  if (normalisedBlocks.size !== 0) {
    blocks = blockMap.merge(normalisedBlocks)
  }

  const resetBlocks = blocks
    .filter((block) => block.getType() === ATOMIC)
    .filter((block) => {
      const entityKey = block.getEntityAt(0)
      let shouldReset = false

      if (entityKey) {
        const entityType = content.getEntity(entityKey).getType()

        shouldReset = !enabledTypes.includes(entityType)
      }

      return shouldReset
    })
    .map((block) => block.set("type", UNSTYLED))

  if (resetBlocks.size !== 0) {
    blocks = blockMap.merge(resetBlocks)
  }

  return EditorState.set(editorState, {
    currentContent: content.merge({
      blockMap: blockMap.merge(blocks),
    }),
  })
}

/**
 * Reset all entity types (images, links, documents, embeds) that are unavailable.
 */
export const filterEntityType = (
  editorState: EditorState,
  enabledTypes: Array<string>,
) => {
  const content = editorState.getCurrentContent()
  const blockMap = content.getBlockMap()

  /**
   * Removes entities from the character list if the character entity isn't enabled.
   * Also removes image entities placed outside of atomic blocks, which can happen
   * on paste.
   * A better approach would probably be to split the block where the image is and
   * create an atomic block there, but that's another story. This is what Draft.js
   * does when the copy-paste is all within one editor.
   */
  const blocks = blockMap.map((block) => {
    const blockType = block.getType()
    let altered = false

    const chars = block.getCharacterList().map((char) => {
      const entityKey = char.getEntity()

      if (entityKey) {
        const entityType = content.getEntity(entityKey).getType()
        const shouldFilter = !enabledTypes.includes(entityType)
        /**
         * Special case for images. They should only be in atomic blocks.
         * This only removes the image entity, not the camera emoji (📷)
         * that Draft.js inserts.
         * If we want to remove this in the future, consider that:
         * - It needs to be removed in the block text, where it's 2 chars / 1 code point.
         * - The corresponding CharacterMetadata needs to be removed too, and it's 2 instances
         */
        const shouldFilterImage = entityType === IMAGE && blockType !== ATOMIC

        if (shouldFilter || shouldFilterImage) {
          altered = true
          return CharacterMetadata.applyEntity(char, null)
        }
      }

      return char
    })

    return altered ? block.set("characterList", chars) : block
  })

  return EditorState.set(editorState, {
    currentContent: content.merge({
      blockMap: blockMap.merge(blocks),
    }),
  })
}

/**
 * Applies whitelist and blacklist operations to the editor content,
 * so the resulting editor state is shaped according to Draftail
 * expectations and configuration.
 * As of now, this doesn't filter line breaks if they aren't disabled
 * as Draft.js does not preserve this type of whitespace on paste anyway.
 */
export const filterEditorState = (
  editorState: EditorState,
  maxListNesting: number,
  enableHorizontalRule: boolean,
  blockTypes: Array<DraftBlockType>,
  inlineStyles: Array<string>,
  entityTypes: EntityTypes,
) => {
  let nextEditorState = editorState
  const enabledBlockTypes = blockTypes.concat([
    // Always enabled in a Draftail editor.
    UNSTYLED,
    // Filtered depending on enabled entity types.
    ATOMIC,
  ])
  let enabledEntityTypes = entityTypes

  if (enableHorizontalRule) {
    enabledEntityTypes.push(HORIZONTAL_RULE)
  }

  // At the moment the list is hard-coded. In the future, the idea
  // would be to have separate config for block entities and inline entities.
  nextEditorState = preserveAtomicBlocks(nextEditorState, [
    HORIZONTAL_RULE,
    IMAGE,
  ])
  nextEditorState = resetBlockDepth(nextEditorState, maxListNesting)
  nextEditorState = resetBlockType(nextEditorState, enabledBlockTypes)
  nextEditorState = filterInlineStyle(nextEditorState, inlineStyles)
  nextEditorState = resetAtomicBlocks(nextEditorState, enabledEntityTypes)
  nextEditorState = filterEntityType(nextEditorState, enabledEntityTypes)

  return nextEditorState
}