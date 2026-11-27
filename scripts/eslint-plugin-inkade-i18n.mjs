const USER_FACING_JSX_ATTRS = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "label",
  "description",
  "oldLabel",
  "newLabel",
  "rootTitle",
  "emptyText",
]);

const TOAST_CALLEES = new Set([
  "showSuccessToast",
  "showErrorToast",
  "showUndoToast",
]);

const TOAST_MEMBER_METHODS = new Set([
  "success",
  "error",
  "info",
  "warning",
  "message",
  "loading",
]);

const ALLOWED_TECHNICAL_TOKENS = new Set([
  "Inkade",
  "BB",
  "Paseo",
  "Cindy",
  "MCP",
  "/mcp",
  "/dispatch",
  ".md",
  "⌘K",
  "⌘.",
  "G D",
  "G I",
  "G L",
  "G T",
  "E",
  "Esc",
  "https://...",
  "bb://thread/...",
  "ink_...",
  "you@example.com",
  "••••••••",
  "mermaid",
]);

function isMeaningfulHumanText(raw) {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (ALLOWED_TECHNICAL_TOKENS.has(trimmed)) return false;
  // Pure punctuation, numbers, emojis, or single-symbol tokens are allowed.
  if (!/[\p{L}\u4e00-\u9fff]/u.test(trimmed)) return false;
  // Allow purely technical version prefixes like "v" or "p=" or "@@ -"
  if (/^[a-z]$/i.test(trimmed)) return false;
  if (/^(https?:\/\/|\/[a-z0-9/_-]+)$/i.test(trimmed)) return false;
  return true;
}

function collectHardcodedStrings(expr, out) {
  if (!expr) return;
  if (expr.type === "Literal" && typeof expr.value === "string") {
    if (isMeaningfulHumanText(expr.value)) {
      out.push({ node: expr, value: expr.value });
    }
    return;
  }
  if (expr.type === "TemplateLiteral") {
    for (const quasi of expr.quasis) {
      const text = quasi.value?.cooked ?? quasi.value?.raw ?? "";
      if (isMeaningfulHumanText(text)) {
        out.push({ node: expr, value: text });
        return;
      }
    }
    return;
  }
  if (expr.type === "ConditionalExpression") {
    collectHardcodedStrings(expr.consequent, out);
    collectHardcodedStrings(expr.alternate, out);
    return;
  }
  if (expr.type === "LogicalExpression") {
    collectHardcodedStrings(expr.left, out);
    collectHardcodedStrings(expr.right, out);
  }
}

export const inkadeI18nPlugin = {
  meta: {
    name: "inkade-i18n",
    version: "0.1.0",
  },
  rules: {
    "no-hardcoded-ui-string": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow hardcoded user-facing strings in UI JSX attributes, JSX expressions, and toast calls; use @inkade/i18n t(...) instead.",
        },
        schema: [],
        messages: {
          hardcodedAttr:
            'Hardcoded user-facing string {{value}} in JSX attribute "{{attr}}". Use t("...") from @inkade/i18n.',
          hardcodedToast:
            'Hardcoded user-facing string {{value}} in toast notification. Use t("...") from @inkade/i18n.',
          hardcodedJsxExpr:
            'Hardcoded user-facing string {{value}} inside JSX expression. Use t("...") from @inkade/i18n.',
        },
      },
      create(context) {
        return {
          JSXAttribute(node) {
            const attrName =
              node.name?.type === "JSXIdentifier" ? node.name.name : null;
            if (!attrName || !USER_FACING_JSX_ATTRS.has(attrName)) return;
            if (!node.value) return;

            if (node.value.type === "Literal" && typeof node.value.value === "string") {
              if (isMeaningfulHumanText(node.value.value)) {
                context.report({
                  node: node.value,
                  messageId: "hardcodedAttr",
                  data: {
                    attr: attrName,
                    value: JSON.stringify(node.value.value.trim().slice(0, 48)),
                  },
                });
              }
              return;
            }

            if (node.value.type === "JSXExpressionContainer") {
              const found = [];
              collectHardcodedStrings(node.value.expression, found);
              for (const item of found) {
                context.report({
                  node: item.node,
                  messageId: "hardcodedAttr",
                  data: {
                    attr: attrName,
                    value: JSON.stringify(item.value.trim().slice(0, 48)),
                  },
                });
              }
            }
          },

          JSXExpressionContainer(node) {
            // Only inspect JSX children expressions (not JSXAttribute values, handled above).
            if (node.parent?.type === "JSXAttribute") return;
            const found = [];
            collectHardcodedStrings(node.expression, found);
            for (const item of found) {
              context.report({
                node: item.node,
                messageId: "hardcodedJsxExpr",
                data: {
                  value: JSON.stringify(item.value.trim().slice(0, 48)),
                },
              });
            }
          },

          CallExpression(node) {
            const { callee, arguments: args } = node;
            if (!args || args.length === 0) return;

            if (callee.type === "Identifier" && TOAST_CALLEES.has(callee.name)) {
              if (callee.name === "showUndoToast" && args[0]?.type === "ObjectExpression") {
                for (const prop of args[0].properties) {
                  if (
                    prop.type === "Property" &&
                    prop.key?.type === "Identifier" &&
                    (prop.key.name === "title" || prop.key.name === "description")
                  ) {
                    const found = [];
                    collectHardcodedStrings(prop.value, found);
                    for (const item of found) {
                      context.report({
                        node: item.node,
                        messageId: "hardcodedToast",
                        data: { value: JSON.stringify(item.value.trim().slice(0, 48)) },
                      });
                    }
                  }
                }
                return;
              }

              for (const arg of args.slice(0, 2)) {
                const found = [];
                collectHardcodedStrings(arg, found);
                for (const item of found) {
                  context.report({
                    node: item.node,
                    messageId: "hardcodedToast",
                    data: { value: JSON.stringify(item.value.trim().slice(0, 48)) },
                  });
                }
              }
              return;
            }

            const isToastCall =
              (callee.type === "Identifier" && callee.name === "toast") ||
              (callee.type === "MemberExpression" &&
                callee.object?.type === "Identifier" &&
                callee.object.name === "toast" &&
                callee.property?.type === "Identifier" &&
                TOAST_MEMBER_METHODS.has(callee.property.name));

            if (isToastCall) {
              const found = [];
              collectHardcodedStrings(args[0], found);
              for (const item of found) {
                context.report({
                  node: item.node,
                  messageId: "hardcodedToast",
                  data: { value: JSON.stringify(item.value.trim().slice(0, 48)) },
                });
              }
            }
          },
        };
      },
    },
  },
};
