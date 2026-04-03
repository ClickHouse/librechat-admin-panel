/**
 * Rule: dialog-controlled-state
 * Ensures Dialog component uses controlled state (open + onOpenChange)
 */

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Dialog must use controlled state with open and onOpenChange props',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingOpen: 'Dialog requires "open" prop for controlled state.',
      missingOnOpenChange: 'Dialog requires "onOpenChange" prop for controlled state.',
      avoidDefaultOpen: 'Avoid using "defaultOpen" - Dialog should use controlled state with "open" and "onOpenChange".',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Dialog') {
          const hasOpen = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'open'
          );
          const hasOnOpenChange = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'onOpenChange'
          );
          const hasDefaultOpen = openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'defaultOpen'
          );

          if (!hasOpen) {
            context.report({
              node: openingElement,
              messageId: 'missingOpen',
            });
          }

          if (!hasOnOpenChange) {
            context.report({
              node: openingElement,
              messageId: 'missingOnOpenChange',
            });
          }

          if (hasDefaultOpen) {
            const defaultOpenProp = openingElement.attributes.find(
              attr => attr.type === 'JSXAttribute' && attr.name.name === 'defaultOpen'
            );
            context.report({
              node: defaultOpenProp,
              messageId: 'avoidDefaultOpen',
            });
          }
        }
      },
    };
  },
};
