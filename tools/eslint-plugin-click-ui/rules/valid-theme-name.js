/**
 * Rule: valid-theme-name
 * Validates theme prop values
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Ensure theme name is valid',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidTheme: 'Theme must be "dark", "light", or "classic". Got "{{value}}".',
    },
    schema: [],
  },

  create(context) {
    const validThemes = ['dark', 'light', 'classic'];

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'ClickUIProvider') {
          const themeAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'theme'
          );

          if (themeAttr && themeAttr.value) {
            let themeValue = '';
            
            if (themeAttr.value.type === 'Literal') {
              themeValue = themeAttr.value.value;
            } else if (themeAttr.value.type === 'JSXExpressionContainer' && 
                       themeAttr.value.expression.type === 'Literal') {
              themeValue = themeAttr.value.expression.value;
            }

            if (themeValue && !validThemes.includes(themeValue)) {
              context.report({
                node: themeAttr,
                messageId: 'invalidTheme',
                data: { value: themeValue },
              });
            }
          }
        }
      },
    };
  },
};
