import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { Msg } from "./env";

/**
 * Read-only assistant-ui conversation view. We feed a static messages[] through
 * useExternalStoreRuntime (stable API — no unstable_ converter) with a no-op
 * onNew, since this is display-only. Text parts render as markdown.
 */

const MarkdownText = () => <MarkdownTextPrimitive />;

const UserMessage = () => (
  <MessagePrimitive.Root className="om-row om-user">
    <div className="om-role">user</div>
    <div className="om-bubble">
      <MessagePrimitive.Content components={{ Text: MarkdownText }} />
    </div>
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root className="om-row om-assistant">
    <div className="om-role">assistant</div>
    <div className="om-bubble">
      <MessagePrimitive.Content components={{ Text: MarkdownText }} />
    </div>
  </MessagePrimitive.Root>
);

export function ConversationView({ messages }: { messages: Msg[] }) {
  const runtime = useExternalStoreRuntime<Msg>({
    isRunning: false,
    messages,
    onNew: async () => {},
    convertMessage: (m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="om-thread">
        <ThreadPrimitive.Viewport className="om-viewport">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
