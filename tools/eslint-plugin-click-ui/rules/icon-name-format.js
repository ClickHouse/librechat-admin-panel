/**
 * Rule: icon-name-format
 * Ensures Icon component names use hyphens, not underscores or camelCase
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Icon names must use hyphens, not underscores or camelCase',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      wrongFormat: 'Icon name "{{name}}" uses wrong format. Icon names must use hyphens (e.g., "check-in-circle", not "check_in_circle" or "checkInCircle").',
      suggestFormat: 'Did you mean "{{suggestion}}"?',
    },
    fixable: 'code',
    schema: [],
  },

  create(context) {
    function convertToHyphenFormat(name) {
      // Convert underscores to hyphens
      let converted = name.replace(/_/g, '-');
      
      // Convert camelCase to hyphen-case
      converted = converted.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      
      return converted;
    }

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Icon') {
          const nameAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'name'
          );

          if (nameAttr && nameAttr.value) {
            let iconName = '';
            
            if (nameAttr.value.type === 'Literal') {
              iconName = nameAttr.value.value;
            } else if (nameAttr.value.type === 'JSXExpressionContainer' && 
                       nameAttr.value.expression.type === 'Literal') {
              iconName = nameAttr.value.expression.value;
            }

            if (iconName) {
              // Check if name contains underscores or is in camelCase
              const hasUnderscores = iconName.includes('_');
              const isCamelCase = /[a-z][A-Z]/.test(iconName);

              if (hasUnderscores || isCamelCase) {
                const suggestion = convertToHyphenFormat(iconName);
                
                context.report({
                  node: nameAttr,
                  messageId: 'wrongFormat',
                  data: { name: iconName },
                  fix(fixer) {
                    if (nameAttr.value.type === 'Literal') {
                      return fixer.replaceText(nameAttr.value, `"${suggestion}"`);
                    } else if (nameAttr.value.type === 'JSXExpressionContainer') {
                      return fixer.replaceText(nameAttr.value.expression, `"${suggestion}"`);
                    }
                    return null;
                  },
                });

                context.report({
                  node: nameAttr,
                  messageId: 'suggestFormat',
                  data: { suggestion },
                });
              }
            }
          }
        }
      },
    };
  },
};
