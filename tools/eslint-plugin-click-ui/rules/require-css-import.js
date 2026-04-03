/**
 * Rule: require-css-import
 * Ensures cui.css is imported when using Click UI components
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require importing Click UI CSS file',
      category: 'Setup',
      recommended: true,
    },
    messages: {
      missingCssImport: "Missing required CSS import. Add: import '@clickhouse/click-ui/cui.css'",
    },
    schema: [],
  },

  create(context) {
    let hasClickUIImports = false;
    let hasCssImport = false;

    return {
      ImportDeclaration(node) {
        if (node.source.value === '@clickhouse/click-ui') {
          hasClickUIImports = true;
        }
        
        if (node.source.value === '@clickhouse/click-ui/cui.css') {
          hasCssImport = true;
        }
      },

      'Program:exit'() {
        const filename = context.getFilename();
        const isRootFile = filename.match(/(App|_app|index|main)\.(tsx?|jsx?)$/i);
        
        if (hasClickUIImports && isRootFile && !hasCssImport) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'missingCssImport',
          });
        }
      },
    };
  },
};
