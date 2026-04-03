/**
 * Rule: prefer-named-imports
 * Enforces named imports over default imports for tree-shaking
 */

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer named imports for tree-shaking',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      useNamedImports: 'Use named imports instead of default import for tree-shaking: import { Button, TextField } from "@clickhouse/click-ui"',
    },
    schema: [],
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === '@clickhouse/click-ui') {
          const hasDefaultImport = node.specifiers.some(
            spec => spec.type === 'ImportDefaultSpecifier'
          );

          if (hasDefaultImport) {
            context.report({
              node,
              messageId: 'useNamedImports',
            });
          }
        }
      },
    };
  },
};
