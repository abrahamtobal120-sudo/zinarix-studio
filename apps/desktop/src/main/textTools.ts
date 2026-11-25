// The text protocol for tools lives in @omni/core, shared with the terminal agent.
export {
  ToolTagFilter,
  leakedToolCalls,
  parseToolCalls,
  protocolBlock,
  resultsMessage,
  toolsUnsupported,
  withProtocol,
} from '@omni/core';
export type { ParsedCalls } from '@omni/core';
