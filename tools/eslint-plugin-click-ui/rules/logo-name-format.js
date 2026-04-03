/**
 * Rule: logo-name-format
 * Ensures Logo component names use underscores, not hyphens or camelCase
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Logo names must use underscores, not hyphens or camelCase',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      wrongFormat: 'Logo name "{{name}}" uses wrong format. Logo names must use underscores (e.g., "digital_ocean", not "digital-ocean" or "digitalOcean").',
      suggestFormat: 'Did you mean "{{suggestion}}"?',
    },
    fixable: 'code',
    schema: [],
  },

  create(context) {
    function convertToUnderscoreFormat(name) {
      // Convert hyphens to underscores
      let converted = name.replace(/-/g, '_');
      
      // Convert camelCase to underscore_case
      converted = converted.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      
      return converted;
    }

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Logo') {
          const nameAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'name'
          );

          if (nameAttr && nameAttr.value) {
            let logoName = '';
            
            if (nameAttr.value.type === 'Literal') {
              logoName = nameAttr.value.value;
            } else if (nameAttr.value.type === 'JSXExpressionContainer' && 
                       nameAttr.value.expression.type === 'Literal') {
              logoName = nameAttr.value.expression.value;
            }

            if (logoName) {
              // Check if name contains hyphens or is in camelCase
              const hasHyphens = logoName.includes('-');
              const isCamelCase = /[a-z][A-Z]/.test(logoName);

              if (hasHyphens || isCamelCase) {
                const suggestion = convertToUnderscoreFormat(logoName);
                
                context.report({
                  node: nameAttr,
                  messageId: 'wrongFormat',
                  data: { name: logoName },
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
