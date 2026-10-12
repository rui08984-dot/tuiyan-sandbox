# Glama introspection image for the p1b MCP server (21 tools).
#
# The server lives in the p1b/ subdirectory of this monorepo and has zero
# runtime dependencies on purpose (see p1b/mcp/userTools.cjs) - the MCP layer
# never requires p1b/src/**, it spawns sub-scripts, and only on a tool call.
# So listing the tools needs no npm install at all.
FROM node:24-alpine
WORKDIR /app
COPY . .
CMD ["node", "p1b/mcp/index.cjs"]
