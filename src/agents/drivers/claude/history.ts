import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { DriverSink } from '../../driver';
import type { ChatNode } from '../../model';
import { ClaudeTranscript, USER_PREFIX, type Json } from './transcript';
import type { ClaudeConversation } from './stream';

export async function importHistory(
  sessionId: string,
  cwd: string,
  sink: DriverSink,
  conversation: ClaudeConversation,
): Promise<void> {
  try {
    const messages = await getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: true });
    const nodes = new Map<string, ChatNode>();
    const collector = new ClaudeTranscript({
      node: (node) => nodes.set(node.id, node),
      append: () => undefined,
    });
    // The SDK gives a system message no subtype, so a compaction is known by
    // the summary that follows its boundary, and takes the boundary's uuid
    // as the live stream does.
    let boundary: string | null = null;
    for (const message of messages) {
      const body = (message.message ?? {}) as Json;
      const entry = message as unknown as Json;
      const at = Date.parse(String(entry.timestamp));
      collector.at = Number.isNaN(at) ? null : at;
      if (message.type === 'system') {
        boundary = message.uuid;
      } else if (entry.isCompactSummary) {
        collector.compaction(boundary ?? message.uuid, 'auto');
      } else if (entry.is_meta) {
        continue;
      } else if (message.type === 'assistant') {
        collector.assistant(body, message.parent_tool_use_id);
        conversation.lastAssistantUuid = message.uuid;
      } else if (message.type === 'user') {
        const structured = (message as unknown as Json).tool_use_result;
        collector.user(body, structured, message.parent_tool_use_id, message.uuid);
        if (!message.parent_tool_use_id) {
          conversation.before.set(`${USER_PREFIX}${message.uuid}`, conversation.lastAssistantUuid);
        }
      }
    }
    sink.history([...nodes.values()]);
  } catch (error) {
    sink.log('claude history import failed', { error: String(error) });
  }
}
