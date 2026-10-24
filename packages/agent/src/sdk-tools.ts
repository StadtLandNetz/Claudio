import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudioTool } from "@claudio/browser";

/** Wraps the neutral Claudio tool definitions as an in-process MCP server for the Agent SDK. */
export function createClaudioSdkServer(tools: ClaudioTool<any>[]): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "claudio",
    version: "0.1.0",
    alwaysLoad: true,
    instructions:
      "Claudio tools record the review: login_as for authentication, capture_evidence for screenshots, report_finding and record_ac_result for results, todo_* and note for working memory, get_console / get_network for runtime errors. In a repository analysis, write_knowledge stores the documents and propose_test proposes regression tests for a person to accept.",
    tools: tools.map((t) =>
      tool(
        t.name,
        t.description,
        t.schema,
        async (args) => ({ content: [{ type: "text" as const, text: await t.handler(args as never) }] }),
        { annotations: { readOnlyHint: t.readOnly ?? false }, alwaysLoad: true },
      ),
    ),
  });
}
