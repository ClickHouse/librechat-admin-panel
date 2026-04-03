/**
 * Rule: require-provider
 * Ensures ClickUIProvider is present in the application root
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require ClickUIProvider to wrap the application',
      category: 'Setup',
      recommended: true,
    },
    messages: {
      missingProvider: 'Click UI components must be wrapped in ClickUIProvider. Add <ClickUIProvider theme="dark"> around your app.',
    },
    schema: [],
  },

  create(context) {
    let hasClickUIImports = false;
    let hasProviderUsage = false;

    return {
      ImportDeclaration(node) {
        if (node.source.value === '@clickhouse/click-ui') {
          hasClickUIImports = true;
          
          // Check if ClickUIProvider is imported
          const hasProviderImport = node.specifiers.some(
            spec => spec.imported && spec.imported.name === 'ClickUIProvider'
          );
          
          if (!hasProviderImport && node.specifiers.length > 0) {
            // Has other Click UI imports but not the provider
            const filename = (context.filename ?? context.getFilename());
            // Only warn in root files (App.tsx, _app.tsx, index.tsx)
            if (filename.match(/(App|_app|index|main)\.(tsx?|jsx?)$/i)) {
              context.report({
                node,
                messageId: 'missingProvider',
              });
            }
          }
        }
      },

      JSXElement(node) {
        if (
          node.openingElement.name.name === 'ClickUIProvider' ||
          (node.openingElement.name.object && 
           node.openingElement.name.object.name === 'ClickUIProvider')
        ) {
          hasProviderUsage = true;
        }
      },

      'Program:exit'() {
        const filename = (context.filename ?? context.getFilename());
        const isRootFile = filename.match(/(App|_app|index|main)\.(tsx?|jsx?)$/i);
        
        if (hasClickUIImports && isRootFile && !hasProviderUsage) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'missingProvider',
          });
        }
      },
    };
  },
};
